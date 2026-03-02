create table if not exists public.special_notes (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('학생', '강사')),
  target_id uuid not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_special_notes_target
  on public.special_notes (target_type, target_id, created_at desc);

alter table public.special_notes enable row level security;

create policy special_notes_select_admin on public.special_notes
  for select
  using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'coordinator')
    )
  );

create policy special_notes_insert_admin on public.special_notes
  for insert
  with check (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'coordinator')
    )
  );

create policy special_notes_delete_admin on public.special_notes
  for delete
  using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'coordinator')
    )
  );
