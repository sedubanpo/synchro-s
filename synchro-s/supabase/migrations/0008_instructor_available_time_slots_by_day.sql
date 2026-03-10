alter table public.instructors
add column if not exists available_time_slots_by_day jsonb not null default '{}'::jsonb;
