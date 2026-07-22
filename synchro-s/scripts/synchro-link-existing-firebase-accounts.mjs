#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SERVICE_ACCOUNT = "/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json";
const S_LMS_NODE_MODULES = "/Users/anjongseong/Documents/New project/s-lms/node_modules";
const REPORT_DIR = "migration-reports";

const require = createRequire(import.meta.url);
const admin = require(path.join(S_LMS_NODE_MODULES, "firebase-admin"));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    applyFirestoreMerge: false,
    applySupabaseUids: false,
    allowFullFirestoreScan: false,
    output: "",
    serviceAccount: DEFAULT_SERVICE_ACCOUNT
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply-firestore-merge") {
      options.applyFirestoreMerge = true;
    } else if (arg === "--apply-supabase-uids") {
      options.applySupabaseUids = true;
    } else if (arg === "--allow-full-firestore-scan") {
      options.allowFullFirestoreScan = true;
    } else if (arg === "--service-account") {
      options.serviceAccount = argv[index + 1] ?? "";
      index += 1;
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
  console.log(`Synchro-S existing Firebase account linker

Usage:
  npm run link:firebase-accounts -- --output migration-reports/firebase-account-link-dry-run.json
  npm run link:firebase-accounts -- --apply-firestore-merge --apply-supabase-uids

This script never creates Firebase Auth users. It only matches existing S-LMS Firebase users and can
optionally merge Firestore bridge docs and Supabase firebase_uid references for exact instructor matches.

Firestore full-collection scans are blocked by default. Pass --allow-full-firestore-scan only for a
deliberate account-index rebuild after confirming Firestore quota is healthy.`);
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

function normalizeName(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/(선생님|강사|쌤|t)$/i, "")
    .trim()
    .toLowerCase();
}

function subjectTokens(value) {
  return String(value || "")
    .split(/[,/·\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasSubjectMismatch(expected, actual) {
  const expectedTokens = subjectTokens(expected);
  const actualTokens = subjectTokens(actual);
  if (!expectedTokens.length || !actualTokens.length) return false;
  return !expectedTokens.some((token) => actualTokens.includes(token));
}

function sha(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

async function fetchAllSupabaseRows(supabase, tableName, columns) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(tableName)
      .select(columns)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`${tableName}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function initFirebase(options) {
  if (!fs.existsSync(options.serviceAccount)) {
    throw new Error(`Firebase service account file not found: ${options.serviceAccount}`);
  }
  const serviceAccount = require(options.serviceAccount);
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
  }
  return admin.firestore();
}

async function listAuthUsers() {
  const users = [];
  let pageToken = undefined;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function listCollection(db, collectionName, options) {
  if (!options.allowFullFirestoreScan) {
    throw new Error(
      `Blocked full Firestore collection scan for ${collectionName}. ` +
        "Use scripts/synchro-firestore-plan-verify.mjs for ID-based verification, " +
        "or pass --allow-full-firestore-scan only for an intentional account-index rebuild."
    );
  }
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

function buildFirebaseAccountIndex(authUsers, userDocs, profileDocs, accessDocs, aliasDocs) {
  const authByUid = new Map(authUsers.map((user) => [user.uid, user]));
  const userByUid = new Map(userDocs.map((doc) => [doc.id, doc.data]));
  const profileByUid = new Map(profileDocs.map((doc) => [doc.id, doc.data]));
  const accessByUid = new Map(accessDocs.map((doc) => [doc.id, doc.data]));
  const aliasesByUid = new Map();

  for (const alias of aliasDocs) {
    const uid = alias.data.uid;
    if (!uid) continue;
    const bucket = aliasesByUid.get(uid) ?? [];
    bucket.push({ id: alias.id, data: alias.data });
    aliasesByUid.set(uid, bucket);
  }

  const uids = new Set([
    ...authByUid.keys(),
    ...userByUid.keys(),
    ...profileByUid.keys(),
    ...accessByUid.keys(),
    ...aliasesByUid.keys()
  ]);

  return [...uids].map((uid) => {
    const auth = authByUid.get(uid);
    const user = userByUid.get(uid) ?? {};
    const profile = profileByUid.get(uid) ?? {};
    const access = accessByUid.get(uid) ?? {};
    const aliases = aliasesByUid.get(uid) ?? [];
    const profileSubjects = Array.isArray(profile.subjects) ? profile.subjects.join(", ") : "";
    const name = user.name || profile.displayName || auth?.displayName || "";
    const subject = user.subject || profile.department || profile.subject || profileSubjects || "";
    return {
      uid,
      authExists: Boolean(auth),
      authEmail: auth?.email || user.email || "",
      authDisabled: Boolean(auth?.disabled),
      name,
      normalizedName: normalizeName(name),
      role: user.role || profile.role || "",
      status: user.status || profile.status || "",
      loginId: user.loginId || profile.loginId || profile.instructorId || profile.teacherId || "",
      subject,
      apps: access.apps || {},
      aliases: aliases.map((alias) => alias.id)
    };
  });
}

function loadAppliedReport() {
  const reportPath = path.join(repoRoot, "migration-reports", "applied.json");
  if (!fs.existsSync(reportPath)) {
    throw new Error("migration-reports/applied.json is required. Run the Supabase reference migration first.");
  }
  return JSON.parse(fs.readFileSync(reportPath, "utf8"));
}

function buildInstructorSheetMeta(appliedReport) {
  const map = new Map();
  const matches = appliedReport?.details?.matches?.instructors?.exact ?? [];
  for (const match of matches) {
    map.set(match.source.id, {
      sheetName: match.candidate.name,
      subject: match.candidate.subject || "",
      sourceRow: match.candidate.sourceRow
    });
  }
  return map;
}

function classifyInstructorMatches(instructors, firebaseAccounts, instructorSheetMeta) {
  const accountsByName = new Map();
  for (const account of firebaseAccounts) {
    if (!account.normalizedName) continue;
    const bucket = accountsByName.get(account.normalizedName) ?? [];
    bucket.push(account);
    accountsByName.set(account.normalizedName, bucket);
  }

  const exact = [];
  const needsReview = [];
  const unmatched = [];

  for (const instructor of instructors) {
    const meta = instructorSheetMeta.get(instructor.id) ?? {};
    const normalizedName = normalizeName(instructor.instructor_name);
    const candidates = accountsByName.get(normalizedName) ?? [];
    if (!candidates.length) {
      unmatched.push({ instructor, sheet: meta, reason: "NO_EXISTING_FIREBASE_ACCOUNT_BY_NAME" });
      continue;
    }
    if (candidates.length > 1) {
      needsReview.push({ instructor, sheet: meta, candidates, reason: "DUPLICATE_FIREBASE_NAME" });
      continue;
    }
    const candidate = candidates[0];
    if (!candidate.authExists) {
      needsReview.push({ instructor, sheet: meta, candidates, reason: "FIRESTORE_DOC_WITHOUT_AUTH_USER" });
      continue;
    }
    if (candidate.authDisabled || candidate.status === "DISABLED" || candidate.role === "DISABLED") {
      needsReview.push({ instructor, sheet: meta, candidates, reason: "DISABLED_FIREBASE_ACCOUNT" });
      continue;
    }
    if (hasSubjectMismatch(meta.subject, candidate.subject)) {
      needsReview.push({ instructor, sheet: meta, candidates, reason: "SUBJECT_MISMATCH" });
      continue;
    }
    exact.push({ instructor, sheet: meta, account: candidate });
  }

  return { exact, needsReview, unmatched };
}

function buildFirestoreMergePlan(appliedReport, matches) {
  const uidByInstructorId = new Map(matches.exact.map((match) => [match.instructor.id, match.account.uid]));
  const instructorNameById = new Map(matches.exact.map((match) => [match.instructor.id, match.instructor.instructor_name]));
  const firestoreSeedPlan = appliedReport?.details?.firestoreSeedPlan?.collections ?? {};
  const now = new Date().toISOString();

  const userAppAccess = matches.exact.map((match) => ({
    id: match.account.uid,
    data: {
      uid: match.account.uid,
      apps: { synchroS: true },
      synchroS: {
        role: "INSTRUCTOR",
        supabaseInstructorId: match.instructor.id,
        instructorName: match.instructor.instructor_name,
        source: "synchro-s-existing-firebase-link"
      },
      updatedAt: now,
      updatedBy: "synchro_existing_firebase_link"
    }
  }));

  const userProfiles = matches.exact.map((match) => ({
    id: match.account.uid,
    data: {
      uid: match.account.uid,
      supabaseInstructorId: match.instructor.id,
      synchroInstructorId: match.instructor.id,
      synchroInstructorName: match.instructor.instructor_name,
      updatedAt: now,
      updatedBy: "synchro_existing_firebase_link"
    }
  }));

  const instructors = matches.exact.map((match) => ({
    id: match.instructor.id,
    data: {
      id: match.instructor.id,
      instructorId: match.instructor.id,
      supabaseInstructorId: match.instructor.id,
      firebaseUid: match.account.uid,
      uid: match.account.uid,
      instructorName: match.instructor.instructor_name,
      name: match.instructor.instructor_name,
      subject: match.sheet.subject || match.account.subject || "",
      active: match.instructor.is_active !== false,
      isActive: match.instructor.is_active !== false,
      source: "synchro-s-supabase",
      linkedAt: now
    }
  }));

  const students = (firestoreSeedPlan.students ?? []).map((student) => ({
    id: student.id,
    data: {
      ...student.data,
      source: "synchro-s-supabase",
      linkedAt: now
    }
  }));

  const studentPermissions = (firestoreSeedPlan.studentPermissions ?? [])
    .filter((permission) => uidByInstructorId.has(permission.data.instructorId))
    .map((permission) => ({
      id: permission.id,
      data: {
        ...permission.data,
        instructorUid: uidByInstructorId.get(permission.data.instructorId),
        instructorName: instructorNameById.get(permission.data.instructorId) || "",
        source: "synchro-s-supabase",
        linkedAt: now
      }
    }));

  return {
    userAppAccess,
    userProfiles,
    instructors,
    students,
    studentPermissions
  };
}

async function commitFirestoreMerge(db, plan) {
  const writes = [
    ...plan.userAppAccess.map((item) => ({ collection: "userAppAccess", ...item })),
    ...plan.userProfiles.map((item) => ({ collection: "userProfiles", ...item })),
    ...plan.instructors.map((item) => ({ collection: "instructors", ...item })),
    ...plan.students.map((item) => ({ collection: "students", ...item })),
    ...plan.studentPermissions.map((item) => ({ collection: "studentPermissions", ...item }))
  ];

  let committed = 0;
  for (let index = 0; index < writes.length; index += 75) {
    const batch = db.batch();
    const chunk = writes.slice(index, index + 75);
    for (const write of chunk) {
      batch.set(db.collection(write.collection).doc(write.id), write.data, { merge: true });
    }
    await commitWithRetry(batch);
    committed += chunk.length;
  }
  return { committedWrites: committed };
}

async function commitWithRetry(batch) {
  const delays = [500, 1000, 2000, 4000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await batch.commit();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("RESOURCE_EXHAUSTED") || attempt >= delays.length) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

async function applySupabaseUids(supabase, matches) {
  let updated = 0;
  for (const match of matches.exact) {
    const { error } = await supabase
      .from("instructors")
      .update({
        firebase_uid: match.account.uid,
        firebase_sync_status: "matched",
        firebase_synced_at: new Date().toISOString()
      })
      .eq("id", match.instructor.id);
    if (error) throw new Error(`instructors ${match.instructor.id}: ${error.message}`);
    updated += 1;
  }
  return { updatedInstructors: updated };
}

function compactMatches(matches) {
  return {
    exact: matches.exact.map((match) => ({
      instructorId: match.instructor.id,
      instructorName: match.instructor.instructor_name,
      uid: match.account.uid,
      firebaseName: match.account.name,
      firebaseRole: match.account.role,
      firebaseSubject: match.account.subject,
      sheetSubject: match.sheet.subject || ""
    })),
    needsReview: matches.needsReview.map((item) => ({
      instructorId: item.instructor.id,
      instructorName: item.instructor.instructor_name,
      sheetSubject: item.sheet.subject || "",
      reason: item.reason,
      candidates: item.candidates.map((candidate) => ({
        uid: candidate.uid,
        name: candidate.name,
        role: candidate.role,
        status: candidate.status,
        subject: candidate.subject,
        authExists: candidate.authExists,
        authDisabled: candidate.authDisabled
      }))
    })),
    newAuthCandidates: matches.unmatched.map((item) => ({
      instructorId: item.instructor.id,
      instructorName: item.instructor.instructor_name,
      sheetSubject: item.sheet.subject || "",
      reason: item.reason
    }))
  };
}

function writeReport(report, outputPath) {
  const target = outputPath || path.join(REPORT_DIR, `synchro-existing-firebase-link-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const absolute = path.isAbsolute(target) ? target : path.join(repoRoot, target);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
  return absolute;
}

loadDotEnvLocal();
const options = parseArgs(process.argv.slice(2));

try {
  const supabase = createSupabaseAdmin();
  const db = await initFirebase(options);
  const appliedReport = loadAppliedReport();
  const instructorSheetMeta = buildInstructorSheetMeta(appliedReport);
  const [instructors, authUsers, userDocs, profileDocs, accessDocs, aliasDocs] = await Promise.all([
    fetchAllSupabaseRows(supabase, "instructors", "id,instructor_name,is_active,firebase_instructor_id,firebase_uid,firebase_sync_status"),
    listAuthUsers(),
    listCollection(db, "users", options),
    listCollection(db, "userProfiles", options),
    listCollection(db, "userAppAccess", options),
    listCollection(db, "loginAliases", options)
  ]);
  const firebaseAccounts = buildFirebaseAccountIndex(authUsers, userDocs, profileDocs, accessDocs, aliasDocs);
  const matches = classifyInstructorMatches(instructors, firebaseAccounts, instructorSheetMeta);
  const firestoreMergePlan = buildFirestoreMergePlan(appliedReport, matches);
  const firestoreApplyResult = options.applyFirestoreMerge ? await commitFirestoreMerge(db, firestoreMergePlan) : null;
  const supabaseApplyResult = options.applySupabaseUids ? await applySupabaseUids(supabase, matches) : null;
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.applyFirestoreMerge || options.applySupabaseUids ? "apply-existing-firebase-link" : "dry-run/read-only",
    safety: {
      createsFirebaseAuthUsers: false,
      deletesFirebaseAuthUsers: false,
      onlyExistingFirebaseUidsEligible: true,
      onlyExactInstructorMatchesEligibleForApply: true
    },
    firebaseSource: {
      projectId: admin.app().options.projectId,
      counts: {
        authUsers: authUsers.length,
        users: userDocs.length,
        userProfiles: profileDocs.length,
        userAppAccess: accessDocs.length,
        loginAliases: aliasDocs.length
      }
    },
    supabaseSource: {
      instructors: instructors.length
    },
    matching: {
      exactCount: matches.exact.length,
      needsReviewCount: matches.needsReview.length,
      newAuthCandidateCount: matches.unmatched.length,
      details: compactMatches(matches)
    },
    firestoreMergePlanSummary: {
      userAppAccess: firestoreMergePlan.userAppAccess.length,
      userProfiles: firestoreMergePlan.userProfiles.length,
      instructors: firestoreMergePlan.instructors.length,
      students: firestoreMergePlan.students.length,
      studentPermissions: firestoreMergePlan.studentPermissions.length
    },
    applyResult: {
      firestore: firestoreApplyResult,
      supabase: supabaseApplyResult
    },
    nextStep: options.applyFirestoreMerge || options.applySupabaseUids
      ? "Verify userAppAccess, userProfiles, instructors, students, and studentPermissions before enabling Synchro-S Firebase login."
      : "Review matches. New Auth creation is not included and remains blocked until separately approved."
  };
  const outputPath = writeReport(report, options.output);
  console.log(JSON.stringify(report, null, 2));
  console.error(`Report written: ${outputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
