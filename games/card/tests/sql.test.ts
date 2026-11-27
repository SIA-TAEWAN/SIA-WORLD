/** 서버 SQL(supabase/migrations/112_card.sql + 114_card_tune.sql — 함수마다 마지막 정의)의 상수·목록이 규칙 코드·공통 모듈과 같은지 본다 (서버는 바꾸지 않고 읽기만) */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_START_GOLD, COIN_ACTS, COIN_ACTS_TRUE, DAILY_SCORE, MASTERY_OPEN, MAX_LOG, RULES_VERSION } from '../src/game/rules';

const MIG = new URL('../../../supabase/migrations/', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, MIG), 'utf8').replace(/\r\n/g, '\n');
const shared = (f: string) => readFileSync(new URL(`../../../shared/${f}`, import.meta.url), 'utf8');
const files = readdirSync(MIG).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
/** 카드배틀 마이그레이션 (뒤의 것이 앞의 정의를 create or replace 로 바꾼다) */
const CARD_FILES = ['112_card.sql', '114_card_tune.sql', '116_card_elite.sql', '117_card_cleanup.sql', '119_review_fixes.sql'];

/** 함수의 마지막 정의 (create or replace — 가장 늦은 마이그레이션이 이긴다) → 본문, 파일 */
function lastDef(fn: string): { body: string; from: string } {
  let body = '';
  let from = '';
  for (const f of files) {
    const t = read(f);
    const m = [...t.matchAll(new RegExp(`create (or replace )?function public\\.${fn}\\(`, 'g'))].pop();
    if (m) [body, from] = [t.slice(m.index, t.indexOf('$$;', m.index)), f];
  }
  return { body, from };
}
const arrayOf = (body: string) => [...(/array\[([^\]]+)\]/.exec(body)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);

describe('112_card.sql · 114_card_tune.sql 과 규칙 코드', () => {
  const c = lastDef('_card_const');
  const vals: Record<string, number> = {};
  for (const m of c.body.matchAll(/when '(\w+)' then (\d+)/g)) vals[m[1]] = Number(m[2]);

  it('_card_const: 규칙 판본 · 숙련 · 시아코인 · 기록 길이 · 오늘의 도전 점수', () => {
    expect(c.from).toBe('116_card_elite.sql');
    for (const f of CARD_FILES) expect(files).toContain(f);
    expect(vals.rules).toBe(RULES_VERSION);
    expect(vals.mastery_open).toBe(MASTERY_OPEN);
    expect(vals.coin_acts).toBe(COIN_ACTS);
    expect(vals.coin_acts_true).toBe(COIN_ACTS_TRUE);
    expect(vals.max_log).toBe(MAX_LOG);
    expect([vals.score_floor, vals.score_elite, vals.score_boss]).toEqual([DAILY_SCORE.floor, DAILY_SCORE.elite, DAILY_SCORE.boss]);
    expect(vals.cat_need).toBe(1);
    expect(vals.admin_gold).toBe(ADMIN_START_GOLD);
  });

  it('관리자 시험 판 시작 엽전: card_start 가 보통·끝없는 판에만 start_gold 를 정해 저장 · 판 JSON 에 startGold', () => {
    const st = lastDef('card_start');
    expect(st.from).toBe('119_review_fixes.sql');
    const body = st.body.replace(/\s+/g, ' ');
    // 관리자 갈래는 오늘의 도전이 아닌 쪽(else) 안
    const els = body.indexOf("perform public._check_character(me, p_hero, 'card')");
    const adm = body.indexOf("if exists (select 1 from public.profiles where id = me and is_admin) then g := public._card_const('admin_gold'); end if;");
    expect(els).toBeGreaterThan(0);
    expect(adm).toBeGreaterThan(els);
    expect(body).toContain("values (me, p_mode, p_hero, lv, s, public._card_const('rules'), d, first, g)");
    expect(lastDef('_card_run_json').body).toContain("'startGold', r.start_gold");
    expect(read('114_card_tune.sql')).toContain('alter table public.card_runs add column if not exists start_gold int;');
    const fn = readFileSync(new URL('../../../supabase/functions/card-finish/index.ts', import.meta.url), 'utf8');
    expect(fn).toContain('startGold: run.start_gold ?? null');
  });

  it('_character_games · _daily_games 마지막 정의에 card (shared/characters.js · daily.js 와 같은 목록)', () => {
    const cg = lastDef('_character_games');
    const dg = lastDef('_daily_games');
    expect(arrayOf(cg.body)).toContain('card');
    expect(arrayOf(dg.body)).toContain('card');
    const sharedList = (text: string, name: string) => [...(new RegExp(`${name} = \\[([^\\]]+)\\]`).exec(text)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(sharedList(shared('characters.js'), 'CHARACTER_GAMES')).toEqual(arrayOf(cg.body));
    expect(sharedList(shared('daily.js'), 'DAILY_GAMES').map((g) => g)).toEqual(arrayOf(dg.body));
  });

  it('_cat_progress_card = {have: 클리어 수, need: cat_need} · 시작은 _check_character(…, card)', () => {
    expect(lastDef('_cat_progress_card').body).toContain("'need', public._card_const('cat_need')");
    expect(lastDef('card_start').body).toContain("perform public._check_character(me, p_hero, 'card')");
  });

  it('보안: security definer + search_path, 기록 함수는 service_role 만', () => {
    for (const fn of ['card_start', 'card_state', 'card_finish_verified', '_cat_progress_card']) {
      expect(lastDef(fn).body, fn).toContain('security definer set search_path = public');
    }
    const t114 = read('114_card_tune.sql');
    expect(t114).toContain('revoke all on function public.card_state() from public, anon;');
    const t117 = read('117_card_cleanup.sql');
    // 119: 옛 5인자 card_start 를 지우고 p_retry 를 더한 6인자에 같은 권한
    const t119 = read('119_review_fixes.sql');
    expect(t119).toContain('drop function if exists public.card_start(text, text, int, text, bigint);');
    expect(t119).toContain('revoke all on function public.card_start(text, text, int, text, bigint, boolean) from public, anon;');
    expect(t119).toContain('grant execute on function public.card_start(text, text, int, text, bigint, boolean) to authenticated;');
    expect(lastDef('_card_prune').body).toContain('security definer set search_path = public');
    expect(t117).toContain('revoke all on function public._card_prune(uuid) from public, anon, authenticated;');
    expect(t114).toContain('revoke all on function public._card_const(text) from public, anon, authenticated;');
    expect(t114).toContain('revoke all on function public._card_run_json(public.card_runs) from public, anon, authenticated;');
    const sql = read('112_card.sql');
    expect(sql).toContain('revoke all on function public.card_finish_verified(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.card_finish_verified(uuid, uuid, jsonb, jsonb) to service_role;');
    expect(sql).toContain("('game_open:card', 'false'::jsonb)");
    for (const t of ['card_runs', 'card_heroes', 'card_endless']) expect(sql).toContain(`alter table public.${t} enable row level security;`);
  });

  it('117: 버린 판 정리 · 오늘의 도전 시작 재시도 · 끝없는 랭킹에서 관리자 빼기', () => {
    const body = lastDef('card_start').body.replace(/\s+/g, ' ');
    // 재시도: 새 판을 만들기 전에 기록 없는 같은 오늘의 도전 판을 돌려준다 ('그날 첫 판' 판정보다 먼저)
    const reuse = body.indexOf("and day = d and hero = p_hero and seed = s and log_len = 0");
    expect(reuse).toBeGreaterThan(0);
    expect(reuse).toBeLessThan(body.indexOf('first := not exists'));
    // 119: 재사용은 화면이 '시간초과 뒤 다시 누름' 이라고 알린 때(p_retry)만
    expect(body).toContain('p_retry boolean default false');
    const gate = body.indexOf('if coalesce(p_retry, false) then');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(reuse);
    // 정리는 앞 판을 버린 뒤, 새 판을 넣기 전
    const prune = body.indexOf('perform public._card_prune(me);');
    expect(prune).toBeGreaterThan(body.indexOf("set status = 'abandoned'"));
    expect(prune).toBeLessThan(body.indexOf('insert into public.card_runs'));
    // 지우는 것은 기록 없는 버린 판만 (오늘의 도전은 오늘 판을 남긴다)
    const pr = lastDef('_card_prune').body.replace(/\s+/g, ' ');
    expect(pr).toContain("status = 'abandoned' and log_len = 0 and acts = 0 and (mode <> 'daily' or day is null or day < public._daily_day())");
    const t117 = read('117_card_cleanup.sql').replace(/\s+/g, ' ');
    expect(t117).toContain('create or replace view public.card_endless_ranking as');
    expect(t117).toContain('where not coalesce(p.is_admin, false);');
    expect(t117).toContain('grant select on public.card_endless_ranking to anon, authenticated;');
  });

  it('오늘의 도전 점수식이 DAILY_SCORE 와 같은 꼴', () => {
    expect(lastDef('card_finish_verified').body.replace(/\s+/g, ' ')).toContain(
      "v_floors * public._card_const('score_floor') + v_elites * public._card_const('score_elite') + v_bosses * public._card_const('score_boss') + greatest(v_hp, 0)",
    );
  });
});

describe('Edge Function card-finish (Deno 규칙)', () => {
  const SH = new URL('../../../supabase/functions/_shared/card/', import.meta.url);
  it('_shared/card 는 .ts 확장자 상대 import 만 (node:· npm:· 확장자 없는 import 없음)', () => {
    const list = [...readdirSync(SH).filter((f) => f.endsWith('.ts')), ...readdirSync(new URL('data/', SH)).filter((f) => f.endsWith('.ts')).map((f) => `data/${f}`)];
    for (const f of list) {
      const t = readFileSync(new URL(f, SH), 'utf8');
      for (const m of t.matchAll(/^\s*(?:import|export)[^'"\n]*from\s+'([^']+)'/gm)) {
        expect(m[1], `${f}: ${m[1]}`).toMatch(/^\.\.?\/.*\.ts$/);
      }
      expect(t, f).not.toMatch(/\b(process|Deno|localStorage|window|document)\./);
    }
  });
  it('card-finish 는 verify.ts 로 다시 돌리고 card_finish_verified 를 부른다', () => {
    const fn = readFileSync(new URL('../../../supabase/functions/card-finish/index.ts', import.meta.url), 'utf8');
    expect(fn).toContain("from '../_shared/card/verify.ts'");
    expect(fn).toContain("sb.rpc('card_finish_verified', { p_user: userId, p_run: runId, p_result: v.result, p_log: v.log })");
    expect(fn).toContain('body?.rules !== CARD_RULES');
  });
});

describe('SIA WORLD 연결', () => {
  it('games.js · presence.js · ranking-dialog.js · deploy.yml 에 card', () => {
    expect(shared('games.js')).toMatch(/id: 'card'[\s\S]*?path: 'games\/card\/', image: 'shared\/images\/card-card.png', open: false/);
    expect(shared('presence.js')).toContain("card: ['card-lobby']");
    expect(shared('ranking-dialog.js')).toMatch(/TAB_ORDER = \[[^\]]*'card'\]/);
    expect(shared('ranking-dialog.js')).toContain("card: { game: 'card'");
    const deploy = readFileSync(new URL('../../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
    expect(deploy).toContain('working-directory: games/card');
    expect(deploy).toContain('cp -r games/card/dist/. _site/games/card/');
    expect(deploy).toContain('deploy_fn card-finish');
  });
  it('index.html PWA head 블록', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<link rel="manifest" href="../../manifest.webmanifest" vite-ignore />');
    expect(html).toContain('<script type="module" src="../../shared/pwa.js" vite-ignore></script>');
  });
});
