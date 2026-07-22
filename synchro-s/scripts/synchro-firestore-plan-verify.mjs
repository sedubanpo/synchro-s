#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const DEFAULT_SERVICE_ACCOUNT = "/Users/anjongseong/Documents/Codex/fir-lms-prod-firebase-adminsdk-fbsvc-92938d5d8a.json";
const S_LMS_NODE_MODULES = "/Users/anjongseong/Documents/New project/s-lms/node_modules";
const DEFAULT_ACCOUNT_REPORT = "migration-reports/firebase-account-link-dry-run.json";
const DEFAULT_APPLIED_REPORT = "migration-reports/applied.json";
const DEFAULT_OUTPUT = "migration-reports/firestore-plan-id-verification-latest.json";

const require = createRequire(import.meta.url);
const admin = require(path.join(S_LMS_NODE_MODULES, "firebase-admin"));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    accountReport: DEFAULT_ACCOUNT_REPORT,
    appliedReport: DEFAULT_APPLIED_REPORT,
    output: DEFAULT_OUTPUT,
    serviceAccount: DEFAULT_SERVICE_ACCOUNT,
    chunkSize: 10,
    delayMs: 250
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--account-report") {
      options.accountReport = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--applied-report") {
      options.appliedReport = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--output") {
      options.output = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--service-account") {
      options.serviceAccount = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--chunk-size") {
      options.chunkSize = Number(argv[index + 1] ?? 10);
      index += 1;
    } else if (arg === "--delay-ms") {
      options.delayMs = Number(argv[index + 1] ?? 250);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isInteger(options.chunkSize) || options.chunkSize < 1 || options.chunkSize > 20) {
    throw new Error("--chunk-size must be an integer from 1 to 20.");
  }
  if (!Number.isInteger(options.delayMs) || options.delayMs < 0) {
    throw new Error("--delay-ms must be a non-negative integer.");
  }

  return options;
}

function printHelp() {
  console.log(`Synchro-S Firestore ID-based verifier

Usage:
  npm run verify:firestore-plan -- --chunk-size 10 --delay-ms 250

This script never scans Firestore collections and never writes documents. It verifies only document
IDs already present in the generated dry-run/apply reports.`);
}

function readJson(filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function writeJson(filePath, value) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
  return absolute;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildExpectedIds(accountReport, appliedReport) {
  const exactMatches = accountReport?.matching?.details?.exact ?? [];
  const exactInstructorIds = new Set(exactMatches.map((match) => match.instructorId));
  const plan = appliedReport?.details?.firestoreSeedPlan?.collections ?? {};

  return {
    users: unique(exactMatches.map((match) => match.uid)),
    userAppAccess: unique(exactMatches.map((match) => match.uid)),
    userProfiles: unique(exactMatches.map((match) => match.uid)),
    instructors: unique(exactMatches.map((match) => match.instructorId)),
    students: unique((plan.students ?? []).map((student) => student.id)),
    studentPermissions: unique(
      (plan.studentPermissions ?? [])
        .filter((permission) => exactInstructorIds.has(permission.data?.instructorId))
        .map((permission) => permission.id)
    )
  };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyGetError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    message,
    resourceExhausted: message.includes("RESOURCE_EXHAUSTED")
  };
}

async function verifyCollectionIds(db, collectionName, ids, options) {
  const missing = [];
  const existing = [];

  for (let index = 0; index < ids.length; index += options.chunkSize) {
    const chunk = ids.slice(index, index + options.chunkSize);
    try {
      const snapshots = await Promise.all(chunk.map((id) => db.collection(collectionName).doc(id).get()));
      for (const snapshot of snapshots) {
        if (snapshot.exists) {
          existing.push(snapshot.id);
        } else {
          missing.push(snapshot.id);
        }
      }
    } catch (error) {
      return {
        collection: collectionName,
        expected: ids.length,
        existing: existing.length,
        missing: missing.length,
        failed: true,
        failedAtIndex: index,
        failedDocIds: chunk,
        error: classifyGetError(error)
      };
    }
    if (options.delayMs > 0 && index + options.chunkSize < ids.length) {
      await sleep(options.delayMs);
    }
  }

  return {
    collection: collectionName,
    expected: ids.length,
    existing: existing.length,
    missing: missing.length,
    missingDocIds: missing,
    failed: false
  };
}

const options = parseArgs(process.argv.slice(2));
const report = {
  generatedAt: new Date().toISOString(),
  mode: "id-based-read-only",
  safety: {
    scansFirestoreCollections: false,
    usesFirestoreCountAggregation: false,
    writesFirestoreDocuments: false,
    createsFirebaseAuthUsers: false
  },
  singleGet: null,
  verification: null,
  stopped: false,
  firstFailure: null
};

try {
  const accountReport = readJson(options.accountReport);
  const appliedReport = readJson(options.appliedReport);
  const expectedIds = buildExpectedIds(accountReport, appliedReport);
  const db = await initFirebase(options);
  const firstUid = expectedIds.users[0];
  if (!firstUid) {
    throw new Error("No expected Firebase uid found in account report.");
  }

  try {
    const snapshot = await db.collection("users").doc(firstUid).get();
    report.singleGet = {
      collection: "users",
      docId: firstUid,
      success: true,
      exists: snapshot.exists
    };
  } catch (error) {
    report.singleGet = {
      collection: "users",
      docId: firstUid,
      success: false,
      error: classifyGetError(error)
    };
    report.stopped = true;
    report.firstFailure = {
      stage: "single-get",
      collection: "users",
      docId: firstUid,
      error: report.singleGet.error
    };
    const outputPath = writeJson(options.output, report);
    console.log(JSON.stringify(report, null, 2));
    console.error(`Report written: ${outputPath}`);
    process.exit(0);
  }

  const collections = ["userAppAccess", "userProfiles", "instructors", "students", "studentPermissions"];
  report.verification = {};

  for (const collectionName of collections) {
    const result = await verifyCollectionIds(db, collectionName, expectedIds[collectionName], options);
    report.verification[collectionName] = result;
    if (result.failed) {
      report.stopped = true;
      report.firstFailure = {
        stage: "expected-id-verification",
        collection: collectionName,
        failedAtIndex: result.failedAtIndex,
        failedDocIds: result.failedDocIds,
        error: result.error
      };
      break;
    }
  }

  const outputPath = writeJson(options.output, report);
  console.log(JSON.stringify(report, null, 2));
  console.error(`Report written: ${outputPath}`);
} catch (error) {
  report.stopped = true;
  report.firstFailure = {
    stage: "script-error",
    error: classifyGetError(error)
  };
  const outputPath = writeJson(options.output, report);
  console.log(JSON.stringify(report, null, 2));
  console.error(`Report written: ${outputPath}`);
  process.exit(1);
}
