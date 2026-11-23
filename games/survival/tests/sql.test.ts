import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHAR_IDS } from '../src/data/balance';
import { BOSSES } from '../src/data/bosses';
import { CHARACTERS, CHARACTER_PRICE, unlockLabel } from '../src/data/characters';
import { ENEMIES } from '../src/data/enemies';
import { MAPS } from '../src/data/maps';
import { PASSIVES } from '../src/data/passives';
import { UPGRADES, upgradeCost } from '../src/data/upgrades';
import { WEAPONS } from '../src/data/weapons';
import { ENDLESS, HELL, RUN_SEC } from '../src/data/balance';
import { LIMITS, characterPrice, coinCap, endlessCoinCap } from '../src/game/progress';

/**
 * 서버 SQL(supabase/migrations/038_survival.sql + 039 · 040 · 041 · 042 · 043 · 044 · 045 · 055 · 073)의 표·상수가 게임 데이터와 같은지 본다.
 * 엽전·강화·해금은 서버가 정하므로, 두 곳의 값이 어긋나면 화면에 보이는 값과 실제가 달라진다.
 */
const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), 'utf8');
// 뒤 파일이 같은 함수를 다시 정의하면 그쪽이 실제 값이다
const FILES = ['038_survival.sql', '039_survival_hardening.sql', '040_survival_5min.sql', '041_survival_3min.sql', '042_survival_speed.sql', '043_survival_4min.sql', '044_survival_endless.sql', '045_survival_review.sql', '055_survival_hell.sql', '073_cat_survival.sql'];
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

describe('SQL 파일 목록', () => {
  it('서바이벌 함수를 다시 정의하는 마이그레이션은 모두 위 목록에 있다 (빠지면 예전 정의를 검사하게 된다)', () => {
    const dir = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
    const redefine = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      // create function · create or replace function, public. 생략·따옴표("public"."_survival_…")·대소문자 모두
      .filter((f) => /create\s+(or\s+replace\s+)?function\s+("?public"?\s*\.\s*)?"?_?survival_/i.test(readFileSync(dir + f, 'utf8')));
    expect(redefine.filter((f) => !FILES.includes(f))).toEqual([]);
  });
});

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
    // 무한 모드 값은 게임 데이터(data/balance.ts 의 ENDLESS)에서 온다
    expect(found.endless_max_time).toBe(ENDLESS.maxSec);
    expect(found.endless_boss_every).toBe(ENDLESS.bossEvery);
    expect(found.max_time).toBe(RUN_SEC);
    // 045: 무한 모드의 가장 긴 판 20분, 시간 여유 15초, 처치 수 하한 (2분 뒤부터 초당 1)
    expect(found).toMatchObject({ endless_max_time: 1200, time_slack: 15, kills_min_from: 120, kills_min_per_sec: 1, coin_min_time: 60 });
    // 055: 헬 모드의 엽전 배율은 게임 데이터(data/balance.ts 의 HELL)에서 온다
    expect(found.hell_coin_mul).toBe(HELL.coin);
    expect(found.hell_coin_mul).toBe(2);
  });

  it('무한 모드의 맵별 엽전 상한', () => {
    expect(rows('_survival_endless_coin_cap')).toEqual(MAPS.map((m) => [m.id, m.endlessCoins]));
    expect(MAPS.map((m) => endlessCoinCap(m.id))).toEqual(MAPS.map((m) => m.endlessCoins));
    // 기록 표의 맵 목록·시간 상한도 같다
    const t = sql.slice(sql.indexOf('create table if not exists public.survival_endless_records'));
    expect(/map_id in \(([^)]+)\)/.exec(t)![1].split(',').map((s) => s.trim().slice(1, -1))).toEqual(MAPS.map((m) => m.id));
    // 표의 시간 상한은 044 그대로(3600)다: 045 는 받는 시간만 줄였다 (이미 있는 기록을 건드리지 않는다)
    const max = Number(/best_time int not null check \(best_time between 0 and (\d+)\)/.exec(t)![1]);
    expect(max).toBeGreaterThanOrEqual(ENDLESS.maxSec);
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
    // 073: 캐릭터 목록은 공용 함수(071 의 _character_ids · _check_character)가 본다. 그 목록이 게임의 캐릭터 목록과 같다
    const b = body('survival_start');
    expect(b).toContain("perform public._check_character(me, p_character, 'survival');");
    expect(b).not.toContain('p_character not in');
    const shared = read('071_characters.sql');
    const list = /array\[([^\]]+)\]::text\[\]/.exec(shared.slice(shared.indexOf('function public._character_ids()')))![1].split(',').map((s) => s.trim().slice(1, -1));
    expect(list).toEqual([...CHAR_IDS]);
    // 시아코인으로 여는 캐릭터(고양이)는 시아서바이벌의 해금 목록을 보지 않는다 (이 게임의 선택 화면에서 연다): 엽전 값 표에도, 판 결과 해금 목록에도 없다
    expect(b).toContain("if public._character_price(p_character) is null and not (p_character = any(pr.unlocked_characters)) then raise exception 'character locked'; end if;");
    expect(rows('_survival_character_prices').map((r) => r[0])).not.toContain('cat');
    // 071: 고양이를 여는 값(시아코인)은 SQL 과 shared/characters.js 가 같다
    const price = (src: string, re: RegExp) => Object.fromEntries([...src.matchAll(re)].map((m) => [m[1], Number(m[2])]));
    const fn = shared.slice(shared.indexOf('function public._character_price('), shared.indexOf('$$;', shared.indexOf('function public._character_price(')));
    const sqlPrice = price(fn, /when '(\w+)' then (\d+)/g);
    const js = readFileSync(fileURLToPath(new URL('../../../shared/characters.js', import.meta.url)), 'utf8');
    const block = /export const CHARACTER_PRICE = \{([^}]*)\}/.exec(js)![1];
    const jsPrice = price(block, /(\w+)\s*:\s*(\d+)/g);
    expect(sqlPrice).toEqual(jsPrice);
    // 게임 안의 값(버튼 글·안내)도 같다. 지금은 고양이 100개
    expect(sqlPrice).toEqual(CHARACTER_PRICE);
    expect(sqlPrice.cat).toBe(100);
    // 버튼 글: shared 의 unlockLabel 과 같은 모양
    expect(js).toContain("export const unlockLabel = (id) => `시아코인 ${CHARACTER_PRICE[id] ?? ''}개로 열기`;");
    expect(unlockLabel('cat')).toBe('시아코인 100개로 열기');
    expect(CHARACTERS.filter((c) => c.unlock.kind === 'sia').map((c) => [c.id, c.unlock.value])).toEqual(Object.entries(CHARACTER_PRICE));
    const f = body('survival_finish');
    const cond: Record<string, string> = {};
    for (const m of f.matchAll(/\(c = '(\w+)' and ([^)]+)\)/g)) cond[m[1]] = m[2].trim();
    const want = Object.fromEntries(
      CHARACTERS.filter((c) => !['base', 'coins', 'sia'].includes(c.unlock.kind)).map((c) => {
        const v = c.unlock.value;
        const text = { time: `p_time >= ${v}`, boss: `p_boss_kills >= ${v}`, kills: `n_kills >= ${v}`, cakes: `n_cakes >= ${v}`, clear: 'p_cleared' }[c.unlock.kind as 'time'];
        return [c.id, text];
      }),
    );
    expect(cond).toEqual(want);
    // 무한 모드·헬 모드: 시간 조건(토끼·말)과 클리어(돼지)로 푸는 캐릭터는 건너뛴다 (4분 모드에서만 풀린다)
    const skip = /continue when \(endless or hell\) and c in \(([^)]+)\);/.exec(f)![1].split(',').map((s) => s.trim().slice(1, -1));
    expect(skip).toEqual(CHARACTERS.filter((c) => ['time', 'clear'].includes(c.unlock.kind)).map((c) => c.id));
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

  it('무한 모드 랭킹은 따로: 생존 시간 → 처치 수 → 먼저 달성한 순, 칸과 권한은 4분 랭킹과 같다', () => {
    const at = sql.indexOf('create or replace view public.survival_endless_ranking as');
    expect(at).toBeGreaterThan(0);
    const view = sql.slice(at).replace(/\s+/g, ' ');
    expect(view).toContain('partition by r.map_id order by r.best_time desc, r.best_kills desc, r.achieved_at asc, r.user_id');
    expect(view).toContain('(count(*) over (partition by r.map_id))::int as total');
    expect(view).toContain('from public.survival_endless_records r join public.profiles p on p.id = r.user_id;');
    expect(view).toContain('revoke all on public.survival_endless_ranking from anon, authenticated;');
    expect(view).toContain('grant select on public.survival_endless_ranking to anon, authenticated;');
    for (const col of ['user_id', 'nickname', 'map_id', 'best_time', 'best_kills', 'cleared', 'character', 'achieved_at']) expect(view).toMatch(new RegExp(`[ .]${col}[, ]`));
    // 랭킹 창: 서바이벌 탭의 모드 전환이 두 뷰를 따로 읽는다
    const js = readFileSync(fileURLToPath(new URL('../../../shared/ranking-dialog.js', import.meta.url)), 'utf8');
    expect(js).toContain("from('survival_endless_ranking')");
    expect(js).toContain("{ id: 'normal', name: '4분 모드' }");
    expect(js).toContain("{ id: 'endless', name: '무한 모드' }");
  });

  it('랭킹 창의 맵 목록이 게임 데이터와 같다', () => {
    const js = readFileSync(fileURLToPath(new URL('../../../shared/ranking-dialog.js', import.meta.url)), 'utf8');
    // SURVIVAL_MAPS 배열만 본다 (그 뒤에는 다른 게임의 목록이 이어진다)
    const from = js.indexOf('export const SURVIVAL_MAPS');
    const list = [...js.slice(from, js.indexOf('];', from)).matchAll(/\{ id: '(\w+)', name: '([^']+)' \}/g)].map((m) => [m[1], m[2]]);
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
    for (const t of ['survival_profiles', 'survival_records', 'survival_runs', 'survival_endless_records', 'survival_hell_records']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from anon, authenticated;`);
      expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete|all)[^;]* on public\\.${t} `));
    }
    expect(sql).not.toMatch(/grant select on public\.survival_runs/);
  });

  it('무한 모드 (044): 판에 모드 칸, 시작은 모드 인자(기본 4분 모드)와 클리어 기록 확인, 끝은 판의 모드를 본다', () => {
    expect(sql).toContain("alter table public.survival_runs add column if not exists mode text not null default 'normal' check (mode in ('normal', 'endless'));");
    // 옛 두 인자 함수는 지우고 (두 인자 호출이 어느 쪽인지 갈리지 않게) 기본값이 있는 세 인자 함수 하나만 둔다
    expect(sql).toContain('drop function if exists public.survival_start(text, text);');
    const s = body('survival_start');
    expect(s).toContain("public.survival_start(p_map text, p_character text, p_mode text default 'normal') returns uuid");
    // 045: 클리어 기록이 있거나 그 맵의 다음 맵이 열려 있으면 열린다 (_survival_map_cleared)
    expect(s).toContain("if p_mode = 'endless' and not public._survival_map_cleared(me, p_map, pr.unlocked_maps) then");
    expect(s).toContain("raise exception 'endless locked'");
    expect(sql).toContain('revoke all on function public.survival_start(text, text, text) from public, anon;');
    expect(sql).toContain('grant execute on function public.survival_start(text, text, text) to authenticated;');
    const f = body('survival_finish');
    expect(f).toContain("endless := rn.mode = 'endless';");
    expect(f).toContain("if endless and p_cleared then raise exception 'bad result'; end if;");
    expect(f).toContain("max_t := case when endless then public._survival_const('endless_max_time') else public._survival_const('max_time') end;");
    expect(f).toContain('coins := least(coins, coalesce(fixed_cap, 0));');
    // 055: 헬 모드의 클리어도 다음 맵 해금에 쓰지 않는다
    expect(f).toContain('if p_cleared and not endless and not hell then');
    // 프로필에 클리어한 맵과 무한 모드 최고 기록이 실린다 (화면이 무한 모드의 잠금을 이것으로 안다)
    const j = body('_survival_profile_json');
    expect(j).toContain("'clearedMaps'");
    expect(j).toContain("'endlessBest'");
  });

  it('검토 반영 (045): 처치 수 하한 · 시아코인의 실제 경과 시간 · 무한 모드 잠금 완화', () => {
    const f = body('survival_finish').replace(/\s+/g, ' ');
    // 처치 수 하한에 못 미치면 세지 않는다 (valid 는 그대로): 엽전 0 · 누적·기록·해금·도감 없음, 클리어도 인정하지 않는다
    expect(f).toContain("enough := p_kills >= greatest(0, p_time - public._survival_const('kills_min_from')) * public._survival_const('kills_min_per_sec');");
    expect(f).toContain("counted := p_time >= public._survival_const('count_min_time') and enough;");
    expect(f).toContain('if not counted then coins := 0; end if;');
    expect(f).toContain('if ok and counted then');
    expect(f).toContain('cleared = p_cleared and ok and enough, valid = ok,');
    expect(f).toContain("'lowKills', not enough,");
    // 시아코인: 생존 시간과 서버가 잰 실제 경과 시간이 모두 1분을 넘고, 처치 수 하한도 넘어야 한다
    expect(f).toContain("if ok and enough and p_time >= public._survival_const('coin_min_time') and elapsed >= public._survival_const('coin_min_time') then");
    // 'too early' 와 'overlap' 은 같은 여유(time_slack)를 쓴다
    expect(f.match(/public\._survival_const\('time_slack'\)/g)!.length).toBe(3);
    expect(f).toContain("if elapsed < p_time / public._survival_const('max_speed') - public._survival_const('time_slack') then raise exception 'too early'; end if;");
    // 무한 모드 잠금: 클리어 기록 또는 다음 맵 해금. 프로필의 clearedMaps 도 같은 함수로
    const c = body('_survival_map_cleared').replace(/\s+/g, ' ');
    expect(c).toContain('where c.user_id = p_user and c.map_id = p_map and c.cleared)');
    expect(c).toContain('on m2.ord = m1.ord + 1 where m1.map_id = p_map and m2.map_id = any(p_unlocked))');
    expect(body('_survival_profile_json')).toContain('where public._survival_map_cleared(r.user_id, m.map_id, r.unlocked_maps)), ');
    // 게임 쪽 문구: 클리어·다음 맵·돼지의 조건은 '4분 버티기'가 아니라 최종 보스 처치다
    expect(f).toContain('if p_cleared and p_boss_kills < 1 then ok := false; end if;');
    for (const m of MAPS.slice(1)) expect(m.unlock).toContain('최종 보스 물리치기');
    expect(CHARACTERS.find((x) => x.unlock.kind === 'clear')!.unlock.text).toContain('최종 보스 물리치기');
  });

  it('헬 모드 (055): 모드 칸 · 잠금은 그 맵의 클리어 · 엽전 상한 2배 · 기록 표와 랭킹 뷰 · 해금 제외', () => {
    // 모드 칸의 check 를 바꿔 'hell' 을 받는다 (044 가 만든 이름 그대로 지우고 다시 만든다: 여러 번 올려도 된다)
    expect(sql).toContain('alter table public.survival_runs drop constraint if exists survival_runs_mode_check;');
    expect(sql).toContain("alter table public.survival_runs add constraint survival_runs_mode_check check (mode in ('normal', 'endless', 'hell'));");
    const s = body('survival_start');
    expect(s).toContain("public.survival_start(p_map text, p_character text, p_mode text default 'normal') returns uuid");
    expect(s).toContain("if p_mode is null or p_mode not in ('normal', 'endless', 'hell') then raise exception 'bad mode'; end if;");
    // 잠금: 무한 모드와 같은 함수(045 의 _survival_map_cleared)로 **그 맵**을 본다
    expect(s).toContain("if p_mode = 'hell' and not public._survival_map_cleared(me, p_map, pr.unlocked_maps) then");
    expect(s).toContain("raise exception 'hell locked'");
    // _survival_map_cleared 는 055 에서 다시 정의하지 않는다 (4분 모드 기록만 본다 → 헬 클리어는 잠금 해제에 쓰이지 않는다)
    expect(read('055_survival_hell.sql')).not.toContain('function public._survival_map_cleared(');
    expect(body('_survival_map_cleared')).toContain('from public.survival_records c');
    const f = body('survival_finish').replace(/\s+/g, ' ');
    expect(f).toContain("hell := rn.mode = 'hell';");
    // 4분 판이다: 가장 긴 판·클리어 조건은 4분 모드의 것 그대로 (무한 모드만 다르다)
    expect(f).toContain("max_t := case when endless then public._survival_const('endless_max_time') else public._survival_const('max_time') end;");
    expect(f).toContain("if p_cleared and p_time <> public._survival_const('max_time') then raise exception 'bad time'; end if;");
    // 엽전 상한 2배
    expect(f).toContain("if hell then mul := mul * public._survival_const('hell_coin_mul'); end if;");
    for (const m of MAPS) {
      expect(coinCap(m.id, 100, 'hell')).toBe(Math.floor(100 * LIMITS.coins_per_sec * m.coinMul * 2));
      expect(coinCap(m.id, 100, 'hell')).toBe(coinCap(m.id, 100, 'normal') * 2);
    }
    // 기록은 따로 (4분 모드와 같은 순서), 최고 생존 시간(누적)은 4분 모드만
    expect(f).toContain('select * into old_h from public.survival_hell_records where user_id = me and map_id = rn.map_id for update;');
    expect(f).toContain('insert into public.survival_hell_records as r (user_id, map_id, best_time, best_kills, cleared, character, achieved_at)');
    expect(f).toContain('elsif p_cleared <> old_h.cleared then better := p_cleared;');
    expect(f).toContain('case when endless or hell then 0 else p_time end');
    // 045 의 검증은 그대로다: 처치 수 하한 · too early · overlap · 시아코인
    expect(f).toContain("counted := p_time >= public._survival_const('count_min_time') and enough;");
    expect(f.match(/public\._survival_const\('time_slack'\)/g)!.length).toBe(3);
    expect(f).toContain("raise exception 'overlap'");
    expect(f).toContain("if ok and enough and p_time >= public._survival_const('coin_min_time') and elapsed >= public._survival_const('coin_min_time') then");
    // 기록 표: 맵 목록 · 시간 상한(4분) · 클리어 칸
    const t = sql.slice(sql.indexOf('create table if not exists public.survival_hell_records'));
    expect(/map_id in \(([^)]+)\)/.exec(t)![1].split(',').map((x) => x.trim().slice(1, -1))).toEqual(MAPS.map((m) => m.id));
    expect(Number(/best_time int not null check \(best_time between 0 and (\d+)\)/.exec(t)![1])).toBe(RUN_SEC);
    expect(t.slice(0, t.indexOf(');'))).toContain('cleared boolean not null default false');
    expect(sql).toContain('grant select on public.survival_hell_records to anon, authenticated;');
    // 프로필에 헬 모드 최고 기록이 실린다
    const j = body('_survival_profile_json');
    expect(j).toContain("'hellBest'");
    expect(j).toContain("jsonb_build_object('time', h.best_time, 'kills', h.best_kills, 'cleared', h.cleared)");
    expect(j).toContain("'clearedMaps'");
    expect(j).toContain("'endlessBest'");
  });

  it('헬 모드 랭킹 (055): 맵별로 따로, 4분 랭킹과 같은 순서·칸·권한', () => {
    const at = sql.indexOf('create or replace view public.survival_hell_ranking as');
    expect(at).toBeGreaterThan(0);
    const view = sql.slice(at).replace(/\s+/g, ' ');
    expect(view).toContain('partition by r.map_id order by r.best_time desc, r.cleared desc, r.best_kills desc, r.achieved_at asc, r.user_id');
    expect(view).toContain('(count(*) over (partition by r.map_id))::int as total');
    expect(view).toContain('from public.survival_hell_records r join public.profiles p on p.id = r.user_id;');
    expect(view).toContain('revoke all on public.survival_hell_ranking from anon, authenticated;');
    expect(view).toContain('grant select on public.survival_hell_ranking to anon, authenticated;');
    for (const col of ['user_id', 'nickname', 'map_id', 'best_time', 'best_kills', 'cleared', 'character', 'achieved_at']) expect(view).toMatch(new RegExp(`[ .]${col}[, ]`));
  });

  it('관리자 계정 (055): 시아서바이벌에 들어올 때(survival_profile) 엽전과 시아코인을 10,000 으로 맞춘다', () => {
    const p = body('survival_profile').replace(/\s+/g, ' ');
    // 다른 SQL 과 같은 방식으로 관리자를 가린다 (profiles.is_admin)
    expect(p).toContain('if exists (select 1 from public.profiles where id = me and is_admin) then');
    expect(p).toContain('update public.survival_profiles set coins = 10000 where user_id = me returning * into pr;');
    expect(p).toContain('perform public._ensure_wallet(me);');
    expect(p).toContain('update public.wallets set sia_coins = 10000 where user_id = me;');
    expect(p).toContain('return public._survival_profile_json(pr);');
    // 다른 함수는 관리자를 따로 다루지 않는다 (기록·랭킹은 그대로)
    for (const fn of ['survival_start', 'survival_finish', 'survival_buy_upgrade']) expect(body(fn)).not.toContain('is_admin');
  });
});
