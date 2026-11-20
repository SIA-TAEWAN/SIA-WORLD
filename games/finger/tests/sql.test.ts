import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PICK_CAP } from '../src/data/growth';
import { heroRows, levelRows, stageRows, upgradeRows } from '../src/data/sqlrows';
import { LIMITS } from '../src/game/progress';
import { MAX_SHOT_STEPS } from '../src/sim';

/**
 * 서버(067_finger.sql)의 표와 기준 값이 게임 데이터와 같은지 확인한다.
 * 다르면 npm run sqlrows 로 줄을 만들어 넣는다 (이미 올라간 마이그레이션은 고치지 않고 새 파일에 넣는다).
 */
const SQL = readFileSync(new URL('../../../supabase/migrations/067_finger.sql', import.meta.url), 'utf8');
const block = (fn: string) => {
  const i = SQL.indexOf(`function public.${fn}(`);
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
  it('공통 강화가 같다', () => expect(rowsIn('_finger_upgrades')).toEqual(upgradeRows()));
  it('대원 레벨 가격표 (1~29 → 다음 레벨)가 같다', () => {
    expect(rowsIn('_finger_levels')).toEqual(levelRows());
    expect(levelRows().length).toBe(29);
  });
  it('대원 합류 지역이 같다', () => expect(rowsIn('_finger_heroes')).toEqual(heroRows()));

  it('검증 기준 값이 같다', () => {
    const c = (name: string) => Number(block('_finger_const').match(new RegExp(`when '${name}' then ([0-9.]+)`))?.[1]);
    expect(c('turn_min_time')).toBe(LIMITS.turnMinTime);
    expect(c('step_rate')).toBe(LIMITS.stepRate);
    expect(c('time_slack')).toBe(LIMITS.timeSlack);
    expect(c('max_age')).toBe(LIMITS.maxAge);
    expect(c('coin_min_time')).toBe(LIMITS.coinMinTime);
    expect(c('max_turns')).toBe(LIMITS.maxTurns);
    expect(c('max_shot_steps')).toBe(MAX_SHOT_STEPS);
    expect(c('pick_cap')).toBe(PICK_CAP);
  });

  it('엽전 식이 growth.ts 와 같다', () => {
    expect(SQL).toContain('raw := st.clear_coins + st.star_coins * v_stars + (case when first then st.first_coins else 0 end);');
    expect(SQL).toContain('raw := floor(st.clear_coins * 3 * least(v_wave, v_waves) / (10.0 * v_waves));');
    expect(SQL).toContain("n_coins := floor((raw + least(v_picked, public._finger_const('pick_cap'))) * (100 + 5 * coin_lv) / 100.0);");
    expect(SQL).toContain("coin_lv := least(5, greatest(0, coalesce((rn.upgrades ->> 'coin')::int, 0)));");
    expect(SQL).toContain('(p_region - 1) * 9');
    expect(SQL).toContain("v_turns * public._finger_const('turn_min_time') + v_steps / public._finger_const('step_rate')");
    expect(SQL).toContain("public._grant_sia_coin(p_user, 'finger', p_run::text)");
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
