import { errorMessage, jsonError } from "@/lib/http";
import { getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

const DEFAULT_SPREADSHEET_ID = "1ByPeH0bZZrZDvW_yPkCpQCIuk724_Gt7uudUj_Ue8Ho";

type InstructorRow = {
  id: string;
  instructor_name: string;
  days_off?: number[] | null;
  available_time_slots?: string[] | null;
  available_time_slots_by_day?: Record<string, unknown> | null;
  is_active?: boolean | null;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function parseCsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

function normalizeHeader(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function normalizeName(value: string): string {
  return value.replace(/^\/+/, "").replace(/\s+/g, " ").trim();
}

function normalizeNameToken(value: string): string {
  return normalizeName(value).replace(/\s+/g, "").toLowerCase();
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const idx = normalizedHeaders.indexOf(normalizeHeader(candidate));
    if (idx >= 0) return idx;
  }
  return -1;
}

async function fetchSheetCsv(spreadsheetId: string, sheetName: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Google Sheets fetch failed (${sheetName}): ${res.status}`);
  return res.text();
}

async function findInstructorByName(
  supabase: any,
  fullName: string
): Promise<InstructorRow | null> {
  const { data, error } = await selectInstructorRows(supabase, true);

  if (error || !data) return null;
  const token = normalizeNameToken(fullName);
  if (!token) return null;

  const exact =
    data.find((row: { instructor_name: string }) => normalizeNameToken(row.instructor_name) === token) ??
    data.find((row: { instructor_name: string }) => {
      const rowToken = normalizeNameToken(row.instructor_name);
      return rowToken.includes(token) || token.includes(rowToken);
    });

  if (!exact) return null;

  return {
    id: exact.id,
    instructor_name: exact.instructor_name,
    days_off: exact.days_off ?? [],
    available_time_slots: exact.available_time_slots ?? [],
    available_time_slots_by_day: exact.available_time_slots_by_day ?? {}
  };
}

function normalizeAvailableTimeSlots(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string" && /^\d{2}:\d{2}$/.test(value)))
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeAvailableTimeSlotsByDay(values: unknown): Record<string, string[]> {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }

  const normalized: Record<string, string[]> = {};
  for (const [rawWeekday, rawSlots] of Object.entries(values)) {
    const weekday = Number(rawWeekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      continue;
    }

    const slots = normalizeAvailableTimeSlots(rawSlots);
    if (slots.length > 0) {
      normalized[String(weekday)] = slots;
    }
  }

  return normalized;
}

function flattenAvailableTimeSlots(byDay: Record<string, string[]>, fallback: unknown): string[] {
  const merged = new Set<string>();

  for (const slots of Object.values(byDay)) {
    for (const slot of slots) {
      merged.add(slot);
    }
  }

  if (merged.size === 0) {
    for (const slot of normalizeAvailableTimeSlots(fallback)) {
      merged.add(slot);
    }
  }

  return [...merged].sort((a, b) => a.localeCompare(b));
}

async function selectInstructorRows(supabase: any, onlyActive = false): Promise<{ data: InstructorRow[] | null; error: any }> {
  const runSelect = async (selectClause: string) => {
    let query = supabase.from("instructors").select(selectClause);
    if (onlyActive) {
      query = query.eq("is_active", true);
    }
    return query;
  };

  const primary = await runSelect("id,instructor_name,days_off,available_time_slots,available_time_slots_by_day,is_active");
  if (!primary.error) {
    return { data: (primary.data ?? []) as InstructorRow[], error: null };
  }

  const message = `${primary.error?.message ?? ""} ${primary.error?.details ?? ""}`;
  if (!message.includes("available_time_slots_by_day") && !message.includes("available_time_slots")) {
    return primary;
  }

  const legacyFallback = await runSelect("id,instructor_name,days_off,available_time_slots,is_active");
  if (!legacyFallback.error) {
    return {
      data: ((legacyFallback.data ?? []) as InstructorRow[]).map((row) => ({
        ...row,
        available_time_slots_by_day: {}
      })),
      error: null
    };
  }

  const fallback = await runSelect("id,instructor_name,days_off,is_active");
  if (fallback.error) {
    return { data: null, error: fallback.error };
  }

  return {
    data: ((fallback.data ?? []) as InstructorRow[]).map((row) => ({
      ...row,
      available_time_slots: [],
      available_time_slots_by_day: {}
    })),
    error: null
  };
}

async function loadSheetMetaMap(spreadsheetId: string): Promise<{
  teacherSubjectByName: Map<string, string>;
  studentSchoolByName: Map<string, string>;
  activeStudentNames: Set<string>;
  studentSheetLoaded: boolean;
}> {
  const parseRegistered = (raw: string): boolean => {
    const v = raw.trim().toLowerCase();
    if (!v || v === "false" || v === "0" || v === "n" || v === "no" || v === "unchecked" || v === "☐") {
      return false;
    }
    return (
      v === "true" ||
      v === "1" ||
      v === "y" ||
      v === "yes" ||
      v === "✓" ||
      v === "☑" ||
      v === "✅" ||
      v === "v" ||
      v === "checked"
    );
  };

  const teacherSubjectByName = new Map<string, string>();
  const studentSchoolByName = new Map<string, string>();
  const activeStudentNames = new Set<string>();
  let studentSheetLoaded = false;

  try {
    const teachersCsv = await fetchSheetCsv(spreadsheetId, "Teachers");
    const teacherRows = parseCsv(teachersCsv);
    if (teacherRows.length > 0) {
      const headers = teacherRows[0];
      const nameIdx = findColumnIndex(headers, ["선생님성함", "강사명", "teacher", "name"]);
      const subjectIdx = findColumnIndex(headers, ["과목", "subject"]);
      const safeNameIdx = nameIdx >= 0 ? nameIdx : 1;
      for (const row of teacherRows.slice(1)) {
        const name = normalizeName(row[safeNameIdx] ?? "");
        if (!name) continue;
        const subject = (row[subjectIdx] ?? "").trim();
        if (subject) {
          teacherSubjectByName.set(name, subject);
        }
      }
    }
  } catch (error) {
    console.error("[options] Teachers 시트 메타 로드 실패", error);
  }

  try {
    const studentsCsv = await fetchSheetCsv(spreadsheetId, "student");
    const studentRows = parseCsv(studentsCsv);
    if (studentRows.length > 0) {
      studentSheetLoaded = true;
      const headers = studentRows[0];
      const nameIdxFound = findColumnIndex(headers, ["이름 필드", "이름", "학생명", "student", "name"]);
      const schoolIdxFound = findColumnIndex(headers, ["학교 필드", "학교", "school"]);
      const gradeIdxFound = findColumnIndex(headers, ["학년 필드", "학년", "grade"]);
      const statusIdxFound = findColumnIndex(headers, ["등록 상태", "등록상태", "status", "active"]);
      const nameIdx = nameIdxFound >= 0 ? nameIdxFound : 0;
      const schoolIdx = schoolIdxFound >= 0 ? schoolIdxFound : 1;
      const gradeIdx = gradeIdxFound >= 0 ? gradeIdxFound : 2;
      const statusIdx = statusIdxFound >= 0 ? statusIdxFound : 3;

      for (const row of studentRows.slice(1)) {
        const name = normalizeName(row[nameIdx] ?? "");
        if (!name) continue;

        const statusRaw = (row[statusIdx] ?? "").toString();
        if (parseRegistered(statusRaw)) {
          activeStudentNames.add(name);
        }

        const school = (row[schoolIdx] ?? "").trim();
        const gradeRaw = (row[gradeIdx] ?? "").toString().trim().replace("@", "");
        const grade = gradeRaw.replace(/[^0-9]/g, "");
        const secondary = school && grade ? `${school} · ${grade}학년` : school || (grade ? `${grade}학년` : "");
        if (secondary) {
          studentSchoolByName.set(name, secondary);
        }
      }
    }
  } catch (error) {
    console.error("[options] student 시트 메타 로드 실패", error);
  }

  return { teacherSubjectByName, studentSchoolByName, activeStudentNames, studentSheetLoaded };
}

export async function GET() {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    if (!profile) {
      return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    }

    const [subjectRes, classTypeRes] = await Promise.all([
      supabase.from("subjects").select("code,display_name,tailwind_bg_class").order("display_name"),
      supabase.from("class_types").select("code,display_name,badge_text,max_students").order("display_name")
    ]);

    if (subjectRes.error) throw subjectRes.error;
    if (classTypeRes.error) throw classTypeRes.error;

    const spreadsheetId = process.env.GOOGLE_SHEETS_SYNC_ID || DEFAULT_SPREADSHEET_ID;
    const { teacherSubjectByName, studentSchoolByName, activeStudentNames, studentSheetLoaded } = await loadSheetMetaMap(
      spreadsheetId
    );

    let instructors: {
      id: string;
      name: string;
      secondary?: string;
      daysOff?: number[];
      availableTimeSlots?: string[];
      availableTimeSlotsByDay?: Record<string, string[]>;
    }[] = [];
    let students: { id: string; name: string; secondary?: string }[] = [];
    const profileInstructorId = (profile as { instructor_id?: string | null }).instructor_id ?? null;

    if (profile.role === "admin" || profile.role === "coordinator") {
      const [instructorRes, studentRes] = await Promise.all([
        selectInstructorRows(supabase, true).then((result) => ({
          ...result,
          data: (result.data ?? []).sort((a: { instructor_name: string }, b: { instructor_name: string }) =>
            a.instructor_name.localeCompare(b.instructor_name, "ko")
          )
        })),
        supabase.from("students").select("id,student_name,is_active").order("student_name")
      ]);

      if (instructorRes.error) throw instructorRes.error;
      if (studentRes.error) throw studentRes.error;

      instructors = (instructorRes.data ?? []).map((row: InstructorRow) => {
        const availableTimeSlotsByDay = normalizeAvailableTimeSlotsByDay(row.available_time_slots_by_day);
        return {
          id: row.id,
          name: row.instructor_name,
          secondary: teacherSubjectByName.get(normalizeName(row.instructor_name)),
          daysOff: (row.days_off ?? []).filter((value) => Number.isInteger(value) && value >= 1 && value <= 7),
          availableTimeSlots: flattenAvailableTimeSlots(availableTimeSlotsByDay, row.available_time_slots),
          availableTimeSlotsByDay
        };
      });
      students = (studentRes.data ?? [])
        .filter((row: { student_name: string; is_active: boolean }) => {
          const normalized = normalizeName(row.student_name);
          if (studentSheetLoaded) return activeStudentNames.has(normalized);
          return row.is_active;
        })
        .map((row: { id: string; student_name: string }) => ({
          id: row.id,
          name: row.student_name,
          secondary: studentSchoolByName.get(normalizeName(row.student_name))
        }));
    } else if (profile.role === "instructor") {
      const instructorQuery = async (selectClause: string) => {
        const query = supabase.from("instructors").select(selectClause);
        return profileInstructorId ? query.eq("id", profileInstructorId).single() : query.eq("user_id", user.id).single();
      };
      let ownInstructor: InstructorRow | null = null;
      let ownInstructorError: any = null;
      {
        const initial = await instructorQuery("id,instructor_name,days_off,available_time_slots,available_time_slots_by_day");
        ownInstructor = (initial.data as InstructorRow | null) ?? null;
        ownInstructorError = initial.error;
      }
      if (ownInstructorError) {
        const message = `${ownInstructorError.message ?? ""} ${ownInstructorError.details ?? ""}`;
        if (message.includes("available_time_slots_by_day")) {
          const fallback = await instructorQuery("id,instructor_name,days_off,available_time_slots");
          ownInstructor = fallback.data
            ? ({
                ...((fallback.data as unknown as InstructorRow) ?? {}),
                available_time_slots_by_day: {}
              } as InstructorRow)
            : null;
          ownInstructorError = fallback.error;
        } else if (message.includes("available_time_slots")) {
          const fallback = await instructorQuery("id,instructor_name,days_off");
          ownInstructor = fallback.data
            ? ({
                ...((fallback.data as unknown as InstructorRow) ?? {}),
                available_time_slots: [],
                available_time_slots_by_day: {}
              } as InstructorRow)
            : null;
          ownInstructorError = fallback.error;
        }
      }
      const fallbackInstructor =
        ownInstructorError || !ownInstructor
          ? await findInstructorByName(supabase, (profile as { full_name?: string | null }).full_name ?? "")
          : null;
      const resolvedInstructor = ownInstructor ?? fallbackInstructor;

      if (!resolvedInstructor) {
        return jsonError("Instructor profile not found", 400);
      }

      const resolvedByDay = normalizeAvailableTimeSlotsByDay(resolvedInstructor.available_time_slots_by_day);
      instructors = [
        {
          id: resolvedInstructor.id,
          name: resolvedInstructor.instructor_name,
          secondary: teacherSubjectByName.get(normalizeName(resolvedInstructor.instructor_name)),
          daysOff: (resolvedInstructor.days_off ?? []).filter((value: number) => Number.isInteger(value) && value >= 1 && value <= 7),
          availableTimeSlots: flattenAvailableTimeSlots(resolvedByDay, resolvedInstructor.available_time_slots),
          availableTimeSlotsByDay: resolvedByDay
        }
      ];

      const { data: classRows, error: classRowsError } = await supabase
        .from("classes")
        .select("id")
        .eq("instructor_id", resolvedInstructor.id);

      if (classRowsError) throw classRowsError;

      const classIds = (classRows ?? []).map((row: { id: string }) => row.id);
      if (classIds.length > 0) {
        const { data: enrollmentRows, error: enrollmentError } = await supabase
          .from("class_enrollments")
          .select("student_id")
          .in("class_id", classIds);

        if (enrollmentError) throw enrollmentError;

        const studentIds = Array.from(new Set((enrollmentRows ?? []).map((row: { student_id: string }) => row.student_id)));
        if (studentIds.length > 0) {
          const { data: studentRows, error: studentRowsError } = await supabase
            .from("students")
            .select("id,student_name")
            .in("id", studentIds)
            .order("student_name");

          if (studentRowsError) throw studentRowsError;

          students = (studentRows ?? [])
            .filter((row: { student_name: string }) => {
              const normalized = normalizeName(row.student_name);
              return studentSheetLoaded ? activeStudentNames.has(normalized) : true;
            })
            .map((row: { id: string; student_name: string }) => ({
              id: row.id,
              name: row.student_name,
              secondary: studentSchoolByName.get(normalizeName(row.student_name))
            }));
        }
      }
    } else {
      const { data: ownStudent, error: ownStudentError } = await supabase
        .from("students")
        .select("id,student_name,default_instructor_id")
        .eq("user_id", user.id)
        .single();

      if (ownStudentError || !ownStudent) {
        return jsonError("Student profile not found", 400);
      }

      const ownStudentName = normalizeName(ownStudent.student_name);
      if (activeStudentNames.size === 0 || activeStudentNames.has(ownStudentName)) {
        students = [
          {
            id: ownStudent.id,
            name: ownStudent.student_name,
            secondary: studentSchoolByName.get(ownStudentName)
          }
        ];
      } else {
        students = [];
      }

      if (ownStudent.default_instructor_id) {
        let { data: defaultInstructor } = await supabase
          .from("instructors")
          .select("id,instructor_name,days_off,available_time_slots,available_time_slots_by_day")
          .eq("id", ownStudent.default_instructor_id)
          .single();

        if (!defaultInstructor) {
          const fallback = await supabase
            .from("instructors")
            .select("id,instructor_name,days_off,available_time_slots")
            .eq("id", ownStudent.default_instructor_id)
            .single();
          defaultInstructor = fallback.data
            ? { ...fallback.data, available_time_slots_by_day: {} }
            : fallback.data;
        }

        if (defaultInstructor) {
          const availableTimeSlotsByDay = normalizeAvailableTimeSlotsByDay(defaultInstructor.available_time_slots_by_day);
          instructors = [
            {
              id: defaultInstructor.id,
              name: defaultInstructor.instructor_name,
              secondary: teacherSubjectByName.get(normalizeName(defaultInstructor.instructor_name)),
              daysOff: (defaultInstructor.days_off ?? []).filter((value: number) => Number.isInteger(value) && value >= 1 && value <= 7),
              availableTimeSlots: flattenAvailableTimeSlots(availableTimeSlotsByDay, defaultInstructor.available_time_slots),
              availableTimeSlotsByDay
            }
          ];
        }
      }
    }

    return NextResponse.json({
      viewerRole: profile.role,
      viewerName: profile.full_name ?? "",
      instructors,
      students,
      subjects: (subjectRes.data ?? []).map(
        (row: { code: string; display_name: string; tailwind_bg_class: string }) => ({
          code: row.code,
          label: row.display_name,
          tailwindClass: row.tailwind_bg_class
        })
      ),
      classTypes: (classTypeRes.data ?? []).map(
        (row: { code: string; display_name: string; badge_text: string; max_students: number }) => ({
          code: row.code,
          label: row.display_name,
          badgeText: row.badge_text,
          maxStudents: row.max_students
        })
      )
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
