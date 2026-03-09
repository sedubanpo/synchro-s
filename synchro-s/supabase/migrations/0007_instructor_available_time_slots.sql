alter table public.instructors
add column if not exists available_time_slots text[] not null default '{}';
