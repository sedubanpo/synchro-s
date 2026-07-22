alter table public.instructor_availability_groups
  add column if not exists weekday_notes jsonb not null default '{}'::jsonb;
