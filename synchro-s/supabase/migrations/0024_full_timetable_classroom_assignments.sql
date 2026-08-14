begin;

create table if not exists public.instructor_fixed_classrooms (
  instructor_id uuid primary key references public.instructors(id) on delete cascade,
  classroom text not null check (classroom in (
    '1강의실', '2강의실', '3강의실', '4강의실', '5강의실', '6강의실', '7강의실',
    '8강의실', '9강의실', '2관 1강의실', '2관 2강의실', '2관 3강의실',
    '3관 1강의실', '3관 2강의실'
  )),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.instructor_classroom_day_overrides (
  assignment_date date not null,
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  classroom text not null check (classroom in (
    '1강의실', '2강의실', '3강의실', '4강의실', '5강의실', '6강의실', '7강의실',
    '8강의실', '9강의실', '2관 1강의실', '2관 2강의실', '2관 3강의실',
    '3관 1강의실', '3관 2강의실'
  )),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (assignment_date, instructor_id)
);

create index if not exists idx_instructor_classroom_day_overrides_date
  on public.instructor_classroom_day_overrides (assignment_date);

alter table public.instructor_fixed_classrooms enable row level security;
alter table public.instructor_classroom_day_overrides enable row level security;

drop policy if exists instructor_fixed_classrooms_manage_staff on public.instructor_fixed_classrooms;
create policy instructor_fixed_classrooms_manage_staff on public.instructor_fixed_classrooms
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

drop policy if exists instructor_classroom_day_overrides_manage_staff on public.instructor_classroom_day_overrides;
create policy instructor_classroom_day_overrides_manage_staff on public.instructor_classroom_day_overrides
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

grant select, insert, update, delete on public.instructor_fixed_classrooms to authenticated;
grant select, insert, update, delete on public.instructor_classroom_day_overrides to authenticated;

commit;
