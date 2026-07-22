#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SPREADSHEET_ID = "1ByPeH0bZZrZDvW_yPkCpQCIuk724_Gt7uudUj_Ue8Ho";
const REPORT_DIR = "migration-reports";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    applySupabaseRefs: false,
    output: "",
    includeDetails: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply-supabase-refs") {
      options.applySupabaseRefs = true;
    } else if (arg === "--include-details") {
      options.includeDetails = true;
    } else if (arg === "--output") {
      options.output = argv[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Synchro-S Firebase migration audit

Usage:
  npm run audit:firebase-migration
  node scripts/synchro-firebase-migration-audit.mjs --include-details --output migration-reports/report.json
  node scripts/synchro-firebase-migration-audit.mjs --apply-supabase-refs

Default mode is dry-run/read-only. --apply-supabase-refs only updates nullable Firebase reference columns
for exact, non-duplicate matches after the SQL migration has been applied.`);
}

function loadDotEnvLocal() {
  const envPath = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      const next = line[i + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
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

function parseCsv(text) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

function normalizeHeader(value) {
  return String(value || "").replace(/\s+/g, "").trim().toLowerCase();
}

function normalizeName(value) {
  return String(value || "").replace(/^\/+/, "").replace(/\s+/g, " ").trim();
}

function normalizeNameToken(value) {
  return normalizeName(value).replace(/\s+/g, "").toLowerCase();
}

function findColumnIndex(headers, candidates) {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const idx = normalizedHeaders.indexOf(normalizeHeader(candidate));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseActive(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (["false", "0", "n", "no", "x", "✕", "☐", "미등록", "퇴원", "퇴사", "휴직", "중지", "비활성"].includes(v)) {
    return false;
  }
  if (["true", "1", "y", "yes", "✓", "☑", "✅", "v", "checked", "등록", "재원", "수강", "재직", "활성"].includes(v)) {
    return true;
  }
  return null;
}

async function fetchSheetCsv(spreadsheetId, sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Google Sheets fetch failed (${sheetName}): ${res.status}`);
  return res.text();
}

function summarizeNameDuplicates(items, nameKey) {
  const byToken = new Map();
  for (const item of items) {
    const token = normalizeNameToken(item[nameKey]);
    if (!token) continue;
    const bucket = byToken.get(token) ?? [];
    bucket.push(item);
    byToken.set(token, bucket);
  }
  return [...byToken.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([token, rows]) => ({
      token,
      count: rows.length,
      names: [...new Set(rows.map((row) => row[nameKey]).filter(Boolean))]
    }));
}

function extractTeachers(rows) {
  const headers = rows[0] ?? [];
  const nameIdx = findColumnIndex(headers, ["선생님성함", "강사명", "teacher", "name"]);
  const subjectIdx = findColumnIndex(headers, ["과목", "subject", "department"]);
  const activeIdx = findColumnIndex(headers, ["재직", "재직상태", "등록 상태", "등록상태", "status", "active"]);

  return rows.slice(1).map((row, index) => ({
    sourceRow: index + 2,
    name: normalizeName(row[nameIdx] ?? ""),
    subject: subjectIdx >= 0 ? String(row[subjectIdx] ?? "").trim() : "",
    active: activeIdx >= 0 ? parseActive(row[activeIdx]) : null
  })).filter((row) => row.name);
}

function extractStudents(rows) {
  const headers = rows[0] ?? [];
  const nameIdx = findColumnIndex(headers, ["이름 필드", "이름", "학생명", "student", "name"]);
  const schoolIdxFound = findColumnIndex(headers, ["학교 필드", "학교", "school", "원"]);
  const gradeIdxFound = findColumnIndex(headers, ["학년 필드", "학년", "grade"]);
  const activeIdx = findColumnIndex(headers, ["등록 상태", "등록상태", "status", "active"]);
  const schoolIdx = schoolIdxFound >= 0 ? schoolIdxFound : 1;
  const gradeIdx = gradeIdxFound >= 0 ? gradeIdxFound : 2;

  return rows.slice(1).map((row, index) => {
    const gradeRaw = String(row[gradeIdx] ?? "").trim().replace("@", "");
    const grade = gradeRaw.replace(/[^0-9]/g, "");
    return {
      sourceRow: index + 2,
      name: normalizeName(row[nameIdx] ?? ""),
      school: String(row[schoolIdx] ?? "").trim(),
      grade,
      active: activeIdx >= 0 ? parseActive(row[activeIdx]) : null
    };
  }).filter((row) => row.name && row.active !== false);
}

function buildNameIndex(items, nameKey) {
  const index = new Map();
  for (const item of items) {
    const token = normalizeNameToken(item[nameKey]);
    if (!token) continue;
    const bucket = index.get(token) ?? [];
    bucket.push(item);
    index.set(token, bucket);
  }
  return index;
}

function classifyMatches(sourceItems, candidateItems, sourceNameKey, candidateNameKey) {
  const candidateIndex = buildNameIndex(candidateItems, candidateNameKey);
  const sourceDuplicates = new Set(summarizeNameDuplicates(sourceItems, sourceNameKey).map((item) => item.token));
  const candidateDuplicates = new Set(summarizeNameDuplicates(candidateItems, candidateNameKey).map((item) => item.token));
  const exact = [];
  const needsReview = [];
  const unmatched = [];

  for (const source of sourceItems) {
    const token = normalizeNameToken(source[sourceNameKey]);
    const candidates = candidateIndex.get(token) ?? [];
    if (candidates.length === 0) {
      unmatched.push(source);
      continue;
    }
    if (candidates.length === 1 && !sourceDuplicates.has(token) && !candidateDuplicates.has(token)) {
      exact.push({ source, candidate: candidates[0], matchKey: token });
      continue;
    }
    needsReview.push({ source, candidates, matchKey: token });
  }

  return { exact, needsReview, unmatched };
}

async function loadSheets() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SYNC_ID || DEFAULT_SPREADSHEET_ID;
  const [teachersCsv, studentsCsv] = await Promise.all([
    fetchSheetCsv(spreadsheetId, "Teachers"),
    fetchSheetCsv(spreadsheetId, "student")
  ]);
  const teacherRows = parseCsv(teachersCsv);
  const studentRows = parseCsv(studentsCsv);
  return {
    spreadsheetId,
    teachers: extractTeachers(teacherRows),
    students: extractStudents(studentRows),
    headers: {
      Teachers: teacherRows[0] ?? [],
      student: studentRows[0] ?? []
    }
  };
}

function createSupabaseAdminOrNull() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

async function loadSupabaseSnapshot(supabase) {
  if (!supabase) {
    const missing = [
      process.env.NEXT_PUBLIC_SUPABASE_URL ? null : "NEXT_PUBLIC_SUPABASE_URL",
      process.env.SUPABASE_SERVICE_ROLE_KEY ? null : "SUPABASE_SERVICE_ROLE_KEY"
    ].filter(Boolean);

    return {
      available: false,
      missingEnv: missing,
      reason: `Missing ${missing.join(", ")}. Add the service role key only in a secure local/CI environment to run the full audit/apply.`
    };
  }

  return {
    available: true,
    instructors: await fetchAllSupabaseRows(supabase, "instructors", "id,instructor_name,is_active,user_id"),
    students: await fetchAllSupabaseRows(supabase, "students", "id,student_name,is_active,user_id,default_instructor_id"),
    classes: await fetchAllSupabaseRows(supabase, "classes", "id,instructor_id,subject_code,class_type_code,schedule_mode,weekday,class_date,start_time,end_time,active_from,active_to,progress_status"),
    enrollments: await fetchAllSupabaseRows(supabase, "class_enrollments", "id,class_id,student_id"),
    timetableGroups: await fetchAllSupabaseRows(supabase, "timetable_groups", "id,role_view,target_id,class_ids,is_active,week_start,name")
  };
}

async function fetchAllSupabaseRows(supabase, tableName, columns) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from(tableName)
      .select(columns)
      .range(from, to);

    if (error) throw new Error(`${tableName}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function summarizeSupabaseRelations(snapshot) {
  if (!snapshot.available) return snapshot;
  const classIds = new Set(snapshot.classes.map((row) => row.id));
  const studentIds = new Set(snapshot.students.map((row) => row.id));
  const instructorIds = new Set(snapshot.instructors.map((row) => row.id));
  return {
    available: true,
    counts: {
      instructors: snapshot.instructors.length,
      students: snapshot.students.length,
      classes: snapshot.classes.length,
      enrollments: snapshot.enrollments.length,
      timetableGroups: snapshot.timetableGroups.length
    },
    integrityWarnings: {
      enrollmentsWithMissingClass: snapshot.enrollments.filter((row) => !classIds.has(row.class_id)).length,
      enrollmentsWithMissingStudent: snapshot.enrollments.filter((row) => !studentIds.has(row.student_id)).length,
      classesWithMissingInstructor: snapshot.classes.filter((row) => !instructorIds.has(row.instructor_id)).length
    },
    duplicateNames: {
      instructors: summarizeNameDuplicates(snapshot.instructors, "instructor_name"),
      students: summarizeNameDuplicates(snapshot.students, "student_name")
    }
  };
}

function buildPermissionPlans(snapshot, studentExact, instructorExact) {
  const exactStudentIds = new Set(studentExact.map((match) => match.source.id));
  const exactInstructorIds = new Set(instructorExact.map((match) => match.source.id));
  const classesById = new Map(snapshot.classes.map((row) => [row.id, row]));
  const permissionKeys = new Set();
  const permissions = [];

  for (const enrollment of snapshot.enrollments) {
    if (!exactStudentIds.has(enrollment.student_id)) continue;
    const classRow = classesById.get(enrollment.class_id);
    if (!classRow || !exactInstructorIds.has(classRow.instructor_id)) continue;
    const key = `${enrollment.student_id}__${classRow.instructor_id}`;
    if (permissionKeys.has(key)) continue;
    permissionKeys.add(key);
    permissions.push({
      permissionId: key,
      studentId: enrollment.student_id,
      instructorId: classRow.instructor_id,
      source: "supabase_class_enrollments"
    });
  }
  return permissions;
}

function buildFirestoreSeedPlan(snapshot, sheets, matches) {
  if (!snapshot.available || !matches) return null;
  const studentSheetByToken = buildNameIndex(sheets.students, "name");
  const teacherSheetByToken = buildNameIndex(sheets.teachers, "name");
  const studentExact = matches.students.exact;
  const instructorExact = matches.instructors.exact;
  const permissions = buildPermissionPlans(snapshot, studentExact, instructorExact);

  return {
    collections: {
      students: studentExact.map((match) => {
        const token = normalizeNameToken(match.source.student_name);
        const sheet = studentSheetByToken.get(token)?.[0] ?? {};
        return {
          id: match.source.id,
          data: {
            id: match.source.id,
            studentId: match.source.id,
            supabaseStudentId: match.source.id,
            studentName: match.source.student_name,
            name: match.source.student_name,
            school: sheet.school ?? "",
            grade: sheet.grade ?? "",
            active: match.source.is_active !== false,
            isActive: match.source.is_active !== false,
            status: match.source.is_active === false ? "INACTIVE" : "ACTIVE",
            source: "synchro-s-supabase"
          }
        };
      }),
      instructors: instructorExact.map((match) => {
        const token = normalizeNameToken(match.source.instructor_name);
        const sheet = teacherSheetByToken.get(token)?.[0] ?? {};
        return {
          id: match.source.id,
          data: {
            id: match.source.id,
            instructorId: match.source.id,
            supabaseInstructorId: match.source.id,
            instructorName: match.source.instructor_name,
            name: match.source.instructor_name,
            subject: sheet.subject ?? "",
            active: match.source.is_active !== false,
            isActive: match.source.is_active !== false,
            status: match.source.is_active === false ? "INACTIVE" : "ACTIVE",
            source: "synchro-s-supabase"
          }
        };
      }),
      studentPermissions: permissions.map((permission) => ({
        id: permission.permissionId,
        data: {
          ...permission,
          active: true,
          permission: "ALLOW",
          source: "synchro-s-supabase"
        }
      }))
    },
    warnings: [
      "This seed plan intentionally does not create Firebase Auth users.",
      "Create Auth users and loginAliases only after reviewing duplicate/unmatched names."
    ]
  };
}

function buildMatches(sheets, supabaseSnapshot) {
  if (!supabaseSnapshot.available) return null;
  const studentMatches = classifyMatches(supabaseSnapshot.students, sheets.students, "student_name", "name");
  const instructorMatches = classifyMatches(supabaseSnapshot.instructors, sheets.teachers, "instructor_name", "name");
  return {
    students: {
      ...studentMatches,
      reverseUnmatched: classifyMatches(sheets.students, supabaseSnapshot.students, "name", "student_name").unmatched
    },
    instructors: {
      ...instructorMatches,
      reverseUnmatched: classifyMatches(sheets.teachers, supabaseSnapshot.instructors, "name", "instructor_name").unmatched
    }
  };
}

function compactMatchSummary(matches) {
  if (!matches) return null;
  return {
    students: {
      exactCount: matches.students.exact.length,
      needsReviewCount: matches.students.needsReview.length,
      unmatchedSupabaseCount: matches.students.unmatched.length,
      unmatchedSheetCount: matches.students.reverseUnmatched.length
    },
    instructors: {
      exactCount: matches.instructors.exact.length,
      needsReviewCount: matches.instructors.needsReview.length,
      unmatchedSupabaseCount: matches.instructors.unmatched.length,
      unmatchedSheetCount: matches.instructors.reverseUnmatched.length
    }
  };
}

function buildReport(sheets, supabaseSnapshot, options, applyResult = null) {
  const supabaseSummary = summarizeSupabaseRelations(supabaseSnapshot);
  const matches = buildMatches(sheets, supabaseSnapshot);
  const firestoreSeedPlan = buildFirestoreSeedPlan(supabaseSnapshot, sheets, matches);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.applySupabaseRefs ? "apply-supabase-refs" : "dry-run/read-only",
    safety: {
      destructiveOperations: false,
      scheduleRowsDeleted: false,
      scheduleRowsRecreated: false,
      onlyExactMatchesEligibleForApply: true
    },
    spreadsheet: {
      id: sheets.spreadsheetId,
      headers: sheets.headers,
      counts: {
        teachers: sheets.teachers.length,
        students: sheets.students.length
      },
      duplicateNames: {
        teachers: summarizeNameDuplicates(sheets.teachers, "name"),
        students: summarizeNameDuplicates(sheets.students, "name")
      }
    },
    supabase: supabaseSummary,
    matching: compactMatchSummary(matches),
    firebaseSeedPlanSummary: firestoreSeedPlan
      ? {
          students: firestoreSeedPlan.collections.students.length,
          instructors: firestoreSeedPlan.collections.instructors.length,
          studentPermissions: firestoreSeedPlan.collections.studentPermissions.length,
          warnings: firestoreSeedPlan.warnings
        }
      : null,
    applyResult,
    nextStep: options.applySupabaseRefs
      ? "If apply succeeded, review updated nullable reference fields before enabling Firebase login."
      : "Review this report before enabling any writes. Do not migrate duplicate, ambiguous, or unmatched names."
  };

  if (options.includeDetails) {
    report.details = {
      matches,
      firestoreSeedPlan
    };
  }

  return report;
}

async function assertFirebaseColumnsReady(supabase) {
  const { error } = await supabase
    .from("students")
    .select("id,firebase_student_id,firebase_match_key,firebase_sync_status")
    .limit(1);

  if (error) {
    throw new Error(
      `Firebase reference columns are not ready. Apply supabase/migrations/0010_firebase_identity_refs.sql first. Supabase said: ${error.message}`
    );
  }
}

async function applySupabaseRefs(supabase, sheets, supabaseSnapshot) {
  if (!supabaseSnapshot.available) {
    throw new Error("Cannot apply without SUPABASE_SERVICE_ROLE_KEY.");
  }
  await assertFirebaseColumnsReady(supabase);

  const matches = buildMatches(sheets, supabaseSnapshot);
  const now = new Date().toISOString();
  const studentExact = matches.students.exact;
  const instructorExact = matches.instructors.exact;
  const permissionPlan = buildPermissionPlans(supabaseSnapshot, studentExact, instructorExact);
  const exactInstructorIds = new Set(instructorExact.map((match) => match.source.id));
  const exactStudentIds = new Set(studentExact.map((match) => match.source.id));

  for (const match of instructorExact) {
    const { error } = await supabase
      .from("instructors")
      .update({
        firebase_instructor_id: match.source.id,
        firebase_match_key: match.matchKey,
        firebase_sync_status: "matched",
        firebase_synced_at: now
      })
      .eq("id", match.source.id);
    if (error) throw new Error(`instructors ${match.source.id}: ${error.message}`);
  }

  for (const match of studentExact) {
    const { error } = await supabase
      .from("students")
      .update({
        firebase_student_id: match.source.id,
        firebase_match_key: match.matchKey,
        firebase_sync_status: "matched",
        firebase_synced_at: now
      })
      .eq("id", match.source.id);
    if (error) throw new Error(`students ${match.source.id}: ${error.message}`);
  }

  for (const classRow of supabaseSnapshot.classes.filter((row) => exactInstructorIds.has(row.instructor_id))) {
    const { error } = await supabase
      .from("classes")
      .update({
        firebase_instructor_id: classRow.instructor_id,
        firebase_sync_status: "matched",
        firebase_synced_at: now
      })
      .eq("id", classRow.id);
    if (error) throw new Error(`classes ${classRow.id}: ${error.message}`);
  }

  for (const enrollment of supabaseSnapshot.enrollments.filter((row) => exactStudentIds.has(row.student_id))) {
    const { error } = await supabase
      .from("class_enrollments")
      .update({
        firebase_student_id: enrollment.student_id,
        firebase_sync_status: "matched",
        firebase_synced_at: now
      })
      .eq("id", enrollment.id);
    if (error) throw new Error(`class_enrollments ${enrollment.id}: ${error.message}`);
  }

  return {
    updatedInstructors: instructorExact.length,
    updatedStudents: studentExact.length,
    updatedClasses: supabaseSnapshot.classes.filter((row) => exactInstructorIds.has(row.instructor_id)).length,
    updatedEnrollments: supabaseSnapshot.enrollments.filter((row) => exactStudentIds.has(row.student_id)).length,
    proposedStudentPermissions: permissionPlan.length,
    skippedStudentsNeedingReview: matches.students.needsReview.length + matches.students.unmatched.length,
    skippedInstructorsNeedingReview: matches.instructors.needsReview.length + matches.instructors.unmatched.length
  };
}

function writeReportIfRequested(report, outputPath) {
  const target = outputPath || path.join(REPORT_DIR, `synchro-firebase-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const absolute = path.isAbsolute(target) ? target : path.join(repoRoot, target);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
  return absolute;
}

loadDotEnvLocal();
const options = parseArgs(process.argv.slice(2));

try {
  const sheets = await loadSheets();
  const supabase = createSupabaseAdminOrNull();
  const supabaseSnapshot = await loadSupabaseSnapshot(supabase);
  const applyResult = options.applySupabaseRefs ? await applySupabaseRefs(supabase, sheets, supabaseSnapshot) : null;
  const report = buildReport(sheets, supabaseSnapshot, options, applyResult);
  const outputPath = writeReportIfRequested(report, options.output);
  console.log(JSON.stringify(report, null, 2));
  console.error(`Report written: ${outputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
