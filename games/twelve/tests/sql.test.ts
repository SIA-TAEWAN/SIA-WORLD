import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockIn, fillBlocks, itemRows, levelRows, mapRows, regionRows, sqlBlocks } from '../src/data/sqlrows';
import { ALL_MAPS } from '../src/data/maps';
import { TIER_LEVELS } from '../src/data/weapons';

/**
 * 서버(078_twelve.sql + 089_twelve_full.sql)의 표와 기준 값이 게임 데이터와 같은지 확인한다.
 * 078 은 운영에 있어 고치지 않는다. 표(gen 블록)는 089 가 create or replace 로 다시 정의하므로 089 의 블록을 대조하고,
 * 함수는 두 파일을 합친 것에서 마지막 정의(= 운영에 남는 정의)를 본다. 다르면 `npm run sqlgen` 으로 089 의 gen 블록을 다시 만든다.
 * 이 두 파일만 읽는다 (071~077 의 고양이 함수는 보지 않는다). SQL 을 실제로 돌려 보는 것은 scripts/pg-check.mjs.
 */
const read = (name: string) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sql078 = read('078_twelve.sql');
const sql089 = read('089_twelve_full.sql');
const sql = `${sql078}\n${sql089}`;
const fn = (name: string) => {
  const i = sql.lastIndexOf(`create or replace function public.${name}(`);
  return i < 0 ? '' : sql.slice(i, sql.indexOf('$$;', i));
};

describe('SQL 표 (npm run sqlgen 이 만든 블록)', () => {
  const blocks = sqlBlocks();
  for (const name of Object.keys(blocks)) {
    it(`${name} 블록이 src/data 와 같다`, () => expect(blockIn(sql089, name)).toBe(blocks[name]));
  }
  it('파일 전체가 다시 만들어도 그대로다', () => expect(fillBlocks(sql089)).toBe(sql089));

  it('089 는 078 의 함수를 같은 모양으로 다시 정의한다 (create or replace · 표 함수는 권한 빼기, RPC 는 로그인한 사람만)', () => {
    const head = (s: string, name: string) => {
      const i = s.indexOf(`create or replace function public.${name}(`);
      return i < 0 ? '' : s.slice(i, s.indexOf('$$', i));
    };
    const names = [...new Set(sql089.match(/create or replace function public\.\w+/g)!.map((s) => s.split('public.')[1]))];
    expect(names.length).toBeGreaterThanOrEqual(Object.keys(blocks).length);
    for (const name of names) {
      expect(head(sql089, name), name).toBe(head(sql078, name));
      if (name.startsWith('_')) expect(sql089).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
      else {
        expect(sql089).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;`));
        expect(sql089).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated;`));
        expect(head(sql089, name)).toContain('security definer set search_path = public');
      }
    }
    expect(sql089).not.toMatch(/create table|drop |alter table/);
  });

  it('줄 수: 준비된 맵(지형 맵 96 + 최종보스맵) · 레벨 1~98 · 장비 216 · 지형 24', () => {
    expect(mapRows().length).toBe(ALL_MAPS.length);
    expect(levelRows().length).toBe(98);
    expect(itemRows().length).toBe(216);
    expect(regionRows().length).toBe(24);
  });
});

describe('SQL 규칙', () => {
  it('착용 레벨 식이 TIER_LEVELS 와 같다', () => {
    expect(fn('_twelve_tier_level')).toContain('select greatest(1, 9 * p_tier)');
    TIER_LEVELS.forEach((lv, t) => expect(Math.max(1, 9 * t)).toBe(lv));
  });

  it('드랍 무작위 계산이 drops.ts 의 roll 과 같은 상수를 쓴다', () => {
    const body = fn('_twelve_roll');
    expect(body).toContain(String(0x9e3779b1));
    expect(body).toContain(String(0x85ebca6b));
    expect(body.split(String(0x45d9f3b)).length - 1).toBe(2);
    expect(body).toContain('& 4294967295');
  });

  it('판정 종류 번호가 drops.ts 의 TAG 와 같다 (1 일반 · 3~7 정예 · 8~12 보스)', () => {
    const body = fn('twelve_finish');
    const drops = readFileSync(new URL('../src/game/drops.ts', import.meta.url), 'utf8');
    expect(drops).toContain('const TAG = { normal: 1, normalPick: 2, eliteStone: 3, eliteAcc: 4, eliteAccPick: 5, eliteRare: 6, eliteRarePick: 7, bossAcc: 8, bossAccPick: 9, bossRare: 10, bossRarePick: 11, key: 12 }');
    for (const [tag, n, what] of [[1, 'i', 'drop_potion'], [3, 'i', 'drop_elite_stone'], [4, 'i', 'drop_elite_acc'], [6, 'i', 'drop_elite_rare'], [8, '1', 'drop_boss_acc'], [10, '1', 'drop_boss_rare'], [12, '1', 'drop_key']] as const) {
      expect(body).toContain(`public._twelve_roll(seed, ${tag}, ${n}) % 10000`);
      expect(body).toContain(`public._twelve_const('${what}')`);
    }
    for (const [tag, n] of [[2, 'i'], [5, 'i'], [7, 'i'], [9, '1'], [11, '1']] as const) expect(body).toContain(`public._twelve_roll(seed, ${tag}, ${n}) %`);
  });

  it('경험치·엽전·시아코인 식', () => {
    const body = fn('twelve_finish');
    expect(body).toContain('n_exp := floor(raw_exp * coalesce(pct, 100) / 100.0);');
    expect(body).toContain('n_coins := case when v_cleared then floor(raw_coin * (100 + rn.coin_pct) / 100.0) else 0 end;');
    expect(body).toContain("normals + v_elites < ceil(mp.total * public._twelve_const('exit_pct') / 100.0)");
    expect(body).toContain("if v_time >= public._twelve_const('coin_min_time') and pr.level - mp.level < public._twelve_const('coin_level_gap') then");
    expect(body).toContain("got_coin := public._grant_sia_coin(me, 'twelve', p_run::text);");
  });

  it('판 시작은 대원을 _check_character 로 검사한다 (고양이는 071 의 것을 그대로 쓴다)', () => {
    expect(fn('_twelve_check_hero')).toContain("perform public._check_character(p_user, p_hero, 'twelve');");
    expect(fn('twelve_start')).toContain('perform public._twelve_check_hero(me, p_hero);');
    expect(fn('twelve_set_hero')).toContain('perform public._twelve_check_hero(me, p_hero);');
    expect(sql).not.toMatch(/create table[^;]*owned_characters/);
    expect(sql).not.toContain('function public.buy_character');
    expect(sql).not.toContain('function public._check_character');
  });

  it('고양이 조건 함수: _cat_progress_twelve(uuid) → {have, need}, 안에서만 부른다', () => {
    expect(sql).toContain('create or replace function public._cat_progress_twelve(p_user uuid) returns jsonb');
    expect(fn('_cat_progress_twelve')).toContain('security definer set search_path = public');
    expect(fn('_cat_progress_twelve')).toContain("'need', 1");
    expect(sql).toContain('revoke all on function public._cat_progress_twelve(uuid) from public, anon, authenticated;');
  });

  it('화면이 부르는 함수는 security definer + search_path + 로그인한 사람만', () => {
    const rpcs = [...new Set(sql.match(/create or replace function public\.twelve_\w+/g)!.map((s) => s.split('public.')[1]))];
    expect(rpcs.sort()).toEqual(['twelve_buy', 'twelve_claim', 'twelve_enhance', 'twelve_equip', 'twelve_finish', 'twelve_lock', 'twelve_scrap', 'twelve_sell', 'twelve_set_hero', 'twelve_start', 'twelve_state', 'twelve_tower_end', 'twelve_tower_floor', 'twelve_tower_start', 'twelve_unequip']);
    for (const name of rpcs) {
      expect(fn(name)).toContain('security definer set search_path = public');
      expect(fn(name)).toContain("raise exception 'need login'");
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon;\\ngrant execute on function public\\.${name}\\([^)]*\\) to authenticated;`));
    }
    // 안에서만 쓰는 함수는 모두 권한을 뺀다
    const inner = [...new Set(sql.match(/create or replace function public\._\w+/g)!.map((s) => s.split('public.')[1]))];
    for (const name of inner) expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
  });

  it('표는 RLS 를 켜고 직접 쓰지 못한다', () => {
    const tables = [...new Set(sql.match(/create table if not exists public\.(twelve_\w+)/g)!.map((s) => s.split('public.')[1]))];
    expect(tables.sort()).toEqual(['twelve_codex', 'twelve_items', 'twelve_keys', 'twelve_maps', 'twelve_pity', 'twelve_profiles', 'twelve_runs', 'twelve_tower', 'twelve_tower_runs']);
    for (const t of tables) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
      expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete|all)[^;]*on public\\.${t} `));
    }
  });

  it('게임 오픈 여부는 닫힌 채로 추가', () => expect(sql).toContain("('game_open:twelve', 'false'::jsonb)"));
});
