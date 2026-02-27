import { errorMessage, jsonError } from "@/lib/http";
import { canManageSchedules, getAuthenticatedProfile } from "@/lib/server/auth";
import { NextResponse } from "next/server";

const DEFAULT_SPREADSHEET_ID = "1ByPeH0bZZrZDvW_yPkCpQCIuk724_Gt7uudUj_Ue8Ho";

type SyncPayload = {
  spreadsheetId?: string;
};

type TeacherRow = {
  name: string;
};

type StudentRow = {
  name: string;
  registered: boolean;
};

function parseRegistered(raw: string): boolean {
  const v = raw.trim().toLowerCase();
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
}

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

function findColumnIndex(headers: string[], candidates: string[]): number {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const idx = normalizedHeaders.indexOf(normalizeHeader(candidate));
    if (idx >= 0) {
      return idx;
    }
  }
  return -1;
}

async function fetchSheetCsv(spreadsheetId: string, sheetName: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`Google Sheets fetch failed (${sheetName}): ${res.status}`);
  }

  return res.text();
}

function extractTeachers(csv: string): TeacherRow[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];

  const headers = rows[0];
  const nameIdx = findColumnIndex(headers, ["선생님성함", "강사명", "teacher", "name"]);
  if (nameIdx < 0) {
    throw new Error("Teachers 시트에서 강사명 컬럼을 찾지 못했습니다.");
  }

  const names = rows
    .slice(1)
    .map((row) => normalizeName(row[nameIdx] ?? ""))
    .filter((name) => name.length > 0);

  return Array.from(new Set(names)).map((name) => ({ name }));
}

function extractStudents(csv: string): StudentRow[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];

  const headers = rows[0];
  const nameIdx = findColumnIndex(headers, ["이름 필드", "이름", "학생명", "student", "name"]);
  const statusIdx = findColumnIndex(headers, ["등록 상태", "등록상태", "status", "active"]);
  if (nameIdx < 0) {
    throw new Error("student 시트에서 학생명 컬럼을 찾지 못했습니다.");
  }
  if (statusIdx < 0) {
    throw new Error("student 시트에서 등록 상태(D열) 컬럼을 찾지 못했습니다.");
  }

  const dedupMap = new Map<string, boolean>();
  for (const row of rows.slice(1)) {
    const name = normalizeName(row[nameIdx] ?? "");
    if (!name) continue;
    const registered = statusIdx >= 0 ? parseRegistered(row[statusIdx] ?? "") : true;
    const prev = dedupMap.get(name) ?? false;
    dedupMap.set(name, prev || registered);
  }

  return Array.from(dedupMap.entries()).map(([name, registered]) => ({ name, registered }));
}

export async function POST(req: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();

    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    if (!profile) {
      return jsonError("Authenticated but no app profile or role mapping in public.users", 403);
    }

    if (!canManageSchedules(profile.role)) {
      return jsonError("Forbidden", 403);
    }

    const payload = ((await req.json().catch(() => ({}))) as SyncPayload) ?? {};
    const spreadsheetId = payload.spreadsheetId?.trim() || process.env.GOOGLE_SHEETS_SYNC_ID || DEFAULT_SPREADSHEET_ID;

    const [teachersCsv, studentsCsv] = await Promise.all([
      fetchSheetCsv(spreadsheetId, "Teachers"),
      fetchSheetCsv(spreadsheetId, "student")
    ]);

    const teachers = extractTeachers(teachersCsv);
    const students = extractStudents(studentsCsv);

    const [{ data: existingInstructors, error: instructorReadError }, { data: existingStudents, error: studentReadError }] =
      await Promise.all([
        supabase.from("instructors").select("instructor_name"),
        supabase.from("students").select("id,student_name,is_active")
      ]);

    if (instructorReadError) throw instructorReadError;
    if (studentReadError) throw studentReadError;

    const existingInstructorNames = new Set(
      (existingInstructors ?? []).map((row: { instructor_name: string }) => normalizeName(row.instructor_name))
    );
    const newInstructors = teachers
      .filter((row) => !existingInstructorNames.has(row.name))
      .map((row) => ({ instructor_name: row.name, is_active: true }));

    const existingStudentByName = new Map(
      (existingStudents ?? []).map((row: { id: string; student_name: string; is_active: boolean }) => [
        normalizeName(row.student_name),
        row
      ])
    );

    const studentUpdates: { id: string; is_active: boolean }[] = [];
    const studentInserts: { student_name: string; is_active: boolean }[] = [];

    for (const row of students) {
      const existing = existingStudentByName.get(row.name) as { id: string; is_active: boolean } | undefined;
      if (!existing) {
        if (row.registered) {
          studentInserts.push({ student_name: row.name, is_active: true });
        }
        continue;
      }

      if (existing.is_active !== row.registered) {
        studentUpdates.push({ id: existing.id, is_active: row.registered });
      }
    }

    if (newInstructors.length > 0) {
      const { error: insertInstructorError } = await supabase.from("instructors").insert(newInstructors);
      if (insertInstructorError) throw insertInstructorError;
    }

    if (studentInserts.length > 0) {
      const { error: insertStudentError } = await supabase.from("students").insert(studentInserts);
      if (insertStudentError) throw insertStudentError;
    }

    for (const row of studentUpdates) {
      const { error: updateStudentError } = await supabase
        .from("students")
        .update({ is_active: row.is_active })
        .eq("id", row.id);
      if (updateStudentError) throw updateStudentError;
    }

    return NextResponse.json({
      spreadsheetId,
      teachersFetched: teachers.length,
      studentsFetched: students.length,
      teachersInserted: newInstructors.length,
      studentsInserted: studentInserts.length,
      studentsUpdated: studentUpdates.length
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
