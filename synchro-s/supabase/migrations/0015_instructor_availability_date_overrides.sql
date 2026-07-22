alter table public.instructor_availability_groups
  add column if not exists date_overrides jsonb not null default '{}'::jsonb;

comment on column public.instructor_availability_groups.date_overrides is
  'Date-specific availability overrides keyed by YYYY-MM-DD. Values contain available/unavailable status, hourly slots, and an optional note.';
