import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectLevel } from '../src/data/balance';
import {
  DAILY_FROM_REGION,
  checkDaily,
  dailyChallenge,
  dailyDetailText,
  dailyLevels,
  dailyScore,
  dailySeed,
  dailySnapshot,
  dailyStages,
  dayLabel,
  isDay,
  localDay,
} from '../src/game/daily';
import { ApiError, createLocalApi, createSupabaseApi, type ServerClient, type Store } from '../src/net/api';
import { FINGER_RULES, HEROES, HERO_IDS, STAGES, buildConfig, createRun, playShot, resultOf, stageOf, verifyRun, type ShotInput } from '../src/sim';
import { choose } from '../src/game/autopilot';
import { CALIB_PILOT } from '../src/data/balance';

/** 오늘의 도전 (086_finger_daily.sql): 날짜 → 조건은 순수 함수, 모든 기기에서 같다 */

const memStore = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const days = (n: number, from = Date.UTC(2026, 10, 23)) => Array.from({ length: n }, (_, i) => new Date(from + i * 86400000).toISOString().slice(0, 10));

describe('오늘의 도전 조건', () => {
  it('시드 식이 shared/daily.js 의 dailySeed 와 같다', () => {
    const src = readFileSync(new URL('../../../shared/daily.js', import.meta.url), 'utf8');
    const body = src.match(/export function dailySeed\(game, day, salt = ''\) \{([\s\S]*?)\n\}/)?.[1];
    expect(body).toBeTruthy();
    const shared = new Function('game', 'day', 'salt', `if (salt === undefined) salt = '';${body}`) as (g: string, d: string, s?: string) => number;
    for (const day of days(40)) for (const salt of [undefined, 'stage', 'party0:0', 'party3:2']) expect(dailySeed('finger', day, salt)).toBe(shared('finger', day, salt));
    expect(dailySeed('finger', '2026-11-23', 'stage')).not.toBe(dailySeed('running', '2026-11-23', 'stage'));
  });

  it('같은 날짜면 늘 같은 조건, 날짜가 다르면 달라진다', () => {
    expect(dailyChallenge('2026-11-23')).toEqual(dailyChallenge('2026-11-23'));
    // 값을 못 박아 둔다: 바뀌면 그날 이미 올라간 기록과 조건이 달라진다
    expect(dailyChallenge('2026-11-23')).toEqual({ day: '2026-11-23', stage: '9-4', party: ['snake', 'pig', 'rat', 'monkey'], level: 17 });
    const list = days(120).map((d) => dailyChallenge(d));
    expect(new Set(list.map((c) => c.stage)).size).toBeGreaterThan(30);
    expect(new Set(list.map((c) => c.party.join())).size).toBeGreaterThan(100);
  });

  it('스테이지는 2~12지역, 파티는 십이지 4명(중복 없음 · 두 타입 섞임), 레벨은 그 지역 예상 레벨', () => {
    expect(dailyStages().length).toBe(STAGES.length - 5);
    for (const c of days(400).map((d) => dailyChallenge(d))) {
      const st = stageOf(c.stage)!;
      expect(st.region, c.day).toBeGreaterThanOrEqual(DAILY_FROM_REGION);
      expect(c.party.length).toBe(4);
      expect(new Set(c.party).size).toBe(4);
      expect(c.party.every((id) => (HERO_IDS as readonly string[]).includes(id))).toBe(true);
      expect(new Set(c.party.map((id) => HEROES[id].type)).size, c.day).toBe(2);
      expect(c.level).toBe(expectLevel(st.region));
      expect(checkDaily(c)).toBeNull();
    }
  });

  it('다른 시드 함수를 주면 그 함수로만 고른다 (공통 모듈의 dailySeed 를 넘긴다)', () => {
    const c = dailyChallenge('2026-11-23', () => 0);
    expect(c.stage).toBe(dailyStages()[0].id);
    expect(c.party).toEqual(HERO_IDS.slice(0, 4));
  });

  it('스냅숏은 보통 판 모양 (정해진 레벨 · 강화 없음) — verifyRun 이 그대로 다시 돌린다', () => {
    const c = dailyChallenge('2026-11-23');
    expect(dailySnapshot(c)).toEqual({ stage: '9-4', mode: 'normal', party: c.party, levels: { snake: 17, pig: 17, rat: 17, monkey: 17 }, upgrades: {} });
    expect(dailyLevels(c)).toEqual({ snake: 17, pig: 17, rat: 17, monkey: 17 });
    // 화면이 만드는 판과 서버가 스냅숏으로 다시 돌리는 판의 결과가 같다
    const s = createRun(buildConfig({ stage: c.stage, mode: 'normal', party: c.party, levels: dailyLevels(c), upgrades: {} }));
    while (s.phase === 'aim') playShot(s, choose(s, CALIB_PILOT));
    const r = resultOf(s);
    expect(r.cleared).toBe(true);
    expect(verifyRun(dailySnapshot(c), s.log)).toEqual(r);
    expect(dailyScore(r)).toBe(-r.turns);
  });

  it('조건 검사 · 점수 · 글', () => {
    const c = dailyChallenge('2026-11-23');
    expect(checkDaily({ ...c, day: 'x' })).toBe('bad day');
    expect(checkDaily({ ...c, stage: '1-3' })).toBe('bad stage');
    expect(checkDaily({ ...c, stage: 'tower' })).toBe('bad stage');
    expect(checkDaily({ ...c, party: ['rat', 'ox', 'tiger'] })).toBe('bad party');
    expect(checkDaily({ ...c, party: ['rat', 'rat', 'ox', 'tiger'] })).toBe('bad party');
    expect(checkDaily({ ...c, party: ['rat', 'cat', 'ox', 'tiger'] })).toBe('bad party');
    expect(dailyScore({ cleared: true, turns: 12 })).toBe(-12);
    expect(dailyScore({ cleared: false, turns: 12 })).toBeNull();
    expect(dailyDetailText(-12, { turns: 12, fallen: 0 })).toBe('12턴');
    expect(dailyDetailText(-12, { turns: 12, fallen: 2 })).toBe('12턴 · 쓰러짐 2');
    expect(dailyDetailText(-9, null)).toBe('9턴');
    expect(dayLabel('2026-11-03')).toBe('11월 3일');
    expect(isDay('2026-11-23')).toBe(true);
    expect(isDay('2026-1-1')).toBe(false);
    // 한국 시간 자정 = UTC 15시
    expect(localDay(Date.UTC(2026, 10, 23, 14, 59))).toBe('2026-11-23');
    expect(localDay(Date.UTC(2026, 10, 23, 15, 0))).toBe('2026-11-24');
  });
});

describe('오늘의 도전 판 기록', () => {
  const c = dailyChallenge('2026-11-23');
  const playAll = (): ShotInput[] => {
    const s = createRun(buildConfig({ stage: c.stage, mode: 'normal', party: c.party, levels: dailyLevels(c), upgrades: {} }));
    while (s.phase === 'aim') playShot(s, choose(s, CALIB_PILOT));
    return s.log.slice();
  };

  it('테스트 모드: 아무것도 안 연 기록으로도 시작되고, 엽전·별·스테이지 기록은 그대로', async () => {
    const api = createLocalApi(memStore());
    const before = await api.loadProfile();
    const run = await api.startDaily(c);
    const out = await api.finish({ run, stage: c.stage, inputs: playAll(), rules: FINGER_RULES });
    expect(out!.replay!.cleared).toBe(true);
    expect(out!.result).toEqual({ coins: 0, stars: out!.replay!.stars, floors: 0, first: false, best: false, siaCoin: false, newHeroes: [], daily: { day: c.day, recorded: false } });
    expect(await api.loadProfile()).toEqual(before);
    await expect(api.startDaily({ ...c, stage: '1-1' })).rejects.toThrow(ApiError);
    // 보통 판은 그대로 (잠긴 스테이지는 거절)
    await expect(api.start(c.stage, ['rat'])).rejects.toThrow('stage locked');
  });

  it('서버: finger_daily_start 에 스테이지 · 파티 · 날짜를 보내고, 날짜가 바뀌었으면 bad day', async () => {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    let fail: string | null = null;
    const client: ServerClient = {
      rpc: (fn, args) => {
        calls.push([fn, args]);
        return Promise.resolve(fail ? { data: null, error: { message: fail } } : { data: 'run-1', error: null });
      },
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    };
    const api = createSupabaseApi(client, 'u1', memStore());
    expect(await api.startDaily(c)).toBe('run-1');
    expect(calls[0]).toEqual(['finger_daily_start', { p_stage: c.stage, p_party: c.party, p_day: c.day }]);
    fail = 'bad day';
    await expect(api.startDaily(c)).rejects.toThrow('bad day');
    // 통신 실패는 기록되지 않는 판 ('')
    fail = 'Failed to fetch';
    expect(await api.startDaily(c)).toBe('');
  });
});
