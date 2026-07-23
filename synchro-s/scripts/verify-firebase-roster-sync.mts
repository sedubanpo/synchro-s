import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { planFirebaseStudentSync, planMissingFirebaseStudentInserts } from "../lib/server/firebaseStudentMirror";
import {
  deduplicateFirebaseRosterStudents,
  loadFirebaseRoster,
  type FirebaseStudentRosterItem
} from "../lib/server/firestoreRoster";

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

const stalePreferredRowId = "11111111-1111-4111-8111-111111111111";
const existingFirebaseOwnerId = "22222222-2222-4222-8222-222222222222";
const conflictingHajimin = { ...hajimin, supabaseStudentId: stalePreferredRowId };
const conflictPlan = planFirebaseStudentSync(
  [
    {
      id: stalePreferredRowId,
      student_name: "하지민",
      is_active: true,
      firebase_student_id: null,
      firebase_uid: null
    },
    {
      id: existingFirebaseOwnerId,
      student_name: "하지민(기존)",
      is_active: true,
      firebase_student_id: studentId,
      firebase_uid: null
    }
  ],
  [conflictingHajimin],
  "2026-07-23T00:00:00.000Z"
);
assert.equal(conflictPlan.identityConflictsResolved, 1, "A stale Supabase pointer must be recognized as an identity conflict.");
assert.equal(conflictPlan.updates.length, 1, "An identity conflict must produce one update.");
assert.equal(
  conflictPlan.updates[0]?.id,
  existingFirebaseOwnerId,
  "The row already owning firebase_student_id must be updated so the unique ID is never moved onto a second row."
);
assert.equal(conflictPlan.inserts.length, 0, "An identity conflict must not create another student row.");

const hongJaebeom: FirebaseStudentRosterItem = {
  ...hajimin,
  id: "33333333-3333-4333-8333-333333333333",
  studentId: "33333333-3333-4333-8333-333333333333",
  canonicalStudentId: "33333333-3333-4333-8333-333333333333",
  studentIdAliases: ["33333333-3333-4333-8333-333333333333"],
  name: "홍재범",
  school: "상문고",
  grade: "3",
  secondary: "상문고 · 3학년"
};
const uniqueNamePlan = planFirebaseStudentSync(
  [{ id: "44444444-4444-4444-8444-444444444444", student_name: "홍재범", is_active: true }],
  [hongJaebeom]
);
assert.equal(uniqueNamePlan.updates[0]?.id, "44444444-4444-4444-8444-444444444444");
assert.equal(uniqueNamePlan.updates[0]?.identityChanged, true);
assert.equal(
  uniqueNamePlan.updates[0]?.payload.firebase_student_id,
  hongJaebeom.canonicalStudentId,
  "A single unambiguous legacy name must be linked to its Firebase ID instead of being left without account details."
);

const duplicateRosterPlan = planFirebaseStudentSync(
  [],
  [
    hongJaebeom,
    {
      ...hongJaebeom,
      id: "legacy-hong-jaebeom",
      studentIdAliases: [...hongJaebeom.studentIdAliases, "legacy-hong-jaebeom"]
    }
  ]
);
assert.equal(duplicateRosterPlan.duplicateRosterEntries, 1, "Duplicate Firebase documents with one canonical ID must be collapsed.");
assert.equal(duplicateRosterPlan.inserts.length, 1, "A duplicated Firebase identity must create at most one Supabase row.");

const deduplicatedRoster = deduplicateFirebaseRosterStudents([
  hongJaebeom,
  {
    ...hongJaebeom,
    id: "legacy-hong-jaebeom",
    school: "",
    grade: "",
    secondary: "",
    supabaseStudentId: undefined,
    studentIdAliases: [...hongJaebeom.studentIdAliases, "legacy-hong-jaebeom"]
  }
]);
assert.equal(deduplicatedRoster.duplicateCount, 1);
assert.equal(deduplicatedRoster.students.length, 1);
assert.equal(
  deduplicatedRoster.students[0]?.secondary,
  "상문고 · 3학년",
  "The user-facing roster must keep the richest canonical school and grade when duplicate Firebase documents exist."
);

const ambiguousNamePlan = planFirebaseStudentSync(
  [
    { id: "55555555-5555-4555-8555-555555555555", student_name: "한윤진", is_active: true },
    { id: "66666666-6666-4666-8666-666666666666", student_name: "한윤진", is_active: true }
  ],
  [{ ...hongJaebeom, name: "한윤진" }]
);
assert.equal(ambiguousNamePlan.needsReview, 1, "True same-name ambiguity must still require review.");
assert.equal(ambiguousNamePlan.updates.length, 0);

const sharedLegacyRowId = "77777777-7777-4777-8777-777777777777";
const competingTargetPlan = planFirebaseStudentSync(
  [
    {
      id: sharedLegacyRowId,
      student_name: "공유 대상",
      is_active: true,
      firebase_student_id: null,
      firebase_uid: null
    }
  ],
  [
    {
      ...hongJaebeom,
      supabaseStudentId: sharedLegacyRowId
    },
    {
      ...hajimin,
      supabaseStudentId: sharedLegacyRowId
    }
  ]
);
assert.equal(
  competingTargetPlan.updates.length,
  0,
  "Two Firebase identities must never be written onto the same unresolved Supabase row."
);
assert.equal(
  competingTargetPlan.needsReview,
  2,
  "Every student in an unresolved target-row collision must be routed to review."
);

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
          },
          {
            name: `projects/fir-lms-prod/databases/(default)/documents/students/legacy-${studentId}`,
            fields: {
              studentId: { stringValue: `legacy-${studentId}` },
              canonicalStudentId: { stringValue: studentId },
              studentIdAliases: {
                arrayValue: { values: [{ stringValue: studentId }, { stringValue: `legacy-${studentId}` }] }
              },
              name: { stringValue: "하지민" },
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
  assert.equal(studentRoster.students.length, 1, "Duplicate Firebase documents must not leak into the user-facing roster.");
  assert.equal(studentRoster.duplicateStudentDocuments, 1);
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
assert.match(
  optionsRoute,
  /firebaseStudentByUniqueName/,
  "A unique active account name must restore school and grade details before a manual sync mutates Supabase."
);
assert.match(
  optionsRoute,
  /uniqueSupabaseStudentNameKeys/,
  "Name fallback must be disabled for duplicate Supabase student names."
);
assert.doesNotMatch(optionsRoute, /planMissingFirebaseInstructorInserts/, "Options GET must not mirror an unmaintained Firestore instructor collection.");
assert.doesNotMatch(optionsRoute, /\.from\(["'](?:students|instructors)["']\)\.insert/, "Options GET must not create identity rows as a read side effect.");
assert.doesNotMatch(optionsRoute, /studentIdsToReactivate/, "Options GET must not reactivate roster rows as a read side effect.");
assert.doesNotMatch(syncRoute, /FirebaseInstructorRosterItem|roster\.instructors/, "Manual sync must not depend on Firestore instructors.");
assert.match(syncRoute, /studentsNeedsReview/, "Unlinked same-name students must be routed to review instead of name-matched.");
assert.match(syncRoute, /planFirebaseStudentSync/, "Manual sync must use the collision-safe Firebase student reconciliation plan.");
assert.match(
  syncRoute,
  /stableUpdates\.map[\s\S]*\.upsert\(updateRows, \{ onConflict: "id" \}\)/,
  "Identity-stable roster updates must stay batched for performance."
);
assert.match(
  syncRoute,
  /for \(const update of identityChangingUpdates\)/,
  "Firebase ID assignments must use the collision-aware write path."
);
assert.match(
  syncRoute,
  /findStudentByFirebaseId[\s\S]*isFirebaseStudentIdConflict/,
  "A concurrent automatic projection must be reconciled instead of surfacing a raw unique-key error."
);

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
assert.match(pageSource, /controller\.abort\(\), 45_000/, "Manual roster sync must time out instead of leaving an indefinite spinner.");
assert.match(pageSource, /window\.clearTimeout\(timeoutId\)/, "Manual roster sync must always release its timeout.");
assert.match(pageSource, /명단 동기화 중\.\.\./, "The pending label must describe roster synchronization truthfully.");

console.log("Firebase roster sync verification passed: student authority, ID-first review guard, side-effect-free options, and no Firestore instructor dependency.");
