begin;

alter table public.save_history
  add column if not exists created_by_uid text,
  add column if not exists created_by_name text,
  add column if not exists created_by_position text,
  add column if not exists created_by_icon_url text;

alter table public.timetable_groups
  add column if not exists created_by_uid text,
  add column if not exists created_by_position text,
  add column if not exists created_by_icon_url text;

create table if not exists public.timetable_group_activity_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  group_id uuid not null references public.timetable_groups(id) on delete cascade,
  action text not null check (action in ('created', 'activated', 'deactivated')),
  actor_uid text,
  actor_name text,
  actor_position text,
  actor_icon_url text
);

create index if not exists idx_timetable_group_activity_group_created
  on public.timetable_group_activity_history (group_id, created_at desc);

create or replace function public.set_timetable_group_active_with_actor(
  p_group_id uuid,
  p_is_active boolean,
  p_actor_uid text,
  p_actor_name text,
  p_actor_position text,
  p_actor_icon_url text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group public.timetable_groups%rowtype;
  v_scope_lock bigint;
  v_deactivated_id uuid;
begin
  select * into v_group
  from public.timetable_groups
  where id = p_group_id;

  if not found then
    raise exception 'Timetable group not found';
  end if;

  v_scope_lock := hashtextextended(
    concat_ws('|', v_group.role_view, v_group.target_id::text, v_group.week_start::text, coalesce(v_group.tag_id::text, 'null')),
    0
  );
  perform pg_advisory_xact_lock(v_scope_lock);

  if p_is_active is not true then
    update public.timetable_groups
    set is_active = false, updated_at = now()
    where id = p_group_id
      and is_active = true
    returning id into v_deactivated_id;

    if v_deactivated_id is not null then
      insert into public.timetable_group_activity_history (
        group_id, action, actor_uid, actor_name, actor_position, actor_icon_url
      ) values (
        v_deactivated_id, 'deactivated', p_actor_uid, p_actor_name, p_actor_position, p_actor_icon_url
      );
    end if;
    return false;
  end if;

  for v_deactivated_id in
    update public.timetable_groups
    set is_active = false, updated_at = now()
    where role_view = v_group.role_view
      and target_id = v_group.target_id
      and week_start = v_group.week_start
      and tag_id is not distinct from v_group.tag_id
      and id <> p_group_id
      and is_active = true
    returning id
  loop
    insert into public.timetable_group_activity_history (
      group_id, action, actor_uid, actor_name, actor_position, actor_icon_url
    ) values (
      v_deactivated_id, 'deactivated', p_actor_uid, p_actor_name, p_actor_position, p_actor_icon_url
    );
  end loop;

  update public.timetable_groups
  set is_active = true, updated_at = now()
  where id = p_group_id
    and is_active = false;

  if found then
    insert into public.timetable_group_activity_history (
      group_id, action, actor_uid, actor_name, actor_position, actor_icon_url
    ) values (
      p_group_id, 'activated', p_actor_uid, p_actor_name, p_actor_position, p_actor_icon_url
    );
  end if;

  return true;
end;
$$;

grant execute on function public.set_timetable_group_active_with_actor(uuid, boolean, text, text, text, text) to authenticated;

commit;
