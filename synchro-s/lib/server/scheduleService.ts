import type {
  ClassTypeOption,
  ConflictResult,
  CreateScheduleRequest,
  RoleView,
  ScheduleEvent,
  ScheduleStatus,
  ScheduleWeekResponse
} from "@/types/schedule";
import { addDays, dateToWeekday, fromSqlTime, rangesOverlap, timeToMinutes, toSqlTime, weekRange } from "@/lib/time";
import { validateSchedulePayload } from "@/lib/validators";

type SupabaseLike = {
  from: (table: string) => any;
};

type WeeklyQuery = {
  weekStart: string;
  view: RoleView;
  instructorId?: string | null;
  studentId?: string | null;
};

type OverrideRow = {
  class_id: string;
  override_date: string;
  action: "cancel" | "reschedule" | "status_only";
  override_instructor_id: string | null;
  override_start_time: string | null;
  override_end_time: string | null;
  override_status: ScheduleStatus | null;
};

type ClassRow = {
  id: string;
  schedule_mode: "recurring" | "one_off";
  instructor_id: string;
  subject_code: string;
  class_type_code: string;
  weekday: number | null;
  class_date: string | null;
  start_time: string;
  end_time: string;
  active_from: string;
  active_to: string | null;
  progress_status: ScheduleStatus;
  created_at: string;
  instructors: { id: string; instructor_name: string } | null;
  subjects: { code: string; display_name: string; tailwind_bg_class: string } | null;
  class_types: { code: string; display_name: string; badge_text: string; max_students: number } | null;
};

type EnrollmentRow = {
  class_id: string;
  student_id: string;
  students: { id: string; student_name: string } | null;
};

const CLASS_SELECT =
  "id,schedule_mode,instructor_id,subject_code,class_type_code,weekday,class_date,start_time,end_time,active_from,active_to,progress_status,created_at,instructors(id,instructor_name),subjects(code,display_name,tailwind_bg_class),class_types(code,display_name,badge_text,max_students)";

function buildOverrideKey(classId: string, date: string): string {
  return `${classId}:${date}`;
}

async function findExistingOverlaps(
  supabase: SupabaseLike,
  payload: CreateScheduleRequest,
  excludeClassId?: string
): Promise<{ id: string; class_type_code: string }[]> {
  if (payload.scheduleMode === "recurring") {
    const referenceDate = payload.activeFrom ?? new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("classes")
      .select("id,class_type_code,start_time,end_time,active_from,active_to")
      .eq("instructor_id", payload.instructorId)
      .eq("schedule_mode", "recurring")
      .eq("weekday", payload.weekday);

    if (error) throw error;

    const rows = (data ?? []) as {
      id: string;
      class_type_code: string;
      start_time: string;
      end_time: string;
      active_from: string;
      active_to: string | null;
    }[];

    return rows
      .filter((row) => (excludeClassId ? row.id !== excludeClassId : true))
      .filter((row) => row.active_from <= referenceDate && (!row.active_to || row.active_to >= referenceDate))
      .filter((row) => rangesOverlap(payload.startTime, payload.endTime, fromSqlTime(row.start_time), fromSqlTime(row.end_time)))
      .map((row) => ({ id: row.id, class_type_code: row.class_type_code }));
  }

  const targetDate = payload.classDate as string;
  const targetWeekday = dateToWeekday(targetDate);

  const [oneOffRes, recurringRes] = await Promise.all([
    supabase
      .from("classes")
      .select("id,class_type_code,start_time,end_time")
      .eq("instructor_id", payload.instructorId)
      .eq("schedule_mode", "one_off")
      .eq("class_date", targetDate),
    supabase
      .from("classes")
      .select("id,class_type_code,start_time,end_time")
      .eq("instructor_id", payload.instructorId)
      .eq("schedule_mode", "recurring")
      .eq("weekday", targetWeekday)
      .lte("active_from", targetDate)
      .or(`active_to.is.null,active_to.gte.${targetDate}`)
  ]);

  if (oneOffRes.error) throw oneOffRes.error;
  if (recurringRes.error) throw recurringRes.error;

  const rows = [
    ...((oneOffRes.data ?? []) as { id: string; class_type_code: string; start_time: string; end_time: string }[]),
    ...((recurringRes.data ?? []) as { id: string; class_type_code: string; start_time: string; end_time: string }[])
  ];

  return rows
    .filter((row) => (excludeClassId ? row.id !== excludeClassId : true))
    .filter((row) => rangesOverlap(payload.startTime, payload.endTime, fromSqlTime(row.start_time), fromSqlTime(row.end_time)))
    .map((row) => ({ id: row.id, class_type_code: row.class_type_code }));
}

async function loadCompatibilityMap(
  supabase: SupabaseLike,
  candidateType: string,
  existingTypes: string[]
): Promise<Map<string, { is_compatible: boolean; reason: string | null }>> {
  if (existingTypes.length === 0) {
    return new Map();
  }

  const [directRes, reverseRes] = await Promise.all([
    supabase
      .from("class_type_compatibility")
      .select("class_type_a,class_type_b,is_compatible,reason")
      .eq("class_type_a", candidateType)
      .in("class_type_b", existingTypes),
    supabase
      .from("class_type_compatibility")
      .select("class_type_a,class_type_b,is_compatible,reason")
      .eq("class_type_b", candidateType)
      .in("class_type_a", existingTypes)
  ]);

  if (directRes.error) throw directRes.error;
  if (reverseRes.error) throw reverseRes.error;

  const map = new Map<string, { is_compatible: boolean; reason: string | null }>();

  for (const row of [...(directRes.data ?? []), ...(reverseRes.data ?? [])]) {
    map.set(`${row.class_type_a}:${row.class_type_b}`, {
      is_compatible: row.is_compatible,
      reason: row.reason
    });
  }

  return map;
}

function resolveCompatibility(
  compatibilityMap: Map<string, { is_compatible: boolean; reason: string | null }>,
  candidateType: string,
  existingType: string
): { isCompatible: boolean; reason: string } {
  const direct = compatibilityMap.get(`${candidateType}:${existingType}`);
  if (direct) {
    return {
      isCompatible: direct.is_compatible,
      reason: direct.reason ?? "Incompatible class type overlap"
    };
  }

  const reverse = compatibilityMap.get(`${existingType}:${candidateType}`);
  if (reverse) {
    return {
      isCompatible: reverse.is_compatible,
      reason: reverse.reason ?? "Incompatible class type overlap"
    };
  }

  if (candidateType === existingType) {
    return {
      isCompatible: true,
      reason: "same class type"
    };
  }

  return {
    isCompatible: false,
    reason: `No compatibility rule defined for ${candidateType} vs ${existingType}`
  };
}

async function checkMoveConflictForWeek(
  supabase: SupabaseLike,
  params: {
    classId: string;
    instructorId: string;
    classTypeCode: string;
    weekStart: string;
    weekday: number;
    startTime: string;
    endTime: string;
  }
): Promise<ConflictResult> {
  const weekly = await fetchWeeklySchedule(supabase, {
    weekStart: params.weekStart,
    view: "instructor",
    instructorId: params.instructorId
  });

  const overlaps = weekly.events.filter(
    (event) =>
      event.id !== params.classId &&
      event.weekday === params.weekday &&
      rangesOverlap(params.startTime, params.endTime, event.startTime, event.endTime)
  );

  if (overlaps.length === 0) {
    return { hasConflict: false, conflicts: [] };
  }

  const existingTypes = Array.from(new Set(overlaps.map((event) => event.classTypeCode)));
  const compatibilityMap = await loadCompatibilityMap(supabase, params.classTypeCode, existingTypes);

  const conflicts: { classId: string; reason: string }[] = [];
  for (const overlap of overlaps) {
    const check = resolveCompatibility(compatibilityMap, params.classTypeCode, overlap.classTypeCode);
    if (!check.isCompatible) {
      conflicts.push({ classId: overlap.id, reason: check.reason });
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts
  };
}

export async function checkScheduleConflict(
  supabase: SupabaseLike,
  payload: CreateScheduleRequest,
  options?: { excludeClassId?: string }
): Promise<ConflictResult> {
  const errors = validateSchedulePayload(payload);
  if (errors.length > 0) {
    throw new Error(errors.join(", "));
  }

  const overlaps = await findExistingOverlaps(supabase, payload, options?.excludeClassId);
  if (overlaps.length === 0) {
    return { hasConflict: false, conflicts: [] };
  }

  const existingTypes = Array.from(new Set(overlaps.map((row) => row.class_type_code)));
  const compatibilityMap = await loadCompatibilityMap(supabase, payload.classTypeCode, existingTypes);

  const conflicts: { classId: string; reason: string }[] = [];

  for (const overlap of overlaps) {
    const check = resolveCompatibility(compatibilityMap, payload.classTypeCode, overlap.class_type_code);
    if (!check.isCompatible) {
      conflicts.push({ classId: overlap.id, reason: check.reason });
    }
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts
  };
}

function addMinutes(time: string, minutesToAdd: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutesToAdd;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

async function getClassType(supabase: SupabaseLike, classTypeCode: string): Promise<ClassTypeOption> {
  const { data, error } = await supabase
    .from("class_types")
    .select("code,display_name,badge_text,max_students")
    .eq("code", classTypeCode)
    .single();

  if (error || !data) {
    throw new Error(`Unknown class type: ${classTypeCode}`);
  }

  return {
    code: data.code,
    label: data.display_name,
    badgeText: data.badge_text,
    maxStudents: data.max_students
  };
}

export async function createScheduleWithEnrollments(
  supabase: SupabaseLike,
  payload: CreateScheduleRequest,
  actorUserId: string
) {
  const dedupedStudentIds = Array.from(new Set(payload.studentIds));
  const errors = validateSchedulePayload({ ...payload, studentIds: dedupedStudentIds });
  if (errors.length > 0) {
    throw new Error(errors.join(", "));
  }

  const classType = await getClassType(supabase, payload.classTypeCode);
  if (dedupedStudentIds.length > classType.maxStudents) {
    throw new Error(`Class type ${classType.label} supports max ${classType.maxStudents} students`);
  }

  const conflict = await checkScheduleConflict(supabase, { ...payload, studentIds: dedupedStudentIds });
  if (conflict.hasConflict) {
    return { classId: "", conflict };
  }

  const classInsertPayload = {
    schedule_mode: payload.scheduleMode,
    instructor_id: payload.instructorId,
    subject_code: payload.subjectCode,
    class_type_code: payload.classTypeCode,
    weekday: payload.scheduleMode === "recurring" ? payload.weekday : null,
    class_date: payload.scheduleMode === "one_off" ? payload.classDate : null,
    start_time: toSqlTime(payload.startTime),
    end_time: toSqlTime(payload.endTime),
    active_from: payload.activeFrom,
    created_by: actorUserId
  };

  const { data: insertedClass, error: classError } = await supabase
    .from("classes")
    .insert(classInsertPayload)
    .select("id")
    .single();

  if (classError || !insertedClass) {
    throw classError ?? new Error("Failed to create class");
  }

  const enrollmentRows = dedupedStudentIds.map((studentId) => ({
    class_id: insertedClass.id,
    student_id: studentId
  }));

  const { error: enrollmentError } = await supabase.from("class_enrollments").insert(enrollmentRows);

  if (enrollmentError) {
    await supabase.from("classes").delete().eq("id", insertedClass.id);
    throw enrollmentError;
  }

  return {
    classId: insertedClass.id,
    conflict
  };
}

export async function importScheduleRow(
  supabase: SupabaseLike,
  payload: CreateScheduleRequest,
  actorUserId: string
): Promise<{ status: "created" | "enrolled" | "existing" | "conflict"; classId: string; conflict: ConflictResult }> {
  const dedupedStudentIds = Array.from(new Set(payload.studentIds));
  const errors = validateSchedulePayload({ ...payload, studentIds: dedupedStudentIds });
  if (errors.length > 0) {
    throw new Error(errors.join(", "));
  }
  const studentId = dedupedStudentIds[0];
  if (!studentId) {
    throw new Error("studentIds must contain at least one student");
  }

  const exactQuery = supabase
    .from("classes")
    .select("id,active_from,active_to,schedule_mode")
    .eq("schedule_mode", payload.scheduleMode)
    .eq("instructor_id", payload.instructorId)
    .eq("subject_code", payload.subjectCode)
    .eq("class_type_code", payload.classTypeCode)
    .eq("start_time", toSqlTime(payload.startTime))
    .eq("end_time", toSqlTime(payload.endTime))
    .limit(1);

  if (payload.scheduleMode === "recurring") {
    exactQuery.eq("weekday", payload.weekday);
  } else {
    exactQuery.eq("class_date", payload.classDate);
  }

  const { data: exactRows, error: exactError } = await exactQuery;
  if (exactError) throw exactError;

  if ((exactRows ?? []).length > 0) {
    const classId = exactRows[0].id as string;
    const existingActiveFrom = exactRows[0].active_from as string | null;
    const existingActiveTo = exactRows[0].active_to as string | null;
    const normalizeActiveFrom = payload.scheduleMode === "recurring" && payload.activeFrom ? payload.activeFrom : null;

    if (payload.scheduleMode === "recurring" && normalizeActiveFrom) {
      const updatePayload: { active_from?: string; active_to?: string | null; updated_at?: string } = {};
      if (!existingActiveFrom || existingActiveFrom > normalizeActiveFrom) {
        updatePayload.active_from = normalizeActiveFrom;
      }
      if (existingActiveTo && existingActiveTo < normalizeActiveFrom) {
        updatePayload.active_to = null;
      }
      if (Object.keys(updatePayload).length > 0) {
        updatePayload.updated_at = new Date().toISOString();
        const { error: activeUpdateError } = await supabase.from("classes").update(updatePayload).eq("id", classId);
        if (activeUpdateError) throw activeUpdateError;
      }
    }
    const { data: existingEnrollment, error: enrollmentReadError } = await supabase
      .from("class_enrollments")
      .select("id")
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (enrollmentReadError) throw enrollmentReadError;

    if (existingEnrollment) {
      return { status: "existing", classId, conflict: { hasConflict: false, conflicts: [] } };
    }

    const classType = await getClassType(supabase, payload.classTypeCode);
    const { count: enrollmentCount, error: countError } = await supabase
      .from("class_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("class_id", classId);
    if (countError) throw countError;

    if ((enrollmentCount ?? 0) >= classType.maxStudents) {
      return {
        status: "conflict",
        classId,
        conflict: {
          hasConflict: true,
          conflicts: [{ classId, reason: `정원 초과: ${classType.label} 최대 ${classType.maxStudents}명` }]
        }
      };
    }

    const { error: enrollmentInsertError } = await supabase.from("class_enrollments").insert({
      class_id: classId,
      student_id: studentId
    });
    if (enrollmentInsertError) throw enrollmentInsertError;

    return { status: "enrolled", classId, conflict: { hasConflict: false, conflicts: [] } };
  }

  const created = await createScheduleWithEnrollments(supabase, payload, actorUserId);
  if (created.conflict.hasConflict) {
    return { status: "conflict", classId: "", conflict: created.conflict };
  }
  return { status: "created", classId: created.classId, conflict: created.conflict };
}

async function loadClassIdsForStudent(supabase: SupabaseLike, studentId: string): Promise<string[]> {
  const { data, error } = await supabase.from("class_enrollments").select("class_id").eq("student_id", studentId);
  if (error) {
    throw error;
  }
  return Array.from(new Set((data ?? []).map((row: { class_id: string }) => row.class_id)));
}

function classToEvent(
  row: ClassRow,
  date: string,
  weekday: number,
  enrollmentMap: Map<string, EnrollmentRow[]>,
  instructorNameMap: Map<string, string>,
  override?: OverrideRow
): ScheduleEvent {
  const enrollments = enrollmentMap.get(row.id) ?? [];
  const effectiveInstructorId = override?.override_instructor_id ?? row.instructor_id;

  return {
    id: row.id,
    scheduleMode: row.schedule_mode,
    instructorId: effectiveInstructorId,
    instructorName:
      instructorNameMap.get(effectiveInstructorId) ?? row.instructors?.instructor_name ?? "Unknown Instructor",
    studentIds: enrollments.map((enrollment) => enrollment.student_id),
    studentNames: enrollments.map((enrollment) => enrollment.students?.student_name ?? "Unknown Student"),
    subjectCode: row.subject_code,
    subjectName: row.subjects?.display_name ?? row.subject_code,
    classTypeCode: row.class_type_code,
    classTypeLabel: row.class_types?.display_name ?? row.class_type_code,
    badgeText: row.class_types?.badge_text ?? `[${row.class_type_code}]`,
    weekday: weekday as ScheduleEvent["weekday"],
    classDate: date,
    startTime: fromSqlTime(override?.override_start_time ?? row.start_time),
    endTime: fromSqlTime(override?.override_end_time ?? row.end_time),
    progressStatus: override?.override_status ?? row.progress_status,
    createdAt: row.created_at
  };
}

export async function fetchWeeklySchedule(
  supabase: SupabaseLike,
  params: WeeklyQuery
): Promise<ScheduleWeekResponse> {
  const { weekStart, weekEnd } = weekRange(params.weekStart);

  let studentClassIds: string[] | null = null;

  if (params.view === "student") {
    if (!params.studentId) {
      throw new Error("studentId is required for student view query");
    }
    studentClassIds = await loadClassIdsForStudent(supabase, params.studentId);
    if (studentClassIds.length === 0) {
      return { weekStart, weekEnd, events: [] };
    }
  }

  const recurringQuery = supabase
    .from("classes")
    .select(CLASS_SELECT)
    .eq("schedule_mode", "recurring")
    .lte("active_from", weekEnd)
    .or(`active_to.is.null,active_to.gte.${weekStart}`);

  const oneOffQuery = supabase
    .from("classes")
    .select(CLASS_SELECT)
    .eq("schedule_mode", "one_off")
    .gte("class_date", weekStart)
    .lte("class_date", weekEnd);

  if (params.view === "instructor" && params.instructorId) {
    recurringQuery.eq("instructor_id", params.instructorId);
    oneOffQuery.eq("instructor_id", params.instructorId);
  }

  if (studentClassIds && studentClassIds.length > 0) {
    recurringQuery.in("id", studentClassIds);
    oneOffQuery.in("id", studentClassIds);
  }

  const [recurringRes, oneOffRes] = await Promise.all([recurringQuery, oneOffQuery]);

  if (recurringRes.error) throw recurringRes.error;
  if (oneOffRes.error) throw oneOffRes.error;

  const classRows = [
    ...((recurringRes.data ?? []) as ClassRow[]),
    ...((oneOffRes.data ?? []) as ClassRow[])
  ];

  if (classRows.length === 0) {
    return { weekStart, weekEnd, events: [] };
  }

  const classIds = classRows.map((row) => row.id);

  const [enrollmentRes, overrideRes] = await Promise.all([
    supabase
      .from("class_enrollments")
      .select("class_id,student_id,students(id,student_name)")
      .in("class_id", classIds),
    supabase
      .from("class_overrides")
      .select(
        "class_id,override_date,action,override_instructor_id,override_start_time,override_end_time,override_status"
      )
      .in("class_id", classIds)
      .gte("override_date", weekStart)
      .lte("override_date", weekEnd)
  ]);

  if (enrollmentRes.error) throw enrollmentRes.error;
  if (overrideRes.error) throw overrideRes.error;

  const enrollments = (enrollmentRes.data ?? []) as EnrollmentRow[];
  const overrides = (overrideRes.data ?? []) as OverrideRow[];

  const enrollmentMap = new Map<string, EnrollmentRow[]>();
  for (const enrollment of enrollments) {
    const bucket = enrollmentMap.get(enrollment.class_id) ?? [];
    bucket.push(enrollment);
    enrollmentMap.set(enrollment.class_id, bucket);
  }

  const overrideMap = new Map<string, OverrideRow>();
  for (const override of overrides) {
    overrideMap.set(buildOverrideKey(override.class_id, override.override_date), override);
  }

  const instructorNameMap = new Map<string, string>();
  for (const row of classRows) {
    if (row.instructors?.id && row.instructors.instructor_name) {
      instructorNameMap.set(row.instructors.id, row.instructors.instructor_name);
    }
  }

  const missingInstructorIds = Array.from(
    new Set(
      overrides
        .map((override) => override.override_instructor_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0 && !instructorNameMap.has(value))
    )
  );

  if (missingInstructorIds.length > 0) {
    const { data: extraInstructors } = await supabase
      .from("instructors")
      .select("id,instructor_name")
      .in("id", missingInstructorIds);

    for (const instructor of extraInstructors ?? []) {
      instructorNameMap.set(instructor.id, instructor.instructor_name);
    }
  }

  const events: ScheduleEvent[] = [];

  for (const row of classRows) {
    if (row.schedule_mode === "recurring") {
      if (!row.weekday) continue;
      const classDate = addDays(weekStart, row.weekday - 1);

      if (classDate < row.active_from) continue;
      if (row.active_to && classDate > row.active_to) continue;

      const override = overrideMap.get(buildOverrideKey(row.id, classDate));
      if (override?.action === "cancel") continue;

      const effectiveInstructorId = override?.override_instructor_id ?? row.instructor_id;
      if (params.view === "instructor" && params.instructorId && effectiveInstructorId !== params.instructorId) {
        continue;
      }

      events.push(classToEvent(row, classDate, row.weekday, enrollmentMap, instructorNameMap, override));
      continue;
    }

    if (!row.class_date) continue;

    const override = overrideMap.get(buildOverrideKey(row.id, row.class_date));
    if (override?.action === "cancel") continue;

    const effectiveInstructorId = override?.override_instructor_id ?? row.instructor_id;
    if (params.view === "instructor" && params.instructorId && effectiveInstructorId !== params.instructorId) {
      continue;
    }

    events.push(
      classToEvent(row, row.class_date, dateToWeekday(row.class_date), enrollmentMap, instructorNameMap, override)
    );
  }

  events.sort((a, b) => {
    if (a.classDate !== b.classDate) return a.classDate.localeCompare(b.classDate);
    return a.startTime.localeCompare(b.startTime);
  });

  return {
    weekStart,
    weekEnd,
    events
  };
}

export async function updateScheduleStatus(
  supabase: SupabaseLike,
  classId: string,
  status: ScheduleStatus,
  changedBy: string,
  reason?: string
) {
  const { data: updatedClass, error: updateError } = await supabase
    .from("classes")
    .update({ progress_status: status, updated_at: new Date().toISOString() })
    .eq("id", classId)
    .select("id,progress_status")
    .single();

  if (updateError || !updatedClass) {
    throw updateError ?? new Error("Failed to update class status");
  }

  const { error: logError } = await supabase.from("class_status_logs").insert({
    class_id: classId,
    status,
    changed_by: changedBy,
    reason: reason ?? "manual-update"
  });

  if (logError) {
    throw logError;
  }

  return updatedClass;
}

export async function moveScheduleSlot(
  supabase: SupabaseLike,
  classId: string,
  target: { weekday: number; weekStart: string; startTime: string },
  actorUserId: string
) {
  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id,instructor_id,subject_code,class_type_code,schedule_mode,class_date,weekday,start_time,end_time,active_from")
    .eq("id", classId)
    .single();

  if (classError || !classRow) {
    throw classError ?? new Error("Class not found");
  }

  const sourceStart = fromSqlTime(classRow.start_time);
  const sourceEnd = fromSqlTime(classRow.end_time);
  const durationMinutes = Math.max(30, timeToMinutes(sourceEnd) - timeToMinutes(sourceStart));
  const endTime = addMinutes(target.startTime, durationMinutes);

  const conflict = await checkMoveConflictForWeek(supabase, {
    classId,
    instructorId: classRow.instructor_id,
    classTypeCode: classRow.class_type_code,
    weekStart: target.weekStart,
    weekday: target.weekday,
    startTime: target.startTime,
    endTime
  });
  if (conflict.hasConflict) {
    return { moved: false, conflict };
  }

  const updatePayload =
    classRow.schedule_mode === "recurring"
      ? {
          weekday: target.weekday,
          start_time: toSqlTime(target.startTime),
          end_time: toSqlTime(endTime),
          updated_at: new Date().toISOString()
        }
      : {
          class_date: addDays(target.weekStart, target.weekday - 1),
          start_time: toSqlTime(target.startTime),
          end_time: toSqlTime(endTime),
          updated_at: new Date().toISOString()
        };

  const { data: updated, error: updateError } = await supabase
    .from("classes")
    .update(updatePayload)
    .eq("id", classId)
    .select("id,weekday,class_date,start_time,end_time")
    .single();

  if (updateError || !updated) {
    throw updateError ?? new Error("Failed to move class");
  }

  const { error: logError } = await supabase.from("class_status_logs").insert({
    class_id: classId,
    status: "planned",
    changed_by: actorUserId,
    reason: `drag-move:${target.weekday}:${target.startTime}`
  });

  if (logError) {
    throw logError;
  }

  return { moved: true, conflict, updated };
}
