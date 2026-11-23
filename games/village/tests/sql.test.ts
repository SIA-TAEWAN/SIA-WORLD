import { readFileSync } from 'node:fs';
import { MONUMENTS, STAT_IDS } from '../src/data/monuments';
import { BUILDING, isMonument, isReward } from '../src/data/buildings';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONST, COST_MUL, GRID_MAX, HALL_AT, HALL_CAP, HALL_NEED, LAND_NEED, LAND_PRICE, LAND_SIZES, NAME_RE, LEVEL_EXP, MARKET_LIMIT, PRICES, RATE_MUL, START_RES, STORAGE_CAP, UPGRADE_EXP, UPGRADE_SEC, kstDay, pricePct } from '../src/data/balance';
import { BUILDINGS, RECIPES } from '../src/data/buildings';
import { COUNTED, GOALS } from '../src/data/goals';
import { AFF_BONUS, AFF_NEED, ASKS, CAT_BONUS, CAT_LAND_STAGE, CAT_PRICE, DRAGON_BONUS, RATE_WORKERS, REQ, RESIDENTS, TASKS, mix } from '../src/data/residents';

/**
 * 서버 SQL(supabase/migrations/047_village.sql + 뒤 마이그레이션)의 표·상수가 게임 데이터와 같은지 본다.
 * 자원·시간·경험치는 서버가 정하므로, 두 곳의 값이 어긋나면 화면에 보이는 값과 실제가 달라진다.
 * 뒤 마이그레이션이 같은 함수를 다시 정의하면 아래 목록에 그 파일을 더한다 (뒤 파일의 정의가 실제 값이다).
 */
export const FILES = ['047_village.sql', '049_village_buildings.sql', '050_village_coin.sql', '051_village_residents.sql', '052_village_ranking.sql', '053_village_monuments.sql', '054_village_tune.sql', '059_village_review.sql', '062_village_admin.sql', '063_village_admin_free.sql', '064_village_admin_visit.sql', '077_cat_village.sql'];
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
    // 주민 · 부탁의 기준 값은 data/residents.ts 의 REQ
    expect(found).toEqual({ ...CONST, req_slots: REQ.slots, req_wait_done: REQ.wait_done, req_wait_skip: REQ.wait_skip, shrine_pct: REQ.shrine_pct, dog_cap_sec: REQ.dog_cap_sec, sheep_range: REQ.sheep_range });
  });

  it('레벨별 표', () => {
    const found = Object.fromEntries([...body('_village_table').matchAll(/when '(\w+)' then array\[([^\]]*)\]/g)].map((m) => [m[1], m[2].split(',').map(Number)]));
    expect(found).toEqual({
      land_sizes: LAND_SIZES, level_exp: LEVEL_EXP, cost_mul: COST_MUL, upgrade_sec: UPGRADE_SEC, upgrade_exp: UPGRADE_EXP,
      rate_mul: RATE_MUL, hall_cap: HALL_CAP, storage_cap: STORAGE_CAP, hall_need: HALL_NEED, market_limit: MARKET_LIMIT,
      land_price: LAND_PRICE, land_need: LAND_NEED, aff_need: AFF_NEED, aff_bonus: AFF_BONUS, dragon_bonus: DRAGON_BONUS, cat_bonus: CAT_BONUS,
    });
    // 땅 값은 PRD 6장의 표 그대로
    expect(LAND_PRICE).toEqual([10, 20, 30, 50, 70, 100]);
    expect(LAND_SIZES.slice(1)).toEqual([10, 12, 14, 16, 18, 20]);
  });

  it('건물 · 장식물 · 길', () => {
    expect(rows('_village_types')).toEqual(
      BUILDINGS.map((d) => [d.id, d.kind, d.w, d.h, d.rice, d.wood, d.stone, d.coin, d.sia, d.upStone, d.buildSec, d.product ?? '', d.rate, d.buildExp, d.cap, d.points, d.unlock]),
    );
  });

  it('가공 · 장터 시세', () => {
    expect(rows('_village_recipes')).toEqual(RECIPES.map((r) => [r.type, r.in1, r.n1, r.in2, r.n2, r.out, r.sec, r.exp, r.base, r.per]));
    expect(rows('_village_prices')).toEqual(PRICES.map((p) => [p.res, p.base, p.idx]));
    // 업그레이드의 엽전 (054): rules.ts 의 upgradeCost 와 같은 식
    const up = body('village_upgrade');
    expect(up).toContain("cn := case when b.level >= public._village_const('coin_from') then (ty.rice + ty.wood)::bigint * m * public._village_const('up_coin_pct')::int / 1000 else 0 end;");
    expect(up).toContain('perform public._village_spend(me, ty.rice * m / 10, ty.wood * m / 10, st, cn);');
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

  it('주민 · 부탁 · 오늘의 할 일', () => {
    expect(rows('_village_residents')).toEqual(RESIDENTS.map((r, i) => [r.id, i + 1, r.level, r.work]));
    expect(rows('_village_asks')).toEqual(ASKS.map((a, i) => [i + 1, a.res, a.base, a.grow, a.from, a.worth]));
    expect(rows('_village_tasks')).toEqual(TASKS.map((t, i) => [i + 1, t.task, t.from, t.base, t.per]));
    // 정해진 수를 만드는 식
    expect(body('_village_mix')).toContain('(((p_seq * 7919 + p_k * 104729 + 12345) % 1000003 + 1000003) % 1000003)::int');
    expect(mix(3, 2)).toBe((3 * 7919 + 2 * 104729 + 12345) % 1000003);
    expect(mix(-5, 1)).toBeGreaterThanOrEqual(0);
    // 부탁을 정하는 식 (game/rules.ts 의 makeAsk)
    const st = body('_village_settle').replace(/\s+/g, ' ');
    expect(st).toContain('n := greatest(1, a.base::bigint * (2 + public._village_mix(seq, 3) % 4) * (20 + lv * a.grow) / 20);');
    expect(st).toContain('v := n * a.worth / 100;');
    // 077: 고양이가 있으면 엽전 · 경험치 + cp % (makeAsk 의 bonus)
    expect(st).toContain("cp := public._village_res_pct(p_user, 'cat');");
    expect(st).toContain("'coin', (v * 3 / 2 + 10) * (100 + cp) / 100, 'exp', (v * public._village_const('req_exp_pct')::int / 100 + 5 + lv * 2) * (100 + cp) / 100, 'aff', 2 + public._village_mix(seq, 4) % 3)");
    expect(st).toContain("'resident', ids[public._village_mix(seq, 1) % cardinality(ids) + 1]");
    expect(st).toContain('where z.pos = public._village_mix(seq, 2) % pool;');
    // 오늘의 할 일 (makeDaily)
    expect(st).toContain('start := public._village_mix(day, 5) % pool;');
    expect(st).toContain("jsonb_build_object('task', t.task, 'n', t.base + t.per * lv, 'coin', 20 + lv * 5, 'exp', need * public._village_const('daily_exp_pct')::int / 100 + 10)");
    expect(st).toContain("need := (public._village_table('level_exp'))[least(lv, 29)];");
    const dc = body('village_daily_claim').replace(/\s+/g, ' ');
    expect(dc).toContain("perform public._village_add(me, 'coin', 50 + p.level * 10);");
    expect(dc).toContain("perform public._village_add_exp(me, need * public._village_const('daily_exp_pct')::int * 2 / 100 + 20);");
    // 이사: 순서대로, 마을 레벨(고양이는 산 것)과 빈 집
    expect(st).toContain("continue when case when d.id = 'cat' then not cat else lv < d.level end;");
    expect(st).toContain('exit when houses <= cnt;');
    expect(st).toContain('cat := public._village_cat_owned(p_user);');
    // 생산량을 올리는 주민
    const rp = body('_village_rate_pct');
    expect(/unnest\(array\[([^\]]+)\]\) w/.exec(rp)![1].split(',').map((x) => x.trim().slice(1, -1))).toEqual([...RATE_WORKERS]);
    for (const f of ['village_assign', 'village_request_done']) expect(body(f)).toContain("in ('ox', 'tiger', 'monkey')");
    // 친밀도: 사당 · 선물
    const rd = body('village_request_done').replace(/\s+/g, ' ');
    expect(rd).toContain("add := add * (100 + public._village_const('shrine_pct')::int) / 100;");
    expect(rd).toContain('if lv1 >= 5 and not r.gifted then');
    expect(rd).toContain("values (me, 'gift_' || r.resident, 'stored', t)");
    // 보너스가 들어가는 식
    expect(body('_village_time_cut')).toContain("p_sec * (100 - public._village_res_pct(p_user, 'dragon')) / 100");
    expect(body('village_craft')).toContain("unit := (rc.sec * 10 / (public._village_table('rate_mul'))[b.level]) * 100 / (100 + pct);");
    expect(body('village_sell')).toContain("coins := p_n::bigint * pr.base * public._village_price_pct(day, pr.idx) * (100 + public._village_res_pct(me, 'pig')) / 1000000;");
    expect(body('_village_market_limit')).toContain("(public._village_table('market_limit'))[m.level]::bigint * (100 + public._village_res_pct(p_user, 'horse')) / 100");
    expect(body('_village_cap').replace(/\s+/g, ' ')).toContain("(public._village_table('storage_cap'))[b.level] * (100 + public._village_res_pct(p_user, 'rat')) / 100");
    expect(body('_village_collect')).toContain('have := u.units + u.units * coalesce(p_bonus, 0) / 100;');
  });

  it('고양이 (077): 13번째 주민 · 살 수 있는 조건 · 주민 집 한 채 더', () => {
    const cat = RESIDENTS[RESIDENTS.length - 1];
    expect([cat.id, cat.level, cat.work, cat.buy]).toEqual(['cat', 0, '', true]);
    expect(RESIDENTS.filter((r) => r.buy).map((r) => r.id)).toEqual(['cat']);
    // 조건: 땅 3단계 (071 의 _character_progress 가 부른다)
    const pg = body('_cat_progress_village').replace(/\s+/g, ' ');
    expect(pg).toContain(`'need', ${CAT_LAND_STAGE})`);
    expect(pg).toContain('select p.land_stage from public.village_profiles p where p.user_id = p_user');
    expect(LAND_SIZES[CAT_LAND_STAGE]).toBe(14);
    // 값 · 게임 id 는 071 과 같다
    const c71 = read('071_characters.sql');
    expect(c71).toContain(`when 'cat' then ${CAT_PRICE}`);
    expect(/function public\._character_games\(\)[\s\S]*?array\[([^\]]+)\]/.exec(c71)![1]).toContain("'village'");
    expect(body('_village_cat_owned')).toContain("game = 'village' and character_id = 'cat'");
    // 산 마을은 주민 집 한 채 더 · 화면에 산 것을 알린다 · 보너스 표
    expect(body('village_build').replace(/\s+/g, ' ')).toContain("+ case when p_type = 'house' and public._village_cat_owned(me) then 1 else 0 end;");
    expect(body('_village_state_json')).toContain("'catOwned', public._village_cat_owned(p_user),");
    expect(body('_village_res_pct')).toContain("case r.resident when 'dragon' then 'dragon_bonus' when 'cat' then 'cat_bonus' else 'aff_bonus' end");
    // 선물 장식물
    expect(BUILDING.gift_cat.points).toBe(BUILDING.gift_pig.points);
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
    expect(c).toContain('got := greatest(0, least(have, room));');
    expect(c).toContain('least(p_now, u.frm + make_interval(secs => ((u.base * 3600 + u.rate - 1) / u.rate)::double precision))');
    // 쌓인 양: 보너스를 넣은 생산량, 잔치와 겹친 시간, 상한
    const n = body('_village_units').replace(/\s+/g, ' ');
    expect(n).toContain("rate := (ty.rate * (public._village_table('rate_mul'))[b.level] / 10)::bigint * (100 + public._village_rate_pct(p_user, p_id)) / 100;");
    // 059: 쌓기 시작한 시각(옮기기 · 배치로 적어 두어도 그대로)부터 최대 시간까지만 쌓인다
    expect(n).toContain('st := public._village_acc_start(b.banked, b.acc_from, b.last_collected_at);');
    expect(n).toContain('fin := least(p_now, st + make_interval(secs => cap));');
    expect(n).toContain('base := greatest(0, floor(extract(epoch from (fin - b.last_collected_at)))::bigint) * rate / 3600;');
    expect(n).toContain('greatest(0, floor(extract(epoch from (least(fin, p.feast_until) - greatest(b.last_collected_at, p.feast_from))))::bigint)');
    expect(n).toContain('frm := b.last_collected_at + (p_now - fin);');
    expect(body('_village_acc_start')).toContain('case when p_banked > 0 then coalesce(p_acc, p_last) else p_last end');
    const bk = body('_village_bank').replace(/\s+/g, ' ');
    expect(bk).toContain('banked = u.units, acc_from = public._village_acc_start(b.banked, b.acc_from, b.last_collected_at),');
    expect(bk).toContain('least(p_now, u.frm + make_interval(secs => ((u.base * 3600 + u.rate - 1) / u.rate)::double precision))');
    expect(c).toContain('set banked = 0, acc_from = null,');
    expect(n).toContain('extra := over * rate * p.feast_pct / 360000;');
    expect(n).toContain("units := least(b.banked + base + extra, cap::bigint * rate * (100 + public._village_const('bonus_room_pct')::int) / 360000);");
    expect(body('_village_rate_pct').replace(/\s+/g, ' ')).toContain("public._village_const('pavilion_pct')::int + public._village_const('pavilion_pct_per')::int * (pv.level - 1)");
    // 용량 제한을 받는 자원
    expect(c).toContain("room := case when product in ('rice', 'wood', 'stone', 'cake') then p_cap - cur else have end;");
    const u = body('village_upgrade').replace(/\s+/g, ' ');
    expect(u).toContain("sec := public._village_time_cut(me, (public._village_table('upgrade_sec'))[b.level] * case when b.type = 'hall' then public._village_const('hall_sec_mul')::int else 1 end);");
    expect(u).toContain('ty.rice * m / 10');
    expect(u).toContain("st := case when b.level >= public._village_const('stone_from') then ty.up_stone * m / 10 else 0 end;");
    expect(u).toContain("if lv < (public._village_table('hall_need'))[b.level] then raise exception 'village level'; end if;");
    expect(u).toContain("elsif b.level >= public._village_hall_level(me) then raise exception 'hall level';");
    // 수확 경험치는 창고에 들어간 양이 아니라 쌓여 있던 양으로 준다 (+ 가공 경험치)
    const h = body('village_harvest');
    expect(h).toContain('total := total + c.have;');
    expect(h).toContain("e := total / public._village_const('harvest_exp_div')::int + jexp;");
  });
});

describe('SQL의 권한 규칙', () => {
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).filter((f, i, a) => a.indexOf(f) === i);
  /** 화면이 부르는 함수 (전부) */
  const OPEN = [
    'village_admin_set_state', 'village_assign', 'village_build', 'village_claim_goal', 'village_craft', 'village_daily_claim', 'village_expand', 'village_feast', 'village_harvest', 'village_monuments', 'village_move', 'village_place',
    'village_praise', 'village_rename', 'village_request_done', 'village_request_skip', 'village_sell', 'village_state', 'village_store', 'village_upgrade', 'village_visit',
  ];

  /** 읽기만 하는 함수 (구경 · 기념물 조건 보기) */
  const READ_ONLY = ['village_visit'];

  it('안에서만 쓰는 함수(_로 시작)는 아무에게도 실행 권한을 주지 않는다', () => {
    const inner = fns.filter((f) => f.startsWith('_'));
    expect(inner.length).toBeGreaterThan(10);
    expect(inner).toContain('_spend_sia_coin');
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
      // 읽기만 하는 함수는 잠그지 않는다
      if (READ_ONLY.includes(f)) {
        expect(b, f).not.toMatch(/\b(insert|update|delete)\b/);
        continue;
      }
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
    for (const f of ['_village_types()', '_village_goals()']) {
      expect(sql).toContain(`drop function if exists public.${f};`);
      const at = sql.lastIndexOf(`drop function if exists public.${f};`);
      expect(sql.slice(at)).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
    }
    // _village_collect 는 인자가 하나 늘었다 (051: 닭의 보너스): 옛 것을 지우고 새 것에 권한을 건다
    const at = sql.lastIndexOf('drop function if exists public._village_collect(uuid, uuid, timestamptz, bigint);');
    expect(at).toBeGreaterThan(0);
    expect(sql.slice(at)).toContain('revoke all on function public._village_collect(uuid, uuid, timestamptz, bigint, int) from public, anon, authenticated;');
    // 그 뒤로 옛 모양(인자 넷)으로 부르는 곳이 남아 있지 않다
    expect(sql.slice(at + 80)).not.toMatch(/_village_collect\(me, [^)]*, public\._village_cap\(me\)\);/);
  });

  it('표는 RLS를 켜고 직접 쓰는 권한이 없다', () => {
    for (const t of ['village_profiles', 'village_buildings', 'sia_coin_spends', 'village_residents', 'village_requests', 'village_praises', 'village_monuments']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
      expect(sql).toContain(`grant select on public.${t} to authenticated;`);
      expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete|all)[^;]* on public\\.${t} `));
    }
  });

  it('시아코인: 쓰는 함수는 지갑 줄을 잠그고, 받는 기록 표와 섞지 않는다. 잠금 순서는 마을 → 지갑', () => {
    const sp = body('_spend_sia_coin').replace(/\s+/g, ' ');
    expect(sp).toContain('select sia_coins into bal from public.wallets where user_id = p_user for update;');
    expect(sp).toContain("if bal is null or bal < p_amount then raise exception 'not enough coin'; end if;");
    expect(sp).toContain('insert into public.sia_coin_spends');
    expect(sp).not.toContain('sia_coin_logs');
    // 시아코인을 쓰는 함수는 마을 줄을 잠근 뒤에 부른다
    for (const f of ['village_build', 'village_expand']) {
      const b = body(f);
      expect(b.indexOf('perform public._village_profile_row(me);')).toBeLessThan(b.indexOf('public._spend_sia_coin('));
      expect(b.indexOf('public._spend_sia_coin(')).toBeGreaterThan(0);
    }
    // 이 게임 안에서는 시아코인을 주지 않는다 (PRD 4장)
    expect(sql).not.toContain('_grant_sia_coin(');
  });

  it('번영도 · 랭킹 · 구경 (052)', () => {
    const pr = body('_village_prosperity').replace(/\s+/g, ' ');
    expect(pr).toContain("sum(case when t.kind in ('main', 'special') then b.level else 0 end + t.points)");
    expect(pr).toContain("b.state not in ('building', 'stored')");
    expect(pr).toContain("* public._village_const('aff_points')::int");
    expect(pr).toContain("* public._village_const('praise_points')::int");
    // 답을 보내기 직전에 다시 센다. 값이 바뀔 때만 달성 시각을 고친다
    expect(body('_village_state_json')).toContain('perform public._village_refresh(p_user, p_now);');
    expect(body('_village_refresh')).toContain('where user_id = p_user and prosperity <> v;');
    // 랭킹 뷰: 번영도 → 먼저 달성. 다른 랭킹 뷰와 같은 모양 · 같은 권한
    const at = sql.lastIndexOf('create or replace view public.village_ranking as');
    expect(at).toBeGreaterThan(0);
    const view = sql.slice(at, sql.indexOf('-- ---------- 5.', at)).replace(/\s+/g, ' ');
    expect(view).toContain('order by v.prosperity desc, v.prosperity_at asc, v.user_id');
    expect(view).toContain('(count(*) over ())::int as total');
    expect(view).toContain('revoke all on public.village_ranking from anon, authenticated;');
    expect(view).toContain('grant select on public.village_ranking to anon, authenticated;');
    for (const col of ['user_id', 'nickname', 'village_name', 'level', 'prosperity', 'achieved_at', 'place', 'total']) expect(view).toMatch(new RegExp(`[ .]${col}[, ]`));
    // 구경: 자원 · 시아코인 · 부탁은 보내지 않는다
    const vj = body('_village_visit_json');
    for (const no of ['resources', 'sia_coins', 'village_requests', 'goal', 'market_', 'exp']) expect(vj, no).not.toContain(no);
    // 칭찬: 두 마을 줄은 user_id 가 작은 쪽부터 잠근다. 이름: 화면과 같은 식
    const p = body('village_praise');
    expect(p.indexOf('if p_user is not null and p_user < me then perform 1 from public.village_profiles where user_id = p_user for update; end if;')).toBeLessThan(p.indexOf('perform public._village_profile_row(me);'));
    expect(p.indexOf('if p_user is not null and p_user < me')).toBeGreaterThan(0);
    expect(body('village_rename')).toContain(`p_name !~ '${NAME_RE.source}'`);
    expect(sql).toContain('check (from_user_id <> to_user_id)');
  });

  it('관리자 계정은 게임에 들어올 때만 엽전 · 시아코인이 10,000 (052 · 059: p_entry 일 때만)', () => {
    const b = body('village_state');
    expect(sql).toContain('drop function if exists public.village_state();');
    expect(b).toContain('create or replace function public.village_state(p_entry boolean default false) returns jsonb');
    expect(b).toContain('if coalesce(p_entry, false) and exists (select 1 from public.profiles where id = me and is_admin) then');
    expect(b).toContain("resources = jsonb_set(resources, '{coin}', '10000'::jsonb)");
    expect(b).toContain('update public.wallets set sia_coins = 10000 where user_id = me;');
    // 다른 함수는 profiles.is_admin 을 직접 보지 않는다 (062: 관리자인지는 _village_admin 하나로 본다)
    for (const f of fns.filter((x) => x !== 'village_state' && x !== '_village_admin')) expect(body(f), f).not.toContain('is_admin');
    expect(body('_village_admin')).toContain('select coalesce((select p.is_admin from public.profiles p where p.id = p_user), false)');
  });

  it('관리자 계정 (062): 최고 레벨 · 짓기 · 사기 제한 없음 · 값을 내지 않음 · 전시 마을', () => {
    // 관리자를 보는 함수는 정해져 있다
    const uses = fns.filter((f) => f !== '_village_admin' && body(f).includes('public._village_admin(')).sort();
    expect(uses).toEqual([
      '_village_state_json', 'village_admin_set_state', 'village_build', 'village_craft', 'village_expand', 'village_feast', 'village_request_done', 'village_sell', 'village_state', 'village_upgrade',
    ]);
    // 063: 가공 · 판매 · 잔치 · 부탁도 관리자는 내지 않는다 (받는 것은 그대로)
    const cr = body('village_craft').replace(/\s+/g, ' ');
    expect(cr).toContain("if not adm then if public._village_res(me, rc.in1) < rc.n1 * p_n");
    expect(cr).toContain('perform public._village_add(me, rc.in1, -rc.n1 * p_n);');
    const se = body('village_sell').replace(/\s+/g, ' ');
    expect(se).toContain("if not adm and sold + coins > public._village_market_limit(me) then raise exception 'sell limit'; end if;");
    expect(se).toContain('if not adm then perform public._village_add(me, p_res, -p_n); end if;');
    expect(se).toContain("perform public._village_add(me, 'coin', coins);");
    const fe = body('village_feast').replace(/\s+/g, ' ');
    expect(fe).toContain("if not adm then perform public._village_add(me, 'cake', -public._village_const('feast_cake')::bigint); end if;");
    const rq = body('village_request_done').replace(/\s+/g, ' ');
    expect(rq).toContain("if not adm then if public._village_res(me, res) < n then raise exception 'not enough'; end if; perform public._village_add(me, res, -n); end if;");
    expect(rq).toContain("perform public._village_add(me, 'coin', (q.content->>'coin')::bigint);");
    // 랭킹에는 관리자 계정이 나오지 않는다 (순위 번호도 차지하지 않는다)
    const at = sql.lastIndexOf('create or replace view public.village_ranking as');
    expect(sql.slice(at, sql.indexOf(';', at)).replace(/\s+/g, ' ')).toContain('where not coalesce(p.is_admin, false)');
    // 관리자 마을은 따로 구경 갈 수 있게 목록만 내준다 (로그인한 사람만 읽는다)
    const av = sql.slice(sql.lastIndexOf('create or replace view public.village_admin_villages as'));
    expect(av.slice(0, av.indexOf(';')).replace(/\s+/g, ' ')).toContain('where coalesce(p.is_admin, false)');
    expect(av).toContain('grant select on public.village_admin_villages to authenticated;');
    expect(body('_village_state_json')).toContain("'admin', public._village_admin(p_user),");
    const st = body('village_state').replace(/\s+/g, ' ');
    expect(st).toContain("if public._village_admin(me) then update public.village_profiles set level = public._village_const('max_level')::int, exp = 0, land_stage = 6");
    const b = body('village_build').replace(/\s+/g, ' ');
    expect(b).toContain("if (not adm or p_type = 'hall') and cnt >= mx then raise exception");
    expect(b).toContain("if not adm and ty.build_sec > 0 and not public._village_slot_free(me) then raise exception 'no slot'; end if;");
    expect(b).toContain('if not adm then perform public._village_spend(me, ty.rice, ty.wood, ty.stone, ty.coin);');
    const u = body('village_upgrade').replace(/\s+/g, ' ');
    expect(u).toContain("if adm then null; elsif b.type = 'hall' then");
    expect(u).toContain("if not adm and not public._village_slot_free(me) then raise exception 'no slot'; end if;");
    expect(u).toContain('if not adm then perform public._village_spend(me, ty.rice * m / 10, ty.wood * m / 10, st, cn); end if;');
    const ex = body('village_expand').replace(/\s+/g, ' ');
    expect(ex).toContain("if not adm then if p.level < (public._village_table('land_need'))[p.land_stage + 1] then raise exception 'village level'; end if; perform public._spend_sia_coin(");
    const ss = body('village_admin_set_state');
    expect(ss.indexOf("if not public._village_admin(me) then raise exception 'not admin'; end if;")).toBeLessThan(ss.indexOf('perform public._village_profile_row(me);'));
    expect(ss).toContain('why := public._village_place_error(me, ty.type, bx, by_, null);');
  });

  it('기념물 (053): 조건 표 · 다른 게임의 기록은 읽기만', () => {
    expect(rows('_village_monument_defs')).toEqual(MONUMENTS.map((m, i) => [m.id, i + 1, m.stat, m.need]));
    // 기념물은 지을 수 없는 장식물이고 (열리는 레벨 99), 번영도 점수가 장식물보다 높다
    const best = Math.max(...BUILDINGS.filter((d) => d.kind === 'deco' && !isReward(d.id)).map((d) => d.points));
    for (const m of MONUMENTS) {
      const d = BUILDING[m.id];
      expect([d.kind, d.unlock, d.coin, d.sia], m.id).toEqual(['deco', [99], 0, 0]);
      expect(d.points, m.id).toBeGreaterThan(best);
    }
    expect(MONUMENTS.map((m) => m.id)).toEqual(BUILDINGS.filter((d) => isMonument(d.id)).map((d) => d.id));
    const st = body('_village_game_stats');
    for (const k of STAT_IDS) expect(st, k).toContain(`'${k}'`);
    // 다른 게임의 표는 읽기만 한다. 디펜스 표는 없을 수도 있다
    expect(st).not.toMatch(/\b(insert|update|delete)\b/);
    expect(st).toContain("if to_regclass('public.defense_stages') is not null then");
    // 059: 다른 게임의 표 · 함수가 하나 없어도 나머지는 읽는다 (그 기록만 0)
    for (const t of ['player_points', 'volleyball_rankings', 'race_records', 'survival_profiles', 'wallet_logs', 'roulette_bets']) {
      const at = st.indexOf(`public.${t}`);
      expect(at, t).toBeGreaterThan(0);
      expect(st.slice(at, st.indexOf('end;', at)), t).toContain('exception when undefined_table');
      expect(st.lastIndexOf('begin', at), t).toBeGreaterThan(st.lastIndexOf('end;', at));
    }
    expect(st).toContain("if to_regprocedure('public._survival_map_cleared(uuid, text, text[])') is not null then");
    for (const f of fns) if (f !== '_village_game_stats') expect(body(f), f).not.toMatch(/player_points|volleyball_rankings|race_records|survival_|wallet_logs|roulette_bets|defense_/);
    // 여는 곳: 들어올 때와 [기념물] 화면
    const sync = 'perform public._village_monument_sync(me, t);';
    expect(fns.filter((f) => body(f).includes(sync)).sort()).toEqual(['village_monuments', 'village_state']);
    const sy = body('_village_monument_sync').replace(/\s+/g, ' ');
    expect(sy).toContain("insert into public.village_buildings (user_id, type, state, last_collected_at) values (p_user, d.monument, 'stored', p_now);");
    expect(sy).toContain('coalesce((st ->> x.stat)::int, 0) >= x.need');
    expect(body('_village_state_json')).toContain("'monuments', coalesce((");
  });

  it('닫힌 상태로 시작한다', () => {
    expect(sql).toContain("insert into public.app_settings (key, value) values ('game_open:village', 'false'::jsonb) on conflict (key) do nothing;");
  });
});
