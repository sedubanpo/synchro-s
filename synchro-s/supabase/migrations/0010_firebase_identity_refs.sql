-- Firebase identity reference columns for a gradual Synchro-S migration.
--
-- This migration is intentionally non-destructive:
-- - no schedule rows are deleted, recreated, or overwritten
-- - existing name fields remain the source-of-record during migration
-- - Firebase references are nullable and can be ignored or cleared if rollout stops

alter table public.users
  add column if not exists firebase_uid text,
  add column if not exists firebase_role text,
  add column if not exists firebase_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_firebase_role_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_firebase_role_check
      check (
        firebase_role is null or
        firebase_role in ('ADMIN', 'COORDINATOR', 'INSTRUCTOR', 'STUDENT')
      ) not valid;
  end if;
end $$;

create unique index if not exists users_firebase_uid_unique
  on public.users (firebase_uid)
  where firebase_uid is not null;

alter table public.instructors
  add column if not exists firebase_uid text,
  add column if not exists firebase_instructor_id text,
  add column if not exists firebase_match_key text,
  add column if not exists firebase_sync_status text not null default 'unmapped',
  add column if not exists firebase_synced_at timestamptz;

alter table public.students
  add column if not exists firebase_uid text,
  add column if not exists firebase_student_id text,
  add column if not exists firebase_match_key text,
  add column if not exists firebase_sync_status text not null default 'unmapped',
  add column if not exists firebase_synced_at timestamptz;

alter table public.classes
  add column if not exists firebase_instructor_id text,
  add column if not exists firebase_sync_status text not null default 'unmapped',
  add column if not exists firebase_synced_at timestamptz;

alter table public.class_enrollments
  add column if not exists firebase_student_id text,
  add column if not exists firebase_sync_status text not null default 'unmapped',
  add column if not exists firebase_synced_at timestamptz;

alter table public.timetable_groups
  add column if not exists firebase_target_id text,
  add column if not exists firebase_sync_status text not null default 'unmapped',
  add column if not exists firebase_synced_at timestamptz;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'instructors',
    'students',
    'classes',
    'class_enrollments',
    'timetable_groups'
  ]
  loop
    if not exists (
      select 1
      from pg_constraint
      where conname = table_name || '_firebase_sync_status_check'
        and conrelid = ('public.' || table_name)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I check (firebase_sync_status in (''unmapped'', ''matched'', ''needs_review'', ''skipped'', ''error'')) not valid',
        table_name,
        table_name || '_firebase_sync_status_check'
      );
    end if;
  end loop;
end $$;

create unique index if not exists instructors_firebase_uid_unique
  on public.instructors (firebase_uid)
  where firebase_uid is not null;

create unique index if not exists instructors_firebase_instructor_id_unique
  on public.instructors (firebase_instructor_id)
  where firebase_instructor_id is not null;

create index if not exists instructors_firebase_match_key_idx
  on public.instructors (firebase_match_key);

create index if not exists instructors_firebase_sync_status_idx
  on public.instructors (firebase_sync_status);

create unique index if not exists students_firebase_uid_unique
  on public.students (firebase_uid)
  where firebase_uid is not null;

create unique index if not exists students_firebase_student_id_unique
  on public.students (firebase_student_id)
  where firebase_student_id is not null;

create index if not exists students_firebase_match_key_idx
  on public.students (firebase_match_key);

create index if not exists students_firebase_sync_status_idx
  on public.students (firebase_sync_status);

create index if not exists classes_firebase_instructor_id_idx
  on public.classes (firebase_instructor_id);

create index if not exists classes_firebase_sync_status_idx
  on public.classes (firebase_sync_status);

create index if not exists class_enrollments_firebase_student_id_idx
  on public.class_enrollments (firebase_student_id);

create index if not exists class_enrollments_firebase_sync_status_idx
  on public.class_enrollments (firebase_sync_status);

create index if not exists timetable_groups_firebase_target_id_idx
  on public.timetable_groups (firebase_target_id);

create index if not exists timetable_groups_firebase_sync_status_idx
  on public.timetable_groups (firebase_sync_status);
