import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SQUAD_SIZE, type CharId } from '../src/data/balance';
import { ROSTER, STARTERS } from '../src/data/characters';
import { STAGES, stageOf } from '../src/data/stages';
import {
  BAN_POOL, DAILY_ENERGY_MUL, DAILY_HP_MUL, DAILY_KILLS_CAP, DAILY_KINDS, DAILY_SQUAD_MAX,
  dailyChallenge, dailyDetailText, dailyMods, dailyScore, dailySeed, dailySquad, localDailyDay, pickIndex,
} from '../src/game/daily';
import { SKILLS, simulate, skillPolicy } from '../src/game/policy';
import { LIMITS, applyRun, defaultProfile, isValid, rejectReason, type RunReport } from '../src/game/progress';
import { createGame } from '../src/game/sim';
import { ApiError, createLocalApi, createSupabaseApi, dailyRecord, type RpcClient, type Store } from '../src/net/api';

/** 오늘의 고개 (오늘의 도전): 날짜 → 스테이지·조건·시드, 점수, 조건이 판 계산에 주는 영향, 기록 흐름 */

const file = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const days = (n: number, from = Date.UTC(2026, 10, 1)) => Array.from({ length: n }, (_, i) => new Date(from + i * 86400_000).toISOString().slice(0, 10));
const store = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe('날짜 → 시드', () => {
  it('shared/daily.js 의 dailySeed 와 같은 값이다', () => {
    const src = file('../../../shared/daily.js');
    const at = src.indexOf('export function dailySeed(');
    expect(at).toBeGreaterThan(0);
    const end = src.indexOf('\n}', at);
    const shared = new Function(`${src.slice(at, end + 2).replace('export function', 'return function')}`)() as (g: string, d: string, s?: string) => number;
    for (const d of days(40)) for (const salt of ['', 'stage', 'rule', 'ban', 'run']) expect(dailySeed('defense', d, salt)).toBe(shared('defense', d, salt));
    expect(dailySeed('defense', '2026-11-23')).toBe(shared('defense', '2026-11-23'));
  });

  it('기기 시계로 만든 날짜는 한국 시간 기준', () => {
    expect(localDailyDay(Date.UTC(2026, 10, 23, 14, 59))).toBe('2026-11-23');
    expect(localDailyDay(Date.UTC(2026, 10, 23, 15, 0))).toBe('2026-11-24');
  });
});

describe('그날의 스테이지와 조건', () => {
  it('같은 날이면 언제나 같고, 스테이지 60개 가운데 하나 + 조건 하나', () => {
    for (const d of days(60)) {
      const a = dailyChallenge(d);
      expect(dailyChallenge(d)).toEqual(a);
      expect(a.day).toBe(d);
      expect(STAGES.some((s) => s.id === a.stage)).toBe(true);
      expect(DAILY_KINDS).toContain(a.kind);
      expect(a.seed).toBe(dailySeed('defense', d, 'run'));
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.desc.length).toBeGreaterThan(0);
      // 조건은 하나만 걸린다
      const on = [a.squadMax !== SQUAD_SIZE, a.hpMul !== 1, a.ban !== null, a.energyMul !== 1].filter(Boolean);
      expect(on).toHaveLength(1);
    }
  });

  it('1년 동안: 조건 네 가지가 모두 나오고, 스테이지·금지 캐릭터가 고르게 바뀐다', () => {
    const all = days(365).map((d) => dailyChallenge(d));
    for (const k of DAILY_KINDS) expect(all.filter((c) => c.kind === k).length).toBeGreaterThan(50);
    expect(new Set(all.map((c) => c.stage)).size).toBeGreaterThan(50);
    expect(new Set(all.filter((c) => c.ban).map((c) => c.ban)).size).toBeGreaterThan(8);
    // 이틀 연속 같은 스테이지는 드물다
    expect(all.filter((c, i) => i > 0 && c.stage === all[i - 1].stage).length).toBeLessThan(20);
  });

  it('조건별 값: 소수 정예 3종 · 억센 요괴 ×1.3 · 쉬는 날(십이지 가운데 하나) · 빈 주머니 ×0.7', () => {
    const pick = (kind: string) => days(200).map((d) => dailyChallenge(d)).find((c) => c.kind === kind)!;
    expect(pick('squad3')).toMatchObject({ squadMax: DAILY_SQUAD_MAX, hpMul: 1, energyMul: 1, ban: null });
    expect(pick('tough')).toMatchObject({ squadMax: SQUAD_SIZE, hpMul: DAILY_HP_MUL, energyMul: 1, ban: null });
    expect(pick('lean')).toMatchObject({ squadMax: SQUAD_SIZE, hpMul: 1, energyMul: DAILY_ENERGY_MUL, ban: null });
    const ban = pick('ban');
    expect(BAN_POOL).toContain(ban.ban);
    expect(ban.title).toContain(ROSTER.find((r) => r.id === ban.ban)!.nick);
    // 고양이(시아코인으로 여는 캐릭터)는 금지 대상이 아니다
    expect(BAN_POOL).toHaveLength(12);
    expect(BAN_POOL).not.toContain('cat');
  });

  it('시드 함수를 바꿔 넣을 수 있다 (화면은 shared/daily.js 의 함수를 넘긴다)', () => {
    const fn = (_g: string, _d: string, salt?: string) => (salt === 'stage' ? 7 : salt === 'rule' ? 2 : salt === 'ban' ? 1 : 99);
    const c = dailyChallenge('2026-11-23', fn);
    expect(c).toMatchObject({ stage: STAGES[pickIndex(7, STAGES.length)].id, kind: DAILY_KINDS[pickIndex(2, DAILY_KINDS.length)], seed: 99 });
    if (c.kind === 'ban') expect(c.ban).toBe(BAN_POOL[pickIndex(1, BAN_POOL.length)]);
  });

  it('출전 명단 고치기: 금지 캐릭터를 빼고 정원까지만', () => {
    const squad: CharId[] = ['rat', 'ox', 'tiger', 'rabbit', 'dragon'];
    const base = dailyChallenge('2026-11-23');
    expect(dailySquad({ ...base, ban: 'ox', squadMax: 5 }, squad)).toEqual(['rat', 'tiger', 'rabbit', 'dragon']);
    expect(dailySquad({ ...base, ban: null, squadMax: 3 }, squad)).toEqual(['rat', 'ox', 'tiger']);
    expect(dailySquad({ ...base, ban: null, squadMax: 5 }, squad)).toEqual(squad);
  });
});

describe('점수', () => {
  it('클리어 1000000 + 남은 생명 × 1000 + 처치 수(999 까지). 실패·포기한 판은 처치 수만', () => {
    expect(dailyScore(true, 18, 240)).toBe(1_018_240);
    expect(dailyScore(true, 25, 5000)).toBe(1_025_000 + DAILY_KILLS_CAP);
    expect(dailyScore(false, 0, 120)).toBe(120);
    // 포기한 판의 남은 생명은 세지 않는다
    expect(dailyScore(false, 20, 30)).toBe(30);
    // 순서: 클리어 > 생명 > 처치
    expect(dailyScore(true, 1, 0)).toBeGreaterThan(dailyScore(false, 0, 99999));
    expect(dailyScore(true, 2, 0)).toBeGreaterThan(dailyScore(true, 1, 99999));
  });

  it('서버(087 defense_finish)의 식과 같다', () => {
    const sql = file('../../../supabase/migrations/087_defense_daily.sql');
    expect(sql).toContain('d_score := (case when p_cleared then 1000000 + p_lives::bigint * 1000 else 0 end) + least(p_kills, 999);');
    expect(DAILY_KILLS_CAP).toBe(999);
    expect(sql).toContain("public._daily_record(me, 'defense', d_score,");
  });

  it('순위표 한 줄', () => {
    expect(dailyDetailText({ cleared: true, lives: 18, kills: 240 }, 1018240)).toBe('클리어 · ❤️ 18 · 💀 240');
    expect(dailyDetailText({ cleared: false, lives: 0, kills: 120 }, 120)).toBe('실패 · 💀 120');
    expect(dailyDetailText(null, 1234)).toBe('1,234점');
  });
});

describe('조건이 판 계산에 주는 영향', () => {
  const cfg = { seed: 5, stage: '1-5', squad: [...STARTERS] };

  it('조건이 없거나 배율이 1이면 판이 보통 판과 똑같다', () => {
    const base = dailyChallenge('2026-11-23');
    expect(dailyMods({ ...base, hpMul: 1, energyMul: 1 })).toBeUndefined();
    const a = createGame(cfg);
    const b = createGame({ ...cfg, mods: { hp: 1, energy: 1 } });
    expect(b.spawns).toEqual(a.spawns);
    expect(b.energy).toBe(a.energy);
    expect(b.lives).toBe(a.lives);
  });

  it('억센 요괴: 웨이브 요괴와 보스의 체력 배율만 1.3배 (등장 시각·수는 그대로) · 빈 주머니: 시작 기운만 70%', () => {
    const base = dailyChallenge('2026-11-23');
    const a = createGame(cfg);
    const tough = createGame({ ...cfg, mods: dailyMods({ ...base, hpMul: DAILY_HP_MUL, energyMul: 1 }) });
    expect(tough.spawns.map((s) => [s.t, s.kind, s.boss, s.route])).toEqual(a.spawns.map((s) => [s.t, s.kind, s.boss, s.route]));
    tough.spawns.forEach((s, i) => expect(s.hpMul).toBeCloseTo(a.spawns[i].hpMul * DAILY_HP_MUL, 9));
    expect(tough.spawns.some((s) => s.boss >= 0)).toBe(true);
    expect(tough.energy).toBe(a.energy);
    const lean = createGame({ ...cfg, mods: dailyMods({ ...base, hpMul: 1, energyMul: DAILY_ENERGY_MUL }) });
    expect(lean.spawns).toEqual(a.spawns);
    expect(lean.energy).toBe(Math.floor(a.energy * DAILY_ENERGY_MUL + 1e-6));
    // 첫 캐릭터 하나는 놓을 수 있다 (모든 스테이지)
    const cheapest = Math.min(...createGame(cfg).cost.filter((_, i) => createGame(cfg).squad.includes(i)));
    for (const st of STAGES) expect(Math.floor(st.energy * DAILY_ENERGY_MUL + 1e-6), st.id).toBeGreaterThanOrEqual(cheapest);
  });

  it('조건을 건 판도 서버 검사를 통과한다: 클리어는 180초 이상 · 처치 수 상한 안', { timeout: 120_000 }, () => {
    const base = dailyChallenge('2026-11-23');
    const runs = [
      simulate({ ...cfg, stage: '1-3', mods: { hp: DAILY_HP_MUL } }, skillPolicy(5, SKILLS.expert)),
      simulate({ ...cfg, stage: '1-3', mods: { energy: DAILY_ENERGY_MUL } }, skillPolicy(5, SKILLS.expert)),
      simulate({ ...cfg, stage: '1-3', squad: dailySquad({ ...base, ban: null, squadMax: DAILY_SQUAD_MAX }, [...STARTERS]) }, skillPolicy(5, SKILLS.expert)),
    ];
    for (const { summary } of runs) {
      const report: RunReport = { ...summary, run: 'x' };
      expect(rejectReason(report, 1e4, summary.startLives)).toBeNull();
      expect(isValid(report)).toBe(true);
      if (summary.cleared) expect(summary.time).toBeGreaterThanOrEqual(LIMITS.clear_min_time);
      else expect(summary.lives).toBe(0);
    }
    // 같은 시드·같은 명령이면 같은 결과 (모든 기기에서 같은 판)
    const again = simulate({ ...cfg, stage: '1-3', mods: { hp: DAILY_HP_MUL } }, skillPolicy(5, SKILLS.expert));
    expect([again.summary.kills, again.summary.lives, again.state.tick]).toEqual([runs[0].summary.kills, runs[0].summary.lives, runs[0].state.tick]);
  });
});

describe('기록 흐름', () => {
  const report = (run: string, over: Partial<RunReport> = {}): RunReport => ({
    run, stage: '7-5', cleared: true, lives: 18, startLives: 20, time: 185, kills: 240, placed: 5, cmds: 10, bonus: 0, codex: { enemies: [], bosses: [] }, ...over,
  });

  it('applyRun(daily): 잠긴 스테이지도 되고, 별·첫 클리어·해금 없이 엽전만 (클리어 보상 또는 버틴 만큼)', () => {
    const p = defaultProfile();
    const st = stageOf('7-5')!;
    expect(() => applyRun(p, report('a'))).toThrow('stage locked');
    const won = applyRun(p, report('a'), ['rat'], 'normal', true);
    expect(won.result).toMatchObject({ coins: st.coins, baseCoins: st.coins, firstCoins: 0, starCoins: 0, newStars: 0, firstClear: false, unlocked: [], opened: null, valid: true });
    expect(won.profile.stages).toEqual({});
    expect(won.profile.unlocked).toEqual(p.unlocked);
    expect(won.profile.coins).toBe(st.coins);
    const lost = applyRun(p, report('b', { cleared: false, lives: 0, time: 95 }), ['rat'], 'normal', true);
    expect(lost.result.coins).toBe(Math.floor((st.coins * 3) / 15));
    // 너무 짧은 판: 아무것도
    expect(applyRun(p, report('c', { cleared: false, lives: 20, time: 10 }), ['rat'], 'normal', true).result.coins).toBe(0);
  });

  it('테스트 모드: 잠긴 스테이지를 오늘의 고개로 시작·저장할 수 있다 (서버 기록 없이 daily = null)', async () => {
    let now = 1_000_000;
    const api = createLocalApi(store(), 'k', () => now);
    await expect(api.start('7-5', ['rat'])).rejects.toThrow('stage locked');
    await expect(api.start('endless', ['rat'], 'endless', '2026-11-23')).rejects.toBeInstanceOf(ApiError);
    const info = await api.start('7-5', ['rat'], 'normal', '2026-11-23');
    now += 200_000;
    const out = await api.finish(report(info!.run));
    expect(out!.result.daily).toBeNull();
    expect(out!.result.newStars).toBe(0);
    expect(out!.profile.stages).toEqual({});
    expect(out!.profile.coins).toBeGreaterThan(0);
  });

  it('서버: 오늘의 고개는 defense_daily_start(p_day) 로 시작하고, 끝낸 답의 daily 를 읽는다', async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    const sb: RpcClient = {
      rpc(fn, args) {
        calls.push([fn, args]);
        if (fn === 'defense_daily_start') return Promise.resolve({ data: { run: 'r1', startLives: 20, upgrades: {}, levels: {}, day: '2026-11-23' }, error: null });
        if (fn === 'defense_start') return Promise.resolve({ data: { run: 'r2', startLives: 20, upgrades: {}, levels: {} }, error: null });
        return Promise.resolve({
          data: { profile: {}, result: { stars: 2, coins: 135, baseCoins: 135, valid: true, daily: args?.p_run === 'r1' ? { day: '2026-11-23', score: 1018240, best: 1018240, improved: true, first: true } : null } },
          error: null,
        });
      },
    };
    const api = createSupabaseApi(sb, 'u', store());
    expect((await api.start('7-5', ['rat'], 'normal', '2026-11-23'))!.run).toBe('r1');
    expect(calls[0]).toEqual(['defense_daily_start', { p_stage: '7-5', p_squad: ['rat'], p_day: '2026-11-23' }]);
    expect((await api.finish(report('r1')))!.result.daily).toEqual({ day: '2026-11-23', score: 1018240, best: 1018240, improved: true, first: true });
    // 보통 판은 예전과 같은 인자로
    await api.start('1-1', ['rat']);
    expect(calls.find((c) => c[0] === 'defense_start')).toEqual(['defense_start', { p_stage: '1-1', p_squad: ['rat'] }]);
    expect((await api.finish(report('r2', { stage: '1-1' })))!.result.daily).toBeNull();
  });

  it('서버가 날짜가 바뀌었다고 거절하면 ApiError(bad day)', async () => {
    const sb: RpcClient = { rpc: () => Promise.resolve({ data: null, error: { code: 'P0001', message: 'bad day' } }) };
    await expect(createSupabaseApi(sb, 'u', store()).start('7-5', ['rat'], 'normal', '2026-11-22')).rejects.toThrow('bad day');
  });

  it('dailyRecord: 모양이 틀리면 null', () => {
    expect(dailyRecord(null)).toBeNull();
    expect(dailyRecord({ day: 1, score: 3 })).toBeNull();
    expect(dailyRecord({ day: '2026-11-23', score: 50, best: 120, improved: false, first: false })).toEqual({ day: '2026-11-23', score: 50, best: 120, improved: false, first: false });
  });
});

describe('SQL 087: 판 끝 함수는 060 의 정의를 그대로 이어받는다', () => {
  const body = (src: string, name: string) => {
    const at = src.lastIndexOf(`create or replace function public.${name}(`);
    expect(at, name).toBeGreaterThanOrEqual(0);
    return src.slice(at, src.indexOf('$$;', at)).replace(/\r/g, '');
  };
  const sql087 = file('../../../supabase/migrations/087_defense_daily.sql');

  it('060 의 defense_finish 에서 바뀐 줄은 오늘의 고개 처리뿐이다', () => {
    const now = body(sql087, 'defense_finish');
    const old = body(file('../../../supabase/migrations/060_defense_review.sql'), 'defense_finish');
    const have = new Set(now.split('\n').map((l) => l.trim()));
    const gone = old.split('\n').map((l) => l.trim()).filter((l) => l && !have.has(l));
    expect(gone).toEqual([
      'select d.stars into old from public.defense_stages d where d.user_id = me and d.stage_id = rn.stage_id;',
      'if counted then',
      "'stars', case when counted then n_stars else 0 end, 'bestStars', greatest(old, case when counted then n_stars else 0 end),",
      "'bestWave', greatest(old_wave, case when endless and counted then wave else 0 end), 'newRecord', new_record));",
    ].filter((l) => !have.has(l)));
    expect(now).toContain('daily := rn.daily is not null;');
    expect(now).toContain('if daily and counted and rn.daily >= public._daily_day() - 1 then');
    expect(now).toContain("'daily', d_out));");
  });

  it('판 시작: 날짜 확인 · 스테이지 잠금은 보지 않음 · 캐릭터 검사는 그대로 · 로그인한 사용자만', () => {
    const st = body(sql087, 'defense_daily_start');
    expect(st).toContain("if p_day is null or p_day <> to_char(d, 'YYYY-MM-DD') then raise exception 'bad day'; end if;");
    expect(st).not.toContain('_defense_stage_open');
    expect(st).toContain("perform public._check_character(me, c, 'defense');");
    expect(st).toContain('security definer set search_path = public');
    expect(sql087).toContain('revoke all on function public.defense_daily_start(text, text[], text) from public, anon;');
    expect(sql087).toContain('grant execute on function public.defense_daily_start(text, text[], text) to authenticated;');
    expect(sql087).toContain('revoke all on function public.defense_finish(uuid, int, boolean, int, int, int, int, int, int, jsonb) from public, anon;');
    expect(sql087).toContain('alter table public.defense_runs add column if not exists daily date;');
    expect(file('../../../supabase/migrations/082_daily.sql')).toMatch(/_daily_games\(\)[\s\S]*'defense'/);
  });
});
