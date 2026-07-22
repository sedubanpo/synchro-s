create table if not exists public.schedule_prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  school text,
  grade text,
  memo text,
  status text not null default 'inquiry' check (status in ('inquiry', 'converted', 'archived')),
  linked_student_id uuid references public.students(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prospect_timetable_groups (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.schedule_prospects(id) on delete cascade,
  week_start date not null,
  name text not null,
  snapshot_events jsonb not null default '[]'::jsonb,
  is_active boolean not null default false,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prospect_schedule_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.prospect_timetable_groups(id) on delete cascade,
  prospect_id uuid not null references public.schedule_prospects(id) on delete cascade,
  instructor_id uuid references public.instructors(id) on delete restrict,
  subject_code text references public.subjects(code) on delete restrict,
  class_type_code text references public.class_types(code) on delete restrict,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  note text,
  is_self_study boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  check (
    is_self_study = true or
    (instructor_id is not null and subject_code is not null and class_type_code is not null)
  )
);

create index if not exists idx_schedule_prospects_status_name
  on public.schedule_prospects (status, name);

create index if not exists idx_prospect_groups_scope
  on public.prospect_timetable_groups (prospect_id, week_start, created_at desc);

create unique index if not exists idx_prospect_groups_one_active
  on public.prospect_timetable_groups (prospect_id, week_start)
  where is_active = true;

create index if not exists idx_prospect_items_active_lookup
  on public.prospect_schedule_items (instructor_id, weekday, start_time, end_time);

alter table public.schedule_prospects enable row level security;
alter table public.prospect_timetable_groups enable row level security;
alter table public.prospect_schedule_items enable row level security;

drop policy if exists schedule_prospects_manage_admin on public.schedule_prospects;
create policy schedule_prospects_manage_admin on public.schedule_prospects
  for all
  using (public.is_admin_or_coordinator(auth.uid()))
  with check (public.is_admin_or_coordinator(auth.uid()));

drop policy if exists schedule_prospects_select_instructor on public.schedule_prospects;
create policy schedule_prospects_select_instructor on public.schedule_prospects
  for select
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'instructor'
    )
  );

drop policy if exists prospect_groups_manage_admin on public.prospect_timetable_groups;
create policy prospect_groups_manage_admin on public.prospect_timetable_groups
  for all
  using (public.is_admin_or_coordinator(auth.uid()))
  with check (public.is_admin_or_coordinator(auth.uid()));

drop policy if exists prospect_groups_select_instructor on public.prospect_timetable_groups;
create policy prospect_groups_select_instructor on public.prospect_timetable_groups
  for select
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'instructor'
    )
  );

drop policy if exists prospect_items_manage_admin on public.prospect_schedule_items;
create policy prospect_items_manage_admin on public.prospect_schedule_items
  for all
  using (public.is_admin_or_coordinator(auth.uid()))
  with check (public.is_admin_or_coordinator(auth.uid()));

drop policy if exists prospect_items_select_instructor on public.prospect_schedule_items;
create policy prospect_items_select_instructor on public.prospect_schedule_items
  for select
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'instructor'
    )
  );

create or replace function public.toggle_prospect_timetable_group(p_group_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group public.prospect_timetable_groups%rowtype;
begin
  select * into v_group
  from public.prospect_timetable_groups
  where id = p_group_id
  for update;

  if not found then
    raise exception 'Prospect timetable group not found';
  end if;

  if v_group.is_active then
    update public.prospect_timetable_groups
    set is_active = false, updated_at = now()
    where id = p_group_id;
    return false;
  end if;

  update public.prospect_timetable_groups
  set is_active = false, updated_at = now()
  where prospect_id = v_group.prospect_id
    and week_start = v_group.week_start
    and is_active = true;

  update public.prospect_timetable_groups
  set is_active = true, updated_at = now()
  where id = p_group_id;

  return true;
end;
$$;

grant execute on function public.toggle_prospect_timetable_group(uuid) to authenticated;

create or replace function public.toggle_timetable_group(p_group_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group public.timetable_groups%rowtype;
begin
  select * into v_group
  from public.timetable_groups
  where id = p_group_id
  for update;

  if not found then
    raise exception 'Timetable group not found';
  end if;

  if v_group.is_active then
    update public.timetable_groups
    set is_active = false, updated_at = now()
    where id = p_group_id;
    return false;
  end if;

  update public.timetable_groups
  set is_active = false, updated_at = now()
  where role_view = v_group.role_view
    and target_id = v_group.target_id
    and week_start = v_group.week_start
    and is_active = true;

  update public.timetable_groups
  set is_active = true, updated_at = now()
  where id = p_group_id;

  return true;
end;
$$;

grant execute on function public.toggle_timetable_group(uuid) to authenticated;

alter table public.special_notes
  drop constraint if exists special_notes_target_type_check;

alter table public.special_notes
  add constraint special_notes_target_type_check
  check (target_type in ('학생', '강사', '신규문의')) not valid;
