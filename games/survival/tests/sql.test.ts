import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ZODIAC_IDS } from '../src/data/balance';
import { BOSSES } from '../src/data/bosses';
import { CHARACTERS } from '../src/data/characters';
import { ENEMIES } from '../src/data/enemies';
import { MAPS } from '../src/data/maps';
import { PASSIVES } from '../src/data/passives';
import { UPGRADES, upgradeCost } from '../src/data/upgrades';
import { WEAPONS } from '../src/data/weapons';
import { LIMITS, characterPrice } from '../src/game/progress';

/**
 * 서버 SQL(supabase/migrations/038_survival.sql + 039 · 040 · 041)의 표·상수가 게임 데이터와 같은지 본다.
 * 엽전·강화·해금은 서버가 정하므로, 두 곳의 값이 어긋나면 화면에 보이는 값과 실제가 달라진다.
 */
const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), 'utf8');
// 뒤 파일이 같은 함수를 다시 정의하면 그쪽이 실제 값이다
const sql = ['038_survival.sql', '039_survival_hardening.sql', '040_survival_5min.sql', '041_survival_3min.sql'].map(read).join('\n');

/** 함수 하나의 본문 */
function body(name: string): string {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`);
  expect(at, name).toBeGreaterThan(0);
  return sql.slice(at, sql.indexOf('$$;', at));
}
/** values 줄: ('a', 1, 2) → ['a', 1, 2] */
const rows = (name: string) =>
  [...body(name).matchAll(/^\s*\(([^)]+)\),?\s*$/gm)].map((m) => m[1].split(',').map((c) => (c.trim().startsWith("'") ? c.trim().slice(1, -1) : Number(c))));

describe('SQL의 표가 게임 데이터와 같다', () => {
  it('영구 강화: 항목 · 최대 레벨 · 첫 비용 · 배수', () => {
    expect(rows('_survival_upgrades')).toEqual(UPGRADES.map((u) => [u.id, u.max, u.baseCost, u.growth]));
  });

  it('강화 비용 식: round(첫 비용 × 배수^레벨 / 5) × 5', () => {
    expect(body('_survival_upgrade_cost')).toContain('(round(p_base * power(p_growth, p_level) / 5) * 5)::bigint');
    expect(body('survival_buy_upgrade')).toContain('public._survival_upgrade_cost(u.base_cost, u.growth, lv)');
    expect(body('survival_reset_upgrades')).toContain('public._survival_upgrade_cost(x.base_cost, x.growth, g.n)');
    // 같은 식을 여기서 다시 계산해 게임 쪽 함수와 비교한다.
    // 서버는 십진수로 정확히, 게임은 부동소수로 계산하므로 반올림이 갈릴 수 있는 값(딱 절반 근처)이 없어야 한다.
    // 단 1.5배는 2의 거듭제곱 분수라 부동소수로도 정확하고, 딱 절반(67.5 등)은 두 쪽 모두 올림이다
    for (const u of UPGRADES) {
      for (let lv = 0; lv < u.max; lv++) {
        const exact = (u.baseCost * u.growth ** lv) / 5;
        if (u.growth !== 1.5) expect(Math.abs((exact % 1) - 0.5), `${u.id} ${lv}`).toBeGreaterThan(0.001);
        expect(upgradeCost(u.id, lv)).toBe(Math.round(exact) * 5);
      }
    }
    expect([0, 1, 2].map((lv) => upgradeCost('might', lv))).toEqual([100, 150, 225]);
  });

  it('엽전으로 푸는 캐릭터와 값', () => {
    expect(rows('_survival_character_prices')).toEqual(CHARACTERS.filter((c) => characterPrice(c.id) !== null).map((c) => [c.id, characterPrice(c.id)]));
  });

  it('맵: id · 엽전 배율 · 순서', () => {
    expect(rows('_survival_maps')).toEqual(MAPS.map((m, i) => [m.id, m.coinMul, i + 1]));
    const check = /map_id in \(([^)]+)\)/.exec(sql)![1].split(',').map((s) => s.trim().slice(1, -1));
    expect(check).toEqual(MAPS.map((m) => m.id));
  });

  it('판 검증 상수', () => {
    const b = body('_survival_const');
    const found = Object.fromEntries([...b.matchAll(/when '(\w+)' then ([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(found).toEqual(LIMITS);
  });

  it('도감에 넣을 수 있는 id', () => {
    const b = body('_survival_codex_ids');
    const list = (kind: string) => new RegExp(`when '${kind}' then array\\[([^\\]]*)\\]`).exec(b)![1].split(',').map((s) => s.trim().slice(1, -1));
    expect(list('enemies')).toEqual(ENEMIES.map((e) => e.id));
    expect(list('bosses')).toEqual(BOSSES.map((e) => e.id));
    expect(list('weapons')).toEqual(WEAPONS.map((e) => e.id));
    expect(list('passives')).toEqual(PASSIVES.map((e) => e.id));
  });

  it('캐릭터 목록과 해금 조건', () => {
    const b = body('survival_start');
    const list = /p_character not in \(([^)]+)\)/.exec(b)![1].split(',').map((s) => s.trim().slice(1, -1));
    expect(list).toEqual([...ZODIAC_IDS]);
    const f = body('survival_finish');
    const cond: Record<string, string> = {};
    for (const m of f.matchAll(/\(c = '(\w+)' and ([^)]+)\)/g)) cond[m[1]] = m[2].trim();
    const want = Object.fromEntries(
      CHARACTERS.filter((c) => !['base', 'coins'].includes(c.unlock.kind)).map((c) => {
        const v = c.unlock.value;
        const text = { time: `p_time >= ${v}`, boss: `p_boss_kills >= ${v}`, kills: `n_kills >= ${v}`, cakes: `n_cakes >= ${v}`, clear: 'p_cleared' }[c.unlock.kind as 'time'];
        return [c.id, text];
      }),
    );
    expect(cond).toEqual(want);
    // 처음 열려 있는 캐릭터·맵
    expect(sql).toContain("unlocked_characters text[] not null default array['rat', 'ox', 'tiger']");
    expect(sql).toContain("unlocked_maps text[] not null default array['field']");
  });
});

describe('랭킹 뷰', () => {
  it('맵별로 따로, 생존 시간 → 클리어 → 처치 수 → 먼저 달성한 순 (PRD 10장)', () => {
    const at = sql.indexOf('create or replace view public.survival_ranking as');
    expect(at).toBeGreaterThan(0);
    const view = sql.slice(at).replace(/\s+/g, ' ');
    expect(view).toContain('partition by r.map_id order by r.best_time desc, r.cleared desc, r.best_kills desc, r.achieved_at asc, r.user_id');
    expect(view).toContain('(count(*) over (partition by r.map_id))::int as total');
    expect(view).toContain('grant select on public.survival_ranking to anon, authenticated;');
    // 랭킹 창(shared/ranking-dialog.js)이 읽는 칸이 모두 있다
    for (const col of ['user_id', 'nickname', 'map_id', 'best_time', 'best_kills', 'cleared', 'character', 'achieved_at']) expect(view).toMatch(new RegExp(`[ .]${col}[, ]`));
  });

  it('랭킹 창의 맵 목록이 게임 데이터와 같다', () => {
    const js = readFileSync(fileURLToPath(new URL('../../../shared/ranking-dialog.js', import.meta.url)), 'utf8');
    const list = [...js.slice(js.indexOf('export const SURVIVAL_MAPS'), js.indexOf('const tabInfo')).matchAll(/\{ id: '(\w+)', name: '([^']+)' \}/g)].map((m) => [m[1], m[2]]);
    expect(list).toEqual(MAPS.map((m) => [m.id, m.name]));
    expect(js).toContain("from('survival_ranking')");
  });
});

describe('SQL의 권한 규칙', () => {
  const fns = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]).filter((f, i, a) => a.indexOf(f) === i);

  it('안에서만 쓰는 함수(_로 시작)는 아무에게도 실행 권한을 주지 않는다', () => {
    const inner = fns.filter((f) => f.startsWith('_'));
    expect(inner.length).toBeGreaterThan(5);
    for (const f of inner) {
      expect(sql, f).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^;]*\\) from public, anon, authenticated;`));
      expect(sql, f).not.toMatch(new RegExp(`grant execute on function public\\.${f}\\(`));
    }
  });

  it('화면이 부르는 함수는 security definer + search_path 고정, 로그인한 사람에게만', () => {
    const open = fns.filter((f) => !f.startsWith('_'));
    expect(open.sort()).toEqual(['survival_buy_upgrade', 'survival_finish', 'survival_now', 'survival_profile', 'survival_reset_upgrades', 'survival_start', 'survival_unlock_character']);
    for (const f of open) {
      const at = sql.lastIndexOf(`create or replace function public.${f}(`);
      const head = sql.slice(at, sql.indexOf('$$', at));
      expect(head, f).toContain('security definer set search_path = public');
      if (f === 'survival_now') continue;
      expect(sql, f).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^;]*\\) from public, anon;`));
      expect(sql, f).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^;]*\\) to authenticated;`));
      expect(body(f), f).toContain("raise exception 'need login'");
    }
  });

  it('표는 RLS를 켜고 직접 쓰는 권한이 없다', () => {
    for (const t of ['survival_profiles', 'survival_records', 'survival_runs']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
      expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete|all)[^;]* on public\\.${t} `));
    }
    expect(sql).not.toMatch(/grant select on public\.survival_runs/);
  });
});
