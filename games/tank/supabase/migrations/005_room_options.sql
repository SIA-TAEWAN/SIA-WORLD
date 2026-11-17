-- 시아탱크 005: 게임방 설정 (게임 속도, 바람 변화 빠르기) - 방장만 바꿀 수 있다
alter table public.rooms add column if not exists speed real not null default 1;
alter table public.rooms add column if not exists wind text not null default 'normal';

create or replace function public.set_room_options(p_id uuid, p_player text, p_speed real, p_wind text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'waiting' then return; end if;
  if public._host_of(r) <> p_player then raise exception 'not host'; end if;
  if p_speed not in (1, 1.5) then raise exception 'bad speed'; end if;
  if p_wind not in ('slow', 'normal', 'fast') then raise exception 'bad wind'; end if;
  update public.rooms set speed = p_speed, wind = p_wind, updated_at = now() where id = p_id;
end $$;

grant execute on function public.set_room_options(uuid, text, real, text) to anon, authenticated;
