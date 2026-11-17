-- 룰렛 베팅 검사: 빠진 칸(target·amount·kind 없음)을 거절한다 (027 보강)
create or replace function public._roulette_check_bets(p_bets jsonb, p_base bigint) returns bigint
language plpgsql immutable as $$
declare b jsonb; k text; t int; a numeric; total bigint := 0;
begin
  if p_bets is null or jsonb_typeof(p_bets) <> 'array' or jsonb_array_length(p_bets) = 0 or jsonb_array_length(p_bets) > 60 then
    raise exception 'bad bets';
  end if;
  for b in select * from jsonb_array_elements(p_bets) loop
    -- 빠진 칸(null)도 거절 (jsonb_typeof(null) <> 'number' 는 null이라 그냥 지나가던 것)
    if jsonb_typeof(b) is distinct from 'object' or jsonb_typeof(b->'target') is distinct from 'number' or jsonb_typeof(b->'amount') is distinct from 'number' or b->>'kind' is null then raise exception 'bad bets'; end if;
    k := b->>'kind';
    t := (b->>'target')::numeric::int;
    a := (b->>'amount')::numeric;
    if (b->>'target')::numeric <> t then raise exception 'bad bets'; end if;
    if k = 'zodiac' or k = 'pair' then if t < 0 or t > 11 then raise exception 'bad bets'; end if;
    elsif k = 'season' then if t < 0 or t > 3 then raise exception 'bad bets'; end if;
    elsif k = 'yinyang' then if t < 0 or t > 1 then raise exception 'bad bets'; end if;
    else raise exception 'bad bets'; end if;
    if a <> trunc(a) or a < p_base or a > 1000000000 or (a::bigint % p_base) <> 0 then raise exception 'bad bets'; end if;
    total := total + a::bigint;
  end loop;
  return total;
end $$;
