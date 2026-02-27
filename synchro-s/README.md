# Synchro-S

Synchro-S is a Next.js + Supabase scheduling app for tutoring academies.

## Features

- Two role views: Instructor (강사), Student (학생)
- Weekly timetable grid (Mon-Sun, 10:00-22:00)
- Modal-based schedule creation
- Conflict blocking using class-type compatibility matrix
- Realtime sync between tabs via Supabase Realtime
- Auto tracking of creation timestamp and progress status logs

## Tech

- Next.js App Router
- Tailwind CSS
- Supabase Postgres + Auth + Realtime + RLS

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure env:

```bash
cp .env.example .env.local
```

Set values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_TIMEZONE=Asia/Seoul`
- `GOOGLE_SHEETS_SYNC_ID` (선택, 기본값: 제공해주신 시트 ID)

3. Apply SQL migration in Supabase SQL editor:

- `supabase/migrations/0001_synchro_s_schema.sql`

4. Run dev server:

```bash
npm run dev
```

Open: <http://localhost:3000/synchro-s>

## Login flow (new)

- Open <http://localhost:3000/login?next=/synchro-s>
- Sign in with your Supabase Auth email/password
- After login, you are redirected to `/synchro-s`
- If session expires, protected API calls return `401` and UI auto-redirects back to `/login`

## Required API routes implemented

- `POST /api/schedules/check-conflict`
- `POST /api/schedules`
- `GET /api/schedules/week`
- `PATCH /api/schedules/:id/status`

Additional helper route:

- `GET /api/schedules/options`
- `POST /api/sheets/sync`

## 버튼 기능

- `노션 붙여넣기 복사`: 현재 주간 시간표를 TSV 형식으로 클립보드에 복사합니다. 노션 DB에 붙여넣을 수 있습니다.
- `Teachers/student 동기화`: Google Sheets의 `Teachers`, `student` 탭을 읽어 신규 강사/학생을 Supabase에 추가합니다.
