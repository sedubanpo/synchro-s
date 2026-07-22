alter table public.schedule_tags
  add column if not exists is_current boolean not null default false;

create unique index if not exists schedule_tags_one_current_idx
  on public.schedule_tags (is_current)
  where is_current = true;

update public.schedule_tags
set is_current = true,
    updated_at = now()
where id = (
  select id
  from public.schedule_tags
  where is_active = true
  order by sort_order asc, created_at asc
  limit 1
)
and not exists (
  select 1 from public.schedule_tags where is_current = true
);

create or replace function public.set_current_schedule_tag(p_tag_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.schedule_tags
    where id = p_tag_id
      and is_active = true
  ) then
    raise exception '활성 상태인 시간표 분류만 현재 분류로 설정할 수 있습니다.';
  end if;

  update public.schedule_tags
  set is_current = false,
      updated_at = now()
  where is_current = true
    and id <> p_tag_id;

  update public.schedule_tags
  set is_current = true,
      updated_at = now()
  where id = p_tag_id;
end;
$$;

grant execute on function public.set_current_schedule_tag(uuid) to authenticated;

alter table public.save_history
  add column if not exists tag_id uuid references public.schedule_tags(id) on delete set null;

create index if not exists idx_save_history_tag_id
  on public.save_history (tag_id, created_at desc);
