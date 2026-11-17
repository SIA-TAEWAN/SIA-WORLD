-- 시아탱크 008: 새 게임방 기본값 - 게임 속도 빠르게(1.5배), 바람 변화 느리게
alter table public.rooms alter column speed set default 1.5;
alter table public.rooms alter column wind set default 'slow';
