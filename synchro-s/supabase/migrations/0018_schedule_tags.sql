create table if not exists public.schedule_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color_key text not null default 'blue'
    check (color_key in ('blue', 'emerald', 'amber', 'rose', 'violet', 'slate')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists schedule_tags_name_unique
  on public.schedule_tags (lower(btrim(name)));

create index if not exists schedule_tags_order_idx
  on public.schedule_tags (is_active desc, sort_order asc, created_at asc);

alter table public.timetable_groups
  add column if not exists tag_id uuid references public.schedule_tags(id) on delete set null;

create index if not exists idx_timetable_groups_tag_scope
  on public.timetable_groups (tag_id, role_view, target_id, week_start, is_active);

alter table public.schedule_tags enable row level security;

drop policy if exists schedule_tags_select_authenticated on public.schedule_tags;
create policy schedule_tags_select_authenticated on public.schedule_tags
for select
using (auth.uid() is not null);

drop policy if exists schedule_tags_manage_admin on public.schedule_tags;
create policy schedule_tags_manage_admin on public.schedule_tags
for all
using (public.is_admin_or_coordinator(auth.uid()))
with check (public.is_admin_or_coordinator(auth.uid()));

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
    and tag_id is not distinct from v_group.tag_id
    and is_active = true;

  update public.timetable_groups
  set is_active = true, updated_at = now()
  where id = p_group_id;

  return true;
end;
$$;

grant execute on function public.toggle_timetable_group(uuid) to authenticated;
