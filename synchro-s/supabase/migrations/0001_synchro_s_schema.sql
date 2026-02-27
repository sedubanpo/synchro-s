-- Synchro-S MVP schema
-- Timezone default: Asia/Seoul (application-level); timestamps stored in timestamptz.

create extension if not exists pgcrypto;

-- Enums
create type public.user_role as enum ('admin', 'coordinator', 'instructor', 'student');
create type public.schedule_mode as enum ('recurring', 'one_off');
create type public.schedule_status as enum ('planned', 'confirmed', 'completed', 'cancelled');
create type public.override_action as enum ('cancel', 'reschedule', 'status_only');

-- Users (mapped to auth.users)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null,
  full_name text not null,
  created_at timestamptz not null default now()
);

create table public.instructors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.users(id) on delete set null,
  instructor_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.users(id) on delete set null,
  student_name text not null,
  default_instructor_id uuid references public.instructors(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.subjects (
  code text primary key,
  display_name text not null,
  tailwind_bg_class text not null
);

create table public.class_types (
  code text primary key,
  display_name text not null,
  badge_text text not null,
  max_students int not null check (max_students > 0)
);

create table public.class_type_compatibility (
  class_type_a text not null references public.class_types(code) on delete cascade,
  class_type_b text not null references public.class_types(code) on delete cascade,
  is_compatible boolean not null,
  reason text,
  primary key (class_type_a, class_type_b)
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  schedule_mode public.schedule_mode not null default 'recurring',
  instructor_id uuid not null references public.instructors(id) on delete restrict,
  subject_code text not null references public.subjects(code) on delete restrict,
  class_type_code text not null references public.class_types(code) on delete restrict,

  weekday smallint check (weekday between 1 and 7),
  class_date date,

  start_time time not null,
  end_time time not null,
  active_from date not null default current_date,
  active_to date,

  progress_status public.schedule_status not null default 'planned',
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),

  check (end_time > start_time),
  check (
    (schedule_mode = 'recurring' and weekday is not null and class_date is null) or
    (schedule_mode = 'one_off' and class_date is not null and weekday is null)
  )
);

create table public.class_enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (class_id, student_id)
);

create table public.class_overrides (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  override_date date not null,
  action public.override_action not null,
  override_instructor_id uuid references public.instructors(id) on delete set null,
  override_start_time time,
  override_end_time time,
  override_status public.schedule_status,
  note text,
  created_at timestamptz not null default now(),
  unique (class_id, override_date),
  check (override_end_time is null or override_start_time is null or override_end_time > override_start_time)
);

create table public.class_status_logs (
  id bigserial primary key,
  class_id uuid not null references public.classes(id) on delete cascade,
  status public.schedule_status not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.users(id) on delete set null,
  reason text
);

-- Triggers
create or replace function public.log_initial_class_status()
returns trigger
language plpgsql
as $$
begin
  insert into public.class_status_logs (class_id, status, changed_by, reason)
  values (new.id, new.progress_status, new.created_by, 'created');
  return new;
end;
$$;

create trigger trg_log_initial_class_status
after insert on public.classes
for each row execute function public.log_initial_class_status();

create or replace function public.touch_classes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_touch_classes_updated_at
before update on public.classes
for each row execute function public.touch_classes_updated_at();

-- Indexes
create index idx_classes_instructor_weekday_time
  on public.classes (instructor_id, weekday, start_time, end_time)
  where schedule_mode = 'recurring';

create index idx_classes_instructor_date_time
  on public.classes (instructor_id, class_date, start_time, end_time)
  where schedule_mode = 'one_off';

create index idx_enrollments_student on public.class_enrollments (student_id);
create index idx_overrides_class_date on public.class_overrides (class_id, override_date);
create index idx_class_status_logs_class_id on public.class_status_logs (class_id, changed_at desc);

-- Seed data
insert into public.subjects (code, display_name, tailwind_bg_class)
values
  ('MATH', '수학', 'bg-blue-500'),
  ('ENGLISH', '영어', 'bg-purple-500')
on conflict (code) do update set
  display_name = excluded.display_name,
  tailwind_bg_class = excluded.tailwind_bg_class;

insert into public.class_types (code, display_name, badge_text, max_students)
values
  ('ONE_TO_ONE', '1:1', '[1:1]', 1),
  ('TWO_TO_ONE', '2:1', '[2:1]', 2),
  ('REGULAR_MULTI', '개별정규', '[개별정규]', 8),
  ('SPECIAL', '특강', '[특강]', 20)
on conflict (code) do update set
  display_name = excluded.display_name,
  badge_text = excluded.badge_text,
  max_students = excluded.max_students;

-- Compatibility matrix (rule-based conflict policy)
insert into public.class_type_compatibility (class_type_a, class_type_b, is_compatible, reason)
values
  ('ONE_TO_ONE', 'ONE_TO_ONE', false, '강사는 동일 시간대에 복수 1:1 수업을 진행할 수 없습니다.'),
  ('ONE_TO_ONE', 'TWO_TO_ONE', false, '1:1과 2:1은 동일 강사 시간 중복이 불가합니다.'),
  ('ONE_TO_ONE', 'REGULAR_MULTI', false, '개별정규 시간대에는 다른 1:1 수업을 배정할 수 없습니다.'),
  ('ONE_TO_ONE', 'SPECIAL', false, '특강 시간과 1:1 수업은 중복될 수 없습니다.'),

  ('TWO_TO_ONE', 'ONE_TO_ONE', false, '2:1과 1:1은 동일 강사 시간 중복이 불가합니다.'),
  ('TWO_TO_ONE', 'TWO_TO_ONE', false, '강사는 동일 시간대에 복수 2:1 수업을 진행할 수 없습니다.'),
  ('TWO_TO_ONE', 'REGULAR_MULTI', false, '개별정규 시간대에는 2:1 수업을 배정할 수 없습니다.'),
  ('TWO_TO_ONE', 'SPECIAL', false, '특강 시간과 2:1 수업은 중복될 수 없습니다.'),

  ('REGULAR_MULTI', 'ONE_TO_ONE', false, '개별정규 시간대에는 1:1 수업을 배정할 수 없습니다.'),
  ('REGULAR_MULTI', 'TWO_TO_ONE', false, '개별정규 시간대에는 2:1 수업을 배정할 수 없습니다.'),
  ('REGULAR_MULTI', 'REGULAR_MULTI', true, '동일 개별정규 슬롯은 동일 수업에 학생 추가로 해석합니다.'),
  ('REGULAR_MULTI', 'SPECIAL', false, '개별정규와 특강은 동일 시간대 중복이 불가합니다.'),

  ('SPECIAL', 'ONE_TO_ONE', false, '특강 시간과 1:1 수업은 중복될 수 없습니다.'),
  ('SPECIAL', 'TWO_TO_ONE', false, '특강 시간과 2:1 수업은 중복될 수 없습니다.'),
  ('SPECIAL', 'REGULAR_MULTI', false, '특강 시간과 개별정규 수업은 중복될 수 없습니다.'),
  ('SPECIAL', 'SPECIAL', true, '동일 특강 슬롯은 동일 수업에 학생 추가로 해석합니다.')
on conflict (class_type_a, class_type_b) do update set
  is_compatible = excluded.is_compatible,
  reason = excluded.reason;

-- Helper functions for RLS
create or replace function public.is_admin_or_coordinator(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = uid
      and u.role in ('admin', 'coordinator')
  );
$$;

create or replace function public.is_instructor_owner(uid uuid, instructor_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.instructors i
    where i.user_id = uid
      and i.id = instructor_uuid
  );
$$;

create or replace function public.is_student_of_class(uid uuid, class_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.class_enrollments ce
    join public.students s on s.id = ce.student_id
    where ce.class_id = class_uuid
      and s.user_id = uid
  );
$$;

create or replace function public.is_student_owner(uid uuid, student_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    where s.id = student_uuid
      and s.user_id = uid
  );
$$;

create or replace function public.can_instructor_access_student(uid uuid, student_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.class_enrollments ce
    join public.classes c on c.id = ce.class_id
    join public.instructors i on i.id = c.instructor_id
    where ce.student_id = student_uuid
      and i.user_id = uid
  );
$$;

-- RLS
alter table public.users enable row level security;
alter table public.instructors enable row level security;
alter table public.students enable row level security;
alter table public.subjects enable row level security;
alter table public.class_types enable row level security;
alter table public.class_type_compatibility enable row level security;
alter table public.classes enable row level security;
alter table public.class_enrollments enable row level security;
alter table public.class_overrides enable row level security;
alter table public.class_status_logs enable row level security;

-- users
create policy users_select_self_or_admin on public.users
for select
using (auth.uid() = id or public.is_admin_or_coordinator(auth.uid()));

create policy users_manage_admin on public.users
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

-- instructors/students
create policy instructors_select_admin on public.instructors
for select
using (public.is_admin_or_coordinator(auth.uid()));

create policy instructors_select_self on public.instructors
for select
using (user_id = auth.uid());

create policy instructors_select_student_default on public.instructors
for select
using (
  exists (
    select 1
    from public.students s
    where s.user_id = auth.uid()
      and s.default_instructor_id = public.instructors.id
  )
);

create policy instructors_manage_admin on public.instructors
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

create policy students_select_admin on public.students
for select
using (public.is_admin_or_coordinator(auth.uid()));

create policy students_select_self on public.students
for select
using (user_id = auth.uid());

create policy students_select_instructor_enrolled on public.students
for select
using (public.can_instructor_access_student(auth.uid(), public.students.id));

create policy students_manage_admin on public.students
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

-- lookups
create policy subjects_select_authenticated on public.subjects
for select
using (auth.uid() is not null);

create policy subjects_manage_admin on public.subjects
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

create policy class_types_select_authenticated on public.class_types
for select
using (auth.uid() is not null);

create policy class_types_manage_admin on public.class_types
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

create policy compatibility_select_authenticated on public.class_type_compatibility
for select
using (auth.uid() is not null);

create policy compatibility_manage_admin on public.class_type_compatibility
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

-- classes
create policy classes_select_admin on public.classes
for select
using (public.is_admin_or_coordinator(auth.uid()));

create policy classes_select_instructor on public.classes
for select
using (public.is_instructor_owner(auth.uid(), instructor_id));

create policy classes_select_student on public.classes
for select
using (public.is_student_of_class(auth.uid(), id));

create policy classes_insert_admin on public.classes
for insert
with check (public.is_admin_or_coordinator(auth.uid()));

create policy classes_update_admin on public.classes
for update
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

create policy classes_update_instructor on public.classes
for update
using (public.is_instructor_owner(auth.uid(), instructor_id))
with check (public.is_instructor_owner(auth.uid(), instructor_id));

create policy classes_delete_admin on public.classes
for delete
using (public.is_admin_or_coordinator(auth.uid()));

-- class_enrollments
create policy enrollments_select_admin on public.class_enrollments
for select
using (public.is_admin_or_coordinator(auth.uid()));

create policy enrollments_select_instructor on public.class_enrollments
for select
using (
  exists (
    select 1
    from public.classes c
    where c.id = class_id
      and public.is_instructor_owner(auth.uid(), c.instructor_id)
  )
);

create policy enrollments_select_student on public.class_enrollments
for select
using (public.is_student_owner(auth.uid(), student_id));

create policy enrollments_manage_admin on public.class_enrollments
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

-- class_overrides
create policy overrides_select_admin on public.class_overrides
for select
using (public.is_admin_or_coordinator(auth.uid()));

create policy overrides_select_instructor on public.class_overrides
for select
using (
  exists (
    select 1
    from public.classes c
    where c.id = class_id
      and public.is_instructor_owner(auth.uid(), c.instructor_id)
  )
);

create policy overrides_select_student on public.class_overrides
for select
using (public.is_student_of_class(auth.uid(), class_id));

create policy overrides_manage_admin on public.class_overrides
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

-- class_status_logs
create policy status_logs_select_admin on public.class_status_logs
for select
using (public.is_admin_or_coordinator(auth.uid()));

create policy status_logs_select_instructor on public.class_status_logs
for select
using (
  exists (
    select 1
    from public.classes c
    where c.id = class_id
      and public.is_instructor_owner(auth.uid(), c.instructor_id)
  )
);

create policy status_logs_select_student on public.class_status_logs
for select
using (public.is_student_of_class(auth.uid(), class_id));

create policy status_logs_insert_admin_or_instructor on public.class_status_logs
for insert
with check (
  public.is_admin_or_coordinator(auth.uid())
  or exists (
    select 1
    from public.classes c
    where c.id = class_id
      and public.is_instructor_owner(auth.uid(), c.instructor_id)
  )
);

-- Realtime publication
-- Supabase requires tables to be in supabase_realtime publication.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'classes'
  ) then
    alter publication supabase_realtime add table public.classes;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'class_enrollments'
  ) then
    alter publication supabase_realtime add table public.class_enrollments;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'class_overrides'
  ) then
    alter publication supabase_realtime add table public.class_overrides;
  end if;
end $$;
