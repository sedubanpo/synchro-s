import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [pageSource, settingsSource] = await Promise.all([
  readFile(path.join(projectRoot, "app/synchro-s/page.tsx"), "utf8"),
  readFile(path.join(projectRoot, "components/schedule/ScheduleTagManager.tsx"), "utf8")
]);

const headerStart = pageSource.indexOf('<section className="sync-surface sticky top-0');
const headerEnd = pageSource.indexOf("</section>", headerStart);
const headerRegion = pageSource.slice(headerStart, headerEnd);
const studentInputStart = pageSource.indexOf("학생별 시간표 입력");
const studentInputEnd = pageSource.indexOf('studentScheduleInputTab === "sync"', studentInputStart);
const studentInputRegion = pageSource.slice(studentInputStart, studentInputEnd);

assert.ok(headerStart >= 0 && headerEnd > headerStart, "상단 헤더 영역을 찾을 수 있어야 합니다.");
assert.doesNotMatch(headerRegion, /입력 일시\/진행현황 자동 기록/, "로고 카드에서 자동 기록 설명을 제거해야 합니다.");
assert.match(headerRegion, /새로고침 · 명단 동기화/, "새로고침과 명단 동기화를 하나의 버튼으로 제공해야 합니다.");
assert.match(headerRegion, />\s*설정창\s*</, "상단 태그 관리자 버튼을 설정창으로 변경해야 합니다.");
assert.doesNotMatch(headerRegion, /정규수업 매주 자동 반복/, "상단 반복 수업 안내 메뉴를 제거해야 합니다.");
assert.doesNotMatch(headerRegion, /노션 붙여넣기 복사/, "상단 노션 복사 메뉴를 제거해야 합니다.");
assert.doesNotMatch(headerRegion, />\s*과목 코드 설정\s*</, "과목 코드 설정을 상단 독립 버튼으로 두지 않아야 합니다.");
assert.match(headerRegion, /\{menuDescription\}/, "메뉴 설명을 시간표 분류 줄의 좌측 보조 문구로 배치해야 합니다.");
assert.doesNotMatch(headerRegion, /Today Dashboard|Overview Dashboard/, "상단에 별도 메뉴 설명 카드를 남기지 않아야 합니다.");

assert.match(settingsSource, /aria-label="설정창"/, "설정 모달에 명확한 접근성 이름이 있어야 합니다.");
assert.match(settingsSource, /onOpenSubjectSettings/, "설정창에서 과목 코드 설정을 열 수 있어야 합니다.");
assert.match(settingsSource, />\s*과목 코드 설정\s*</, "과목 코드 설정 진입점을 설정창 안에 제공해야 합니다.");

assert.match(studentInputRegion, /학생 시간표 주차 이동/, "학생 입력 바에 주차 이동 도구를 배치해야 합니다.");
assert.match(studentInputRegion, /Student Profile/, "학생 입력 바에 학생 프로필 선택기를 배치해야 합니다.");
for (const label of ["홈 주차 이동", "전체 요약 주차 이동", "시간표 검토 주차 이동", "오류 기록 주차 이동", "시간표 생성 주차 이동", "강사 시간표 주차 이동"]) {
  assert.match(pageSource, new RegExp(label), `${label} 도구를 각 화면 제목 영역에 제공해야 합니다.`);
}
assert.match(pageSource, /aria-label="월간 시간표 달력"/, "최근 저장 기록 아래에 월간 달력을 배치해야 합니다.");
assert.match(pageSource, /className="xl:hidden"/, "데스크톱 미만에서도 달력에 접근할 수 있어야 합니다.");
assert.match(pageSource, /학생 시간표 빠른 수업 카드/, "학생용 빠른 수업 카드를 좌측 레일에 배치해야 합니다.");
assert.match(pageSource, /showStudentLessonPalette \? "flex-\[0_1_38%\]" : "flex-\[0_1_58%\]"/, "학생 화면에서 저장 기록 높이를 줄여 빠른 카드 공간을 확보해야 합니다.");
assert.match(pageSource, /mb-5 xl:hidden/, "좁은 화면에서는 빠른 수업 카드를 본문 보조 패널에 유지해야 합니다.");
assert.doesNotMatch(pageSource, /SchoolLogoBackdrop[\s\S]{0,180}grayscale/, "학교 로고 배경은 컬러를 유지해야 합니다.");

console.log("상단 설명·메뉴별 주차 이동·좌측 기록/달력/빠른 카드 재배치 검증 완료");
