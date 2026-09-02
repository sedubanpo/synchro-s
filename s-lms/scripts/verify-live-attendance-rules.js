const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const rulesPath = path.resolve(__dirname, '..', 'firebase', 'firestore.rules');
const rules = fs.readFileSync(rulesPath, 'utf8');
const submitRule = rules.match(/function canSubmitLiveTimetableAttendance\(data\) \{([\s\S]*?)\n    \}/)?.[1] || '';
const createRule = rules.match(/function isValidLiveTimetableAttendanceCreate\(data\) \{([\s\S]*?)\n    \}/)?.[1] || '';

assert(submitRule.includes('(isStaffOrAdmin() || isInstructor())'), 'staff and instructors must be allowed to submit attendance');
assert(!submitRule.includes('hasStudentPermissionDoc'), 'attendance submission must not require a student permission mapping');
assert(!submitRule.includes('reporterName'), 'the shared helper must accept teacher event documents without reporterName');
assert(createRule.includes('data.reporterName == currentUserDoc().data.name'), 'report creation must remain bound to the authenticated user name');
assert(rules.includes('data.reporterUid == request.auth.uid'), 'writes must remain bound to the authenticated reporter UID');
assert(rules.includes('resource.data.reporterUid == request.auth.uid'), 'teachers must only read or acknowledge their own reports');
assert(rules.includes("request.resource.data.type == 'TEACHER_SUBMITTED'"), 'teacher submission events must remain schema-checked');
assert(rules.includes('getAfter(/databases/$(database)/documents/liveTimetableAttendanceReports/$(reportId)).data.reporterUid == request.auth.uid'), 'events must remain bound to their parent report');

console.log('live attendance rules checks passed');
