import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const gridPath = path.join(root, "components/schedule/TimetableGrid.tsx");
const blockPath = path.join(root, "components/schedule/ScheduleBlock.tsx");
const grid = fs.readFileSync(gridPath, "utf8");
const block = fs.readFileSync(blockPath, "utf8");

function expectSource(source: string, pattern: RegExp, message: string) {
  if (!pattern.test(source)) {
    throw new Error(message);
  }
}

expectSource(
  grid,
  /w-max\s+min-w-max.*\[--timetable-day-width:165\.714px\].*2xl:\[--timetable-day-width:177\.143px\]/s,
  "시간표는 표시 요일 수와 무관하게 기존 7요일 기준의 고정 열 폭을 사용해야 합니다."
);
expectSource(
  grid,
  /<colgroup>[\s\S]*?<col className="w-20 min-w-20"\s*\/>[\s\S]*?renderDays\.map[\s\S]*?data-timetable-day-column[\s\S]*?var\(--timetable-day-width\)/,
  "숨겨지지 않은 요일은 colgroup에서 동일한 고정 폭을 유지해야 합니다."
);
expectSource(
  block,
  /data-schedule-title="true"[\s\S]*?className="[^"]*break-keep[^"]*text-pretty[^"]*"/,
  "수업 제목은 한국어 단어 단위로 자연스럽게 줄바꿈되어야 합니다."
);

const titleTag = block.match(/<p\b(?=[^>]*data-schedule-title="true")[^>]*>/)?.[0] ?? "";
if (/\btruncate\b|whitespace-nowrap|text-overflow/.test(titleTag)) {
  throw new Error("수업 제목에 말줄임 또는 한 줄 고정 스타일이 남아 있습니다.");
}

console.log("dense timetable layout verification passed");
