import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COINS, MAX_LV, SQUAD_SIZE, STAR2_LIVES, START_LIVES, WAVES, WAVE_SEC } from '../src/data/balance';
import { BOSSES } from '../src/data/bosses';
import { EXTRAS, ROSTER, STARTERS } from '../src/data/characters';
import { ENDLESS_COINS, ENDLESS_ID, ENDLESS_MAX_SEC } from '../src/data/endless';
import { ENEMIES } from '../src/data/enemies';
import { CHAR_MAX_LV, LEVEL_COSTS, UPGRADES, upgradeCost } from '../src/data/growth';
import { REGIONS } from '../src/data/regions';
import { STAGES } from '../src/data/stages';
import { LIMITS } from '../src/game/progress';

/**
 * 서버 SQL(supabase/migrations/048_defense.sql · 060_defense_review.sql · 074_cat_defense.sql)의 표·상수가 게임 데이터와 같은지 본다.
 * 엽전·레벨업·강화·해금은 서버가 정하므로, 두 곳의 값이 어긋나면 화면에 보이는 값과 실제가 달라진다.
 * 뒤에 이 함수들을 다시 정의하는 마이그레이션이 생기면 아래 목록에 그 파일을 더한다 (뒤 파일의 정의가 실제 값이다).
 */
const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), 'utf8');
const FILES = ['048_defense.sql', '060_defense_review.sql', '074_cat_defense.sql'];
const sql = FILES.map(read).join('\n');

/** 함수 하나의 본문 */
function body(name: string): string {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`);
  expect(at, name).toBeGreaterThan(0);
  return sql.slice(at, sql.indexOf('$$;', at));
}
/** values 줄: ('a', 1, 2) → ['a', 1, 2] */
const rows = (name: string) =>
  [...body(name).matchAll(/^\s*\(([^)]+)\),?\s*$/gm)].map((m) => m[1].split(',').map((c) => (c.trim().startsWith("'") ? c.trim().slice(1, -1) : Number(c))));
/** _defense_const 의 값 */
const consts = Object.fromEntries([...body('_defense_const').matchAll(/when '(\w+)' then ([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));

describe('SQL의 표가 게임 데이터와 같다', () => {
  it('스테이지: id · 지역 · 번호 · 클리어 보상 · 첫 클리어 보상', () => {
    expect(rows('_defense_stages')).toEqual(STAGES.map((s) => [s.id, s.region, s.no, s.coins, s.firstCoins]));
    // 서버는 시작 생명을 20(+ 강화)으로 본다: 스테이지마다 다른 시작 생명은 쓰지 않는다
    expect(STAGES.every((s) => s.lives === undefined)).toBe(true);
  });

  it('지역: 필요 별 · 클리어하면 해금되는 캐릭터', () => {
    expect(rows('_defense_regions')).toEqual(REGIONS.map((r) => [r.no, r.stars, ROSTER.find((c) => c.unlockRegion === r.no)?.id ?? '']));
  });

  it('캐릭터 레벨업 비용', () => {
    expect(rows('_defense_level_costs')).toEqual(LEVEL_COSTS.map((c, i) => [i + 1, c]));
    expect(consts.char_max_level).toBe(CHAR_MAX_LV);
  });

  it('공통 강화: 항목 · 최대 레벨 · 첫 비용 · 레벨마다 더해지는 값, 비용 식 = base_cost + step × 레벨', () => {
    expect(rows('_defense_upgrades')).toEqual(UPGRADES.map((u) => [u.id, u.max, u.baseCost, u.step]));
    expect(body('defense_buy_upgrade')).toContain('price := u.base_cost + u.step * lv;');
    for (const u of UPGRADES) for (let lv = 0; lv < u.max; lv++) expect(upgradeCost(u.id, lv)).toBe(u.baseCost + u.step * lv);
    // 서버가 강화 레벨을 읽는 열쇠
    expect(body('defense_start')).toContain("pr.upgrades->>'lives'");
    expect(body('defense_finish')).toContain("pr.upgrades->>'coin'");
  });

  it('검증 상수 (_defense_const = LIMITS)', () => {
    for (const [k, v] of Object.entries(LIMITS)) expect(consts[k], k).toBe(v);
    expect(consts).toMatchObject({
      start_lives: START_LIVES, star2_lives: STAR2_LIVES, star_coins: COINS.perStar, fail_div: COINS.failDiv,
      wave_sec: WAVE_SEC, waves: WAVES, squad_max: SQUAD_SIZE,
    });
    expect(MAX_LV).toBe(3);
  });

  it('도감에 들어갈 수 있는 id: 요괴 9종 · 보스 12종 (데이터와 같은 순서)', () => {
    expect(rows('_defense_codex_ids')).toEqual([...ENEMIES.map((e, i) => ['enemies', e.id, i + 1]), ...BOSSES.map((b, i) => ['bosses', b.id, i + 1])]);
  });

  it('끝없는 모드의 값', () => {
    expect(consts.endless_max_time).toBe(ENDLESS_MAX_SEC);
    expect(consts.endless_coin_per_wave).toBe(ENDLESS_COINS.perWave);
    expect(consts.endless_coin_cap).toBe(ENDLESS_COINS.cap);
    expect(body('defense_start')).toContain("d.stage_id = '1-5'");
    expect(ENDLESS_ID).toBe('endless');
  });

  it('캐릭터 목록 · 처음부터 쓸 수 있는 캐릭터 · 스테이지로 열리지 않는 캐릭터(고양이)', () => {
    // 캐릭터 id 는 071 의 _check_character 가 본다 (모르는 id · 다음 단계에서 사지 않은 캐릭터)
    expect(body('defense_level_up')).toContain('perform public._check_character(me, p_character);');
    expect(body('defense_start')).toContain('perform public._check_character(me, c);');
    // 고양이는 해금 표(unlocked_characters)가 아니라 _defense_extra_ids 로 'character locked' 를 피한다
    expect(EXTRAS).toEqual(['cat']);
    expect(body('_defense_extra_ids')).toContain(`array[${EXTRAS.map((c) => `'${c}'`).join(',')}]::text[]`);
    for (const f of ['defense_start', 'defense_level_up']) expect(body(f)).toContain('public._defense_extra_ids()');
    // 071 의 _character_ids 에 명단 전체가 있다
    const ids = read('071_characters.sql').match(/select array\[([^\]]+)\]::text\[\]/)![1].split(',').map((c) => c.trim().slice(1, -1));
    expect(ROSTER.map((r) => r.id)).toEqual(ids);
    expect(sql).toContain(`unlocked_characters text[] not null default array[${STARTERS.map((c) => `'${c}'`).join(', ')}]`);
  });

  it('엽전 계산식: 서버가 스테이지 표로 계산한다 (화면이 보낸 금액을 받는 인자가 없다)', () => {
    const f = body('defense_finish');
    expect(f).toContain("base := (st.coins * least(public._defense_const('waves')::int, done)) / public._defense_const('fail_div')::int;");
    // 끝없는 모드: 넘긴 웨이브마다, 상한까지
    expect(f).toContain("base := least(public._defense_const('endless_coin_cap')::int, done * public._defense_const('endless_coin_per_wave')::int);");
    expect(f).toContain('wave := done + 1;');
    expect(f).toContain('coins := ((base + first + star_c + bonus) * (100 + 5 * coin_lv)) / 100;');
    expect(f.slice(0, f.indexOf(') returns jsonb'))).not.toMatch(/coin/);
  });

  it('060: 별은 서버가 시작 생명으로 센다 (화면의 별과 달라도 거절하지 않는다) · 판 시작이 판 설정을 돌려준다 · defense_now 는 하나', () => {
    const f = body('defense_finish');
    expect(f).not.toMatch(/p_stars\s*<>/);
    expect(f).toContain('when p_lives >= rn.start_lives then 3');
    const st = body('defense_start');
    expect(st).toContain(') returns jsonb');
    expect(st).toContain("jsonb_build_object('run', rid, 'startLives', lives, 'upgrades', pr.upgrades, 'levels', pr.character_levels)");
    expect(read('060_defense_review.sql').match(/create or replace function public\.defense_now\(/g)).toHaveLength(1);
    expect(read('074_cat_defense.sql')).not.toContain('function public.defense_now(');
    expect(body('defense_now')).toContain('volatile');
  });

  it('권한: 화면이 부르는 함수는 로그인한 사용자만, 안쪽 함수와 표 쓰기는 아무도', () => {
    for (const fn of ['defense_profile()', 'defense_now()', 'defense_start(text, text[], text)', 'defense_finish(uuid, int, boolean, int, int, int, int, int, int, jsonb)', 'defense_level_up(text)', 'defense_buy_upgrade(text)']) {
      expect(sql, fn).toContain(`revoke all on function public.${fn} from public, anon;`);
      expect(sql, fn).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
    for (const fn of ['_defense_codex_ids', '_defense_codex_merge', '_defense_const', '_defense_stages', '_defense_regions', '_defense_level_costs', '_defense_upgrades', '_defense_profile_row', '_defense_profile_json', '_defense_region_open', '_defense_stage_open', '_defense_extra_ids']) {
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
    }
    // 랭킹 뷰 2개는 누구나 읽는다
    for (const v of ['defense_stage_ranking', 'defense_endless_ranking']) expect(sql).toContain(`grant select on public.${v} to anon, authenticated;`);
    for (const t of ['defense_profiles', 'defense_stages', 'defense_runs', 'defense_endless']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
    expect(sql).not.toMatch(/grant (insert|update|delete|all)/);
    expect(sql).toContain("insert into public.app_settings (key, value) values ('game_open:defense', 'false'::jsonb) on conflict (key) do nothing;");
  });
});
