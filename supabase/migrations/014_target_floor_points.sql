-- 시아탱크 014: 백발백중 층별 점수 (1층 200점, 한 층마다 +50점, 7층 500점)
-- 5발 모두 7층을 맞히면 최대 2,500점. 점수는 50점 단위

alter table public.target_scores drop constraint if exists target_scores_best_check;
alter table public.target_scores add constraint target_scores_best_check check (best between 0 and 2500);

create or replace function public.submit_target_score(p_name text, p_token uuid, p_score int)
returns int language plpgsql security definer set search_path = public as $$
declare b int;
begin
  if not exists (select 1 from public.accounts where name = p_name and token = p_token) then raise exception 'need login'; end if;
  if p_score is null or p_score < 0 or p_score > 2500 or p_score % 50 <> 0 then raise exception 'bad score'; end if;
  insert into public.target_scores as ts (name, best, plays) values (p_name, p_score, 1)
  on conflict (name) do update set best = greatest(ts.best, excluded.best), plays = ts.plays + 1, updated_at = now()
  returning best into b;
  return b;
end $$;
