import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BEHAVIORS, CAT_NEED, CONST, FOODS, LOVE_NEED, PERSONALITIES, SQL_IDS, kstDay, mix } from '../src/data/balance';

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
    expect(tables).toEqual({ love_need: LOVE_NEED, cat_need: CAT_NEED });
    const ids = Object.fromEntries([...body('_nyang_ids').matchAll(/when '(\w+)' then array\[([^\]]*)\]/g)].map((m) => [m[1], m[2].split(',').map((s) => s.trim().slice(1, -1))]));
    expect(ids).toEqual(Object.fromEntries(Object.entries(SQL_IDS).map(([k, v]) => [k, [...v]])));
  });

  it('성격 5종 · 사료', () => {
    expect(rows('_nyang_personalities')).toEqual(PERSONALITIES.map((p) => [p.id, p.full_sec, p.water_sec, p.poop_sec, p.mood_sec, p.likes.join(','), p.dislikes.join(','), p.toy, p.churu]));
    expect(rows('_nyang_foods')).toEqual(FOODS.map((f) => [f.id, f.add, f.price]));
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
      'nyang_adopt', 'nyang_brush', 'nyang_churu', 'nyang_clean', 'nyang_cure', 'nyang_feed', 'nyang_gift', 'nyang_pet', 'nyang_play', 'nyang_play_start',
      'nyang_seen', 'nyang_state', 'nyang_water',
    ]);
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
    // 처음에는 닫힘
    expect(sql).toContain("insert into public.app_settings (key, value) values ('game_open:nyang', 'false'::jsonb) on conflict (key) do nothing;");
  });
});
