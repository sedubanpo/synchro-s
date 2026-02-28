alter table public.instructors
add column if not exists days_off smallint[] not null default '{}'::smallint[];

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'instructors_days_off_valid'
      and conrelid = 'public.instructors'::regclass
  ) then
    alter table public.instructors
      add constraint instructors_days_off_valid
      check (days_off <@ array[1,2,3,4,5,6,7]::smallint[]);
  end if;
end $$;
