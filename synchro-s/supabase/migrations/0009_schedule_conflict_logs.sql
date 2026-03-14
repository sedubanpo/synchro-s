create table if not exists public.schedule_conflict_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  week_start date null,
  target_type text null check (target_type in ('학생', '강사')),
  target_name text null,
  student_name text not null,
  instructor_name text null,
  weekday smallint not null check (weekday between 1 and 7),
  start_time text not null,
  end_time text not null,
  reason text not null,
  details text null,
  source text not null,
  raw_text text null
);

create index if not exists idx_schedule_conflict_logs_created_at
on public.schedule_conflict_logs (created_at desc);

create index if not exists idx_schedule_conflict_logs_student_name
on public.schedule_conflict_logs (student_name);
