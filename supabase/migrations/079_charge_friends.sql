-- 079: 시아돌격대 — 스테이지별 친구 기록 (최다 생존 대원 1~3위 + 내 기록·순위)
--   기록은 061 부터 쌓이는 charge_stages.best_troops (클리어한 판의 남은 대원 최고 값).
--   charge_stages 는 본인 줄만 읽을 수 있으므로(RLS) 다른 사람 기록은 아래 읽기 함수로만 준다:
--   닉네임 · 대원 수 · 순위만 내보내고 user_id 는 내보내지 않는다.
--   동점은 먼저 달성한 사람 우선. 061 에는 "최고 기록을 세운 시각" 칸이 없어서(cleared_at = 첫 클리어 시각)
--   best_at 칸을 더하고, charge_finish 는 그대로 둔 채 트리거로 best_troops 가 오를 때만 시각을 고친다.
--   이미 있는 줄은 알 수 있는 가장 가까운 값인 cleared_at 으로 채운다.

-- ---------- 1. 최고 기록을 세운 시각 ----------

alter table public.charge_stages add column if not exists best_at timestamptz;
update public.charge_stages set best_at = cleared_at where best_at is null;
alter table public.charge_stages alter column best_at set default now();
alter table public.charge_stages alter column best_at set not null;

create or replace function public._charge_stage_best_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.best_troops > old.best_troops then
    new.best_at := now();
  else
    new.best_at := old.best_at;
  end if;
  return new;
end $$;
revoke all on function public._charge_stage_best_at() from public, anon, authenticated;

drop trigger if exists charge_stages_best_at on public.charge_stages;
create trigger charge_stages_best_at before update on public.charge_stages
  for each row execute function public._charge_stage_best_at();

-- 스테이지별 순위 읽기용
create index if not exists charge_stages_top_idx on public.charge_stages (stage_id, best_troops desc, best_at);

-- ---------- 2. 읽기 함수 ----------

-- 한 지역(스테이지 5개)의 기록을 한 번에: 스테이지 화면이 스테이지마다 부르지 않게.
-- 모양: { "3-1": { "top": [ { "place": 1, "nickname": "…", "troops": 321, "me": false }, … 최대 3 ],
--                  "total": 12, "mine": { "place": 5, "troops": 120 } | null }, … }
-- 기록이 하나도 없는 스테이지는 빠진다. 순위: 대원 수 많은 순 → 먼저 달성한 순 → user_id
create or replace function public.charge_stage_tops(p_region int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  return coalesce((
    select jsonb_object_agg(g.stage_id, jsonb_build_object('top', g.top, 'total', g.total, 'mine', g.mine))
    from (
      select r.stage_id,
        jsonb_agg(jsonb_build_object('place', r.place, 'nickname', r.nickname, 'troops', r.best_troops, 'me', r.user_id = me) order by r.place)
          filter (where r.place <= 3) as top,
        max(r.total) as total,
        (jsonb_agg(jsonb_build_object('place', r.place, 'troops', r.best_troops)) filter (where r.user_id = me)) -> 0 as mine
      from (
        select s.stage_id, s.user_id, p.nickname, s.best_troops,
          (row_number() over (partition by s.stage_id order by s.best_troops desc, s.best_at asc, s.user_id))::int as place,
          (count(*) over (partition by s.stage_id))::int as total
        from public.charge_stages s
        join public.profiles p on p.id = s.user_id
        join public._charge_stages() t on t.stage_id = s.stage_id
        where t.region = p_region and s.best_troops > 0
      ) r
      group by r.stage_id
    ) g
  ), '{}'::jsonb);
end $$;
revoke all on function public.charge_stage_tops(int) from public, anon;
grant execute on function public.charge_stage_tops(int) to authenticated;
