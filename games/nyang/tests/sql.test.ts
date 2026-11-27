import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BEHAVIORS, BLOCKED, CAT_NEED, CONST, EXCHANGES, FOODS, FURNITURE, LOVE_NEED, PERSONALITIES, PLANTS, POT_PRICES, SELL, SHOP, SQL_IDS, STYLES, TREAT, kstDay, mix } from '../src/data/balance';

/**
 * 서버 SQL(supabase/migrations/123_nyang.sql)의 값 · 표가 게임 데이터(src/data/balance.ts)와 같은지 본다.
 * 상태 계산은 서버가 정하므로, 두 곳의 값이 어긋나면 화면에 보이는 값과 실제가 달라진다.
 * 뒤 마이그레이션이 같은 함수를 다시 정의하면 아래 목록에 그 파일을 더한다 (뒤 파일의 정의가 실제 값이다).
 */
export const FILES = ['123_nyang.sql'];
const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const sql = FILES.map(read).join('\n');

/** 함수 하나의 (마지막) 본문 */
function body(name: string): string {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`);
  expect(at, name).toBeGreaterThan(0);
  return sql.slice(at, sql.indexOf('$$;', at));
}
const value = (c: string): unknown => {
  const t = c.trim();
  return t.startsWith("'") ? t.slice(1, -1) : Number(t);
};
/** values 줄: ('a', 1, 'b,c') → ['a', 1, 'b,c'] */
const rows = (name: string) => [...body(name).matchAll(/^\s*\((.+)\),?\s*$/gm)].map((m) => (m[1].match(/\s*'[^']*'|[^,]+/g) ?? []).map(value));

describe('SQL의 값 · 표가 게임 데이터와 같다', () => {
  it('기준 값', () => {
    const found = Object.fromEntries([...body('_nyang_const').matchAll(/when '(\w+)' then (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(found).toEqual({ ...CONST });
  });

  it('표 · 목록', () => {
    const tables = Object.fromEntries([...body('_nyang_table').matchAll(/when '(\w+)' then array\[([^\]]*)\]/g)].map((m) => [m[1], m[2].split(',').map(Number)]));
    expect(tables).toEqual({ love_need: LOVE_NEED, cat_need: CAT_NEED, pot_prices: POT_PRICES });
    expect(POT_PRICES.length).toBe(CONST.pot_max - CONST.pot_start);
    const ids = Object.fromEntries([...body('_nyang_ids').matchAll(/when '(\w+)' then array\[([^\]]*)\]/g)].map((m) => [m[1], m[2].split(',').map((s) => s.trim().slice(1, -1))]));
    expect(ids).toEqual(Object.fromEntries(Object.entries(SQL_IDS).map(([k, v]) => [k, [...v]])));
  });

  it('성격 5종 · 사료', () => {
    expect(rows('_nyang_personalities')).toEqual(PERSONALITIES.map((p) => [p.id, p.full_sec, p.water_sec, p.poop_sec, p.mood_sec, p.likes.join(','), p.dislikes.join(','), p.toy, p.churu]));
    expect(rows('_nyang_foods')).toEqual(FOODS.map((f) => [f.id, f.add, f.mood, f.pack, f.price]));
  });

  it('4단계: 식물 · 상점 · 팔기 · 바꾸기 · 풀', () => {
    expect(rows('_nyang_plants')).toEqual(PLANTS.map((p) => [p.id, p.grow_sec, p.water_sec, p.level, p.seed, p.sell]));
    expect(rows('_nyang_shop')).toEqual(SHOP.map((i) => [i.id, i.tab, i.price, i.sia, i.give, i.once, i.level]));
    expect(rows('_nyang_sell')).toEqual(Object.entries(SELL));
    expect(rows('_nyang_exchanges')).toEqual(EXCHANGES.map((e) => [e.id, e.need, e.n]));
    expect(rows('_nyang_treats')).toEqual(Object.entries(TREAT).map(([id, v]) => [id, v.mood, v.love]));
    // 시아코인으로 사는 것은 지갑에서 한 번에 (_spend_sia_coin, 기록 번호 buy:<n>)
    expect(body('nyang_buy')).toContain("public._spend_sia_coin(me, it.sia * p_n, 'nyang', 'buy:' || (pr.buy_seq + 1))");
    // 츄르는 시아코인 5개 (PRD)
    for (const i of SHOP.filter((x) => x.tab === 'churu')) expect([i.price, i.sia]).toEqual([0, 5]);
    // 기본 사료는 공짜 (엽전 0 이어도 밥은 준다)
    expect(FOODS[0]).toMatchObject({ id: 'basic', price: 0 });
    expect(body('_nyang_pot_grown')).toContain('least(pl.grow_sec, p.grown + case when p.water_at is null then 0 else greatest(0, least(p_t - p.water_at, pl.water_sec::bigint))::int end)');
  });

  it('5단계: 가구 · 벽지 · 바닥 · 창문 · 막힌 칸 · 앨범', () => {
    expect(rows('_nyang_furniture')).toEqual(FURNITURE.map((f) => [f.id, f.kind, f.w, f.h]));
    expect(rows('_nyang_styles')).toEqual(STYLES.map((x) => [x.id, x.kind, x.price]));
    // 막힌 칸은 격자 안 (가구를 놓을 자리가 남는다)
    for (const c of BLOCKED) {
      const m = /^([fw])(\d+)_(\d+)$/.exec(c)!;
      expect(m, c).toBeTruthy();
      const [cols, rows] = m[1] === 'f' ? [CONST.grid_cols, CONST.grid_rows] : [CONST.wall_cols, CONST.wall_rows];
      expect(Number(m[2]) < cols && Number(m[3]) < rows, c).toBe(true);
    }
    const pl = body('nyang_place');
    expect(pl).toContain("raise exception 'not owned'");
    expect(pl).toContain('px + f.w > ncols or py + f.h > nrows');
    expect(body('nyang_photo')).toContain("public._nyang_const('album_max')");
    expect(sql).toContain('primary key (user_id, id)');
  });

  it('행동 도감', () => {
    expect(rows('_nyang_behaviors')).toEqual(BEHAVIORS.map((b) => [b.id, b.level]));
  });

  it('3단계 계산 (놀아 주기 상한 · 빗질 털 뭉치 · 선물)이 rules.ts 와 같은 모양', () => {
    const pl = body('nyang_play');
    expect(pl).toContain("least(coalesce(p_catches, 0), public._nyang_const('play_catch_max'), ((t - c.play_at) / public._nyang_const('play_catch_sec'))::int)");
    expect(pl).toContain("public._nyang_const('play_love_day') - c.play_love");
    expect(body('nyang_brush')).toContain("public._nyang_const('fur_min') + public._nyang_mix(day * 4 + c.slot, 5) % public._nyang_const('fur_span')");
    const rp = body('_nyang_roll_present');
    expect(rp).toContain("public._nyang_const('present_pct') + lv * public._nyang_const('present_pct_level')");
    expect(rp).toContain("public._nyang_const('present_coin_min') + lv * 2 + public._nyang_mix(q, 3) % public._nyang_const('present_coin_span')");
    expect(body('nyang_state')).toContain('public._nyang_roll_present(me, c, t)');
    // 첫 고양이를 들이면 츄르
    expect(body('nyang_adopt')).toContain("public._nyang_const('start_churu')");
  });

  it('계산 식이 rules.ts 와 같은 모양', () => {
    // 한국 날짜 · 정해진 수
    expect(body('_nyang_day')).toContain('floor((p_t - 1767193200)::numeric / 86400)::int');
    expect(kstDay(1767193200)).toBe(0);
    expect(kstDay(1767193199)).toBe(-1);
    expect(body('_nyang_mix')).toContain('(((p_seq * 7919 + p_k * 104729 + 12345) % 1000003 + 1000003) % 1000003)::int');
    expect(mix(3, 2)).toBe((3 * 7919 + 2 * 104729 + 12345) % 1000003);
    // 일정하게 줄어드는 값 · 절반 · 바닥 (rules.ts 의 lin · linHalfAt · linZeroAt). 10000 · 5000 은 max · half
    expect(CONST.max).toBe(10000);
    expect(CONST.half).toBe(5000);
    expect(CONST.poop_max).toBe(4);
    expect(body('_nyang_lin')).toContain('greatest(0, p_amount - (greatest(0, p_t - p_at) * 10000 / p_dur))');
    expect(body('_nyang_half_at')).toContain('case when p_amount >= 5000 then p_at + ((p_amount - 5000 + 1)::bigint * p_dur + 10000 - 1) / 10000 else p_at end');
    expect(body('_nyang_zero_at')).toContain('p_at + (p_amount::bigint * p_dur + 10000 - 1) / 10000');
    const st = body('_nyang_settle');
    expect(st).toContain('case when c.poop_base <= 2 then c.poop_at + (3 - c.poop_base)::bigint * p.poop_sec else c.poop_at end');
    expect(st).toContain('c.poop_at + greatest(0, 4 - c.poop_base)::bigint * p.poop_sec');
    expect(st).toContain("c.sick_at := greatest(fl + public._nyang_const('sick_sec'), v_from);");
    // 이름 규칙
    expect(body('nyang_adopt')).toContain("nm !~ '^[가-힣a-zA-Z0-9]+( [가-힣a-zA-Z0-9]+)*$'");
    // 시아코인: 게임 id 'nyang'
    expect(body('_nyang_pay')).toContain("public._grant_sia_coin(p_user, 'nyang', 'care:' || (pr.sia_paid + 1))");
  });

  it('보안: 화면이 부르는 함수만 authenticated 에 열고, 나머지는 막는다', () => {
    const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)/g)].map((m) => m[1]);
    const pub = fns.filter((f) => f.startsWith('nyang_'));
    expect(pub.sort()).toEqual([
      'nyang_adopt', 'nyang_brush', 'nyang_buy', 'nyang_churu', 'nyang_clean', 'nyang_cure', 'nyang_exchange', 'nyang_expand_pots', 'nyang_feed', 'nyang_gift',
      'nyang_harvest', 'nyang_pet', 'nyang_plant', 'nyang_play', 'nyang_play_start', 'nyang_seen', 'nyang_sell', 'nyang_state', 'nyang_treat', 'nyang_water',
      'nyang_water_pot', 'nyang_place', 'nyang_vase', 'nyang_photo', 'nyang_photo_delete',
    ].sort());
    for (const f of fns) {
      expect(sql, f).toMatch(new RegExp(`revoke all on function public\\.${f}\\(`));
      if (pub.includes(f)) {
        expect(sql, f).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to authenticated;`));
        expect(body(f), f).toContain('security definer set search_path = public');
      } else expect(sql, f).not.toMatch(new RegExp(`grant execute on function public\\.${f}\\(`));
    }
    for (const t of ['nyang_profiles', 'nyang_cats', 'nyang_pots', 'nyang_album']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
    // 서버 시각만 쓴다
    expect(body('_nyang_now')).toContain('extract(epoch from now())');
    for (const f of pub) expect(body(f), f).toContain('public._nyang_now()');
    // 집사 랭킹: 친밀도 합 → 돌본 날 → 먼저 달성한 순, 관리자 · 친밀도 0 은 빼고, 읽기만
    const view = sql.slice(sql.lastIndexOf('create or replace view public.nyang_ranking'), sql.indexOf('grant select on public.nyang_ranking'));
    expect(view).toContain('order by r.love desc, r.care_days desc, r.achieved_at asc nulls last, r.user_id');
    expect(view).toContain('where r.love > 0 and not coalesce(p.is_admin, false)');
    expect(sql).toContain('revoke all on public.nyang_ranking from anon, authenticated;\ngrant select on public.nyang_ranking to anon, authenticated;');
    // love_at(먼저 달성한 순)은 친밀도가 오를 때만 바뀐다
    expect(body('_nyang_save')).toContain('love_at = case when c.love > nyang_cats.love then public._nyang_now() else nyang_cats.love_at end');
    // 처음에는 닫힘
    expect(sql).toContain("insert into public.app_settings (key, value) values ('game_open:nyang', 'false'::jsonb) on conflict (key) do nothing;");
  });
});

describe('SIA WORLD 연결', () => {
  const shared = (f: string) => readFileSync(new URL(`../../../shared/${f}`, import.meta.url), 'utf8');
  it('games.js · presence.js · ranking-dialog.js · deploy.yml · 배경음 폴더에 nyang', () => {
    expect(shared('games.js')).toMatch(/id: 'nyang'[\s\S]*?path: 'games\/nyang\/', image: 'shared\/images\/card-nyang.png', open: false/);
    expect(shared('presence.js')).toContain("nyang: ['nyang-lobby']");
    expect(readFileSync(new URL('../src/net/world.ts', import.meta.url), 'utf8')).toContain("enterGame('nyang-lobby', user)");
    expect(shared('ranking-dialog.js')).toMatch(/TAB_ORDER = \[[^\]]*'nyang'/);
    expect(shared('ranking-dialog.js')).toContain("supabase.from('nyang_ranking')");
    expect(shared('audio/bgm/README.md')).toMatch(/\| nyang \| 시아집사 \|[^\n]*instrumental[^\n]*instrumental \|/);
    const deploy = readFileSync(new URL('../../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
    expect(deploy).toContain('working-directory: games/nyang');
    expect(deploy).toContain('games/nyang/package-lock.json');
    expect(deploy).toContain('_site/games/nyang');
    expect(deploy).toContain('cp -r games/nyang/dist/. _site/games/nyang/');
  });
  it('index.html PWA head 블록', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<link rel="manifest" href="../../manifest.webmanifest" vite-ignore />');
    expect(html).toContain('<link rel="apple-touch-icon" href="../../shared/images/app/apple-touch-icon.png" vite-ignore />');
    expect(html).toContain('<script type="module" src="../../shared/pwa.js" vite-ignore></script>');
  });
});
