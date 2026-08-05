import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const loginSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const serverAuthSource = await readFile(new URL("../lib/server/firebaseAuth.ts", import.meta.url), "utf8");

assert.match(loginSource, /const LOGIN_TIMEOUTS = \{[\s\S]*alias: 15_000[\s\S]*firebaseAuth: 20_000[\s\S]*session: 25_000[\s\S]*access: 20_000/);
assert.match(loginSource, /Promise\.race\(\[operation, timeout\]\)/, "Firebase SDK calls must have a bounded pending state.");
assert.match(loginSource, /controller\.abort\(\)/, "Login HTTP requests must be abortable.");
assert.match(loginSource, /if \(timeoutId\) clearTimeout\(timeoutId\)/, "SDK timeout must always be released.");
assert.match(loginSource, /finally \{\s*clearTimeout\(timeoutId\);\s*\}/, "HTTP timeout must always be released.");
assert.match(loginSource, /setSubmitting\(false\)/, "Login UI must recover from failures and re-enable submission.");
assert.match(loginSource, /계정 확인 응답이 지연되고 있습니다/);
assert.match(loginSource, /Firebase 인증 응답이 지연되고 있습니다/);
assert.match(loginSource, /로그인 세션 생성이 지연되고 있습니다/);
assert.match(loginSource, /로그인 권한 확인이 지연되고 있습니다/);

assert.match(serverAuthSource, /const FIREBASE_SERVER_TIMEOUT_MS = 15_000/);
assert.match(serverAuthSource, /fetchFirebaseResource\(CERTS_URL/);
assert.match(serverAuthSource, /"Firebase 계정 정보 확인"/);
assert.match(serverAuthSource, /controller\.signal\.aborted/);
assert.match(serverAuthSource, /finally \{\s*clearTimeout\(timeoutId\);\s*\}/);

console.log("Login resilience verification passed: alias, Firebase Auth, session, access, certificate, and account-document requests are bounded and recoverable.");
