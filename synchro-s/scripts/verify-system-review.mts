import assert from "node:assert/strict";
import { fetchWeeklySchedule } from "../lib/server/scheduleService";
import { buildSessionToken, verifySessionToken } from "../lib/server/sessionToken";
import { fetchSupabaseRowsByIds } from "../lib/server/supabasePagination";

process.env.SESSION_SECRET = "local-regression-test-only";
const token = buildSessionToken({ fullName: "검증", role: "student", studentId: "s" });
assert.equal(verifySessionToken(token)?.studentId, "s");
assert.equal(verifySessionToken(`${token}.extra`), null);
const body = token.split(".")[0];
assert.doesNotThrow(() => verifySessionToken(`${body}.${"가".repeat(43)}`));
assert.equal(verifySessionToken(`${body}.${"가".repeat(43)}`), null);
const largeSingleId = Array.from({ length: 1101 }, (_, id) => ({ id }));
const pagedBatch = await fetchSupabaseRowsByIds(["one"], async (_ids, from, to) => ({ data: largeSingleId.slice(from, to + 1), error: null }));
assert.equal(pagedBatch.length, 1101, "one ID can still produce multiple result pages");

// Simulate the PostgREST row cap, not just a pagination helper in isolation.
const lessons = Array.from({ length: 1101 }, (_, index) => ({
  id: `c${String(index).padStart(4, "0")}`, schedule_mode: "recurring", instructor_id: "i",
  subject_code: "MATH", class_type_code: "REGULAR", weekday: 1, class_date: null,
  start_time: "10:00:00", end_time: "11:00:00", active_from: "2026-08-31", active_to: null,
  progress_status: "planned", created_at: "2026-08-31T00:00:00Z",
  instructors: { id: "i", instructor_name: "강사", is_active: true }, subjects: null, class_types: null
}));
const enrollments = lessons.map((lesson, index) => ({
  id: `e${index}`, class_id: lesson.id, student_id: `s${index}`,
  students: { id: `s${index}`, student_name: `학생${index}`, is_active: true }
}));
const groups = lessons.map((lesson, index) => ({
  id: `g${index}`, role_view: "student", target_id: `s${index}`, week_start: "2026-08-31", expires_on: null,
  tag_id: "sep", is_active: true, class_ids: [lesson.id], snapshot_events: [], created_at: "2026-08-31T00:00:00Z"
}));
const tables: Record<string, any[]> = { classes: lessons, class_enrollments: enrollments, timetable_groups: groups };
const pages: Record<string, number> = {};
const db = { from(table: string) {
  let data = [...(tables[table] ?? [])]; let from = 0; let to = 999;
  const query: any = {
    select() { return query; }, order() { return query; },
    eq(key: string, value: unknown) { data = data.filter(row => row[key] === value); return query; },
    in(key: string, values: unknown[]) { assert.ok(values.length <= 100, "IN filters must not grow beyond the safe batch size"); data = data.filter(row => values.includes(row[key])); return query; },
    is(key: string, value: unknown) { return query.eq(key, value); },
    lte() { return query; }, gte() { return query; }, or() { return query; },
    range(start: number, end: number) { from = start; to = end; return query; },
    then(resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) {
      pages[table] = (pages[table] ?? 0) + 1;
      return Promise.resolve({ data: data.slice(from, to + 1), error: null }).then(resolve, reject);
    }
  }; return query;
} };
const result = await fetchWeeklySchedule(db, { weekStart: "2026-08-31", view: "instructor", instructorId: "i", scheduleTagId: "sep" });
assert.equal(result.events.length, 1101, "all lessons beyond the 1,000-row cap must survive");
assert.equal(result.events.at(-1)?.studentNames[0], "학생1100");
assert.ok(pages.class_enrollments >= 3);
assert.ok(pages.timetable_groups >= 3);
console.log("PASS: malformed-session recovery; 1,101 lessons, enrollments and effective groups across page boundaries");
