-- 시아탱크 012: 게임 모드 (초보 / 일반). 방장만 바꾼다
alter table public.rooms add column if not exists mode text not null default 'normal' check (mode in ('easy', 'normal'));

create or replace function public.set_room_mode(p_id uuid, p_player text, p_mode text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'waiting' then return; end if;
  if public._host_of(r) <> p_player then raise exception 'not host'; end if;
  if p_mode not in ('easy', 'normal') then raise exception 'bad mode'; end if;
  update public.rooms set mode = p_mode, updated_at = now() where id = p_id;
end $$;
grant execute on function public.set_room_mode(uuid, text, text) to anon, authenticated;
