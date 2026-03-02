create table if not exists public.save_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  target_type text not null check (target_type in ('학생', '강사')),
  target_name text not null
);

create index if not exists idx_save_history_created_at_desc
  on public.save_history (created_at desc);
