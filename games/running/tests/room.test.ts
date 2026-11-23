import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rankResults, type RaceEntry } from '../src/game/ranking';
import type { Channel, Member, NetMsg } from '../src/net/channel';
import type { PlayerMeta } from '../src/net/seats';

// 방(RaceRoom)은 서버 시각을 쓴다: 시험에서는 손으로 돌리는 시계로 바꾼다
const clock = { now: 1_000_000 };
vi.mock('../src/net/api', () => ({
  serverNow: () => clock.now,
  GO_GAP_MS: 4000,
  GoTooSoonError: class extends Error {},
}));
const { RaceRoom } = await import('../src/net/room');
type Room = InstanceType<typeof RaceRoom>;

/** 한 방의 가짜 실시간 채널: 보낸 것은 나를 뺀 모두에게 바로 간다 */
class Hub {
  chans: FakeChannel[] = [];
  sent: NetMsg[] = [];
  sync() {
    const list: Member<PlayerMeta>[] = this.chans.filter((c) => c.meta).map((c) => ({ key: c.key, meta: c.meta! }));
    this.chans.filter((c) => c.meta).forEach((c) => c.presence?.(list));
  }
}
class FakeChannel implements Channel<PlayerMeta> {
  meta: PlayerMeta | null = null;
  presence: ((m: Member<PlayerMeta>[]) => void) | null = null;
  msg: ((m: NetMsg) => void) | null = null;
  leaves = 0;
  constructor(
    private hub: Hub,
    readonly key: string,
  ) {
    hub.chans.push(this);
  }
  onPresence(cb: (m: Member<PlayerMeta>[]) => void) {
    this.presence = cb;
  }
  onMessage(cb: (m: NetMsg) => void) {
    this.msg = cb;
  }
  async join(meta: PlayerMeta) {
    this.meta = meta;
    this.hub.sync();
  }
  async track(meta: PlayerMeta) {
    this.meta = meta;
    this.hub.sync();
  }
  send(m: NetMsg) {
    this.hub.sent.push(m);
    for (const c of this.hub.chans) if (c !== this && c.meta) c.msg?.(JSON.parse(JSON.stringify(m)));
  }
  connected() {
    return !!this.meta;
  }
  async leave() {
    this.leaves++;
    this.meta = null;
    this.hub.sync();
  }
}

const roster = [
  { slot: 0, id: 'a', name: '가', char: 'tiger' as const },
  { slot: 1, id: 'b', name: '나', char: 'rat' as const },
  { slot: 2, id: null, name: 'AI 소', char: 'ox' as const },
  { slot: 3, id: null, name: 'AI 용', char: 'dragon' as const },
];
const none = [false, false, false, false];
const fin = (slot: number, timeMs: number): RaceEntry => ({ slot, status: 'finish', timeMs, x: 150 });
const dnf = (slot: number, x: number): RaceEntry => ({ slot, status: 'dnf', timeMs: null, x });
/** 기준 기기가 정한 진짜 결과 */
const right = rankResults([fin(0, 21000), fin(1, 20000), fin(2, 22000), fin(3, 23000)]);
/** 끝 알림을 못 받은 기기가 스스로 정한 (틀린) 결과: b 의 도착을 못 봤다 */
const wrong = rankResults([fin(0, 21000), dnf(1, 120), fin(2, 22000), fin(3, 23000)]);
const pts = (r: Room) => Object.fromEntries(r.series.rows.map((x) => [x.k, x.pts]));

async function makeRooms(ids: string[]) {
  const hub = new Hub();
  const rooms: Room[] = [];
  for (const id of ids) {
    const api = { channel: () => new FakeChannel(hub, id), syncClock: async () => undefined };
    const room = new RaceRoom(api as never, 'room1', { id, name: id }, id === 'a' ? 'tiger' : 'rat');
    rooms.push(room);
    await room.join();
    clock.now += 10; // 들어온 순서 = 방장 순서
  }
  return { hub, rooms };
}

beforeEach(() => {
  vi.useFakeTimers();
  clock.now = 1_000_000;
});
afterEach(() => vi.useRealTimers());

describe('연속전 점수판: 끝 알림 없이 스스로 끝낸 판은 확정이 아니다', () => {
  it('방장이 스스로 끝낸 판은 자기 기기에만 더하고 퍼뜨리지 않으며, 그 판을 센 다른 사람 것을 받는다', async () => {
    const { hub, rooms } = await makeRooms(['a', 'b']);
    const [a, b] = rooms;
    expect(a.isHost()).toBe(true);
    hub.sent.length = 0;

    // 방장 a: 끝 알림을 못 받아 스스로 끝냈다 (틀린 순위)
    a.addResult(5, roster, wrong, none, false);
    vi.advanceTimersByTime(1000);
    expect(a.series.n).toBe(1);
    expect(a.unsureRound).toBe(5);
    expect(pts(a)['u:b']).toBe(0);
    expect(hub.sent.filter((m) => m.t === 'gp')).toEqual([]);
    expect(b.series.n).toBe(0);

    // 기준 기기 b 가 진짜 결과로 더해 알린다 → 방장이 아니고 판 수가 같아도 a 가 받는다
    b.addResult(5, roster, right, none);
    expect(pts(b)).toEqual({ 'u:a': 3, 'u:b': 4, 'ai:ox': 2, 'ai:dragon': 1 });
    expect(pts(a)).toEqual(pts(b));
    expect(a.unsureRound).toBeNull();
    // 받은 뒤에는 다시 방장 것이 기준: 같은 판 수의 다른 사람 것을 더 받지 않는다
    const kept = a.series;
    b.send({ t: 'gp', f: 'b', gp: { ...b.series, rows: b.series.rows.map((r) => ({ ...r, pts: 0 })) } });
    expect(a.series).toBe(kept);
  });

  it('확정이 아닌 동안에도 그 판을 세지 않은 같은 판 수의 점수판은 받지 않는다', async () => {
    const { rooms } = await makeRooms(['a', 'b']);
    const [a, b] = rooms;
    a.addResult(5, roster, wrong, none, false);
    const mine = a.series;
    b.send({ t: 'gp', f: 'b', gp: { n: 1, done: [4], rows: [] } });
    expect(a.series).toBe(mine);
    expect(a.unsureRound).toBe(5);
  });

  it('방장이 아닌 기기가 스스로 끝낸 판도 퍼뜨리지 않고, 방장 것이 오면 바꾼다', async () => {
    const { hub, rooms } = await makeRooms(['a', 'b']);
    const [a, b] = rooms;
    hub.sent.length = 0;
    b.addResult(5, roster, wrong, none, false);
    expect(hub.sent.filter((m) => m.t === 'gp')).toEqual([]);
    a.addResult(5, roster, right, none);
    expect(pts(b)).toEqual(pts(a));
    expect(b.unsureRound).toBeNull();
  });

  it('방장이 다른 기기의 점수판을 먼저 받아 이미 센 판이어도, 지금 점수판을 한 번 알린다', async () => {
    const { hub, rooms } = await makeRooms(['a', 'b', 'c']);
    const [a, b, c] = rooms;
    // c 는 b 의 알림을 놓쳤다
    const cMsg = hub.chans[2].msg;
    hub.chans[2].msg = null;
    b.addResult(5, roster, right, none);
    hub.chans[2].msg = cMsg;
    expect(a.series.n).toBe(1);
    expect(c.series.n).toBe(0);
    hub.sent.length = 0;
    a.addResult(5, roster, right, none);
    const gps = hub.sent.filter((m) => m.t === 'gp');
    expect(gps.length).toBe(1);
    expect(gps[0].f).toBe('a');
    expect(pts(c)).toEqual(pts(a));
    // 방장이 아니면 다시 알리지 않는다
    hub.sent.length = 0;
    b.addResult(5, roster, right, none);
    expect(hub.sent).toEqual([]);
    // 스스로 끝낸(확정 아님) 판이면 방장도 알리지 않는다
    a.addResult(5, roster, wrong, none, false);
    expect(hub.sent).toEqual([]);
  });
});

describe('들어오는 사이에 나간 방', () => {
  it('시계를 맞추는 동안 나갔으면 채널에 들어가지 않고 타이머도 걸지 않는다', async () => {
    const hub = new Hub();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const ch = new FakeChannel(hub, 'a');
    const room = new RaceRoom({ channel: () => ch, syncClock: () => gate } as never, 'room1', { id: 'a', name: 'a' }, 'tiger');
    const joining = room.join();
    await room.leave();
    release();
    await joining;
    expect(ch.meta).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('채널에 들어가는 동안 나갔으면 채널을 다시 떠나고 타이머를 걸지 않는다', async () => {
    const hub = new Hub();
    const ch = new FakeChannel(hub, 'a');
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const join = ch.join.bind(ch);
    ch.join = async (meta) => {
      await gate;
      await join(meta);
    };
    const room = new RaceRoom({ channel: () => ch, syncClock: async () => undefined } as never, 'room1', { id: 'a', name: 'a' }, 'tiger');
    const joining = room.join();
    await Promise.resolve();
    await Promise.resolve();
    await room.leave();
    release();
    await joining;
    expect(ch.meta).toBeNull();
    expect(ch.leaves).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('AI 난이도: 방장이 고른 것이 시작 알림에 실린다', () => {
  const go = (round: number) => ({ round, readyAt: clock.now + 3000, goAt: clock.now + 5000 });
  async function levelRooms(ids: string[], levels: Record<string, 'easy' | 'normal' | 'hard'> = {}) {
    const hub = new Hub();
    const rooms: Room[] = [];
    let round = 0;
    for (const id of ids) {
      const api = { channel: () => new FakeChannel(hub, id), syncClock: async () => undefined, go: async () => go(++round) };
      const room = new RaceRoom(api as never, 'room1', { id, name: id }, id === 'a' ? 'tiger' : 'rat', levels[id]);
      rooms.push(room);
      await room.join();
      clock.now += 10;
    }
    return { hub, rooms };
  }
  const starts = (hub: Hub) => hub.sent.filter((m) => m.t === 'start');

  it('기본은 보통. 방장만 바꿀 수 있고 모든 기기가 같은 값을 본다', async () => {
    const { rooms } = await levelRooms(['a', 'b']);
    const [a, b] = rooms;
    expect([a.level, b.level]).toEqual(['normal', 'normal']);
    b.setLevel('hard'); // 방장이 아니다
    expect([a.level, b.level]).toEqual(['normal', 'normal']);
    a.setLevel('hard');
    expect([a.level, b.level]).toEqual(['hard', 'hard']);
  });

  it('들어온 사람은 자기가 쓰던 난이도가 아니라 방장 것을 따르고, 방장이 나가도 그 난이도가 이어진다', async () => {
    const { rooms } = await levelRooms(['a', 'b'], { a: 'easy', b: 'hard' });
    const [a, b] = rooms;
    expect([a.level, b.level]).toEqual(['easy', 'easy']);
    await a.leave();
    expect(b.isHost()).toBe(true);
    expect(b.level).toBe('easy');
    b.setLevel('normal');
    expect(b.level).toBe('normal');
  });

  it('시작 알림(StartMsg)에 난이도가 실리고, 받은 기기의 판에도 같은 값이 남는다', async () => {
    const { hub, rooms } = await levelRooms(['a', 'b'], { a: 'hard' });
    const [a, b] = rooms;
    a.setReady(true);
    b.setReady(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(starts(hub).length).toBe(1);
    expect(starts(hub)[0].level).toBe('hard');
    expect(a.current?.level).toBe('hard');
    expect(b.current?.level).toBe('hard');
  });

  it('오늘의 도전 방(시드 고정)은 고른 값과 상관없이 보통', async () => {
    const hub = new Hub();
    const api = { channel: () => new FakeChannel(hub, 'a'), syncClock: async () => undefined, go: async () => go(1) };
    const room = new RaceRoom(api as never, 'daily1', { id: 'a', name: 'a' }, 'tiger', 'hard');
    room.fixedSeed = 12345;
    await room.join();
    expect(room.level).toBe('normal');
    room.setLevel('easy');
    expect(room.level).toBe('normal');
    room.setReady(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(starts(hub)[0]).toMatchObject({ seed: 12345, level: 'normal' });
  });
});

describe('대기실: 화면을 가린 방장', () => {
  const vis = { hidden: false };
  const listeners = new Set<() => void>();
  beforeEach(() => {
    vis.hidden = false;
    listeners.clear();
    vi.stubGlobal('document', {
      get hidden() {
        return vis.hidden;
      },
      addEventListener: (_: string, f: () => void) => void listeners.add(f),
      removeEventListener: (_: string, f: () => void) => void listeners.delete(f),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const setHidden = (h: boolean) => {
    vis.hidden = h;
    listeners.forEach((f) => f());
  };

  it('방장이 화면을 가리면 away 를 올려 다음 사람이 방장이 되어 시작하고, 돌아오면 away 를 푼다', async () => {
    const hub = new Hub();
    const rooms: Room[] = [];
    let round = 0;
    for (const id of ['a', 'b']) {
      const api = { channel: () => new FakeChannel(hub, id), syncClock: async () => undefined, go: async () => ({ round: ++round, readyAt: clock.now + 3000, goAt: clock.now + 5000 }) };
      const room = new RaceRoom(api as never, 'room1', { id, name: id }, id === 'a' ? 'tiger' : 'rat');
      rooms.push(room);
      await room.join();
      clock.now += 10;
    }
    const [a, b] = rooms;
    expect(a.isHost()).toBe(true);
    b.setReady(true);
    // a 의 화면이 가려졌다 (두 기기가 같은 document 를 보므로 a 에게만 알린다)
    a.setAway(true);
    expect(hub.chans.find((c) => c.key === 'a')!.meta?.away).toBe(true);
    expect(b.isHost()).toBe(true);
    expect(a.isHost()).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    // 레디하지 않은 a 를 기다리지 않고 b 가 시작한다
    expect(hub.sent.filter((m) => m.t === 'start')).toHaveLength(1);
    expect(hub.sent.find((m) => m.t === 'start')!.roster[0].id).toBe('a');
    a.setAway(false);
    expect(hub.chans.find((c) => c.key === 'a')!.meta?.away).toBeUndefined();
    expect(a.isHost()).toBe(true);
  });

  it('visibilitychange 를 받아 away 를 올리고 내린다, 나가면 감시를 푼다', async () => {
    const { hub, rooms } = await makeRooms(['a']);
    const [a] = rooms;
    setHidden(true);
    expect(hub.chans[0].meta?.away).toBe(true);
    setHidden(false);
    expect(hub.chans[0].meta?.away).toBeUndefined();
    await a.leave();
    expect(listeners.size).toBe(0);
  });
});

describe('판 열쇠: 서버가 판 번호를 다시 써도(1시간 뒤 1부터) 새 판으로 본다', () => {
  it('같은 판 번호라도 GO 시각이 다르면 시작을 받고 점수판에도 따로 센다', async () => {
    const { rooms } = await makeRooms(['a', 'b']);
    const [, b] = rooms;
    const start = (goAt: number) => ({ t: 'start', round: 1, seed: 7, readyAt: goAt - 2000, goAt, roster });
    const send = (m: unknown) => rooms[0].send(m as never);
    const g1 = clock.now + 5000;
    send(start(g1));
    expect(b.current?.goAt).toBe(g1);
    b.addResult(g1, roster, right, none);
    b.raceOver(1);
    expect(b.series.n).toBe(1);
    // 한 시간 뒤: 서버가 다시 1번을 준다
    clock.now += 3_600_000;
    const g2 = clock.now + 5000;
    send(start(g2));
    expect(b.current?.goAt).toBe(g2);
    b.addResult(g2, roster, right, none);
    expect(b.series.n).toBe(2);
    // 같은 시작이 다시 오면 무시한다
    b.raceOver(1);
    send(start(g2));
    expect(b.current).toBeNull();
  });
});
