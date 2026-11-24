import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DT, END_AFTER_FIRST, LANES, ZODIAC_IDS } from '../src/game/constants';
import { dailyTrackSeed, isDailyRoomKey } from '../src/game/daily';
import { aiName, lineup } from '../src/game/lineup';
import { makeRng } from '../src/game/rng';
import { aiPress, type AiPlan } from '../src/game/ai';
import { newRunner, stepRunner } from '../src/game/sim';
import { makeTrack } from '../src/game/track';

// 오늘의 도전 판(SoloSession · RaceGame)은 서버 시각을 쓴다: 시험에서는 손으로 돌리는 시계로 바꾼다
const clock = { now: 1_000_000 };
vi.mock('../src/net/api', () => {
  class GoTooSoonError extends Error {
    constructor() {
      super('too soon');
    }
  }
  return { serverNow: () => clock.now, GO_GAP_MS: 4000, GoTooSoonError };
});
const { GoTooSoonError } = (await import('../src/net/api')) as unknown as { GoTooSoonError: new () => Error };
const { SoloSession, dropRoomParam, soloRoster, submitRun, tooSoonWait } = await import('../src/net/solo');
const { RaceGame } = await import('../src/race/game');
type Api = import('../src/net/api').RaceApi;

const me = { id: 'u1', name: '시아' };

function fakeApi(over: Partial<Api> = {}): Api & { calls: string[] } {
  const calls: string[] = [];
  return {
    kind: 'local',
    calls,
    syncClock: async () => void calls.push('sync'),
    go: async (room) => {
      calls.push(`go:${room}`);
      return { round: 7, readyAt: clock.now + 1200, goAt: clock.now + 3000 };
    },
    submit: async (room, round, ms, ch) => {
      calls.push(`submit:${room}:${round}:${ms}:${ch}`);
      return { saved: true, bestMs: ms, improved: true };
    },
    myBest: async () => null,
    places: async () => ({}),
    dailySubmit: async (room, round, day) => {
      calls.push(`daily:${room}:${round}:${day}`);
      return day;
    },
    ...over,
  } as Api & { calls: string[] };
}

describe('자리 구성 (lineup)', () => {
  it('지금은 나 + AI 3명: 0번이 나, AI 는 나와 겹치지 않는 십이지', () => {
    for (let seed = 1; seed < 200; seed++) {
      const l = lineup('tiger', null, seed);
      expect(l).toHaveLength(LANES);
      expect(l.map((s) => s.slot)).toEqual([0, 1, 2, 3]);
      expect(l[0]).toEqual({ slot: 0, role: 'me', char: 'tiger' });
      expect(l.slice(1).every((s) => s.role === 'ai' && s.char !== 'tiger' && (ZODIAC_IDS as readonly string[]).includes(s.char))).toBe(true);
      expect(new Set(l.map((s) => s.char)).size).toBe(LANES);
    }
  });
  it('3단계 고스트: 나 + 고스트 1 + AI 2. 고스트는 내 캐릭터와 같아도 되고, AI 는 둘 다 피한다', () => {
    const l = lineup('cat', 'rat', 5);
    expect(l.map((s) => s.role)).toEqual(['me', 'ghost', 'ai', 'ai']);
    expect(l[1].char).toBe('rat');
    expect(l.slice(2).some((s) => s.char === 'rat' || s.char === 'cat')).toBe(false);
    const same = lineup('dog', 'dog', 9);
    expect(same.map((s) => s.char).slice(0, 2)).toEqual(['dog', 'dog']);
    expect(same.slice(2).every((s) => s.char !== 'dog')).toBe(true);
  });
  it('같은 seed 면 같은 AI, seed 가 바뀌면 다른 AI 도 나온다 (고양이는 AI 로 나오지 않는다)', () => {
    expect(lineup('pig', null, 42)).toEqual(lineup('pig', null, 42));
    const seen = new Set<string>();
    for (let s = 0; s < 50; s++) lineup('pig', null, s).forEach((x) => seen.add(x.char));
    expect(seen.has('cat')).toBe(false);
    expect(seen.size).toBeGreaterThan(8);
  });
  it('명단: 내 자리는 내 id·이름, AI 는 id 없이 "AI 어흥이"', () => {
    const r = soloRoster(me, 'rabbit', 3);
    expect(r[0]).toMatchObject({ slot: 0, id: 'u1', name: '시아', char: 'rabbit', role: 'me' });
    for (const s of r.slice(1)) expect(s).toMatchObject({ id: null, name: aiName(s.char), role: 'ai' });
    expect(aiName('tiger')).toBe('AI 어흥이');
  });
});

describe('오늘의 도전 판 열기 (SoloSession)', () => {
  it('방 키는 서버 083 이 받는 모양(^daily[a-z0-9]{4,19}$), 한 화면에서는 같은 키', async () => {
    for (let i = 0; i < 50; i++) expect(isDailyRoomKey(new SoloSession(fakeApi(), me, makeRng(i)).key)).toBe(true);
    const api = fakeApi();
    const s = new SoloSession(api, me);
    await s.go();
    await s.go();
    expect(api.calls.filter((c) => c.startsWith('go:'))).toEqual([`go:${s.key}`, `go:${s.key}`]);
    expect(api.calls.filter((c) => c === 'sync')).toHaveLength(1); // 시계 맞추기는 처음 한 번
  });
  it('한 판: 그날 트랙 시드 + 서버 GO 시각 + 나와 AI 3명', async () => {
    const s = new SoloSession(fakeApi(), me);
    const st = (await s.start('horse', '2026-11-23'))!;
    expect(st).toMatchObject({ key: s.key, round: 7, seed: dailyTrackSeed('2026-11-23'), day: '2026-11-23' });
    expect(st.goAt).toBeGreaterThan(st.readyAt);
    expect(st.roster[0]).toMatchObject({ id: 'u1', char: 'horse', role: 'me' });
  });
  it('race_go 는 고스트를 받은 뒤에 부른다 (함께 기다리면 느린 통신에서 화면이 뜰 때 GO 가 지나 있다)', async () => {
    const api = fakeApi();
    const s = new SoloSession(api, me);
    let release!: () => void;
    const ghost = new Promise<null>((r) => (release = () => r(null)));
    const p = s.start('horse', '2026-11-23', () => false, Math.random, ghost);
    await new Promise((r) => setTimeout(r, 5));
    expect(api.calls.some((c) => c.startsWith('go:'))).toBe(false);
    release();
    expect(await p).not.toBeNull();
    expect(api.calls.some((c) => c.startsWith('go:'))).toBe(true);
    // 고스트를 기다리는 사이 취소하면 race_go 를 부르지 않는다
    const api2 = fakeApi();
    let cancel = false;
    const s2 = new SoloSession(api2, me);
    const p2 = s2.start('horse', '2026-11-23', () => cancel, Math.random, new Promise((r) => setTimeout(() => r(null), 5)));
    cancel = true;
    expect(await p2).toBeNull();
    expect(api2.calls.some((c) => c.startsWith('go:'))).toBe(false);
  });
  it("'too soon' 이면 남은 시간만큼 기다렸다 다시 묻는다", async () => {
    let n = 0;
    const waits: number[] = [];
    const api = fakeApi({
      go: async () => {
        if (n++ === 1) throw new GoTooSoonError();
        return { round: n, readyAt: clock.now + 1200, goAt: clock.now + 2500 };
      },
    });
    const s = new SoloSession(api, me, Math.random, async (ms) => {
      waits.push(ms);
      clock.now += ms;
    });
    await s.go();
    clock.now += 1500; // 1.5초 만에 '다시 도전'
    const g = await s.go();
    expect(g?.round).toBe(3);
    expect(waits).toEqual([4000 - 1500 + 300]);
  });
  it('기다리는 사이 취소하면 null, 끝내 못 받으면 예외', async () => {
    const api = fakeApi({ go: async () => Promise.reject(new GoTooSoonError()) });
    let cancel = false;
    const s = new SoloSession(api, me, Math.random, async () => void (cancel = true));
    expect(await s.go(() => cancel)).toBeNull();
    const s2 = new SoloSession(api, me, Math.random, async () => undefined);
    await expect(s2.go()).rejects.toBeInstanceOf(GoTooSoonError);
  });
  it('기다릴 시간: 마지막 GO 를 모르거나 어긋나면 4초 통째로 (+0.3초)', () => {
    expect(tooSoonWait(0, 10_000)).toBe(4300);
    expect(tooSoonWait(10_000, 11_000)).toBe(3300);
    expect(tooSoonWait(10_000, 20_000)).toBe(4300);
    expect(tooSoonWait(10_000, 5_000)).toBe(4300);
  });
});

describe('기록 올리기 (race_submit → race_daily_submit)', () => {
  it('서버가 받은 완주 기록만 그날 기록으로 넣는다', async () => {
    const api = fakeApi();
    const r = submitRun(api, 'dailyabcd2345', 3, 31234, 'tiger', '2026-11-23');
    expect((await r.record).saved).toBe(true);
    expect(await r.dailySaved).toBe('2026-11-23');
    expect(api.calls).toEqual(['submit:dailyabcd2345:3:31234:tiger', 'daily:dailyabcd2345:3:2026-11-23']);
    const no = fakeApi({ submit: async (_k, _r, ms) => ({ saved: false, bestMs: ms, improved: false }) });
    expect(await submitRun(no, 'dailyabcd2345', 3, 31234, 'tiger', '2026-11-23').dailySaved).toBeNull();
    expect(no.calls.some((c) => c.startsWith('daily:'))).toBe(false);
  });
});

describe('예전 초대 링크 (?room=)', () => {
  it('?room 만 빼고 나머지 주소는 그대로. 없으면 null', () => {
    expect(dropRoomParam('http://localhost:5290/games/running/?local=1&room=abcd')).toBe('http://localhost:5290/games/running/?local=1');
    expect(dropRoomParam('https://x.io/games/running/?room=abcd#a')).toBe('https://x.io/games/running/#a');
    expect(dropRoomParam('https://x.io/games/running/?local=1')).toBeNull();
  });
});

describe('혼자 판 진행 (RaceGame: 나 + AI)', () => {
  const start = (go = clock.now + 3000) => ({
    key: 'dailyabcd2345', round: 1, seed: dailyTrackSeed('2026-11-23'), readyAt: go - 1800, goAt: go, day: '2026-11-23', roster: soloRoster(me, 'tiger', 11),
  });
  it('GO 전에 누르면 실격하고 1.5초 뒤 끝난다 (AI 는 실격 없음)', () => {
    const race = new RaceGame(fakeApi(), start());
    clock.now = race.readyAt + 100;
    race.press();
    race.update();
    expect(race.view(0).state).toBe('foul');
    expect(race.events.some((e) => e.ev === 'foul')).toBe(true);
    clock.now = race.readyAt + 1400;
    race.update();
    expect(race.results).toBeNull();
    clock.now = race.readyAt + 1700;
    race.update();
    expect(race.results).not.toBeNull();
    expect(race.results!.find((r) => r.slot === 0)!.status).toBe('foul');
    expect(race.results!.filter((r) => r.status !== 'foul')).toHaveLength(3);
  });
  it('화면이 가려졌다 돌아와도 고정 걸음으로 따라잡는다: 한꺼번에 돌린 것과 조금씩 돌린 것이 같다', () => {
    const a = new RaceGame(fakeApi(), start(2_000_000));
    const b = new RaceGame(fakeApi(), start(2_000_000));
    clock.now = 2_000_000 + 50;
    a.press();
    b.press();
    for (let t = 50; t <= 12_000; t += 16) {
      clock.now = 2_000_000 + t;
      a.update();
    }
    clock.now = 2_000_000 + 12_000;
    a.update();
    clock.now = 2_000_000 + 60;
    b.update(); // 출발
    clock.now = 2_000_000 + 12_000; // 12초 동안 가려졌다 돌아옴
    b.update();
    for (let s = 0; s < LANES; s++) expect(b.view(s).x).toBeCloseTo(a.view(s).x, 6);
    expect(a.view(1).x).toBeGreaterThan(20);
  });
  it('내가 완주하면 기록을 올리고 그날 기록에도 넣는다. 1등 도착 뒤 15초 안에 끝난다', async () => {
    const api = fakeApi();
    const race = new RaceGame(api, start(3_000_000));
    // 나는 방해물을 모두 잘 넘는 계획으로 누른다: 같은 계산을 옆에서 돌려 걸음마다 누를 버튼을 정한다
    const obs = makeTrack(race.seed);
    const plan: AiPlan = { react: 0.1, jump: Object.fromEntries(obs.map((o) => [o.id, o.kind !== 'boost'])) };
    const shadow = newRunner();
    let t = 0;
    for (let i = 0; i < 90 / DT && !race.results; i++) {
      const p = aiPress(shadow, obs, plan);
      stepRunner(shadow, obs, p);
      shadow.events.length = 0;
      t = (i + 1) * DT * 1000;
      clock.now = 3_000_000 + t;
      if (p) race.press(p === 'slide' ? 'slide' : 'jump');
      race.update();
    }
    expect(race.results).not.toBeNull();
    const mine = race.results!.find((r) => r.slot === 0)!;
    expect(mine.status).toBe('finish');
    expect(race.record).not.toBeNull();
    expect(await race.dailySaved).toBe('2026-11-23');
    expect(api.calls).toContain(`submit:dailyabcd2345:1:${mine.timeMs}:tiger`);
    const first = Math.min(...race.results!.map((r) => r.timeMs ?? Infinity));
    expect(t / 1000).toBeLessThanOrEqual(first / 1000 + END_AFTER_FIRST + DT + 0.1);
  });
});

describe('접속 인원 채널 (shared/presence.js 의 enterGame)', () => {
  it('게임 쪽 채널 이름이 로비의 GAME_CHANNELS.race 와 같다', async () => {
    const { PRESENCE_TOPIC, LOBBY_MAX } = await import('../src/net/world');
    const src = readFileSync(new URL('../../../shared/presence.js', import.meta.url), 'utf8');
    expect(src).toMatch(new RegExp(`race: \\['${PRESENCE_TOPIC}'\\]`));
    expect(src).toMatch(new RegExp(`GAME_MAX = ${LOBBY_MAX}\\b`));
  });
});
