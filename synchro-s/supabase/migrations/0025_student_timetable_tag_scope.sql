begin;

-- Student timetable activation is tag-scoped, not week-scoped. Historical
-- data may contain one active row per week; keep the most recently touched
-- row active before enforcing the new invariant.
with ranked_active_student_groups as (
  select
    id,
    row_number() over (
      partition by target_id, tag_id
      order by updated_at desc, created_at desc, id desc
    ) as active_rank
  from public.timetable_groups
  where role_view = 'student'
    and tag_id is not null
    and is_active = true
)
update public.timetable_groups as timetable_group
set is_active = false, updated_at = now()
from ranked_active_student_groups
where timetable_group.id = ranked_active_student_groups.id
  and ranked_active_student_groups.active_rank > 1;

create unique index if not exists timetable_groups_one_active_student_per_tag
  on public.timetable_groups (
    target_id,
    tag_id
  )
  where role_view = 'student' and tag_id is not null and is_active = true;

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
    case
      when v_group.role_view = 'student' and v_group.tag_id is not null then
        concat_ws('|', v_group.role_view, v_group.target_id::text, coalesce(v_group.tag_id::text, 'null'))
      else
        concat_ws('|', v_group.role_view, v_group.target_id::text, v_group.week_start::text, coalesce(v_group.tag_id::text, 'null'))
    end,
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
    and (v_group.role_view = 'student' and v_group.tag_id is not null or week_start = v_group.week_start)
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
    case
      when v_group.role_view = 'student' and p_tag_id is not null then
        concat_ws('|', v_group.role_view, v_group.target_id::text, coalesce(p_tag_id::text, 'null'))
      else
        concat_ws('|', v_group.role_view, v_group.target_id::text, v_group.week_start::text, coalesce(p_tag_id::text, 'null'))
    end,
    0
  );
  perform pg_advisory_xact_lock(v_scope_lock);

  if v_group.is_active then
    update public.timetable_groups
    set is_active = false, updated_at = now()
    where role_view = v_group.role_view
      and target_id = v_group.target_id
      and (v_group.role_view = 'student' and p_tag_id is not null or week_start = v_group.week_start)
      and tag_id is not distinct from p_tag_id
      and id <> p_group_id
      and is_active = true;
  end if;

  update public.timetable_groups
  set tag_id = p_tag_id, updated_at = now()
  where id = p_group_id;
end;
$$;

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
    case
      when v_group.role_view = 'student' and v_group.tag_id is not null then
        concat_ws('|', v_group.role_view, v_group.target_id::text, coalesce(v_group.tag_id::text, 'null'))
      else
        concat_ws('|', v_group.role_view, v_group.target_id::text, v_group.week_start::text, coalesce(v_group.tag_id::text, 'null'))
    end,
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
      and (v_group.role_view = 'student' and v_group.tag_id is not null or week_start = v_group.week_start)
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

create or replace function public.toggle_timetable_group(p_group_id uuid)
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
    case
      when v_group.role_view = 'student' and v_group.tag_id is not null then
        concat_ws('|', v_group.role_view, v_group.target_id::text, coalesce(v_group.tag_id::text, 'null'))
      else
        concat_ws('|', v_group.role_view, v_group.target_id::text, v_group.week_start::text, coalesce(v_group.tag_id::text, 'null'))
    end,
    0
  );
  perform pg_advisory_xact_lock(v_scope_lock);

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
    and (v_group.role_view = 'student' and v_group.tag_id is not null or week_start = v_group.week_start)
    and tag_id is not distinct from v_group.tag_id
    and id <> p_group_id
    and is_active = true;

  update public.timetable_groups
  set is_active = true, updated_at = now()
  where id = p_group_id;

  return true;
end;
$$;

grant execute on function public.set_timetable_group_active(uuid, boolean) to authenticated;
grant execute on function public.set_timetable_group_tag(uuid, uuid) to authenticated;
grant execute on function public.set_timetable_group_active_with_actor(uuid, boolean, text, text, text, text) to authenticated;
grant execute on function public.toggle_timetable_group(uuid) to authenticated;

commit;
