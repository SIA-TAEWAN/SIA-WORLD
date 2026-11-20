import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { END_AFTER_FIRST, END_AFTER_GO } from '../src/game/constants';
import { FALLBACK_MARGIN, HOST_BACK_MS, HOST_SILENT_MS, fallbackEndDue, isFresh, isSettled, noteHeard, raceHostOf, type Heard } from '../src/net/seats';

// 경기 진행(RaceGame)은 서버 시각을 쓴다: 시험에서는 손으로 돌리는 시계로 바꾼다
const clock = { now: 1_000_000 };
vi.mock('../src/net/api', () => ({ serverNow: () => clock.now }));
const { RaceGame } = await import('../src/race/game');

const roster = [
  { slot: 0, id: 'a' },
  { slot: 1, id: 'b' },
  { slot: 2, id: 'c' },
  { slot: 3, id: null },
];
const none = [false, false, false, false];
const all = new Set(['a', 'b', 'c']);
const settled = (now: number): Heard => ({ last: now, since: -Infinity });

describe('기준 기기 고르기 (위치가 안 오는 기기는 건너뛴다)', () => {
  it('위치가 HOST_SILENT_MS 넘게 안 오면 다음 사람이 기준 기기', () => {
    const now = 100_000;
    const heard = new Map<string, Heard>([['a', settled(now - HOST_SILENT_MS - 1)], ['b', settled(now)], ['c', settled(now)]]);
    expect(raceHostOf(roster, all, none, heard, now)).toBe('b');
    // 경계: 딱 HOST_SILENT_MS 이면 아직 오는 것으로 본다
    heard.set('a', settled(now - HOST_SILENT_MS));
    expect(raceHostOf(roster, all, none, heard, now)).toBe('a');
    // 기록이 아예 없으면(화면을 가렸다고 알림) 건너뛴다
    heard.delete('a');
    expect(raceHostOf(roster, all, none, heard, now)).toBe('b');
  });

  it('명단 순서가 기준: 받은 순서나 Map 순서와 상관없이 모든 기기가 같은 사람을 고른다', () => {
    const now = 100_000;
    const h1 = new Map<string, Heard>([['c', settled(now)], ['b', settled(now)], ['a', settled(now)]]);
    const h2 = new Map<string, Heard>([['a', settled(now - 50)], ['b', settled(now - 10)], ['c', settled(now)]]);
    expect(raceHostOf(roster, all, none, h1, now)).toBe('a');
    expect(raceHostOf(roster, all, none, h2, now)).toBe('a');
    // 접속이 끊겼거나 AI로 넘어간 사람은 위치가 와도 건너뛴다
    expect(raceHostOf(roster, new Set(['b', 'c']), none, h1, now)).toBe('b');
    expect(raceHostOf(roster, all, [true, false, false, false], h1, now)).toBe('b');
    // heard 없이 부르면 예전처럼 접속해 있는 첫 사람
    expect(raceHostOf(roster, new Set(['b']), none)).toBe('b');
  });

  it('돌아온 기기는 HOST_BACK_MS 동안 이어져 와야 다시 기준 기기 (오락가락 막기)', () => {
    let a: Heard = { last: 0, since: -Infinity };
    const b: Heard = settled(0);
    const heard = { get: (id: string) => (id === 'a' ? a : id === 'b' ? b : undefined) };
    // a 가 3초 멈췄다가 t=3000 에 돌아온다
    a = noteHeard(a, 3000);
    expect(a.since).toBe(3000);
    for (let t = 3000; t <= 3000 + HOST_BACK_MS + 200; t += 100) {
      a = noteHeard(a, t);
      b.last = t;
      const host = raceHostOf(roster, new Set(['a', 'b']), none, heard, t);
      expect(host).toBe(t - 3000 >= HOST_BACK_MS ? 'a' : 'b');
    }
  });

  it('짧게 끊기는 것(HOST_SILENT_MS 이하)은 이어진 것으로 본다', () => {
    let h = noteHeard(undefined, 0);
    h = noteHeard(h, HOST_BACK_MS);
    expect(isSettled(h, HOST_BACK_MS)).toBe(true);
    h = noteHeard(h, HOST_BACK_MS + HOST_SILENT_MS); // 1.5초 쉬었다 옴
    expect(h.since).toBe(0);
    expect(isSettled(h, h.last)).toBe(true);
    const late = h.last + HOST_SILENT_MS + 1; // 너무 오래 쉬었다
    h = noteHeard(h, late);
    expect(h.since).toBe(late);
    expect(isFresh(h, late)).toBe(true);
    expect(isSettled(h, late)).toBe(false);
  });

  it('자리 잡은 사람이 없으면 위치가 오는 사람 중 첫 사람 (혼자 돌아온 경우 바로 맡는다)', () => {
    const now = 50_000;
    const heard = new Map<string, Heard>([['b', { last: now, since: now - 100 }], ['c', { last: now, since: now - 10 }]]);
    expect(raceHostOf(roster, all, none, heard, now)).toBe('b');
    expect(raceHostOf(roster, all, none, new Map(), now)).toBeUndefined();
  });
});

describe('기준 기기가 아닐 때 스스로 끝내기', () => {
  it('GO 뒤 END_AFTER_GO + 여유, 또는 첫 도착 뒤 END_AFTER_FIRST + 여유가 지나면 끝', () => {
    expect(fallbackEndDue(END_AFTER_GO + FALLBACK_MARGIN, null)).toBe(false);
    expect(fallbackEndDue(END_AFTER_GO + FALLBACK_MARGIN + 0.01, null)).toBe(true);
    expect(fallbackEndDue(40, null)).toBe(false);
    expect(fallbackEndDue(33 + END_AFTER_FIRST + FALLBACK_MARGIN, 33_000)).toBe(false);
    expect(fallbackEndDue(33 + END_AFTER_FIRST + FALLBACK_MARGIN + 0.01, 33_000)).toBe(true);
  });
});

// ───────────── 두 기기 경기 (가짜 채널) ─────────────

type Msg = { t: string; [k: string]: any };
type Game = InstanceType<typeof RaceGame>;
interface FakeDevice {
  id: string;
  game: Game;
  running: boolean;
}
interface Vis {
  hidden: boolean;
  fire?: () => void;
}

/** 기기마다 화면 가림 상태가 다르다: 지금 진행 중인 기기(current)의 상태를 document 로 보여 준다 */
const docState = { current: '', vis: new Map<string, Vis>() };
function installDocument() {
  (globalThis as any).document = {
    get visibilityState() {
      return docState.vis.get(docState.current)?.hidden ? 'hidden' : 'visible';
    },
    addEventListener: (_: string, fn: () => void) => {
      const v = docState.vis.get(docState.current) ?? { hidden: false };
      v.fire = fn;
      docState.vis.set(docState.current, v);
    },
    removeEventListener: () => {},
  };
}

function makeRace(ids: string[]) {
  const listeners = new Map<string, ((m: Msg) => void)[]>();
  const present = new Set(ids);
  /** 채널이 끊긴(다시 연결하는 중인) 기기: 보내기는 되지만(REST) 아무것도 받지 못한다 */
  const down = new Set<string>();
  const goAt = clock.now + 3000;
  const chars = ['rat', 'ox', 'tiger', 'rabbit'] as const;
  const start = {
    t: 'start' as const, round: 7, seed: 12345, readyAt: clock.now + 1000, goAt,
    roster: chars.map((char, slot) => ({ slot, id: ids[slot] ?? null, name: ids[slot] ? ids[slot].toUpperCase() : `AI ${slot}`, char })),
  };
  /** 그 기기에 메시지 하나를 넣는다 */
  const deliver = (to: string, m: Msg) => {
    if (down.has(to)) return;
    const was = docState.current;
    docState.current = to;
    (listeners.get(to) ?? []).forEach((f) => f(JSON.parse(JSON.stringify(m))));
    docState.current = was;
  };
  const api = { submit: () => Promise.resolve({ saved: false, bestMs: 0, improved: false }) };
  const devices: FakeDevice[] = ids.map((id) => {
    const room = {
      me: { id }, present, key: 'room',
      onMsg(fn: (m: Msg) => void) {
        listeners.set(id, [...(listeners.get(id) ?? []), fn]);
        return () => listeners.set(id, (listeners.get(id) ?? []).filter((f) => f !== fn));
      },
      // 다른 기기에만 간다 (broadcast self: false)
      send(m: Msg) {
        for (const to of listeners.keys()) if (to !== id) deliver(to, m);
      },
      connected: () => !down.has(id),
      raceOver() {},
    };
    docState.current = id;
    const game = new RaceGame(room as never, api as never, start);
    return { id, game, running: true };
  });
  return { devices, goAt, down, deliver };
}

const FRAME = 1000 / 60;
/** 시계를 돌리며 돌아가는 기기만 매 프레임 진행 */
function step(devs: FakeDevice[], until: number) {
  while (clock.now < until) {
    clock.now += FRAME;
    for (const d of devs) {
      docState.current = d.id;
      if (d.running) d.game.update();
    }
    vi.advanceTimersByTime(FRAME);
  }
}
/** 그 기기 입장에서 묻기 */
function as<T>(d: FakeDevice, f: (g: Game) => T): T {
  docState.current = d.id;
  return f(d.game);
}

describe('기준 기기의 화면이 멈추면 다른 기기가 넘겨받는다', () => {
  beforeEach(() => {
    clock.now = 1_000_000;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).document;
    docState.vis.clear();
  });

  it('멈춘 기준 기기 대신 AI를 이어 달려 AI가 도착하고, 경기가 제때 끝난다', () => {
    const { devices, goAt } = makeRace(['a', 'b']);
    const [A, B] = devices;
    step(devices, goAt + 50);
    A.game.press();
    B.game.press();
    step(devices, goAt + 10_000);
    expect(A.game.isHost()).toBe(true);
    expect(B.game.isHost()).toBe(false);
    const aiX = B.game.view(2).x;
    expect(aiX).toBeGreaterThan(20);
    // a 의 화면이 멈춘다 (rAF 멈춤, 채널은 살아 있음)
    A.running = false;
    const stopAt = clock.now;
    step(devices, stopAt + HOST_SILENT_MS - 300);
    expect(B.game.isHost()).toBe(false);
    step(devices, stopAt + HOST_SILENT_MS + 200);
    expect(B.game.isHost()).toBe(true);
    // 마지막으로 받은 위치에서 이어서, 멈춰 있던 시간을 따라잡는다
    expect(B.game.view(2).x).toBeGreaterThan(aiX + 5);
    let endT = 0;
    B.game.onOver = () => (endT = B.game.clock());
    step(devices, goAt + 120_000);
    const res = B.game.results!;
    expect(res).toBeTruthy();
    for (const slot of [2, 3]) expect(res.find((r) => r.slot === slot)!.status).toBe('finish');
    // 멈춘 a 의 자리는 AI가 이어 달렸다
    expect(B.game.taken[0]).toBe(true);
    // b 가 끝을 정했다: 모두 들어왔거나 첫 도착 + 15초 (GO 뒤 90초를 기다리지 않는다)
    const first = Math.min(...res.map((r) => r.timeMs ?? Infinity));
    expect(first).toBeLessThan(45_000);
    expect(endT).toBeLessThan(first / 1000 + END_AFTER_FIRST + 0.5);
  });

  it('화면을 가리면 바로 내려놓고, 다시 보이면 HOST_BACK_MS 뒤에 평소대로 돌아온다', () => {
    installDocument();
    const { devices, goAt } = makeRace(['a', 'b']);
    const [A, B] = devices;
    step(devices, goAt + 50);
    A.game.press();
    B.game.press();
    step(devices, goAt + 8000);
    expect(as(A, (g) => g.isHost())).toBe(true);
    // a 가 화면을 가린다: 'away' 를 받은 b 가 바로 넘겨받는다
    const va = docState.vis.get('a')!;
    va.hidden = true;
    A.running = false;
    docState.current = 'a';
    va.fire!();
    expect(as(A, (g) => g.isHost())).toBe(false);
    expect(as(B, (g) => g.isHost())).toBe(true);
    step(devices, clock.now + 3000);
    const aiX = as(B, (g) => g.view(2).x);
    // 다시 보인다: 한동안은 b 가 계속 맡는다
    va.hidden = false;
    A.running = true;
    const back = clock.now;
    step(devices, back + HOST_BACK_MS / 2);
    expect(as(A, (g) => g.isHost())).toBe(false);
    expect(as(B, (g) => g.isHost())).toBe(true);
    step(devices, back + HOST_BACK_MS + 500);
    expect(as(A, (g) => g.isHost())).toBe(true);
    expect(as(B, (g) => g.isHost())).toBe(false);
    // 넘겨받은 a 도 b 가 보낸 위치에서 이어 달린다 (처음으로 되돌아가지 않는다)
    expect(as(A, (g) => g.view(2).x)).toBeGreaterThan(aiX);
    step(devices, goAt + 120_000);
    const ra = A.game.results!;
    const rb = B.game.results!;
    expect(ra).toBeTruthy();
    expect(rb).toEqual(ra);
    for (const slot of [2, 3]) expect(ra.find((r) => r.slot === slot)!.status).toBe('finish');
    // 3초 가린 것은 자리를 빼앗기지 않는다
    expect(A.game.taken[0]).toBe(false);
  });
});

describe('채널이 끊긴 기기는 기준 기기를 맡지 않는다', () => {
  beforeEach(() => {
    clock.now = 1_000_000;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('다시 연결하는 동안(보내기만 됨) 스스로 빠지고, 남의 자리를 AI로 넘기지 않는다', () => {
    const { devices, goAt, down } = makeRace(['a', 'b']);
    const [A, B] = devices;
    step(devices, goAt + 50);
    A.game.press();
    B.game.press();
    step(devices, goAt + 8000);
    expect(A.game.isHost()).toBe(true);
    // a 의 채널이 끊긴다: a 의 위치는 계속 b 에게 가지만 a 는 아무것도 받지 못한다
    down.add('a');
    step(devices, clock.now + 100);
    expect(A.game.isHost()).toBe(false);
    // b 는 'nh' 를 보고 바로 넘겨받는다 (a 의 위치는 계속 오므로 a 의 자리는 그대로)
    expect(B.game.isHost()).toBe(true);
    const sent: Msg[] = [];
    const listen = (m: Msg) => sent.push(m);
    const offB = (B.game as any).room.onMsg(listen);
    // SILENT_MS(8초)보다 오래 끊겨 있어도 a 는 b 의 자리를 넘기지도, 경기를 끝내지도 않는다
    step(devices, clock.now + 12_000);
    offB();
    expect(sent.some((m) => m.t === 'takeover' || m.t === 'end')).toBe(false);
    expect(sent.filter((m) => m.t === 'pos').every((m) => !m.tk && m.nh === 1)).toBe(true);
    expect(A.game.taken).toEqual([false, false, false, false]);
    expect(B.game.taken).toEqual([false, false, false, false]);
    expect(A.game.results).toBeNull();
    // 다시 이어진다: 이어진 직후 '조용했다'고 보고 b 를 넘기지 않는다
    down.delete('a');
    step(devices, goAt + 120_000);
    expect(A.game.taken).toEqual([false, false, false, false]);
    expect(B.game.taken).toEqual([false, false, false, false]);
    const ra = A.game.results!;
    expect(ra).toBeTruthy();
    expect(B.game.results).toEqual(ra);
    for (const slot of [2, 3]) expect(ra.find((r) => r.slot === slot)!.status).toBe('finish');
  });

  it('자리 넘김·끝 알림·tk 표시는 내가 보는 기준 기기 것만 받는다', () => {
    const { devices, goAt, deliver } = makeRace(['a', 'b']);
    const [A, B] = devices;
    step(devices, goAt + 50);
    A.game.press();
    B.game.press();
    step(devices, goAt + 5000);
    expect(A.game.isHost()).toBe(true);
    // 기준 기기가 아닌 b 가 보낸 것은 a 가 무시한다
    deliver('a', { t: 'takeover', round: 7, f: 'b', slot: 0 });
    deliver('a', { t: 'pos', r: 7, f: 'b', ts: clock.now, tk: 0b11, s: [] });
    deliver('a', { t: 'end', round: 7, f: 'b', results: [{ slot: 1, place: 1, status: 'finish', timeMs: 30_000, x: 150 }] });
    // 보낸 사람이 없는 것도 (기준 기기가 있으면) 무시
    deliver('a', { t: 'takeover', round: 7, slot: 1 });
    expect(A.game.taken).toEqual([false, false, false, false]);
    expect(A.game.amRacing()).toBe(true);
    expect(A.game.results).toBeNull();
    // 기준 기기 a 가 보낸 것은 b 가 받는다
    deliver('b', { t: 'pos', r: 7, f: 'a', ts: clock.now, tk: 0b10, s: [] });
    expect(B.game.taken[1]).toBe(true);
    expect(B.game.amRacing()).toBe(false);
  });
});

describe('기준 기기가 바뀌면 사람 자리를 이어받은 AI도 따라잡는다', () => {
  beforeEach(() => {
    clock.now = 1_000_000;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('앞 기준 기기가 AI로 달리던 사람 자리를 마지막 위치 시각부터 이어 달린다', () => {
    const { devices, goAt } = makeRace(['a', 'b', 'c']);
    const [A, B, C] = devices;
    step(devices, goAt + 50);
    A.game.press();
    B.game.press();
    C.game.press();
    step(devices, goAt + 3000);
    // c 의 화면이 멈춘다: SILENT_MS 뒤 기준 기기 a 가 c 의 자리를 AI로 넘긴다
    C.running = false;
    step(devices, clock.now + 9000);
    expect(A.game.taken[2]).toBe(true);
    expect(B.game.taken[2]).toBe(true);
    step(devices, clock.now + 2000);
    // 이번에는 기준 기기 a 의 화면이 멈춘다
    A.running = false;
    const stopAt = clock.now;
    const x0 = B.game.view(2).x;
    step(devices, stopAt + HOST_SILENT_MS + 200);
    expect(B.game.isHost()).toBe(true);
    // 멈춰 있던 약 1.5초를 따라잡는다 (지금부터 달리면 1m 남짓밖에 못 간다)
    expect(B.game.view(2).x).toBeGreaterThan(x0 + 5);
  });
});
