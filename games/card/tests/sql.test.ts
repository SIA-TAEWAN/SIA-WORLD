/** 서버 SQL(supabase/migrations/111_card.sql)의 상수·목록이 규칙 코드·공통 모듈과 같은지 본다 (서버는 바꾸지 않고 읽기만) */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COIN_ACTS, COIN_ACTS_TRUE, DAILY_SCORE, MASTERY_OPEN, MAX_LOG, RULES_VERSION } from '../src/game/rules';

const MIG = new URL('../../../supabase/migrations/', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, MIG), 'utf8').replace(/\r\n/g, '\n');
const shared = (f: string) => readFileSync(new URL(`../../../shared/${f}`, import.meta.url), 'utf8');
const files = readdirSync(MIG).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();

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

describe('111_card.sql 과 규칙 코드', () => {
  const c = lastDef('_card_const');
  const vals: Record<string, number> = {};
  for (const m of c.body.matchAll(/when '(\w+)' then (\d+)/g)) vals[m[1]] = Number(m[2]);

  it('_card_const: 규칙 판본 · 숙련 · 시아코인 · 기록 길이 · 오늘의 도전 점수', () => {
    expect(c.from).toBe('111_card.sql');
    expect(vals.rules).toBe(RULES_VERSION);
    expect(vals.mastery_open).toBe(MASTERY_OPEN);
    expect(vals.coin_acts).toBe(COIN_ACTS);
    expect(vals.coin_acts_true).toBe(COIN_ACTS_TRUE);
    expect(vals.max_log).toBe(MAX_LOG);
    expect([vals.score_floor, vals.score_elite, vals.score_boss]).toEqual([DAILY_SCORE.floor, DAILY_SCORE.elite, DAILY_SCORE.boss]);
    expect(vals.cat_need).toBe(1);
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
    const sql = read('111_card.sql');
    expect(sql).toContain('revoke all on function public.card_finish_verified(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.card_finish_verified(uuid, uuid, jsonb, jsonb) to service_role;');
    expect(sql).toContain("('game_open:card', 'false'::jsonb)");
    for (const t of ['card_runs', 'card_heroes', 'card_endless']) expect(sql).toContain(`alter table public.${t} enable row level security;`);
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
