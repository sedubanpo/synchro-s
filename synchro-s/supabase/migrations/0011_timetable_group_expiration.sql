alter table public.timetable_groups
  add column if not exists expires_on date;

create index if not exists idx_timetable_groups_active_window
  on public.timetable_groups (role_view, target_id, is_active, week_start, expires_on);
