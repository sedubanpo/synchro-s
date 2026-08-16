import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [pageSource, paletteSource, emblemSource, historyRouteSource, designSource] = await Promise.all([
  readFile(path.join(projectRoot, "app/synchro-s/page.tsx"), "utf8"),
  readFile(path.join(projectRoot, "components/schedule/LessonCardPalette.tsx"), "utf8"),
  readFile(path.join(projectRoot, "components/schedule/SchoolEmblem.tsx"), "utf8"),
  readFile(path.join(projectRoot, "app/api/save-history/route.ts"), "utf8"),
  readFile(path.join(projectRoot, "DESIGN.md"), "utf8")
]);

assert.match(historyRouteSource, /fetchRecentSaveHistory\(supabase, 120\)/, "최근 저장 기록은 여러 페이지를 구성할 만큼 충분히 조회해야 합니다.");
assert.match(pageSource, /const SAVE_HISTORY_PAGE_SIZE = 10/, "최근 저장 기록은 학생별 묶음 카드 10개 단위로 페이지를 구성해야 합니다.");
assert.match(pageSource, /visibleSaveHistoryGroups\.map/, "현재 페이지의 최근 저장 묶음만 렌더링해야 합니다.");
assert.match(pageSource, /aria-label="최근 저장 기록 페이지"/, "최근 저장 기록 페이지 이동 영역에 접근 가능한 이름이 있어야 합니다.");
assert.match(pageSource, /aria-label="이전 페이지"[\s\S]*aria-label="다음 페이지"/, "이전·다음 페이지 이동 버튼을 모두 제공해야 합니다.");
assert.match(pageSource, /saveHistoryTagLookup[\s\S]*SCHEDULE_TAG_TONES\[historyTag\.colorKey\]/, "저장 기록 태그는 태그 관리자에서 정한 색상을 사용해야 합니다.");

const historyRegion = pageSource.slice(pageSource.indexOf("Save History"), pageSource.indexOf("<div className=\"flex min-w-0 flex-col gap-4\">"));
assert.doesNotMatch(historyRegion, /분류:/, "최근 저장 기록에서 이전 '분류:' 용어를 제거해야 합니다.");
assert.match(historyRegion, /태그[\s\S]*#\$\{entry\.tagLabel\}/, "최근 저장 기록은 태그 용어와 태그명을 표시해야 합니다.");
assert.ok((pageSource.match(/<SchoolLogoBackdrop/g) ?? []).length >= 2, "최근 저장 카드와 학생 시간표 헤더 모두 학교 로고 배경을 사용해야 합니다.");
assert.match(emblemSource, /aria-hidden="true"/, "학교 로고 배경은 장식 이미지로 접근성 트리에서 제외해야 합니다.");
assert.match(emblemSource, /onError=\{\(\) => setFailed\(true\)\}/, "학교 로고가 깨지면 장식 배경을 안전하게 숨겨야 합니다.");

assert.match(paletteSource, /card: "border-rose-200 bg-rose-50/, "국어 빠른 카드는 과목색을 카드 전체 배경에 적용해야 합니다.");
assert.match(paletteSource, /card: "border-blue-200 bg-blue-50/, "수학 빠른 카드는 과목색을 카드 전체 배경에 적용해야 합니다.");
assert.match(paletteSource, /card: "border-violet-200 bg-violet-50/, "영어 빠른 카드는 과목색을 카드 전체 배경에 적용해야 합니다.");
assert.match(paletteSource, /card: "border-emerald-200 bg-emerald-50/, "과학 빠른 카드는 과목색을 카드 전체 배경에 적용해야 합니다.");
assert.match(paletteSource, /text-\[15px\][^\n]*\{template\.instructorName\}/, "빠른 카드의 강사명은 기존보다 크게 표시해야 합니다.");
assert.match(paletteSource, /rounded-md border px-2 py-0\.5[^\n]*tone\.badge/, "과목명은 기존 UI에 맞는 작은 사각 라벨로 표시해야 합니다.");
assert.doesNotMatch(paletteSource, /rounded-full border px-2 py-0\.5[^\n]*template\.subjectName/, "과목명에 둥근 말풍선형 라벨을 사용하지 않아야 합니다.");

assert.match(designSource, /School emblems may appear as oversized, clipped, color-retaining backdrops/, "학교 로고 배경은 저채도 컬러를 유지하도록 디자인 기준에 기록해야 합니다.");
assert.doesNotMatch(historyRegion, /grayscale/, "최근 저장 기록의 학교 로고는 흑백 필터를 사용하지 않아야 합니다.");
assert.match(designSource, /Save-history rail width: `15\.5rem`/, "최근 저장 기록 레일의 확장 폭을 디자인 기준에 기록해야 합니다.");

console.log("최근 저장 기록·학교 로고 배경·빠른 수업 카드 디자인 검증 완료");
