import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveSubjectOption } from "../lib/subjectResolver";
import { getOverlappingHourSlots } from "../lib/timetableSlots";

const subjects = [
  { code: "SOCIAL", label: "세지" },
  { code: "SOCIAL2", label: "사문" },
  { code: "SOCIAL8", label: "통사" },
  { code: "SCIENCE7", label: "통과" }
];

assert.equal(resolveSubjectOption(subjects, "통합사회")?.code, "SOCIAL8");
assert.equal(resolveSubjectOption(subjects, "사회문화")?.code, "SOCIAL2");
assert.equal(resolveSubjectOption(subjects, "세계지리")?.code, "SOCIAL");
assert.equal(resolveSubjectOption(subjects, "통합과학")?.code, "SCIENCE7");

const slots = Array.from({ length: 15 }, (_, index) => `${String(index + 9).padStart(2, "0")}:00`);
assert.deepEqual(
  getOverlappingHourSlots({ startTime: "15:00", endTime: "18:00" }, slots),
  ["15:00", "16:00", "17:00"],
  "시간표 생성의 3시간 수업은 세 개 시간 행에 표시되어야 합니다."
);

const root = process.cwd();
const workspace = fs.readFileSync(path.join(root, "components/schedule/ScheduleCreationWorkspace.tsx"), "utf8");
const modal = fs.readFileSync(path.join(root, "components/schedule/SyncScheduleDraftModal.tsx"), "utf8");

assert.ok(workspace.includes("resolveSubjectOption(subjects, input.subjectLabel)"));
assert.ok(workspace.includes("hideEmptyDays={hideEmptyDays}"));
assert.ok(workspace.includes("hideEmptyTimes={hideEmptyTimes}"));
assert.ok(workspace.includes("빈 요일 숨기기"));
assert.ok(workspace.includes("빈 시간 숨기기"));
assert.ok(modal.includes("if (accepted !== false) onClose()"), "검증 실패 시 입력창을 닫지 않아야 합니다.");

console.log("schedule creation draft verification passed");
