create table if not exists public.portal_identities (
  id uuid primary key default gen_random_uuid(),
  portal_id text not null,
  firebase_uid text not null,
  instructor_id uuid references public.instructors(id) on delete cascade,
  login_id text not null,
  email text not null,
  display_name text not null,
  account_role text not null,
  auth_role text not null default 'authenticated',
  status text not null default 'ACTIVE',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firebase_uid),
  unique (portal_id, login_id)
);

create index if not exists portal_identities_instructor_id_idx
  on public.portal_identities (instructor_id);

create index if not exists portal_identities_portal_status_idx
  on public.portal_identities (portal_id, status);

alter table public.portal_identities enable row level security;

comment on table public.portal_identities is
  'Server-managed links between Firebase Auth identities and portal-specific Supabase identities.';

comment on column public.portal_identities.auth_role is
  'Firebase custom claim role required for authenticated portal sessions.';
