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
