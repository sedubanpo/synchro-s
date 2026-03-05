create table if not exists public.instructor_schedule_view_logs (
  id bigserial primary key,
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  week_start date not null,
  viewer_name text,
  viewed_at timestamptz not null default now()
);

create index if not exists idx_instructor_view_logs_instructor_viewed_at
  on public.instructor_schedule_view_logs (instructor_id, viewed_at desc);

alter table public.instructor_schedule_view_logs enable row level security;

create policy instructor_view_logs_insert_self_or_admin on public.instructor_schedule_view_logs
  for insert
  with check (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and (
          u.role in ('admin', 'coordinator')
          or (
            u.role = 'instructor'
            and exists (
              select 1
              from public.instructors i
              where i.user_id = u.id
                and i.id = instructor_schedule_view_logs.instructor_id
            )
          )
        )
    )
  );
