import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { planMissingFirebaseStudentInserts } from "../lib/server/firebaseStudentMirror";
import type { FirebaseStudentRosterItem } from "../lib/server/firestoreRoster";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const studentId = "92568553-9f1e-4339-a9f7-165019c59adc";
const hajimin: FirebaseStudentRosterItem = {
  id: studentId,
  studentId,
  canonicalStudentId: studentId,
  studentIdAliases: [studentId],
  name: "하지민",
  school: "세화여고",
  grade: "2",
  secondary: "세화여고 · 2학년",
  status: "ACTIVE",
  active: true
};

const planned = planMissingFirebaseStudentInserts([], [hajimin], "2026-07-22T00:00:00.000Z");
assert.equal(planned.length, 1, "A canonical Firebase student must be planned for Supabase mirroring.");
assert.deepEqual(planned[0], {
  id: studentId,
  student_name: "하지민",
  is_active: true,
  firebase_student_id: studentId,
  firebase_uid: null,
  firebase_match_key: "하지민|세화여고|2",
  firebase_sync_status: "matched",
  firebase_synced_at: "2026-07-22T00:00:00.000Z"
});

const alreadyMirrored = planMissingFirebaseStudentInserts(
  [{ id: studentId, student_name: "하지민", is_active: true, firebase_student_id: studentId, firebase_uid: null }],
  [hajimin]
);
assert.equal(alreadyMirrored.length, 0, "An already mirrored Firebase student must not be duplicated.");

const syncRoute = fs.readFileSync(path.join(repoRoot, "app/api/sheets/sync/route.ts"), "utf8");
assert.match(syncRoute, /loadFirebaseRoster\(idToken, \{ forceRefresh: true \}\)/, "Manual roster sync must bypass stale roster cache.");
assert.doesNotMatch(syncRoute, /docs\.google\.com|source:\s*["']sheets["']/, "Manual roster sync must not silently fall back to Sheets.");
assert.match(syncRoute, /Firebase 인증 상태를 확인할 수 없습니다/, "Missing Firebase authentication must have an actionable error.");

const optionsRoute = fs.readFileSync(path.join(repoRoot, "app/api/schedules/options/route.ts"), "utf8");
assert.doesNotMatch(
  optionsRoute,
  /activeStudentNames|activeTeacherNames/,
  "Legacy Sheet active flags must not override the Firebase/Supabase roster state."
);
assert.match(
  optionsRoute,
  /Firebase 명단을 새로고침하지 못했습니다/,
  "A failed canonical roster refresh must return a truthful error."
);

const pageSource = fs.readFileSync(path.join(repoRoot, "app/synchro-s/page.tsx"), "utf8");
assert.match(pageSource, /await auth\.authStateReady\(\)/, "Client requests must wait for Firebase auth restoration.");
assert.match(
  pageSource,
  /getFirebaseAuthHeaders\(\{ "Content-Type": "application\/json" \}, true\)/,
  "Manual roster sync must refresh the Firebase ID token."
);

console.log("Firebase roster sync verification passed: canonical insert, duplicate guard, fresh roster, no silent Sheets fallback.");
