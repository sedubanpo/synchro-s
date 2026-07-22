import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/synchro-s/page.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../components/schedule/HomeInstructorFolderDashboard.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(page, /const \[overviewLoading, setOverviewLoading\] = useState\(true\)/, "overview loading must cover the first paint");
assert.match(page, /const \[timetableGroupsLoading, setTimetableGroupsLoading\] = useState\(true\)/, "group loading must cover the first paint");
assert.match(page, /!viewerRoleResolved \|\| overviewLoading \|\| timetableGroupsLoading/, "home loading must wait for role and schedule data");
assert.match(page, /\.finally\(\(\) => setViewerRoleResolved\(true\)\)/, "failed roster loading must not leave the home skeleton running forever");

const openInstructor = page.slice(page.indexOf("onOpenInstructor={(id) =>"), page.indexOf("onOpenStudent={(id) =>"));
const openStudent = page.slice(page.indexOf("onOpenStudent={(id) =>"), page.indexOf("/>\n        )", page.indexOf("onOpenStudent={(id) =>")));
assert.match(openInstructor, /setMainTab\("instructor"\)/, "instructor detail must open the instructor timetable");
assert.doesNotMatch(openInstructor, /setMainTab\("overview"\)/, "instructor detail must not open overview");
assert.match(openStudent, /setMainTab\("student"\)/, "student card must open the student timetable");
assert.doesNotMatch(openStudent, /setMainTab\("overview"\)/, "student card must not open overview");
assert.match(openInstructor, /setSelectedGroupId\(null\)/, "instructor navigation must clear stale group selection while preserving the active tag");
assert.match(openStudent, /setSelectedGroupId\(null\)/, "student navigation must clear stale group selection while preserving the active tag");
assert.doesNotMatch(openInstructor, /setSelectedScheduleTagId/, "instructor navigation must preserve the Home tag");
assert.doesNotMatch(openStudent, /setSelectedScheduleTagId/, "student navigation must preserve the Home tag");

assert.match(dashboard, /aria-busy=\{loading\}/, "loading state must be announced semantically");
assert.match(dashboard, /sync-home-skeleton/, "home loading must use the dedicated moving skeleton");
assert.match(dashboard, /setHighlightedStudentId/, "student highlighting must share component state across time slots");
assert.match(dashboard, /aria-pressed=\{highlighted\}/, "student highlight controls must expose pressed state");
assert.match(dashboard, /summary\?\.secondary \|\| "학교·학년 정보 없음"/, "student chips must display school and grade details");
assert.doesNotMatch(dashboard, /\{event\.subjectName\} · \{event\.instructorName\}/, "selected instructor details must not repeat in every time slot");

assert.match(styles, /@keyframes sync-home-skeleton-shimmer/, "loading skeleton must animate its light sweep");
assert.match(styles, /@keyframes sync-home-skeleton-drift/, "loading skeleton elements must move individually");
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.sync-home-skeleton \{[\s\S]*?animation: none/, "loading motion must stop for reduced-motion users");

console.log("Home dashboard UX verification passed: loading, tagged routing, student metadata, and linked highlighting are present.");
