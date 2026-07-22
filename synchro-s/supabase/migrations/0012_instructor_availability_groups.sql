create table if not exists public.instructor_availability_groups (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  month_start date not null,
  name text not null,
  available_time_slots_by_day jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_trunc('month', month_start)::date = month_start)
);

create index if not exists idx_instructor_availability_groups_month
  on public.instructor_availability_groups (instructor_id, month_start, created_at desc);

create unique index if not exists idx_instructor_availability_groups_one_active
  on public.instructor_availability_groups (instructor_id, month_start)
  where is_active = true;

alter table public.instructor_availability_groups enable row level security;

drop policy if exists instructor_availability_groups_select_admin on public.instructor_availability_groups;
create policy instructor_availability_groups_select_admin on public.instructor_availability_groups
  for select
  using (public.is_admin_or_coordinator(auth.uid()));

drop policy if exists instructor_availability_groups_manage_admin on public.instructor_availability_groups;
create policy instructor_availability_groups_manage_admin on public.instructor_availability_groups
  for all
  using (public.is_admin_or_coordinator(auth.uid()))
  with check (public.is_admin_or_coordinator(auth.uid()));
