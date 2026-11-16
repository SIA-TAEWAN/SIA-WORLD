-- 시아탱크 011: 방장이 대기 중인 게임방에서 다른 사람을 내보낸다
create or replace function public.kick_player(p_id uuid, p_host text, p_target text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'waiting' then return; end if;
  if public._host_of(r) <> p_host then raise exception 'not host'; end if;
  if p_target = p_host then return; end if;
  update public.rooms set
    players = (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(r.players) e where e->>'id' <> p_target),
    updated_at = now()
  where id = p_id;
end $$;
grant execute on function public.kick_player(uuid, text, text) to anon, authenticated;
