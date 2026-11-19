import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONST, COST_MUL, GRID_MAX, HALL_AT, HALL_CAP, HALL_NEED, LAND_SIZES, LEVEL_EXP, MARKET_LIMIT, PRICES, RATE_MUL, START_RES, STORAGE_CAP, UPGRADE_EXP, UPGRADE_SEC, kstDay, pricePct } from '../src/data/balance';
import { BUILDINGS, RECIPES } from '../src/data/buildings';
import { COUNTED, GOALS } from '../src/data/goals';

/**
 * 서버 SQL(supabase/migrations/047_village.sql + 뒤 마이그레이션)의 표·상수가 게임 데이터와 같은지 본다.
 * 자원·시간·경험치는 서버가 정하므로, 두 곳의 값이 어긋나면 화면에 보이는 값과 실제가 달라진다.
 * 뒤 마이그레이션이 같은 함수를 다시 정의하면 아래 목록에 그 파일을 더한다 (뒤 파일의 정의가 실제 값이다).
 */
export const FILES = ['047_village.sql', '049_village_buildings.sql'];
const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const sql = FILES.map(read).join('\n');

/** 함수 하나의 (마지막) 본문 */
function body(name: string): string {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`);
  expect(at, name).toBeGreaterThan(0);
  return sql.slice(at, sql.indexOf('$$;', at));
}
/** 값 하나: 'a' → a, 12 → 12, array[1, 2] → [1, 2] */
const value = (c: string): unknown => {
  const t = c.trim();
  if (t.startsWith('array[')) return t.slice(6, -1).split(',').map((v) => Number(v));
  return t.startsWith("'") ? t.slice(1, -1) : Number(t);
};
/** values 줄: ('a', 1, array[1, 2]) → ['a', 1, [1, 2]] */
const rows = (name: string) =>
  [...body(name).matchAll(/^\s*\((.+)\),?\s*$/gm)].map((m) => (m[1].match(/\s*array\[[^\]]*\]|[^,]+/g) ?? []).map(value));

describe('SQL의 표가 게임 데이터와 같다', () => {
  it('기준 값', () => {
    const found = Object.fromEntries([...body('_village_const').matchAll(/when '(\w+)' then ([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(found).toEqual(CONST);
  });

  it('레벨별 표', () => {
    const found = Object.fromEntries([...body('_village_table').matchAll(/when '(\w+)' then array\[([^\]]*)\]/g)].map((m) => [m[1], m[2].split(',').map(Number)]));
    expect(found).toEqual({
      land_sizes: LAND_SIZES, level_exp: LEVEL_EXP, cost_mul: COST_MUL, upgrade_sec: UPGRADE_SEC, upgrade_exp: UPGRADE_EXP,
      rate_mul: RATE_MUL, hall_cap: HALL_CAP, storage_cap: STORAGE_CAP, hall_need: HALL_NEED, market_limit: MARKET_LIMIT,
    });
  });

  it('건물 · 장식물 · 길', () => {
    expect(rows('_village_types')).toEqual(
      BUILDINGS.map((d) => [d.id, d.kind, d.w, d.h, d.rice, d.wood, d.stone, d.coin, d.sia, d.upStone, d.buildSec, d.product ?? '', d.rate, d.buildExp, d.cap, d.points, d.unlock]),
    );
  });

  it('가공 · 장터 시세', () => {
    expect(rows('_village_recipes')).toEqual(RECIPES.map((r) => [r.type, r.in1, r.n1, r.in2, r.n2, r.out, r.sec, r.exp, r.base, r.per]));
    expect(rows('_village_prices')).toEqual(PRICES.map((p) => [p.res, p.base, p.idx]));
    // 시세 식: 80 + (날 × 7919 + 번호 × 104729 + 12345) mod 51
    expect(body('_village_price_pct').replace(/\s+/g, ' ')).toContain('(p_day::bigint * 7919 + p_idx * 104729 + 12345)');
    expect(pricePct(0, 1)).toBe(80 + ((104729 + 12345) % 51));
    for (let d = 300; d < 400; d++) for (const p of PRICES) expect(pricePct(d, p.idx)).toBeGreaterThanOrEqual(80), expect(pricePct(d, p.idx)).toBeLessThanOrEqual(130);
    // 서버 날짜: 한국 시간 2026-01-01 = 0
    expect(body('_village_kst_day')).toContain("((p_at at time zone 'Asia/Seoul')::date - date '2026-01-01')::int");
    expect(kstDay(Date.UTC(2025, 11, 31, 15, 0, 0))).toBe(0);
    expect(kstDay(Date.UTC(2025, 11, 31, 14, 59, 59))).toBe(-1);
    expect(kstDay(Date.UTC(2026, 10, 19, 15, 0, 0))).toBe(323);
  });

  it('마을 목표', () => {
    expect(rows('_village_goals')).toEqual(GOALS.map((g, i) => [i, g.kind, g.type, g.n, g.rice, g.wood, g.stone, g.coin, g.exp]));
    // 그 목표가 시작된 뒤부터 세는 종류
    const counted = /g\.kind in \(([^)]+)\)/.exec(body('_village_progress'))![1].split(',').map((s) => s.trim().slice(1, -1));
    expect(counted).toEqual([...COUNTED]);
  });

  it('새 마을: 자원 · 마을 회관 자리 · 땅 크기', () => {
    const { special, ...old } = START_RES;
    expect(special).toBe(0);
    expect(sql).toContain(`resources jsonb not null default '${JSON.stringify(old)}'::jsonb`);
    expect(body('_village_profile_row')).toContain(`values (p_user, 'hall', ${HALL_AT.x}, ${HALL_AT.y}, 'done')`);
    expect(body('_village_place_error')).toContain(`x0 := (${GRID_MAX} - size) / 2;`);
    expect(sql).toContain(`x int not null check (x between 0 and ${GRID_MAX - 1})`);
    expect(sql).toContain(`level int not null default 1 check (level between 1 and ${CONST.max_level})`);
    expect(sql).toContain(`level int not null default 1 check (level between 1 and ${CONST.building_max_level})`);
    expect(sql).toContain(`land_stage int not null default 0 check (land_stage between 0 and ${LAND_SIZES.length - 1})`);
  });

  it('계산식 (game/rules.ts 와 같은 식)', () => {
    const c = body('_village_collect').replace(/\s+/g, ' ');
    expect(c).toContain("rate := ty.rate * (public._village_table('rate_mul'))[b.level] / 10;");
    expect(c).toContain('have := greatest(0, floor(extract(epoch from (p_now - frm)))::bigint) * rate / 3600;');
    expect(c).toContain('got := greatest(0, least(have, room));');
    expect(c).toContain('least(p_now, frm + make_interval(secs => ((have * 3600 + rate - 1) / rate)::double precision))');
    // 용량 제한을 받는 자원
    expect(c).toContain("room := case when product in ('rice', 'wood', 'stone', 'cake') then p_cap - cur else have end;");
    const u = body('village_upgrade').replace(/\s+/g, ' ');
    expect(u).toContain('ty.rice * m / 10');
    expect(u).toContain("st := case when b.level >= public._village_const('stone_from') then ty.up_stone * m / 10 else 0 end;");
    expect(u).toContain("if lv < (public._village_table('hall_need'))[b.level] then raise exception 'village level'; end if;");
    expect(u).toContain("elsif b.level >= public._village_hall_level(me) then raise exception 'hall level';");
    // 수확 경험치는 창고에 들어간 양이 아니라 쌓여 있던 양으로 준다 (+ 가공 경험치)
    const h = body('village_harvest');
    expect(h).toContain('total := total + c.have;');
    expect(h).toContain("e := total / public._village_const('harvest_exp_div')::int + jexp;");
    expect(body('village_craft')).toContain("unit := rc.sec * 10 / (public._village_table('rate_mul'))[b.level];");
    expect(body('village_sell')).toContain('coins := p_n::bigint * pr.base * public._village_price_pct(day, pr.idx) / 10000;');
  });
});

describe('SQL의 권한 규칙', () => {
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).filter((f, i, a) => a.indexOf(f) === i);
  /** 화면이 부르는 함수 (전부) */
  const OPEN = ['village_build', 'village_claim_goal', 'village_craft', 'village_harvest', 'village_move', 'village_place', 'village_sell', 'village_state', 'village_store', 'village_upgrade'];

  it('안에서만 쓰는 함수(_로 시작)는 아무에게도 실행 권한을 주지 않는다', () => {
    const inner = fns.filter((f) => f.startsWith('_'));
    expect(inner.length).toBeGreaterThan(10);
    for (const f of inner) {
      expect(sql, f).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^;]*\\) from public, anon, authenticated;`));
      expect(sql, f).not.toMatch(new RegExp(`grant execute on function public\\.${f}\\(`));
    }
  });

  it('화면이 부르는 함수는 security definer + search_path 고정, 로그인한 사람에게만, 내 마을 줄을 먼저 잠근다', () => {
    const open = fns.filter((f) => !f.startsWith('_'));
    expect(open.sort()).toEqual(OPEN);
    for (const f of open) {
      const at = sql.lastIndexOf(`create or replace function public.${f}(`);
      expect(sql.slice(at, sql.indexOf('$$', at)), f).toContain('security definer set search_path = public');
      expect(sql, f).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^;]*\\) from public, anon;`));
      expect(sql, f).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^;]*\\) to authenticated;`));
      const b = body(f);
      expect(b, f).toContain("raise exception 'need login'");
      // 잠근 뒤의 시각으로, 끝난 짓기부터 마무리하고 계산한다
      const lock = b.indexOf('perform public._village_profile_row(me);');
      const clock = b.indexOf('t := clock_timestamp();');
      const settle = b.indexOf('perform public._village_settle(me, t);');
      expect(lock, f).toBeGreaterThan(0);
      expect(clock, f).toBeGreaterThan(lock);
      expect(settle, f).toBeGreaterThan(clock);
    }
    expect(body('_village_profile_row')).toContain('for update');
  });

  it('모양이 바뀐 함수는 지우고 다시 만든다 (그리고 권한을 다시 건다)', () => {
    for (const f of ['_village_types()', '_village_goals()', '_village_collect(uuid, uuid, timestamptz, bigint)']) {
      expect(sql).toContain(`drop function if exists public.${f};`);
      const at = sql.lastIndexOf(`drop function if exists public.${f};`);
      expect(sql.slice(at)).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
    }
  });

  it('표는 RLS를 켜고 직접 쓰는 권한이 없다', () => {
    for (const t of ['village_profiles', 'village_buildings']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
      expect(sql).toContain(`grant select on public.${t} to authenticated;`);
      expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete|all)[^;]* on public\\.${t} `));
    }
  });

  it('닫힌 상태로 시작한다', () => {
    expect(sql).toContain("insert into public.app_settings (key, value) values ('game_open:village', 'false'::jsonb) on conflict (key) do nothing;");
  });
});
