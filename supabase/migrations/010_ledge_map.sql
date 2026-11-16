-- 시아탱크 010: '아슬아슬' 맵(ledge) 추가
alter table public.rooms drop constraint if exists rooms_map_check;
alter table public.rooms add constraint rooms_map_check check (map in ('random', 'valley', 'sky', 'sphinx', 'ledge'));

create or replace function public.set_room_map(p_id uuid, p_player text, p_map text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'waiting' then return; end if;
  if public._host_of(r) <> p_player then raise exception 'not host'; end if;
  if p_map not in ('random', 'valley', 'sky', 'sphinx', 'ledge') then raise exception 'bad map'; end if;
  update public.rooms set map = p_map, updated_at = now() where id = p_id;
end $$;
