# 시간표 미러링 고속화 (GitHub + Apps Script)

## 목표
- UI는 GitHub(정적 호스팅)에서 빠르게 제공
- 데이터는 Apps Script API(mode=api)로 최소 JSON만 전달
- 기존 Apps Script UI는 즉시 폐기하지 않고 병행 운영

## 이번에 적용된 것
- `server_target_work.js`에 API 라우트 추가
  - `doGet(e)`에서 `mode=api` 처리
  - `action=ping|sheets|grid` 지원
  - `lite=1` 기본: 경량 rows 포맷 반환
- 파일: `/Users/anjongseong/Documents/New project/mirror_fast.html`
  - GitHub에 올려 즉시 성능 테스트 가능한 경량 뷰어

## API 사용법
기본 URL:
- `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`

### 1) 헬스체크
- `?mode=api&action=ping`

### 2) 시트 목록
- `?mode=api&action=sheets`

### 3) 시간표 데이터
- 전체: `?mode=api&action=grid&sheet=3/6(금)_개학&lite=1`
- 강사: `?mode=api&action=grid&sheet=3/6(금)_개학&teacher=김미라&lite=1`
- 캐시 무시: `...&refresh=1`

## 배포 절차 (무중단)
1. Apps Script `Code.gs`에 `server_target_work.js` 내용 반영
2. 웹앱 새 버전 배포
3. `ping`/`grid` API 응답 확인
4. `mirror_fast.html`을 GitHub Pages에 업로드하여 실사용 테스트
5. 안정화 후 기존 Apps Script UI는 보조 채널로 유지

## 권장 운영
- 응답 속도: `lite=1` 기본 유지
- 캐시: 30초~2분 폴링 + 수동 새로고침 버튼
- 보안(선택): Script Properties에 `SCHEDULE_API_TOKEN` 설정 후 `token` 파라미터 검증
- 장애 대비: 기존 Apps Script UI URL은 항상 유지

## 다음 단계 (원하면 제가 추가 구현)
- 기존 `ui_target_work.html`에서 `google.script.run` 대신 API fetch 모드 지원
- 교사/관리자 공용 경량 모바일 전용 화면 분리
- GitHub Actions로 `main` push 시 자동 배포/헬스체크
