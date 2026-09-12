import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moveScheduleSlot } from "../lib/server/scheduleService";

// Exercise the actual service, weekly projection and group selection with an
// in-memory Supabase adapter. No credentials or production writes.
function fixture(currentConflict = false) {
  const lesson = (id: string, type: string, start: string, end: string) => ({
    id, instructor_id: "teacher", subject_code: "ENGLISH", class_type_code: type,
    schedule_mode: "recurring", weekday: 7, class_date: null, start_time: start, end_time: end,
    active_from: "2026-08-01", active_to: null, progress_status: "planned", created_at: "2026-08-01",
    instructors: { id: "teacher", instructor_name: "검증강사", is_active: true },
    subjects: { display_name: "영어" }, class_types: { display_name: type, badge_text: type }
  });
  const db: Record<string, any[]> = {
    classes: [lesson("source", "REGULAR_MULTI", "15:00", "16:00"), lesson("old-ratio", "ONE_TO_ONE", "19:00", "20:00"), lesson("current", currentConflict ? "ONE_TO_ONE" : "REGULAR_MULTI", "19:00", "20:00")],
    instructors: [{ id: "teacher", days_off: [] }],
    class_enrollments: [
      { id: "e1", class_id: "source", student_id: "jun", students: { id: "jun", student_name: "검증학생A", is_active: true } },
      { id: "e2", class_id: "old-ratio", student_id: "yoon", students: { id: "yoon", student_name: "검증학생B", is_active: true } },
      { id: "e3", class_id: "current", student_id: "other", students: { id: "other", student_name: "검증학생C", is_active: true } }
    ],
    timetable_groups: [
      { id: "g1", target_id: "jun", tag_id: "sep", class_ids: ["source"] },
      { id: "g2", target_id: "yoon", tag_id: "aug", class_ids: ["old-ratio"] },
      { id: "g3", target_id: "other", tag_id: "sep", class_ids: ["current"] }
    ].map(g => ({ ...g, role_view: "student", week_start: "2026-08-31", is_active: true, snapshot_events: [], expires_on: null, created_at: "2026-08-31" })),
    class_overrides: [], prospect_timetable_entries: [], class_type_compatibility: [], class_status_logs: []
  };
  let writes = 0;
  const supabase = { from(table: string) {
    const filters: ((r: any) => boolean)[] = [];
    let single = false; let update: any; let insert: any; let bounds: number[] | undefined;
    const query: any = {
      select: () => query, order: () => query,
      eq: (k: string, v: any) => { filters.push(r => r[k] === v); return query; },
      is: (k: string, v: any) => { filters.push(r => (r[k] ?? null) === v); return query; },
      in: (k: string, v: any[]) => { filters.push(r => v.includes(r[k])); return query; },
      lte: (k: string, v: any) => { filters.push(r => r[k] <= v); return query; },
      gte: (k: string, v: any) => { filters.push(r => r[k] >= v); return query; },
      or: () => query, range: (a: number, b: number) => { bounds = [a,b]; return query; },
      single: () => { single = true; return query; }, maybeSingle: () => { single = true; return query; },
      update: (value: any) => { update = value; return query; },
      insert: (value: any) => { insert = value; return query; },
      then(resolve: any, reject: any) {
        let rows = (db[table] ?? []).filter(r => filters.every(f => f(r)));
        if (update) { writes++; rows.forEach(r => Object.assign(r, update)); }
        if (insert) { writes++; (db[table] ??= []).push(insert); rows = [insert]; }
        if (bounds) rows = rows.slice(bounds[0], bounds[1] + 1);
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      }
    }; return query;
  } };
  return { supabase, writes: () => writes };
}
const target = { weekday: 7, weekStart: "2026-09-07", startTime: "19:00", endTime: "20:00" };
for (const [tag, realConflict, expected] of [[undefined, false, false], ["sep", false, true], ["sep", true, false]] as const) {
  const f = fixture(realConflict);
  const result = await moveScheduleSlot(f.supabase, "source", { ...target, scheduleTagId: tag }, "qa", { studentId: "jun" });
  assert.equal(result.moved, expected, `${tag}: currentConflict=${realConflict}`);
  if (!expected) assert.equal(f.writes(), 0, "conflict must not mutate records");
  if (tag === "sep" && realConflict) assert.equal(result.conflict.conflicts[0]?.classId, "current");
}
const source = readFileSync(new URL("../app/synchro-s/page.tsx", import.meta.url), "utf8");
for (const match of source.matchAll(/fetch\(`\/api\/schedules\/\$\{[^}]+\}\/move`[\s\S]*?body: JSON.stringify\(\{([\s\S]*?)\}\)/g)) {
  assert.match(match[1]!, /scheduleTagId: selectedScheduleTagId/, "every move caller must pass its displayed tag scope");
}
console.log("PASS: legacy unscoped conflict reproduced; selected-tag move succeeds; real same-tag conflict rejects without writes.");
