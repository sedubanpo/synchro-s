# notion-smart-input

구조화된 홀로그램 폼으로 입력받은 값을 Notion의 관계형 데이터베이스에 연결하여 `당일 특이사항` 항목을 생성하는 Next.js 앱입니다.

## 1. 새 프로젝트 생성

```bash
npx create-next-app@latest notion-smart-input --typescript --tailwind --eslint --app --import-alias "@/*"
cd notion-smart-input
npm install @notionhq/client three @react-three/fiber @react-three/drei zod clsx
```

## 2. 환경 변수 설정

```bash
cp .env.example .env.local
```

`NOTION_MAIN_TITLE_PROPERTY`, `NOTION_MAIN_RELATION_PROPERTY`, `NOTION_MAIN_DATE_PROPERTY` 값은 실제 `당일 특이사항` DB 속성명과 동일해야 합니다.

## 3. 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`을 열면 됩니다.

## 4. 동작 흐름

1. 사용자가 그룹을 고릅니다.
2. `app/api/persons/route.ts`가 해당 그룹의 Notion DB에서 명단을 불러옵니다.
3. 사용자가 대상자, 특이사항, 날짜를 폼에 입력합니다.
4. `app/api/incidents/route.ts`가 메인 DB에 제목, Relation, Date를 매핑해 새 페이지를 생성합니다.
