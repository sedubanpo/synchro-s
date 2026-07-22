create table if not exists public.student_availability_groups (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  month_start date not null,
  title text not null,
  memo text not null default '',
  weekly_availability jsonb not null default '{}'::jsonb,
  date_overrides jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_trunc('month', month_start)::date = month_start)
);

create index if not exists idx_student_availability_groups_month
  on public.student_availability_groups (student_id, month_start, created_at desc);

create unique index if not exists idx_student_availability_groups_one_active
  on public.student_availability_groups (student_id, month_start)
  where is_active = true;

alter table public.student_availability_groups enable row level security;

drop policy if exists student_availability_groups_select_admin on public.student_availability_groups;
create policy student_availability_groups_select_admin on public.student_availability_groups
  for select
  using (public.is_admin_or_coordinator(auth.uid()));

drop policy if exists student_availability_groups_manage_admin on public.student_availability_groups;
create policy student_availability_groups_manage_admin on public.student_availability_groups
  for all
  using (public.is_admin_or_coordinator(auth.uid()))
  with check (public.is_admin_or_coordinator(auth.uid()));

comment on table public.student_availability_groups is
  'Monthly student availability versions with a recurring weekly base and date-specific temporary/unavailable overrides.';
