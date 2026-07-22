import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { planMissingFirebaseStudentInserts } from "../lib/server/firebaseStudentMirror";
import { loadFirebaseRoster, type FirebaseStudentRosterItem } from "../lib/server/firestoreRoster";

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

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("/documents/students")) {
    return new Response(
      JSON.stringify({
        documents: [
          {
            name: `projects/fir-lms-prod/databases/(default)/documents/students/${studentId}`,
            fields: {
              studentId: { stringValue: studentId },
              canonicalStudentId: { stringValue: studentId },
              studentIdAliases: { arrayValue: { values: [{ stringValue: studentId }] } },
              name: { stringValue: "하지민" },
              school: { stringValue: "세화여고" },
              grade: { stringValue: "2" },
              status: { stringValue: "ACTIVE" },
              active: { booleanValue: true }
            }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  throw new Error(`Unexpected Firestore URL: ${url}`);
};

try {
  const studentRoster = await loadFirebaseRoster("student-readable-token", { forceRefresh: true });
  assert.equal(studentRoster.available, true, "A readable Firebase student collection must keep the roster usable.");
  assert.equal(studentRoster.studentsAvailable, true, "The canonical student roster must remain available.");
  assert.equal(studentRoster.students[0]?.secondary, "세화여고 · 2학년", "Canonical student details must be preserved.");
} finally {
  globalThis.fetch = originalFetch;
}

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
  /Firebase 학생 명단을 새로고침하지 못했습니다/,
  "A failed canonical roster refresh must return a truthful error."
);
assert.match(optionsRoute, /firebaseRoster\.studentsAvailable/, "Student roster behavior must not depend on instructor permissions.");
assert.doesNotMatch(optionsRoute, /planMissingFirebaseInstructorInserts/, "Options GET must not mirror an unmaintained Firestore instructor collection.");
assert.doesNotMatch(optionsRoute, /\.from\(["'](?:students|instructors)["']\)\.insert/, "Options GET must not create identity rows as a read side effect.");
assert.doesNotMatch(optionsRoute, /studentIdsToReactivate/, "Options GET must not reactivate roster rows as a read side effect.");
assert.doesNotMatch(syncRoute, /FirebaseInstructorRosterItem|roster\.instructors/, "Manual sync must not depend on Firestore instructors.");
assert.match(syncRoute, /studentsNeedsReview/, "Unlinked same-name students must be routed to review instead of name-matched.");

const rosterSource = fs.readFileSync(path.join(repoRoot, "lib/server/firestoreRoster.ts"), "utf8");
assert.doesNotMatch(rosterSource, /listFirestoreCollection\(idToken, ["']instructors["']\)/, "The runtime roster must not request Firestore instructors.");
assert.match(rosterSource, /createHash\(["']sha256["']\)/, "Roster cache entries must be isolated by a non-reversible token fingerprint.");

const pageSource = fs.readFileSync(path.join(repoRoot, "app/synchro-s/page.tsx"), "utf8");
assert.match(pageSource, /await auth\.authStateReady\(\)/, "Client requests must wait for Firebase auth restoration.");
assert.match(
  pageSource,
  /getFirebaseAuthHeaders\(\{ "Content-Type": "application\/json" \}, true\)/,
  "Manual roster sync must refresh the Firebase ID token."
);

console.log("Firebase roster sync verification passed: student authority, ID-first review guard, side-effect-free options, and no Firestore instructor dependency.");
