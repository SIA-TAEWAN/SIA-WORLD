import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PICK_CAP, TOWER_BOSS_COINS, TOWER_FLOOR_COINS, towerCoins } from '../src/data/growth';
import { heroRows, levelRows, stageRows, upgradeRows } from '../src/data/sqlrows';
import { LIMITS } from '../src/game/progress';
import { EXTRA_HERO_IDS, HEROES, MAX_SHOT_STEPS, STAGES } from '../src/sim';

/**
 * 서버(067_finger.sql · 070_finger_limits.sql · 077_cat_finger.sql)의 표와 기준 값이 게임 데이터와 같은지 확인한다.
 * 다르면 npm run sqlrows 로 줄을 만들어 넣는다 (이미 올라간 마이그레이션은 고치지 않고 새 파일에 넣는다).
 */
// 시아핑거 함수를 정의하는 마이그레이션 (순서대로). 함수를 다시 정의하는 새 파일을 만들면 여기에 넣는다 — 마지막 정의를 본다
const FILES = ['067_finger.sql', '070_finger_limits.sql', '077_cat_finger.sql'];
const SQL = FILES.map((f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8')).join('\n');
/** fn 의 최신 정의 (뒤 파일의 create or replace 가 이긴다) */
const block = (fn: string) => {
  const i = SQL.lastIndexOf(`create or replace function public.${fn}(`);
  expect(i, fn).toBeGreaterThan(0);
  return SQL.slice(i, SQL.indexOf('$$;', i));
};
const rowsIn = (fn: string) =>
  block(fn)
    .split('\n')
    .map((l) => l.trim().replace(/,$/, ''))
    .filter((l) => /^\(('|\d)/.test(l));

describe('SQL 표', () => {
  it('스테이지 보상 60줄이 같다', () => {
    expect(rowsIn('_finger_stages')).toEqual(stageRows());
    expect(stageRows().length).toBe(60);
  });
  it('SQL 스테이지 id 집합 = 시뮬레이션 60스테이지 (서버가 아는 스테이지만 판을 시작할 수 있다)', () => {
    const ids = rowsIn('_finger_stages').map((l) => l.match(/^\('([^']+)'/)?.[1]);
    expect(new Set(ids)).toEqual(new Set(STAGES.map((s) => s.id)));
    expect(ids.length).toBe(STAGES.length);
    // 지역 · 번호 열도 스테이지 데이터와 같다
    const rows = rowsIn('_finger_stages');
    for (const st of STAGES) expect(rows.some((l) => l.startsWith(`('${st.id}', ${st.region}, ${st.no}, `)), st.id).toBe(true);
  });
  it('공통 강화가 같다', () => expect(rowsIn('_finger_upgrades')).toEqual(upgradeRows()));
  it('대원 레벨 가격표 (1~29 → 다음 레벨)가 같다', () => {
    expect(rowsIn('_finger_levels')).toEqual(levelRows());
    expect(levelRows().length).toBe(29);
  });
  it('대원 합류 지역이 같다', () => expect(rowsIn('_finger_heroes')).toEqual(heroRows()));
  it('추가 대원(고양이)은 지역 합류 표 밖, 같은 목록 · 공용 캐릭터 검사를 거친다 (077)', () => {
    const ids = block('_finger_extra_heroes').match(/array\[([^\]]*)\]/)?.[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(ids).toEqual([...EXTRA_HERO_IDS]);
    for (const id of EXTRA_HERO_IDS) {
      expect(HEROES[id].unlockRegion).toBe(-1);
      expect(rowsIn('_finger_heroes').some((l) => l.startsWith(`('${id}'`))).toBe(false);
    }
    // 추가 대원은 시아코인으로 연 사람만 (owned_characters, 071) · 프로필에 owned 로 준다
    expect(block('_finger_unlocked')).toContain('|| public._finger_owned(p_user)');
    expect(block('_finger_owned')).toContain('from public.owned_characters o where o.user_id = p_user and o.character_id = e.id');
    expect(block('_finger_profile_json')).toContain("'owned', to_jsonb(public._finger_owned(p_user))");
    expect(SQL).toContain('revoke all on function public._finger_owned(uuid) from public, anon, authenticated;');
    expect(block('finger_start')).toContain('perform public._check_character(me, x);');
    expect(block('finger_start')).toContain('not public._finger_is_hero(y)');
    expect(block('finger_level_up')).toContain('perform public._check_character(me, p_hero);');
  });

  it('검증 기준 값이 같다', () => {
    const c = (name: string) => Number(block('_finger_const').match(new RegExp(`when '${name}' then ([0-9.]+)`))?.[1]);
    expect(c('turn_min_time')).toBe(LIMITS.turnMinTime);
    expect(c('step_rate')).toBe(LIMITS.stepRate);
    expect(c('time_slack')).toBe(LIMITS.timeSlack);
    expect(c('max_age')).toBe(LIMITS.maxAge);
    expect(c('tower_max_age')).toBe(LIMITS.towerMaxAge);
    expect(c('coin_min_time')).toBe(LIMITS.coinMinTime);
    expect(c('max_turns')).toBe(LIMITS.maxTurns);
    expect(c('max_shot_steps')).toBe(MAX_SHOT_STEPS);
    expect(c('pick_cap')).toBe(PICK_CAP);
    expect(c('tower_turns')).toBe(LIMITS.towerTurns);
    expect(c('tower_floor_coins')).toBe(TOWER_FLOOR_COINS);
    expect(c('tower_boss_coins')).toBe(TOWER_BOSS_COINS);
  });

  it('판 끝 검사: 탑은 따로 큰 상한 · 겹침은 늦게 시작한 판 또는 먼저 시작한 판의 최소 판 시간으로만 (070)', () => {
    const fn = block('finger_finish_verified');
    expect(fn).toContain("public._finger_const(case when tower then 'tower_max_age' else 'max_age' end) then raise exception 'too late'");
    expect(fn).toContain('(o.started_at > rn.started_at');
    expect(fn).toContain('(o.started_at <= rn.started_at');
    expect(fn).toContain("make_interval(secs => coalesce(o.turns, 0) * public._finger_const('turn_min_time')");
    expect(LIMITS.towerMaxAge).toBeGreaterThan(LIMITS.maxAge);
  });

  it('끝없는 탑 엽전 식이 growth.ts 의 towerCoins 와 같다', () => {
    const fn = block('_finger_tower_coins');
    expect(fn).toContain("public._finger_const('tower_floor_coins') * greatest(0, coalesce(p_floors, 0))");
    expect(fn).toContain("+ public._finger_const('tower_boss_coins') * (greatest(0, coalesce(p_floors, 0)) / 5))::int");
    // SQL 식을 그대로 옮겨 계산해 본다 (int 나눗셈 = 내림)
    const sqlCoins = (n: number) => TOWER_FLOOR_COINS * Math.max(0, n) + TOWER_BOSS_COINS * Math.trunc(Math.max(0, n) / 5);
    for (let n = 0; n <= 120; n++) expect(sqlCoins(n), String(n)).toBe(towerCoins(n));
    // 탑 판: 층 엽전 + 주운 엽전, 같은 엽전 강화 식
    expect(block('finger_finish_verified')).toContain('raw := public._finger_tower_coins(v_floors);');
    expect(block('finger_finish_verified')).toContain("public._finger_const(case when tower then 'tower_turns' else 'max_turns' end)");
    expect(block('finger_finish_verified')).toContain('(tower and (v_floors < 0 or v_floors > v_turns or v_floors > v_waves))');
    // 기록 갱신: 높은 층 · 같은 층이면 적은 턴
    expect(block('finger_finish_verified')).toContain('v_floors > old_floor or (v_floors = old_floor and v_turns < old_turns)');
    expect(SQL).toContain("if not public._finger_cleared(me, '1-5') then raise exception 'tower locked'; end if;");
  });

  it('랭킹 뷰 2개: 정렬 · 권한 (돌격대 061 과 같은 모양)', () => {
    expect(SQL).toContain('create or replace view public.finger_stage_ranking as');
    expect(SQL).toContain('order by r.total_stars desc, r.cleared_stages desc, r.stars_updated_at asc, r.user_id');
    expect(SQL).toContain('create or replace view public.finger_tower_ranking as');
    expect(SQL).toContain('order by r.best_floor desc, r.turns asc, r.achieved_at asc, r.user_id');
    for (const v of ['finger_stage_ranking', 'finger_tower_ranking']) {
      expect(SQL).toContain(`revoke all on public.${v} from anon, authenticated;`);
      expect(SQL).toContain(`grant select on public.${v} to anon, authenticated;`);
    }
    expect(SQL).toContain('revoke all on function public._finger_tower_coins(int) from public, anon, authenticated;');
  });

  it('엽전 식이 growth.ts 와 같다', () => {
    expect(block('finger_finish_verified')).toContain('raw := st.clear_coins + st.star_coins * v_stars + (case when first then st.first_coins else 0 end);');
    expect(block('finger_finish_verified')).toContain('raw := floor(st.clear_coins * 3 * least(v_wave, v_waves) / (10.0 * v_waves));');
    expect(block('finger_finish_verified')).toContain("n_coins := floor((raw + least(v_picked, public._finger_const('pick_cap'))) * (100 + 5 * coin_lv) / 100.0);");
    expect(block('finger_finish_verified')).toContain("coin_lv := least(5, greatest(0, coalesce((rn.upgrades ->> 'coin')::int, 0)));");
    expect(SQL).toContain('(p_region - 1) * 9');
    expect(block('finger_finish_verified')).toContain("v_turns * public._finger_const('turn_min_time') + v_steps / public._finger_const('step_rate')");
    expect(block('finger_finish_verified')).toContain("public._grant_sia_coin(p_user, 'finger', p_run::text)");
  });

  it('권한: finish_verified 는 service_role 만, 나머지 RPC 는 authenticated', () => {
    expect(SQL).toContain('revoke all on function public.finger_finish_verified(uuid, uuid, jsonb) from public, anon, authenticated;');
    expect(SQL).toContain('grant execute on function public.finger_finish_verified(uuid, uuid, jsonb) to service_role;');
    for (const f of ['finger_profile()', 'finger_start(text, text[], text)', 'finger_buy_upgrade(text)', 'finger_level_up(text)'])
      expect(SQL).toContain(`grant execute on function public.${f} to authenticated;`);
    for (const t of ['finger_profiles', 'finger_heroes', 'finger_stages', 'finger_runs', 'finger_tower']) {
      expect(SQL).toContain(`alter table public.${t} enable row level security;`);
      expect(SQL).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
  });

  it('게임 오픈 여부는 닫힌 채로 추가', () => expect(SQL).toContain("('game_open:finger', 'false'::jsonb)"));
});
