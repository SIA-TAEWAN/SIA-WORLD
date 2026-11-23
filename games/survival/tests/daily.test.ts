import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUN_SEC } from '../src/data/balance';
import { CHARACTER_BY_ID } from '../src/data/characters';
import { MAPS, MAP_INDEX } from '../src/data/maps';
import { UPGRADE_TOTAL, presetUpgrades } from '../src/data/upgrades';
import {
  DAILY_CHARS, DAILY_CLEAR_BONUS, DAILY_GAME, DAILY_MAPS, DAILY_TIME_UNIT, DAILY_UPGRADES,
  cleanDailyRanking, dailyChallenge, dailyScore, dailySeed, dayText, isDay, localDay,
} from '../src/game/daily';
import { LIMITS, applyRun, defaultProfile, validRun } from '../src/game/progress';
import { createLocalApi } from '../src/net/api';
import { createRun, step, makeInput, summarize, type RunSummary } from '../src/game/sim';

const file = (p: string) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8');

/** 날짜 n일 뒤 */
const dayAfter = (n: number) => new Date(Date.UTC(2026, 10, 23) + n * 86400_000).toISOString().slice(0, 10);

describe('오늘의 도전: 조건', () => {
  it('시드 식은 shared/daily.js 의 dailySeed 와 같다 (모든 기기·게임이 같은 값을 만든다)', () => {
    const src = file('shared/daily.js');
    const at = src.indexOf('export function dailySeed(');
    const fn = src.slice(at, src.indexOf('\n}', at) + 2).replace('export function dailySeed', 'return function');
    const shared = new Function(fn)() as (g: string, d: string, s?: string) => number;
    for (let i = 0; i < 40; i++) {
      for (const salt of ['', 'map', 'char', 'seed']) expect(dailySeed(DAILY_GAME, dayAfter(i), salt)).toBe(shared(DAILY_GAME, dayAfter(i), salt));
    }
    expect(dailySeed('survival', '2026-11-23', 'seed')).toBe(shared('survival', '2026-11-23', 'seed'));
    // 공통 틀의 게임 목록에 이 게임이 있다 (SQL · JS)
    expect(src).toContain(`'${DAILY_GAME}'`);
    expect(file('supabase/migrations/082_daily.sql')).toMatch(new RegExp(`array\\[[^\\]]*'${DAILY_GAME}'`));
  });

  it('같은 날이면 언제나 같은 조건, 값은 날짜 문자열에서만 나온다', () => {
    const a = dailyChallenge('2026-11-23');
    expect(dailyChallenge('2026-11-23')).toEqual(a);
    expect(a.day).toBe('2026-11-23');
    expect(a.seed).toBe(dailySeed('survival', '2026-11-23', 'seed'));
    expect(Number.isInteger(a.seed) && a.seed >= 0 && a.seed <= 0xffffffff).toBe(true);
    // 넘겨준 시드 함수(shared/daily.js 의 것)를 쓴다
    const fixed = dailyChallenge('2026-11-23', () => 5);
    expect(fixed).toEqual({ day: '2026-11-23', map: DAILY_MAPS[5 % DAILY_MAPS.length], char: DAILY_CHARS[5 % DAILY_CHARS.length], seed: 5, upg: DAILY_UPGRADES[DAILY_MAPS[5 % DAILY_MAPS.length]] });
  });

  it('맵은 모든 맵에서, 캐릭터는 처음부터 열려 있는 캐릭터에서만 고른다 (고양이·잠긴 캐릭터 제외)', () => {
    expect(DAILY_MAPS).toEqual(MAPS.map((m) => m.id));
    expect(DAILY_CHARS).toEqual(defaultProfile().unlockedCharacters);
    expect(DAILY_CHARS.length).toBeGreaterThan(1);
    for (const c of DAILY_CHARS) expect(CHARACTER_BY_ID[c].unlock.kind).toBe('base');
    const maps = new Set<string>();
    const chars = new Set<string>();
    const seeds = new Set<number>();
    for (let i = 0; i < 120; i++) {
      const c = dailyChallenge(dayAfter(i));
      expect(MAP_INDEX[c.map]).not.toBeUndefined();
      expect(DAILY_CHARS).toContain(c.char);
      expect(c.upg).toBe(DAILY_UPGRADES[c.map]);
      maps.add(c.map);
      chars.add(c.char);
      seeds.add(c.seed);
    }
    // 날마다 바뀐다: 넉 달이면 모든 맵·캐릭터가 나오고 시드는 겹치지 않는다
    expect([...maps].sort()).toEqual([...DAILY_MAPS].sort());
    expect([...chars].sort()).toEqual([...DAILY_CHARS].sort());
    expect(seeds.size).toBe(120);
  });

  it('강화 단계: 맵마다 정해져 있고 (PRD 7장의 클리어 가능한 수준) 맵이 어려울수록 높다', () => {
    expect(Object.keys(DAILY_UPGRADES)).toEqual(MAPS.map((m) => m.id));
    const levels = MAPS.map((m) => DAILY_UPGRADES[m.id]);
    expect(levels).toEqual([10, 22, 34, 44]);
    for (const n of levels) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(UPGRADE_TOTAL);
      expect(Object.values(presetUpgrades(n)).reduce((a, b) => a + b, 0)).toBe(n);
    }
  });

  it('날짜: 한국 시간 기준, 모양 확인', () => {
    // UTC 15시 = 한국 자정
    expect(localDay(Date.UTC(2026, 10, 23, 14, 59))).toBe('2026-11-23');
    expect(localDay(Date.UTC(2026, 10, 23, 15, 0))).toBe('2026-11-24');
    expect(isDay('2026-11-23')).toBe(true);
    for (const v of ['2026-11-3', '', null, 20261123, '2026-11-23T00:00']) expect(isDay(v)).toBe(false);
    expect(dayText('2026-11-03')).toBe('11월 3일');
    expect(dayText('x')).toBe('');
  });

  it('같은 조건이면 판이 똑같이 흘러간다 (시드가 요괴 등장을 정한다)', () => {
    const c = dailyChallenge('2026-11-23');
    const play = (): RunSummary => {
      const s = createRun({ seed: c.seed, char: c.char, map: c.map, mode: 'normal', upgrades: presetUpgrades(c.upg), numbers: false });
      const input = makeInput();
      for (let i = 0; i < 60 * 25 && s.phase !== 'over' && s.phase !== 'clear'; i++) {
        input.mx = Math.cos(i / 40);
        input.my = Math.sin(i / 40);
        if (s.phase === 'levelup') input.pick = 0;
        step(s, input);
        input.pick = -1;
      }
      return { ...summarize(s), build: undefined };
    };
    expect(play()).toEqual(play());
  });
});

describe('오늘의 도전: 점수', () => {
  it('오래 버틴 순 → 클리어 → 처치 수', () => {
    expect(dailyScore({ time: 150, kills: 300, cleared: false })).toBe(15_000_300);
    expect(dailyScore({ time: 240, kills: 2000, cleared: true })).toBe(24_052_000);
    // 1초 더 버틴 쪽이 처치 수와 상관없이 위
    const maxKills = LIMITS.kills_base + RUN_SEC * LIMITS.kills_per_sec;
    expect(dailyScore({ time: 100, kills: 0, cleared: false })).toBeGreaterThan(dailyScore({ time: 99, kills: maxKills, cleared: false }));
    // 4분을 채웠으면 클리어한 쪽이 처치 수와 상관없이 위, 클리어끼리는 처치 수
    expect(dailyScore({ time: 240, kills: 0, cleared: true })).toBeGreaterThan(dailyScore({ time: 240, kills: maxKills, cleared: false }));
    expect(dailyScore({ time: 240, kills: 901, cleared: true })).toBeGreaterThan(dailyScore({ time: 240, kills: 900, cleared: true }));
    // 자리가 겹치지 않는다: 처치 수 상한 < 클리어 자리, 클리어 자리 + 처치 수 상한 < 1초 자리
    expect(maxKills).toBeLessThan(DAILY_CLEAR_BONUS);
    expect(DAILY_CLEAR_BONUS + maxKills).toBeLessThan(DAILY_TIME_UNIT);
    // 시간은 4분까지
    expect(dailyScore({ time: 999, kills: 0, cleared: false })).toBe(RUN_SEC * DAILY_TIME_UNIT);
  });

  it('서버(084)도 같은 식으로 넣는다', () => {
    const sql = file('supabase/migrations/084_survival_daily.sql').replace(/\s+/g, ' ');
    expect(sql).toContain(`p_time::bigint * ${DAILY_TIME_UNIT} + (case when p_cleared then ${DAILY_CLEAR_BONUS} else 0 end) + p_kills,`);
    expect(sql).toContain(`d_res := public._daily_record(me, '${DAILY_GAME}',`);
    // 서버가 받아들인 정상 판만 (상한 안 · 처치 수 하한 이상), 판을 시작한 날의 순위에
    expect(sql).toContain('if daily and ok and enough then');
    expect(sql).toContain("d_day := (rn.started_at at time zone 'Asia/Seoul')::date;");
    expect(sql).toContain("jsonb_build_object('time', p_time, 'kills', p_kills, 'cleared', p_cleared, 'level', p_level, 'map', rn.map_id, 'character', rn.character)");
  });

  it('순위 읽기: 모양이 다른 답은 버리고, 값은 고쳐 쓴다', () => {
    expect(cleanDailyRanking(null)).toBeNull();
    expect(cleanDailyRanking({ day: 'x', top: [] })).toBeNull();
    expect(cleanDailyRanking({ day: '2026-11-23' })).toBeNull();
    const r = cleanDailyRanking({
      day: '2026-11-23', today: '2026-11-23', total: 3,
      top: [
        { place: 1, nickname: '가', score: 24052000, detail: { time: 240, kills: 2000, cleared: true }, me: false },
        { place: 2, nickname: '나', score: 15000300, detail: { time: 150, kills: 300, cleared: false }, me: true },
        { place: 0, nickname: '?' }, null,
      ],
      mine: { place: 2, score: 15000300, detail: { time: 150, kills: 300, cleared: false }, plays: 4 },
    })!;
    expect(r.top).toEqual([
      { place: 1, nickname: '가', time: 240, kills: 2000, cleared: true, me: false },
      { place: 2, nickname: '나', time: 150, kills: 300, cleared: false, me: true },
    ]);
    expect(r.mine).toEqual({ place: 2, time: 150, kills: 300, cleared: false, plays: 4 });
    expect(r.total).toBe(3);
    expect(cleanDailyRanking({ day: '2026-11-23', top: [], mine: null, total: 0 })).toEqual({ day: '2026-11-23', top: [], mine: null, total: 0 });
  });
});

describe('오늘의 도전: 판 결과 (기기 쪽 규칙 = 서버 084)', () => {
  const run = (over: Partial<RunSummary> = {}): RunSummary => ({
    map: 'underworld', character: 'tiger', mode: 'normal', time: 240, kills: 2000, level: 20, coins: 100, cleared: true, bossKills: 3, cakes: 2,
    codex: { enemies: [], bosses: [], weapons: [], passives: [] }, ...over,
  });

  it('맵별 기록·다음 맵 해금·시간/클리어 조건 해금·최고 생존 시간에는 넣지 않고, 엽전·누적은 4분 모드처럼 받는다', () => {
    expect(validRun(run())).toBe(true);
    const out = applyRun(defaultProfile(), {}, run(), 1, {}, {}, true);
    expect(out.records).toEqual({});
    expect(out.result.newRecord).toBe(false);
    expect(out.result.unlockedMaps).toEqual([]);
    expect(out.profile.unlockedMaps).toEqual(defaultProfile().unlockedMaps);
    expect(out.profile.clearedMaps).toEqual([]);
    expect(out.profile.totals.bestTime).toBe(0);
    // 시간(토끼·말)·클리어(돼지) 조건은 건너뛰고, 누적 조건(용: 보스 · 뱀: 처치 1,000)은 그대로
    expect(out.result.unlockedCharacters.sort()).toEqual(['dragon', 'snake']);
    expect(out.profile.coins).toBe(100);
    expect(out.profile.totals).toMatchObject({ kills: 2000, runs: 1, clears: 1, bossKills: 3 });
    // 같은 판이 4분 모드였다면 기록과 해금에 들어간다
    const normal = applyRun(defaultProfile(), {}, run({ map: 'field' }), 1);
    expect(normal.result.newRecord).toBe(true);
    expect(normal.result.unlockedMaps).toEqual(['bamboo']);
    expect(normal.result.unlockedCharacters).toContain('pig');
  });

  it('테스트 모드: 잠긴 맵에서도 시작되고 (고양이는 안 된다) 기록에 남지 않는다', async () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    let t = 1_000_000;
    const api = createLocalApi(store, () => t);
    await expect(api.start('underworld', 'tiger')).rejects.toThrow('map locked');
    await expect(api.start('underworld', 'cat', 0, 'normal', true)).rejects.toThrow('bad character');
    const id = (await api.start('underworld', 'tiger', 0, 'normal', true))!;
    t += 300_000;
    const out = (await api.finish({ ...run(), run: id }))!;
    expect(out.result.newRecord).toBe(false);
    expect(out.profile.unlockedMaps).toEqual(['field']);
    expect(out.profile.clearedMaps).toEqual([]);
    // 다음 판(4분 모드)은 평소대로
    const id2 = (await api.start('field', 'tiger'))!;
    t += 300_000;
    const out2 = (await api.finish({ ...run({ map: 'field' }), run: id2 }))!;
    expect(out2.result.newRecord).toBe(true);
    expect(out2.profile.unlockedMaps).toEqual(['field', 'bamboo']);
  });
});
