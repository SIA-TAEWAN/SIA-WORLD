import { describe, expect, it, vi } from 'vitest';
import { DT, LANES, ZODIAC_IDS } from '../src/game/constants';
import { dailyTrack, dailyTrackSeed } from '../src/game/daily';
import {
  GHOST_MAX_PRESSES, GHOST_MAX_STEP, GhostPlayer, GhostRecorder, acceptGhost, ghostDiffText, ghostName, parseGhost, pressKindOf, replayGhost, type Ghost,
} from '../src/game/ghost';
import { aiPress, type AiPlan } from '../src/game/ai';
import { lineup } from '../src/game/lineup';
import { formatTime } from '../src/game/ranking';
import { newRunner, stepRunner, type Press } from '../src/game/sim';
import type { Obstacle } from '../src/game/track';

// RaceGame 은 서버 시각을 쓴다: 손으로 돌리는 시계로
const clock = { now: 5_000_000 };
vi.mock('../src/net/api', () => ({ serverNow: () => clock.now, GO_GAP_MS: 4000, GoTooSoonError: class extends Error {} }));
const { RaceGame } = await import('../src/race/game');
const { soloRoster, ghostRunOf, submitGhost, SoloSession } = await import('../src/net/solo');
type Api = import('../src/net/api').RaceApi;

const DAYS = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-12-01'];
const me = { id: 'u1', name: '시아' };

/** 계획(잘 넘기 / 실수 섞기)대로 달리며 누른 것을 적는다 (sim 만으로) */
function recordRun(obs: readonly Obstacle[], plan: AiPlan, extra: (step: number) => Press = () => false) {
  const r = newRunner();
  const rec = new GhostRecorder();
  for (let step = 1; step <= GHOST_MAX_STEP && r.finishMs === null; step++) {
    let p = aiPress(r, obs, plan);
    if (!p) p = extra(step);
    stepRunner(r, obs, p);
    if (p) {
      const k = pressKindOf(r.events);
      if (k !== null) rec.recordPress(step, k);
    }
    r.events.length = 0;
  }
  return { ms: r.finishMs, rec };
}

const goodPlan = (obs: readonly Obstacle[], miss = new Set<number>()): AiPlan => ({
  react: 0.13,
  jump: Object.fromEntries(obs.map((o) => [o.id, miss.has(o.id) ? o.kind === 'boost' : o.kind !== 'boost'])),
});

describe('고스트 기록 → 재생 (같은 트랙이면 같은 도착 기록)', () => {
  it('여러 날짜 트랙, 점프·슬라이딩·실수가 섞인 입력, 쓸데없는 누름까지', () => {
    for (const day of DAYS) {
      const obs = dailyTrack(day);
      const miss = new Set(obs.filter((_, i) => i % 4 === 1).map((o) => o.id));
      let s = dailyTrackSeed(day);
      // 가끔 아무 때나 점프·슬라이딩도 눌러 본다 (공중·넘어짐 중의 누름은 안 적힌다)
      const noise = () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        const v = s / 0x100000000;
        return v < 0.01 ? 'jump' : v < 0.02 ? 'slide' : false;
      };
      for (const [plan, extra] of [
        [goodPlan(obs), undefined],
        [goodPlan(obs, miss), noise],
      ] as const) {
        const { ms, rec } = recordRun(obs, plan, extra);
        expect(ms).not.toBeNull();
        const g = rec.build(day, 'cat', ms!)!;
        expect(g.presses.length).toBeGreaterThan(5);
        expect(g.presses.some(([, k]) => k === 2)).toBe(true); // 슬라이딩이 들어 있다
        expect(g.presses[0][1]).toBe(0); // 첫 누름은 출발
        expect(replayGhost(g, obs).finishMs).toBe(ms);
        // JSON 으로 오갔다 와도 같다
        expect(acceptGhost(JSON.parse(JSON.stringify(g)), day, obs)).toEqual(g);
      }
    }
  });

  it('RaceGame 에서 기록한 것(화면이 가려져 따라잡기 루프로 한꺼번에 돈 것 포함)도 재생하면 같은 기록', () => {
    const day = '2026-11-23';
    const obs = dailyTrack(day);
    const plan = goodPlan(obs, new Set([obs[3].id]));
    for (const hiddenAt of [null, 8000, 15000]) {
      const go = (clock.now += 100_000);
      const race = new RaceGame(fakeApi(), {
        key: 'dailyabcd2345', round: 1, seed: dailyTrackSeed(day), readyAt: go - 1800, goAt: go, day, roster: soloRoster(me, 'tiger', 3),
      });
      const shadow = newRunner();
      let mine: number | null = null;
      for (let i = 0; i < 90 / DT && mine === null; i++) {
        const p = aiPress(shadow, obs, plan);
        stepRunner(shadow, obs, p);
        shadow.events.length = 0;
        const t = (i + 1) * DT * 1000;
        // hiddenAt 부터 3초 동안 화면이 멈췄다: 그동안은 누르지도, 프레임을 돌리지도 못한다 → 그림자 주자도 같은 입력을 놓친다
        if (hiddenAt !== null && t > hiddenAt && t < hiddenAt + 3000) continue;
        clock.now = go + t;
        if (p) race.press(p === 'slide' ? 'slide' : 'jump');
        race.update();
        mine = race.view(0).finishMs;
      }
      if (hiddenAt !== null) {
        // 따라잡은 판은 그림자 주자와 달라졌을 수 있지만, 적힌 걸음으로 다시 달리면 RaceGame 의 기록과 같아야 한다
        clock.now = go + 89_000;
        race.update();
        mine = race.view(0).finishMs;
      }
      expect(mine).not.toBeNull();
      const g = race.myGhost(mine!);
      expect(g).not.toBeNull();
      expect(replayGhost(g!, obs).finishMs).toBe(mine);
    }
  });

  it('경기 중 고스트 자리는 걸음마다 그 기록대로 달려 같은 시각에 도착한다 (따라잡기 루프 포함)', () => {
    const day = '2026-11-22';
    const obs = dailyTrack(day);
    const { ms, rec } = recordRun(obs, goodPlan(obs, new Set([obs[5].id, obs[9].id])));
    const ghost = rec.build(day, 'rat', ms!)!;
    const run = { ghost, nickname: '일등이', dayPlace: 1, place: 4, me: false };
    for (const frame of [16, 33, 2500]) {
      const go = (clock.now += 100_000);
      const race = new RaceGame(fakeApi(), {
        key: 'dailyabcd2345', round: 2, seed: dailyTrackSeed(day), readyAt: go - 1800, goAt: go, day,
        roster: soloRoster(me, 'rat', 9, { char: 'rat', name: ghostName(1, '일등이') }), ghost: run,
      });
      expect(race.roster[1]).toMatchObject({ role: 'ghost', char: 'rat', name: '👻 1위 일등이' });
      for (let t = 0; t <= ms! + 200; t += frame) {
        clock.now = go + t;
        race.update();
      }
      clock.now = go + ms! + 200;
      race.update();
      expect(race.view(1).finishMs, `frame ${frame}`).toBe(ms);
    }
  });
});

describe('이상한 고스트 거르기', () => {
  const day = '2026-11-21';
  const obs = dailyTrack(day);
  const { ms, rec } = recordRun(obs, goodPlan(obs));
  const good = rec.build(day, 'dog', ms!)!;
  const bad = (over: Partial<Record<keyof Ghost, unknown>>) => ({ ...good, ...over });

  it('형식 오류', () => {
    expect(parseGhost(good)).toEqual(good);
    for (const x of [
      null, 'x', 3, bad({ v: 2 }), bad({ day: '2026-13-01' }), bad({ day: '20261121' }), bad({ char: 'unicorn' }), bad({ ms: -1 }), bad({ ms: 1.5 }),
      bad({ ms: '29000' }), bad({ presses: [] }), bad({ presses: 'a' }), bad({ presses: [[1, 3]] }), bad({ presses: [[0, 0]] }), bad({ presses: [[1.5, 0]] }),
      bad({ presses: [[5, 0], [5, 1]] }), bad({ presses: [[5, 0], [3, 1]] }), bad({ presses: [[1, 0, 9]] }), bad({ presses: [[GHOST_MAX_STEP + 1, 0]] }),
    ])
      expect(parseGhost(x), JSON.stringify(x)?.slice(0, 80)).toBeNull();
    // 고양이(내가 안 연 캐릭터여도) 고스트로는 받는다
    expect(parseGhost(bad({ char: 'cat' }))?.char).toBe('cat');
  });
  it('개수 초과: 200개 넘게 적으면 고스트를 만들지 않고, 받은 것도 버린다', () => {
    const r = new GhostRecorder();
    for (let i = 1; i <= GHOST_MAX_PRESSES; i++) r.recordPress(i * 3, 1);
    expect(r.build(day, 'ox', 30000)).not.toBeNull();
    r.recordPress(9999, 1);
    expect(r.overflow).toBe(true);
    expect(r.build(day, 'ox', 30000)).toBeNull();
    const many = Array.from({ length: GHOST_MAX_PRESSES + 1 }, (_, i) => [i + 1, 1]);
    expect(parseGhost(bad({ presses: many }))).toBeNull();
  });
  it('기록 불일치(±10ms 넘게) · 다른 날짜 트랙이면 쓰지 않는다', () => {
    expect(acceptGhost(good, day, obs)).toEqual(good);
    expect(acceptGhost(bad({ ms: ms! + 10 }), day, obs)).not.toBeNull();
    expect(acceptGhost(bad({ ms: ms! - 11 }), day, obs)).toBeNull();
    expect(acceptGhost(bad({ ms: ms! + 300 }), day, obs)).toBeNull();
    expect(acceptGhost(good, '2026-11-22', dailyTrack('2026-11-22'))).toBeNull(); // 날짜가 다르다
    expect(acceptGhost(bad({ day: '2026-11-22' }), '2026-11-22', dailyTrack('2026-11-22'))).toBeNull(); // 다른 트랙에서는 기록이 다르다
    expect(acceptGhost(bad({ presses: good.presses.slice(0, 3) }), day, obs)).toBeNull(); // 도착 못 함
  });
  it('ghostRunOf: race_ghost_top 의 답을 확인해서만 쓴다', () => {
    const top = { ghost: good, nickname: '멍멍', char: 'dog' as const, ms: ms!, place: 2, dayPlace: 1, me: false };
    expect(ghostRunOf(top, day)).toMatchObject({ nickname: '멍멍', dayPlace: 1, place: 2 });
    expect(ghostRunOf({ ...top, ghost: bad({ ms: ms! + 50 }) }, day)).toBeNull();
    expect(ghostRunOf(null, day)).toBeNull();
  });
});

describe('고스트가 있을 때·없을 때 4명 구성', () => {
  it('있으면 나 + 고스트 + AI 2 (내 캐릭터와 같아도), 없으면 나 + AI 3', () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const [mine, ghost] of [['tiger', 'tiger'], ['cat', 'cat'], ['pig', 'cat'], ['cat', 'rabbit']] as const) {
        const l = lineup(mine, ghost, seed);
        expect(l.map((s) => s.role)).toEqual(['me', 'ghost', 'ai', 'ai']);
        expect([l[0].char, l[1].char]).toEqual([mine, ghost]);
        const ai = l.slice(2).map((s) => s.char);
        expect(ai.every((c) => c !== mine && c !== ghost && (ZODIAC_IDS as readonly string[]).includes(c))).toBe(true);
        expect(new Set(ai).size).toBe(2);
      }
      const none = lineup('ox', null, seed);
      expect(none.map((s) => s.role)).toEqual(['me', 'ai', 'ai', 'ai']);
      expect(none).toHaveLength(LANES);
    }
  });
  it('SoloSession.start: 고스트를 받으면 명단에 👻 이름표, 다른 날 것·없음이면 AI 3명', async () => {
    const day = '2026-11-23';
    const obs = dailyTrack(day);
    const { ms, rec } = recordRun(obs, goodPlan(obs));
    const run = { ghost: rec.build(day, 'cat', ms!)!, nickname: '셋째', dayPlace: 3, place: 7, me: false };
    const s = new SoloSession(fakeApi(), me);
    const a = (await s.start('cat', day, () => false, Math.random, Promise.resolve(run)))!;
    expect(a.roster.map((r) => r.role)).toEqual(['me', 'ghost', 'ai', 'ai']);
    expect(a.roster[1]).toMatchObject({ char: 'cat', name: '👻 3위 셋째', id: null });
    expect(a.ghost).toBe(run);
    clock.now += 10_000;
    const b = (await s.start('cat', '2026-11-24', () => false, Math.random, Promise.resolve(run)))!;
    expect(b.roster.map((r) => r.role)).toEqual(['me', 'ai', 'ai', 'ai']);
    expect(b.ghost).toBeNull();
    clock.now += 10_000;
    const c = (await s.start('cat', day, () => false, Math.random, Promise.reject(new Error('x'))))!;
    expect(c.roster.map((r) => r.role)).toEqual(['me', 'ai', 'ai', 'ai']);
  });
});

describe('고스트 올리기 (race_daily_submit 이 된 판만, 실패하면 한 번 더)', () => {
  const day = '2026-11-23';
  const obs = dailyTrack(day);
  const { ms, rec } = recordRun(obs, goodPlan(obs));
  const g = rec.build(day, 'tiger', ms!)!;
  it('그날 기록이 들어갔으면 올리고, 못 들어갔거나 날짜가 다르면 올리지 않는다', async () => {
    const api = fakeApi({ kind: 'supabase' });
    expect(await submitGhost(api, 'k', 1, g, Promise.resolve(day), 0)).toBe(true);
    expect(await submitGhost(api, 'k', 1, g, Promise.resolve(null), 0)).toBe(false);
    expect(await submitGhost(api, 'k', 1, g, Promise.resolve('2026-11-22'), 0)).toBe(false);
    expect(await submitGhost(api, 'k', 1, g, null, 0)).toBe(false);
    expect(api.calls.filter((c) => c.startsWith('ghost:'))).toEqual(['ghost:k:1']);
  });
  it('통신 실패면 한 번 더, 서버가 거절하면 그만', async () => {
    let n = 0;
    const api = fakeApi({ kind: 'supabase', ghostSubmit: async () => (n++ === 0 ? 'retry' : 'ok') });
    expect(await submitGhost(api, 'k', 1, g, Promise.resolve(day), 0)).toBe(true);
    expect(n).toBe(2);
    let m = 0;
    const no = fakeApi({ kind: 'supabase', ghostSubmit: async () => (m++, 'rejected') });
    expect(await submitGhost(no, 'k', 1, g, Promise.resolve(day), 0)).toBe(false);
    expect(m).toBe(1);
    const down = fakeApi({ kind: 'supabase', ghostSubmit: async () => Promise.reject(new Error('net')) });
    expect(await submitGhost(down, 'k', 1, g, Promise.resolve(day), 0)).toBe(false);
  });
  it('테스트 모드(local)는 서버 기록 없이 바로 (기기에 둔다)', async () => {
    const api = fakeApi({ kind: 'local' });
    expect(await submitGhost(api, 'k', 1, g, null, 0)).toBe(true);
  });
});

describe('이름표·결과 문구', () => {
  it('👻 N위 닉네임, 1위보다 빨랐어요 / 1위까지', () => {
    expect(ghostName(1, '시아')).toBe('👻 1위 시아');
    expect(ghostName(4, '시아')).toBe('👻 4위 시아');
    expect(ghostDiffText(29000, 29420, '1위', formatTime)).toBe('1위보다 0.42초 빨랐어요! 🎉');
    expect(ghostDiffText(29420, 29000, '1위', formatTime)).toBe('1위까지 0.42초');
    expect(ghostDiffText(29000, 29000, '1위', formatTime)).toBe('1위와 똑같은 기록이에요!');
    // 보이는 기록(0.01초 버림)끼리: 30.576 → 30.57, 30.582 → 30.58 → 0.01초
    expect(ghostDiffText(30582, 30576, '내 1위 기록', formatTime)).toBe('내 1위 기록까지 0.01초');
    expect(ghostDiffText(30571, 30576, '1위', formatTime)).toBe('1위와 똑같은 기록이에요!');
  });
  it('GhostPlayer: 적힌 걸음에만 누른다', () => {
    const p = new GhostPlayer({ v: 1, day: '2026-11-23', char: 'ox', ms: 1, presses: [[3, 0], [10, 1], [11, 2]] });
    const out = Array.from({ length: 12 }, (_, i) => p.press(i + 1));
    expect(out).toEqual([false, false, true, false, false, false, false, false, false, 'jump', 'slide', false]);
  });
});

function fakeApi(over: Partial<Api> = {}): Api & { calls: string[] } {
  const calls: string[] = [];
  return {
    kind: 'local',
    calls,
    syncClock: async () => undefined,
    go: async () => ({ round: 7, readyAt: clock.now + 1200, goAt: clock.now + 3000 }),
    submit: async (_r, _n, ms) => ({ saved: true, bestMs: ms, improved: true }),
    myBest: async () => null,
    places: async () => ({}),
    dailySubmit: async (_r, _n, day) => day,
    ghostTop: async () => null,
    ghostSubmit: async (room, round) => (calls.push(`ghost:${room}:${round}`), 'ok'),
    ...over,
  } as Api & { calls: string[] };
}
