create table if not exists public.timetable_groups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  role_view text not null check (role_view in ('student', 'instructor')),
  target_id uuid not null,
  week_start date not null,
  name text not null,
  class_ids uuid[] not null default '{}',
  snapshot_events jsonb not null default '[]'::jsonb,
  is_active boolean not null default false,
  created_by_name text
);

create index if not exists idx_timetable_groups_scope_created
  on public.timetable_groups (role_view, target_id, created_at desc);

create index if not exists idx_timetable_groups_active_scope
  on public.timetable_groups (role_view, target_id, is_active);
