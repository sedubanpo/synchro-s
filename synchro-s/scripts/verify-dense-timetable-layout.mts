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
  /w-\[1240px\]\s+min-w-\[1240px\].*2xl:w-\[1320px\]\s+2xl:min-w-\[1320px\]/s,
  "시간표가 요일별 강사명을 표시할 수 있는 확장 폭을 가져야 합니다."
);
expectSource(
  grid,
  /<colgroup>[\s\S]*?<col className="w-20"\s*\/>[\s\S]*?renderDays\.map/,
  "시간 열과 요일 열의 폭을 colgroup으로 안정적으로 배분해야 합니다."
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
