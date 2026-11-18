-- 035: 시아탱크 포인트 고정
--   포인트는 이기고 져도 바뀌지 않는다. 누구나 게임마다 1,000포인트로 아이템을 산다.
--   랭킹은 승패(wins·losses)로 매긴다. player_points.points 칸은 남겨 두되 모두 1,000으로 맞춘다.

update public.player_points set points = 1000 where points <> 1000;

-- 판 정산 (033과 같고, 포인트는 건드리지 않는다)
create or replace function public.end_game(p_id uuid, p_game_no int, p_present text[], p_winner int default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rooms; rest jsonb; e jsonb; won boolean;
begin
  select * into r from public.rooms where id = p_id for update;
  if not found or r.status <> 'playing' or r.game_no <> p_game_no then return; end if;
  if p_winner in (0, 1) and r.map <> 'target' then
    for e in select * from jsonb_array_elements(r.players) loop
      continue when not exists (select 1 from public.profiles pr where pr.id::text = e->>'id');
      won := (e->>'team')::int = p_winner;
      insert into public.player_points as pp (user_id, points, wins, losses)
      values ((e->>'id')::uuid, 1000, case when won then 1 else 0 end, case when won then 0 else 1 end)
      on conflict (user_id) do update set
        wins = pp.wins + case when won then 1 else 0 end,
        losses = pp.losses + case when won then 0 else 1 end,
        updated_at = now();
      if (e->>'id') = any(p_present) and not ((e->>'id') = any(r.gone)) then
        perform public._grant_sia_coin((e->>'id')::uuid, 'tank', p_id || ':' || p_game_no);
      end if;
    end loop;
  end if;
  select coalesce(jsonb_agg(x || '{"items":[],"ready":false}'::jsonb), '[]'::jsonb) into rest
  from jsonb_array_elements(r.players) x where x->>'id' = any(p_present) and not (x->>'id' = any(r.gone));
  if jsonb_array_length(rest) = 0 then
    delete from public.rooms where id = p_id;
  else
    update public.rooms set status = 'waiting', players = rest, gone = '{}',
      host_id = case when exists (select 1 from jsonb_array_elements(rest) x where x->>'id' = r.host_id) then r.host_id else rest->0->>'id' end,
      updated_at = now()
    where id = p_id;
  end if;
end $$;
