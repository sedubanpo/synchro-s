import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [pageSource, gridSource, tabsSource, workspaceSource, faviconSource] = await Promise.all([
  readFile(path.join(projectRoot, "app/synchro-s/page.tsx"), "utf8"),
  readFile(path.join(projectRoot, "components/schedule/TimetableGrid.tsx"), "utf8"),
  readFile(path.join(projectRoot, "components/schedule/StudentScheduleTabs.tsx"), "utf8"),
  readFile(path.join(projectRoot, "components/schedule/StudentAvailabilityWorkspace.tsx"), "utf8"),
  readFile(path.join(projectRoot, "app/icon.svg"), "utf8")
]);

for (const label of ["싱크로 시간표", "노션 시간표", "가능 일정"]) {
  assert.match(tabsSource, new RegExp(label), `공용 입력 방식 탭에 ${label}가 있어야 합니다.`);
}
assert.match(tabsSource, /aria-current=\{activeTab === tab\.id \? "page" : undefined\}/, "현재 입력 방식을 접근성 상태로 알려야 합니다.");
assert.match(workspaceSource, /navigation\?: ReactNode/, "가능 일정 화면이 돌아가기 탭을 받을 수 있어야 합니다.");
assert.match(pageSource, /<StudentAvailabilityWorkspace[\s\S]*?navigation=\{[\s\S]*?<StudentScheduleTabs/, "가능 일정 화면에도 공용 입력 방식 탭을 전달해야 합니다.");

assert.match(pageSource, /studentAvailabilityComparisonCell/, "저장된 가능 일정과 날짜별 변동을 합성해야 합니다.");
assert.match(pageSource, /studentAvailabilityPreviewByMonth/, "표시 주간이 월 경계를 넘을 때 월별 가능 일정을 보관해야 합니다.");
assert.match(pageSource, /availabilityCells=\{showStudentAvailabilityPreview \? studentAvailabilityCells : undefined\}/, "가능 일정은 시간표에 읽기 전용 오버레이로 전달해야 합니다.");
assert.match(pageSource, /aria-pressed=\{showStudentAvailabilityPreview\}/, "가능 일정 미리보기 버튼이 켜짐 상태를 알려야 합니다.");
assert.match(gridSource, /availabilityCells\?: Readonly<Record<string, TimetableAvailabilityCell>>/, "시간표 격자는 읽기 전용 가능 일정 셀을 받아야 합니다.");
assert.match(gridSource, /availabilityCell\.status === "available" \? "가능" : "불가"/, "시간표 셀에 가능·불가를 짧게 표시해야 합니다.");

for (const iconName of ["new", "undo", "days", "times", "availability", "save"]) {
  assert.match(pageSource, new RegExp(`ToolbarIcon name="${iconName}"`), `${iconName} 기능 버튼에 픽토그램이 있어야 합니다.`);
}
assert.match(faviconSource, /<svg/, "파비콘은 브라우저가 직접 사용할 수 있는 SVG여야 합니다.");
assert.match(faviconSource, /<rect/, "파비콘에 시간표 칸 형태가 있어야 합니다.");
assert.match(faviconSource, /#2563EB/, "파비콘은 Synchro-S의 파란색을 사용해야 합니다.");

console.log("가능 일정 복귀·시간표 미리보기·픽토그램·파비콘 검증 완료");
