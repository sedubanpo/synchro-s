begin;

-- Older imports and concurrent requests could leave more than one active group
-- in the same timetable scope. Keep the most recently updated row active before
-- enforcing the invariant at the database level.
with ranked_active_groups as (
  select
    id,
    row_number() over (
      partition by role_view, target_id, week_start, coalesce(tag_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by updated_at desc, created_at desc, id desc
    ) as active_rank
  from public.timetable_groups
  where is_active = true
)
update public.timetable_groups as timetable_group
set is_active = false, updated_at = now()
from ranked_active_groups
where timetable_group.id = ranked_active_groups.id
  and ranked_active_groups.active_rank > 1;

create unique index if not exists timetable_groups_one_active_per_scope
  on public.timetable_groups (
    role_view,
    target_id,
    week_start,
    (coalesce(tag_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  where is_active = true;

create or replace function public.set_timetable_group_active(
  p_group_id uuid,
  p_is_active boolean
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group public.timetable_groups%rowtype;
  v_scope_lock bigint;
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
      and is_active = true;
    return false;
  end if;

  update public.timetable_groups
  set is_active = false, updated_at = now()
  where role_view = v_group.role_view
    and target_id = v_group.target_id
    and week_start = v_group.week_start
    and tag_id is not distinct from v_group.tag_id
    and id <> p_group_id
    and is_active = true;

  update public.timetable_groups
  set is_active = true, updated_at = now()
  where id = p_group_id
    and is_active = false;

  return true;
end;
$$;

create or replace function public.set_timetable_group_tag(
  p_group_id uuid,
  p_tag_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group public.timetable_groups%rowtype;
  v_scope_lock bigint;
begin
  select * into v_group
  from public.timetable_groups
  where id = p_group_id;

  if not found then
    raise exception 'Timetable group not found';
  end if;

  v_scope_lock := hashtextextended(
    concat_ws('|', v_group.role_view, v_group.target_id::text, v_group.week_start::text, coalesce(p_tag_id::text, 'null')),
    0
  );
  perform pg_advisory_xact_lock(v_scope_lock);

  if v_group.is_active then
    update public.timetable_groups
    set is_active = false, updated_at = now()
    where role_view = v_group.role_view
      and target_id = v_group.target_id
      and week_start = v_group.week_start
      and tag_id is not distinct from p_tag_id
      and id <> p_group_id
      and is_active = true;
  end if;

  update public.timetable_groups
  set tag_id = p_tag_id, updated_at = now()
  where id = p_group_id;
end;
$$;

grant execute on function public.set_timetable_group_active(uuid, boolean) to authenticated;
grant execute on function public.set_timetable_group_tag(uuid, uuid) to authenticated;

commit;
