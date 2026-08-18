alter table public.class_types
  add column if not exists memo text not null default '';

comment on column public.class_types.memo is
  '운영자가 설정창에서 관리하는 수업 유형 안내 메모';
