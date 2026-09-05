import { errorMessage, jsonError } from "@/lib/http";
import { getAuthenticatedProfile } from "@/lib/server/auth";
import {
  getBearerIdToken,
  isStudentActiveFromCanonicalRoster,
  loadFirebaseRoster,
  type FirebaseStudentRosterItem
} from "@/lib/server/firestoreRoster";
import { type SupabaseStudentMirrorRow } from "@/lib/server/firebaseStudentMirror";
import { fetchAllSupabaseRows } from "@/lib/server/supabasePagination";
import { isInstructorRosterActive, parseInstructorRosterActive } from "@/lib/instructorRoster";
import { NextResponse } from "next/server";

const DEFAULT_SPREADSHEET_ID = "1ByPeH0bZZrZDvW_yPkCpQCIuk724_Gt7uudUj_Ue8Ho";

type InstructorRow = {
  id: string;
  instructor_name: string;
  days_off?: number[] | null;
  available_time_slots?: string[] | null;
  available_time_slots_by_day?: Record<string, unknown> | null;
  is_active?: boolean | null;
  firebase_instructor_id?: string | null;
  firebase_uid?: string | null;
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

function hasMissingColumn(error: unknown, column: string): boolean {
  const message = `${(error as { message?: string })?.message ?? ""} ${(error as { details?: string })?.details ?? ""}`;
  return new RegExp(`['"]${column}['"]`).test(message) || message.includes(column);
}

async function selectInstructorRows(supabase: any, onlyActive = false): Promise<{ data: InstructorRow[] | null; error: any }> {
  const runSelect = async (selectClause: string) => {
    let query = supabase.from("instructors").select(selectClause);
    if (onlyActive) {
      query = query.eq("is_active", true);
    }
    return query;
  };

  const primary = await runSelect("id,instructor_name,days_off,available_time_slots,available_time_slots_by_day,is_active,firebase_instructor_id,firebase_uid");
  if (!primary.error) {
    return { data: (primary.data ?? []) as InstructorRow[], error: null };
  }

  const missingLegacy = hasMissingColumn(primary.error, "available_time_slots") && !hasMissingColumn(primary.error, "available_time_slots_by_day");
  const missingByDay = hasMissingColumn(primary.error, "available_time_slots_by_day");

  if (!missingLegacy && !missingByDay) {
    return primary;
  }

  if (missingLegacy) {
    const byDayFallback = await runSelect("id,instructor_name,days_off,available_time_slots_by_day,is_active,firebase_instructor_id,firebase_uid");
    if (!byDayFallback.error) {
      return {
        data: ((byDayFallback.data ?? []) as InstructorRow[]).map((row) => ({
          ...row,
          available_time_slots: []
        })),
        error: null
      };
    }
  }

  if (missingByDay) {
    const legacyFallback = await runSelect("id,instructor_name,days_off,available_time_slots,is_active,firebase_instructor_id,firebase_uid");
    if (!legacyFallback.error) {
      return {
        data: ((legacyFallback.data ?? []) as InstructorRow[]).map((row) => ({
          ...row,
          available_time_slots_by_day: {}
        })),
        error: null
      };
    }
  }

  const fallback = await runSelect("id,instructor_name,days_off,is_active");
  if (fallback.error) {
    return {
      data: null,
      error: fallback.error
    };
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

async function selectSingleInstructorWithFallback(runQuery: (selectClause: string) => any) {
  const primary = await runQuery("id,instructor_name,days_off,available_time_slots,available_time_slots_by_day,is_active,firebase_instructor_id,firebase_uid");
  if (!primary.error) {
    return {
      data: (primary.data as InstructorRow | null) ?? null,
      error: null
    };
  }

  const missingLegacy = hasMissingColumn(primary.error, "available_time_slots") && !hasMissingColumn(primary.error, "available_time_slots_by_day");
  const missingByDay = hasMissingColumn(primary.error, "available_time_slots_by_day");

  if (missingLegacy) {
    const byDayFallback = await runQuery("id,instructor_name,days_off,available_time_slots_by_day,is_active,firebase_instructor_id,firebase_uid");
    if (!byDayFallback.error) {
      return {
        data: byDayFallback.data
          ? ({
              ...(byDayFallback.data as InstructorRow),
              available_time_slots: []
            } as InstructorRow)
          : null,
        error: null
      };
    }
  }

  if (missingByDay) {
    const legacyFallback = await runQuery("id,instructor_name,days_off,available_time_slots,is_active,firebase_instructor_id,firebase_uid");
    if (!legacyFallback.error) {
      return {
        data: legacyFallback.data
          ? ({
              ...(legacyFallback.data as InstructorRow),
              available_time_slots_by_day: {}
            } as InstructorRow)
          : null,
        error: null
      };
    }
  }

  const fallback = await runQuery("id,instructor_name,days_off,is_active");
  return {
    data: fallback.data
      ? ({
          ...(fallback.data as InstructorRow),
          available_time_slots: [],
          available_time_slots_by_day: {}
        } as InstructorRow)
      : null,
    error: fallback.error
  };
}

type SheetMetaMap = {
  teacherSubjectByName: Map<string, string>;
  teacherActiveByName: Map<string, boolean>;
  studentSchoolByName: Map<string, string>;
};

const SHEET_META_CACHE_TTL_MS = 2 * 60 * 1000;
const sheetMetaCache = new Map<string, { value?: SheetMetaMap; expiresAt: number; promise?: Promise<SheetMetaMap> }>();

async function loadSheetMetaMap(spreadsheetId: string): Promise<SheetMetaMap> {
  const teacherSubjectByName = new Map<string, string>();
  const teacherActiveByName = new Map<string, boolean>();
  const studentSchoolByName = new Map<string, string>();

  try {
    const teachersCsv = await fetchSheetCsv(spreadsheetId, "Teachers");
    const teacherRows = parseCsv(teachersCsv);
    if (teacherRows.length > 0) {
      const headers = teacherRows[0];
      const nameIdx = findColumnIndex(headers, ["선생님성함", "강사명", "teacher", "name"]);
      const subjectIdx = findColumnIndex(headers, ["과목", "subject"]);
      const activeIdx = findColumnIndex(headers, ["재직", "재직여부", "활성", "active", "is_active"]);
      const safeNameIdx = nameIdx >= 0 ? nameIdx : 1;
      for (const row of teacherRows.slice(1)) {
        const name = normalizeName(row[safeNameIdx] ?? "");
        if (!name) continue;
        const subject = (row[subjectIdx] ?? "").trim();
        if (subject) {
          teacherSubjectByName.set(name, subject);
        }
        if (activeIdx >= 0) {
          const active = parseInstructorRosterActive(row[activeIdx] ?? "");
          if (active !== null) teacherActiveByName.set(name, active);
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
      const headers = studentRows[0];
      const nameIdxFound = findColumnIndex(headers, ["이름 필드", "이름", "학생명", "student", "name"]);
      const schoolIdxFound = findColumnIndex(headers, ["학교 필드", "학교", "school"]);
      const gradeIdxFound = findColumnIndex(headers, ["학년 필드", "학년", "grade"]);
      const nameIdx = nameIdxFound >= 0 ? nameIdxFound : 0;
      const schoolIdx = schoolIdxFound >= 0 ? schoolIdxFound : 1;
      const gradeIdx = gradeIdxFound >= 0 ? gradeIdxFound : 2;

      for (const row of studentRows.slice(1)) {
        const name = normalizeName(row[nameIdx] ?? "");
        if (!name) continue;

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

  return { teacherSubjectByName, teacherActiveByName, studentSchoolByName };
}

async function loadSheetMetaMapCached(spreadsheetId: string, forceRefresh: boolean): Promise<SheetMetaMap> {
  const now = Date.now();
  const cached = sheetMetaCache.get(spreadsheetId);

  if (!forceRefresh && cached?.value && cached.expiresAt > now) {
    return cached.value;
  }

  if (!forceRefresh && cached?.promise) {
    return cached.promise;
  }

  const promise = loadSheetMetaMap(spreadsheetId).then((value) => {
    sheetMetaCache.set(spreadsheetId, {
      value,
      expiresAt: Date.now() + SHEET_META_CACHE_TTL_MS
    });
    return value;
  });

  sheetMetaCache.set(spreadsheetId, {
    value: cached?.value,
    expiresAt: cached?.expiresAt ?? 0,
    promise
  });

  return promise;
}

export async function GET(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    if (!profile) {
      return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    }

    const [subjectRes, initialClassTypeRes] = await Promise.all([
      supabase.from("subjects").select("code,display_name,tailwind_bg_class").order("display_name"),
      supabase.from("class_types").select("code,display_name,badge_text,max_students,memo").order("display_name")
    ]);
    let classTypeRes = initialClassTypeRes;
    if (classTypeRes.error?.code === "42703") {
      classTypeRes = await supabase.from("class_types").select("code,display_name,badge_text,max_students").order("display_name") as typeof initialClassTypeRes;
    }

    if (subjectRes.error) throw subjectRes.error;
    if (classTypeRes.error) throw classTypeRes.error;

    const { searchParams } = new URL(req.url);
    const forceSheetRefresh = searchParams.get("refreshSheets") === "1" || searchParams.get("refreshSheets") === "true";
    const spreadsheetId = process.env.GOOGLE_SHEETS_SYNC_ID || DEFAULT_SPREADSHEET_ID;
    const [{
      teacherSubjectByName,
      teacherActiveByName,
      studentSchoolByName
    }, firebaseRoster] = await Promise.all([
      loadSheetMetaMapCached(spreadsheetId, forceSheetRefresh),
      loadFirebaseRoster(getBearerIdToken(req), { forceRefresh: forceSheetRefresh })
    ]);
    if (forceSheetRefresh && (profile.role === "admin" || profile.role === "coordinator") && !firebaseRoster.studentsAvailable) {
      return jsonError(
        `Firebase 학생 명단을 새로고침하지 못했습니다. 기존 Synchro-S 학생 명단은 유지되었습니다. (${firebaseRoster.studentError ?? firebaseRoster.error ?? "원인 미상"})`,
        502
      );
    }
    const firebaseStudentById = new Map<string, FirebaseStudentRosterItem>();
    const firebaseStudentNameCounts = new Map<string, number>();
    const firebaseStudentByUniqueName = new Map<string, FirebaseStudentRosterItem>();
    if (firebaseRoster.studentsAvailable) {
      for (const student of firebaseRoster.students) {
        const nameKey = normalizeName(student.name).replace(/\s+/g, "").toLowerCase();
        if (nameKey) {
          firebaseStudentNameCounts.set(nameKey, (firebaseStudentNameCounts.get(nameKey) ?? 0) + 1);
          if (!firebaseStudentByUniqueName.has(nameKey)) firebaseStudentByUniqueName.set(nameKey, student);
        }
        for (const key of [
          student.id,
          student.studentId,
          student.canonicalStudentId,
          student.supabaseStudentId,
          student.firebaseUid,
          ...(student.studentIdAliases ?? [])
        ].filter(Boolean) as string[]) {
          firebaseStudentById.set(key, student);
        }
      }
      for (const [nameKey, count] of firebaseStudentNameCounts) {
        if (count > 1) firebaseStudentByUniqueName.delete(nameKey);
      }
    }
    let uniqueSupabaseStudentNameKeys = new Set<string>();

    const firebaseInstructorByUid = new Map(firebaseRoster.instructorAccounts.map((account) => [account.uid, account]));
    const firebaseInstructorById = new Map(
      firebaseRoster.instructorAccounts.flatMap((account) => account.instructorIds.map((id) => [id, account] as const))
    );
    const firebaseInstructorNameCounts = new Map<string, number>();
    const firebaseInstructorByUniqueName = new Map<string, (typeof firebaseRoster.instructorAccounts)[number]>();
    for (const account of firebaseRoster.instructorAccounts) {
      const nameKey = normalizeNameToken(account.name);
      if (!nameKey) continue;
      firebaseInstructorNameCounts.set(nameKey, (firebaseInstructorNameCounts.get(nameKey) ?? 0) + 1);
      if (!firebaseInstructorByUniqueName.has(nameKey)) firebaseInstructorByUniqueName.set(nameKey, account);
    }
    for (const [nameKey, count] of firebaseInstructorNameCounts) {
      if (count > 1) firebaseInstructorByUniqueName.delete(nameKey);
    }

    const resolveFirebaseInstructorAccount = (row: InstructorRow) =>
      (row.firebase_uid ? firebaseInstructorByUid.get(row.firebase_uid) : undefined) ??
      (row.firebase_instructor_id ? firebaseInstructorById.get(row.firebase_instructor_id) : undefined) ??
      firebaseInstructorById.get(row.id) ??
      firebaseInstructorByUniqueName.get(normalizeNameToken(row.instructor_name));

    const resolveFirebaseStudent = (row: { id: string; student_name: string; firebase_student_id?: string | null; firebase_uid?: string | null }) =>
      firebaseStudentById.get(row.id) ??
      (row.firebase_student_id ? firebaseStudentById.get(row.firebase_student_id) : undefined) ??
      (row.firebase_uid ? firebaseStudentById.get(row.firebase_uid) : undefined) ??
      (uniqueSupabaseStudentNameKeys.has(normalizeName(row.student_name).replace(/\s+/g, "").toLowerCase())
        ? firebaseStudentByUniqueName.get(normalizeName(row.student_name).replace(/\s+/g, "").toLowerCase())
        : undefined);

    let instructors: {
      id: string;
      name: string;
      secondary?: string;
      isActive?: boolean;
      daysOff?: number[];
      availableTimeSlots?: string[];
      availableTimeSlotsByDay?: Record<string, string[]>;
    }[] = [];
    let suspendedInstructors: typeof instructors = [];
    let students: { id: string; name: string; secondary?: string; school?: string; isActive?: boolean }[] = [];
    let suspendedStudents: typeof students = [];
    const profileInstructorId = (profile as { instructor_id?: string | null }).instructor_id ?? null;
    const profileStudentId = (profile as { student_id?: string | null }).student_id ?? null;

    if (profile.role === "admin" || profile.role === "coordinator") {
      const [instructorRes, studentRows] = await Promise.all([
        selectInstructorRows(supabase, false).then((result) => ({
          ...result,
          data: (result.data ?? []).sort((a: { instructor_name: string }, b: { instructor_name: string }) =>
            a.instructor_name.localeCompare(b.instructor_name, "ko")
          )
        })),
        fetchAllSupabaseRows<SupabaseStudentMirrorRow>(async (from, to) => {
          const result = await supabase
            .from("students")
            .select("id,student_name,is_active,firebase_student_id,firebase_uid")
            .order("student_name")
            .order("id")
            .range(from, to);
          return {
            data: (result.data ?? []) as SupabaseStudentMirrorRow[],
            error: result.error
          };
        })
      ]);

      if (instructorRes.error) throw instructorRes.error;

      const instructorRows = instructorRes.data ?? [];
      const supabaseStudentNameCounts = new Map<string, number>();
      for (const row of studentRows) {
        const nameKey = normalizeName(row.student_name).replace(/\s+/g, "").toLowerCase();
        if (nameKey) supabaseStudentNameCounts.set(nameKey, (supabaseStudentNameCounts.get(nameKey) ?? 0) + 1);
      }
      uniqueSupabaseStudentNameKeys = new Set(
        [...supabaseStudentNameCounts.entries()].filter(([, count]) => count === 1).map(([nameKey]) => nameKey)
      );

      const toInstructorOption = (row: InstructorRow, isActive: boolean) => {
        const availableTimeSlotsByDay = normalizeAvailableTimeSlotsByDay(row.available_time_slots_by_day);
        return {
          id: row.id,
          name: row.instructor_name,
          secondary: teacherSubjectByName.get(normalizeName(row.instructor_name)),
          isActive,
          daysOff: (row.days_off ?? []).filter((value) => Number.isInteger(value) && value >= 1 && value <= 7),
          availableTimeSlots: flattenAvailableTimeSlots(availableTimeSlotsByDay, row.available_time_slots),
          availableTimeSlotsByDay
        };
      };
      instructors = instructorRows
        .filter((row: InstructorRow) => {
          const firebaseAccount = firebaseRoster.instructorAccountsAvailable
            ? resolveFirebaseInstructorAccount(row)
            : undefined;
          return isInstructorRosterActive(
            row.is_active,
            teacherActiveByName.get(normalizeName(row.instructor_name)),
            firebaseAccount?.active
          );
        })
        .map((row: InstructorRow) => toInstructorOption(row, true));
      suspendedInstructors = instructorRows
        .filter((row: InstructorRow) => {
          const firebaseAccount = firebaseRoster.instructorAccountsAvailable
            ? resolveFirebaseInstructorAccount(row)
            : undefined;
          return !isInstructorRosterActive(
            row.is_active,
            teacherActiveByName.get(normalizeName(row.instructor_name)),
            firebaseAccount?.active
          );
        })
        .map((row: InstructorRow) => toInstructorOption(row, false));

      const isStudentRosterActive = (row: { id: string; student_name: string; is_active: boolean | null; firebase_student_id?: string | null; firebase_uid?: string | null }) => {
        const firebaseStudent = firebaseRoster.studentsAvailable ? resolveFirebaseStudent(row) : undefined;
        return isStudentActiveFromCanonicalRoster(firebaseRoster.studentsAvailable, firebaseStudent, row.is_active);
      };
      students = studentRows
        .filter(isStudentRosterActive)
        .map((row: { id: string; student_name: string; firebase_student_id?: string | null; firebase_uid?: string | null }) => {
          const firebaseStudent = firebaseRoster.studentsAvailable ? resolveFirebaseStudent(row) : undefined;
          return {
          id: row.id,
          name: firebaseStudent?.name || row.student_name,
          secondary: firebaseStudent?.secondary || studentSchoolByName.get(normalizeName(row.student_name)),
          school: firebaseStudent?.school || studentSchoolByName.get(normalizeName(row.student_name))?.split("·")[0]?.trim(),
          isActive: true
          };
        });
      suspendedStudents = studentRows
        .filter((row: { id: string; student_name: string; is_active: boolean | null; firebase_student_id?: string | null; firebase_uid?: string | null }) => !isStudentRosterActive(row))
        .map((row: { id: string; student_name: string; firebase_student_id?: string | null; firebase_uid?: string | null }) => {
          const firebaseStudent = firebaseRoster.studentsAvailable ? resolveFirebaseStudent(row) : undefined;
          return {
          id: row.id,
          name: firebaseStudent?.name || row.student_name,
          secondary: firebaseStudent?.secondary || studentSchoolByName.get(normalizeName(row.student_name)),
          school: firebaseStudent?.school || studentSchoolByName.get(normalizeName(row.student_name))?.split("·")[0]?.trim(),
          isActive: false
          };
        });
    } else if (profile.role === "instructor") {
      const instructorQuery = async (selectClause: string) => {
        const query = supabase.from("instructors").select(selectClause);
        return profileInstructorId ? query.eq("id", profileInstructorId).single() : query.eq("user_id", user.id).single();
      };
      const ownInstructorResult = await selectSingleInstructorWithFallback(instructorQuery);
      const ownInstructor = ownInstructorResult.data;
      const ownInstructorError = ownInstructorResult.error;
      const fallbackInstructor =
        ownInstructorError || !ownInstructor
          ? await findInstructorByName(supabase, (profile as { full_name?: string | null }).full_name ?? "")
          : null;
      const resolvedInstructor = ownInstructor ?? fallbackInstructor;

      if (!resolvedInstructor || resolvedInstructor.is_active === false) {
        return jsonError("Instructor profile not found", 400);
      }

      const resolvedByDay = normalizeAvailableTimeSlotsByDay(resolvedInstructor.available_time_slots_by_day);
      instructors = [
        {
          id: resolvedInstructor.id,
          name: resolvedInstructor.instructor_name,
          secondary: teacherSubjectByName.get(normalizeName(resolvedInstructor.instructor_name)),
          isActive: true,
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
            .select("id,student_name,is_active,firebase_student_id,firebase_uid")
            .in("id", studentIds)
            .order("student_name");

          if (studentRowsError) throw studentRowsError;

          students = (studentRows ?? [])
            .filter((row: { id: string; student_name: string; is_active: boolean | null; firebase_student_id?: string | null; firebase_uid?: string | null }) => {
              const firebaseStudent = firebaseRoster.studentsAvailable ? resolveFirebaseStudent(row) : undefined;
              if (firebaseStudent) return firebaseStudent.active;
              return row.is_active !== false;
            })
            .map((row: { id: string; student_name: string; firebase_student_id?: string | null; firebase_uid?: string | null }) => {
              const firebaseStudent = firebaseRoster.studentsAvailable ? resolveFirebaseStudent(row) : undefined;
              return {
              id: row.id,
              name: firebaseStudent?.name || row.student_name,
              secondary: firebaseStudent?.secondary || studentSchoolByName.get(normalizeName(row.student_name)),
              school: firebaseStudent?.school || studentSchoolByName.get(normalizeName(row.student_name))?.split("·")[0]?.trim()
              };
            });
        }
      }
    } else {
      const { data: ownStudent, error: ownStudentError } = await supabase
        .from("students")
        .select("id,student_name,default_instructor_id,is_active,firebase_student_id,firebase_uid")
        .eq(profileStudentId ? "id" : "user_id", profileStudentId || user.id)
        .single();

      if (ownStudentError || !ownStudent) {
        return jsonError("Student profile not found", 400);
      }

      const ownStudentName = normalizeName(ownStudent.student_name);
      const firebaseStudent = firebaseRoster.studentsAvailable ? resolveFirebaseStudent(ownStudent) : undefined;
      const ownStudentActive = firebaseStudent ? firebaseStudent.active : ownStudent.is_active !== false;
      if (ownStudentActive) {
        students = [
          {
            id: ownStudent.id,
            name: firebaseStudent?.name || ownStudent.student_name,
            secondary: firebaseStudent?.secondary || studentSchoolByName.get(ownStudentName),
            school: firebaseStudent?.school || studentSchoolByName.get(ownStudentName)?.split("·")[0]?.trim()
          }
        ];
      } else {
        students = [];
      }

      if (ownStudent.default_instructor_id) {
        const defaultInstructorResult = await selectSingleInstructorWithFallback((selectClause) =>
          supabase.from("instructors").select(selectClause).eq("id", ownStudent.default_instructor_id).single()
        );
        const defaultInstructor = defaultInstructorResult.data;

        if (defaultInstructor) {
          const availableTimeSlotsByDay = normalizeAvailableTimeSlotsByDay(defaultInstructor.available_time_slots_by_day);
          instructors = [
            {
              id: defaultInstructor.id,
              name: defaultInstructor.instructor_name,
              secondary: teacherSubjectByName.get(normalizeName(defaultInstructor.instructor_name)),
              isActive: defaultInstructor.is_active !== false,
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
      suspendedInstructors,
      students,
      suspendedStudents,
      subjects: (subjectRes.data ?? []).map(
        (row: { code: string; display_name: string; tailwind_bg_class: string }) => ({
          code: row.code,
          label: row.display_name,
          tailwindClass: row.tailwind_bg_class
        })
      ),
      classTypes: (classTypeRes.data ?? []).map(
        (row: { code: string; display_name: string; badge_text: string; max_students: number; memo?: string | null }) => ({
          code: row.code,
          label: row.display_name,
          badgeText: row.badge_text,
          maxStudents: row.max_students,
          memo: row.memo ?? ""
        })
      )
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
