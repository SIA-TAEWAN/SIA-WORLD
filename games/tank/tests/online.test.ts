import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineGame, adoptOrder, demote, hostCandidates, type HostView } from '../src/net/online';
import type { NetMsg, Room } from '../src/net/backend';
import type { RoomSession } from '../src/net/room';
import type { SceneApi, TurnRecord } from '../src/net/protocol';

const view = (p: Partial<HostView> = {}): HostView => ({
  me: 'a',
  meAway: false,
  present: new Set(['a', 'b', 'c']),
  away: new Set(),
  taken: new Set(),
  ...p,
});

describe('기준 기기 고르기', () => {
  it('순서대로 첫 번째 접속한 기기', () => {
    expect(hostCandidates(['a', 'b', 'c'], view())).toEqual(['a', 'b', 'c']);
    expect(hostCandidates(['a', 'b', 'c'], view({ me: 'b', present: new Set(['b', 'c']) }))).toEqual(['b', 'c']);
  });

  it('화면을 가린 기기(away)는 건너뛴다 — 나 자신도', () => {
    expect(hostCandidates(['a', 'b', 'c'], view({ me: 'c', away: new Set(['a']) }))[0]).toBe('b');
    expect(hostCandidates(['a', 'b', 'c'], view({ meAway: true }))).toEqual(['b', 'c']);
  });

  it('AI가 넘겨받은 기기는 건너뛴다', () => {
    expect(hostCandidates(['a', 'b', 'c'], view({ me: 'c', taken: new Set(['a']) }))[0]).toBe('b');
  });

  it('모두 화면을 가렸으면 접속한 기기 중 첫 번째', () => {
    expect(hostCandidates(['a', 'b'], view({ meAway: true, away: new Set(['b']), present: new Set(['a', 'b']) }))[0]).toBe('a');
    expect(hostCandidates(['b', 'a'], view({ meAway: true, away: new Set(['b']), present: new Set(['a', 'b']) }))[0]).toBe('b');
  });

  it('아무도 없으면 나', () => {
    expect(hostCandidates(['b'], view({ present: new Set() }))).toEqual(['a']);
  });

  it('자리를 비운 기기는 순서 맨 뒤로', () => {
    expect(demote(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    expect(demote(['a', 'b', 'c'], 'c')).toEqual(['a', 'b', 'c']);
    expect(demote(['a', 'b'], 'z')).toEqual(['a', 'b']);
  });

  it('다른 기기의 순서를 받아들일 때 모르는 사람은 빼고 빠진 사람은 붙인다', () => {
    expect(adoptOrder(['a', 'b', 'c'], ['c', 'x', 'a', 'a'])).toEqual(['c', 'a', 'b']);
    expect(adoptOrder(['a', 'b'], 'nope')).toEqual(['a', 'b']);
  });
});

// ---------- OnlineGame (가짜 채널) ----------

function fakeSession(present: string[]) {
  const msgFns = new Set<(m: NetMsg) => void>();
  const presFns = new Set<() => void>();
  const sent: NetMsg[] = [];
  const awayCalls: boolean[] = [];
  const s = {
    present: new Set(present),
    away: new Set<string>(),
    on(fn: (m: NetMsg) => void) {
      msgFns.add(fn);
      return () => msgFns.delete(fn);
    },
    onPresence(fn: () => void) {
      presFns.add(fn);
      return () => presFns.delete(fn);
    },
    send(m: NetMsg) {
      sent.push(m);
    },
    async setAway(v: boolean) {
      awayCalls.push(v);
    },
    onReconnect: () => () => undefined,
  };
  return {
    session: s as unknown as RoomSession,
    raw: s,
    sent,
    awayCalls,
    recv: (m: NetMsg) => msgFns.forEach((f) => f({ g: 1, ...m })),
    presence: () => presFns.forEach((f) => f()),
  };
}

const room = (ids: string[]): Room => ({
  id: 'r',
  lobby: 'l',
  name: 'n',
  map: 'hill' as Room['map'],
  status: 'playing',
  players: ids.map((id) => ({ id, name: id, tank: 'rat' as never, team: 0, items: [] })),
  seed: 1,
  host_id: ids[0],
  game_no: 1,
  created_at: '',
});

function fakeScene(nTanks: number) {
  const calls = { takeover: [] as number[], loaded: 0, turns: [] as TurnRecord[] };
  const scene: SceneApi = {
    onRemoteLive: () => undefined,
    onRemoteTurn: (r) => void calls.turns.push(r),
    loadSnapshot: () => void calls.loaded++,
    setConn: () => undefined,
    takeover: (i) => void calls.takeover.push(i),
    matchState: { tanks: Array.from({ length: nTanks }, () => ({ alive: true })) } as never,
  };
  return { scene, calls };
}

describe('OnlineGame', () => {
  const games: OnlineGame[] = [];
  const make = (me: string, ids = ['a', 'b', 'c']) => {
    const f = fakeSession(ids);
    const g = new OnlineGame(f.session, room(ids), me);
    games.push(g);
    const sc = fakeScene(ids.length);
    g.attach(sc.scene);
    return { g, f, sc };
  };
  afterEach(() => {
    games.splice(0).forEach((g) => g.dispose());
    vi.useRealTimers();
  });

  it('기준 기기가 화면을 가리면 다음 사람이 기준 기기가 되고, 돌아와도 되찾지 않는다', () => {
    const { g, f } = make('b');
    expect(g.isHost()).toBe(false);
    expect(g.isBackup()).toBe(true);
    f.raw.away.add('a');
    f.presence();
    expect(g.isHost()).toBe(true);
    f.raw.away.delete('a');
    f.presence();
    expect(g.isHost()).toBe(true);
  });

  it('기준 기기가 끊기면(접속 목록에서 빠짐) 순서 뒤로 가서 다시 들어와도 기준 기기가 아니다', () => {
    const { g, f } = make('b');
    f.raw.present.delete('a');
    f.presence();
    expect(g.isHost()).toBe(true);
    f.raw.present.add('a');
    f.presence();
    expect(g.isHost()).toBe(true);
  });

  it('보낸 턴 기록에 보낸 기기를 붙인다', () => {
    const { g, f } = make('a');
    g.sendTurn({ turn: 3, runs: [], input: null, facing: 1 });
    expect(f.sent.at(-1)).toMatchObject({ t: 'turn', r: { turn: 3, from: 'a' } });
  });

  it('sync 지문은 기준 기기가 보낸 것만 비교한다', () => {
    const { g, f } = make('c');
    g.turnDone(5, 'mine');
    f.recv({ t: 'sync', turn: 5, hash: 'other', from: 'c' });
    expect(f.sent.some((m) => m.t === 'snapreq')).toBe(false);
    // 후보 첫째·둘째가 아닌 기기 → 무시 (a 는 끊겨서 순서 뒤로, c 자신 제외하면 후보는 b, c)
    f.raw.present.delete('a');
    f.presence();
    f.raw.present.add('a');
    f.presence();
    f.recv({ t: 'sync', turn: 5, hash: 'other', from: 'a' });
    expect(f.sent.some((m) => m.t === 'snapreq')).toBe(false);
    f.recv({ t: 'sync', turn: 5, hash: 'other', from: 'b' });
    expect(f.sent.some((m) => m.t === 'snapreq')).toBe(true);
  });

  it('sync 에 서든데스 설정을 싣고, 내 설정과 다르면 지문이 같아도 기준 기기 판 상태를 받는다', () => {
    const host = make('a');
    host.g.turnDone(1, 'h');
    expect(host.f.sent.at(-1)).toMatchObject({ t: 'sync', sudden: 0 });
    const { g, f } = make('b');
    g.turnDone(1, 'h');
    f.recv({ t: 'sync', turn: 1, hash: 'h', from: 'a', sudden: 0 });
    expect(f.sent.some((m) => m.t === 'snapreq')).toBe(false);
    f.recv({ t: 'sync', turn: 1, hash: 'h', from: 'a', sudden: 30 });
    expect(f.sent.some((m) => m.t === 'snapreq')).toBe(true);
  });

  it('takeover 는 기준 기기(또는 다음 후보)가 보낸 것만 받는다', () => {
    const { f, sc } = make('c', ['a', 'b', 'c', 'd']);
    f.recv({ t: 'takeover', id: 'b', from: 'd' });
    expect(sc.calls.takeover).toEqual([]);
    f.recv({ t: 'takeover', id: 'b', from: 'a' });
    expect(sc.calls.takeover).toEqual([1]);
  });

  it('내 탱크를 넘겨받았다는 소식(sync 목록·takeover·판 중간 거절)이 오면 판에서 나간다', () => {
    for (const msg of [
      { t: 'sync', turn: 1, hash: 'x', from: 'a', taken: ['b'] },
      { t: 'takeover', id: 'b', from: 'a' },
      { t: 'snap', to: 'b', from: 'a', denied: true },
    ]) {
      const { g, f } = make('b');
      const kicked = vi.fn();
      g.whenKicked(kicked);
      f.recv(msg);
      expect(kicked).toHaveBeenCalledTimes(1);
      expect(g.frozen()).toBe(true);
      // 나간 뒤에는 아무것도 보내지 않는다
      const n = f.sent.length;
      g.sendTurn({ turn: 2, runs: [], input: null, facing: 1 });
      expect(f.sent.length).toBe(n);
    }
  });

  it('sync 에 실린 넘겨받은 목록으로 다른 탱크도 AI로 바꾼다', () => {
    const { f, sc } = make('c');
    f.recv({ t: 'sync', turn: 1, hash: 'x', from: 'a', taken: ['b'] });
    expect(sc.calls.takeover).toEqual([1]);
  });

  it('화면을 오래 가렸다 돌아오면 판 상태를 다시 받을 때까지 멈추고 보내지 않는다', async () => {
    vi.useFakeTimers();
    const { g, f, sc } = make('a');
    expect(g.isHost()).toBe(true);
    const vis = (h: boolean) => (g as unknown as { onVisibility(h: boolean): void }).onVisibility(h);
    vis(true);
    vi.advanceTimersByTime(2500);
    expect(f.awayCalls).toEqual([true]);
    expect(g.isHost()).toBe(false);
    g.sendTurn({ turn: 1, runs: [], input: null, facing: 1 });
    expect(f.sent.some((m) => m.t === 'turn')).toBe(false);
    vis(false);
    expect(g.frozen()).toBe(true);
    expect(f.sent.at(-1)).toMatchObject({ t: 'snapreq', from: 'a' });
    // 지금 기준 기기(b)가 답한다 — 순서도 b 의 것으로
    f.recv({ t: 'snap', to: 'a', from: 'b', order: ['b', 'c', 'a'], taken: [], snap: {}, records: [], elapsed: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(sc.calls.loaded).toBe(1);
    expect(g.frozen()).toBe(false);
    expect(f.awayCalls).toEqual([true, false]);
    expect(g.isHost()).toBe(false);
  });

  it('잠깐(2초 안) 가렸다 돌아오면 그대로 이어 간다', () => {
    vi.useFakeTimers();
    const { g, f } = make('a');
    const vis = (h: boolean) => (g as unknown as { onVisibility(h: boolean): void }).onVisibility(h);
    vis(true);
    vi.advanceTimersByTime(1000);
    vis(false);
    vi.advanceTimersByTime(3000);
    expect(f.awayCalls).toEqual([]);
    expect(g.frozen()).toBe(false);
    expect(g.isHost()).toBe(true);
  });

  it('청하지 않은 snap 은 기준 기기가 보낸 것만 불러온다', () => {
    const { f, sc } = make('c', ['a', 'b', 'c', 'd']);
    f.recv({ t: 'snap', to: 'c', from: 'd', snap: {}, records: [], elapsed: 0 });
    expect(sc.calls.loaded).toBe(0);
    f.recv({ t: 'snap', to: 'c', from: 'a', snap: {}, records: [], elapsed: 0 });
    expect(sc.calls.loaded).toBe(1);
  });
});

// ---------- 여러 기기를 잇는 가짜 채널 (메시지·자리 비움이 서로에게 간다) ----------

type Vis = { onVisibility(h: boolean): void; currentHost(): string };

function linkedNet(ids: string[]) {
  const devs = new Map<string, { msgFns: Set<(m: NetMsg) => void>; presFns: Set<() => void>; reconnFns: Set<() => void>; present: Set<string>; away: Set<string>; awayMe: boolean; sent: NetMsg[]; awayCalls: boolean[] }>();
  /** true 면 자리 비움(presence) 변화가 남에게 가지 않는다 (늦거나 잃어버림) */
  const net = { dropPresence: false };
  const later = (f: () => void) => queueMicrotask(f);
  for (const id of ids) devs.set(id, { msgFns: new Set(), presFns: new Set(), reconnFns: new Set(), present: new Set(ids), away: new Set(), awayMe: false, sent: [], awayCalls: [] });
  const session = (me: string) => {
    const d = devs.get(me)!;
    return {
      present: d.present,
      away: d.away,
      on: (fn: (m: NetMsg) => void) => (d.msgFns.add(fn), () => d.msgFns.delete(fn)),
      onPresence: (fn: () => void) => (d.presFns.add(fn), () => d.presFns.delete(fn)),
      onReconnect: (fn: () => void) => (d.reconnFns.add(fn), () => d.reconnFns.delete(fn)),
      send(m: NetMsg) {
        d.sent.push(m);
        for (const [id, o] of devs) if (id !== me && o.present.has(me)) later(() => o.msgFns.forEach((f) => f(m)));
      },
      async setAway(v: boolean) {
        d.awayCalls.push(v);
        if (d.awayMe === v) return;
        d.awayMe = v;
        if (net.dropPresence) return;
        for (const [id, o] of devs) {
          if (id === me) continue;
          if (v) o.away.add(me);
          else o.away.delete(me);
          later(() => o.presFns.forEach((f) => f()));
        }
      },
    } as unknown as RoomSession;
  };
  const games = new Map<string, OnlineGame>();
  for (const id of ids) {
    const g = new OnlineGame(session(id), room(ids), id);
    g.attach(fakeScene(ids.length).scene);
    // 기준 기기가 답할 수 있게 턴 시작 상태를 둔다
    g.turnStarted({ snapshot: () => ({ turn: 1 }), turn: 1 } as never);
    games.set(id, g);
  }
  return {
    net,
    devs,
    g: (id: string) => games.get(id)!,
    vis: (id: string, h: boolean) => (games.get(id)! as unknown as Vis).onVisibility(h),
    /** 기기마다 생각하는 기준 기기 */
    hosts: () => ids.map((id) => (games.get(id)! as unknown as Vis).currentHost()),
    /** 다른 기기들이 본 접속 목록에서 id 가 빠졌다 들어온다 (id 자신은 모른다) */
    blip(id: string) {
      for (const [k, o] of devs) {
        if (k === id) continue;
        o.present.delete(id);
        o.presFns.forEach((f) => f());
        o.present.add(id);
        o.presFns.forEach((f) => f());
      }
    },
    reconnect: (id: string) => devs.get(id)!.reconnFns.forEach((f) => f()),
    dispose: () => games.forEach((g) => g.dispose()),
  };
}

describe('기준 기기가 둘이거나 없어지지 않게', () => {
  let n: ReturnType<typeof linkedNet> | null = null;
  afterEach(() => {
    n?.dispose();
    n = null;
    vi.useRealTimers();
  });

  it('기준 기기가 가렸다 돌아왔는데 away 타이머가 못 돌았으면(아이폰 잠금) 먼저 away를 알리고 다음 기기가 답한다', async () => {
    vi.useFakeTimers();
    n = linkedNet(['a', 'b']);
    expect(n.hosts()).toEqual(['a', 'a']);
    n.vis('a', true);
    vi.setSystemTime(Date.now() + 2500); // 시계만 가고 타이머는 안 돎
    n.vis('a', false);
    await vi.advanceTimersByTimeAsync(0);
    expect(n.devs.get('a')!.awayCalls[0]).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(n.g('a').frozen()).toBe(false);
    expect(n.devs.get('b')!.sent.some((m) => m.t === 'snap' && m.to === 'a')).toBe(true);
    expect(n.hosts()).toEqual(['b', 'b']);
    expect([n.g('a').isHost(), n.g('b').isHost()]).toEqual([false, true]);
    expect(n.devs.get('a')!.awayCalls).toEqual([true, false]);
  });

  it('away 알림이 늦거나 사라져도, 기준 기기로 알던 기기가 판 상태를 청하면 다음 기기가 넘겨받아 답한다', async () => {
    vi.useFakeTimers();
    n = linkedNet(['a', 'b']);
    n.net.dropPresence = true;
    n.vis('a', true);
    vi.setSystemTime(Date.now() + 2500);
    n.vis('a', false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(n.g('a').frozen()).toBe(false);
    expect(n.hosts()).toEqual(['b', 'b']);
    expect([n.g('a').isHost(), n.g('b').isHost()]).toEqual([false, true]);
  });

  it('기준 기기의 연결이 끊겼다 다시 이어지면(남들만 나갔다 들어온 것으로 봄) 스스로 뒤로 가서 기준 기기가 하나', async () => {
    vi.useFakeTimers();
    n = linkedNet(['a', 'b']);
    n.blip('a');
    expect(n.hosts()).toEqual(['a', 'b']); // 고치기 전에는 여기서 그대로 둘 다 기준 기기
    n.reconnect('a');
    expect(n.g('a').frozen()).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(n.g('a').frozen()).toBe(false);
    expect(n.hosts()).toEqual(['b', 'b']);
    expect([n.g('a').isHost(), n.g('b').isHost()]).toEqual([false, true]);
    expect(n.g('a').trusted('b')).toBe(true);
  });

  it('세 기기: 기준 기기가 다시 이어져도 모두 같은 기기를 기준으로 본다', async () => {
    vi.useFakeTimers();
    n = linkedNet(['a', 'b', 'c']);
    n.blip('a');
    n.reconnect('a');
    await vi.advanceTimersByTimeAsync(3000);
    expect(n.hosts()).toEqual(['b', 'b', 'b']);
    expect(['a', 'b', 'c'].filter((id) => n!.g(id).isHost())).toEqual(['b']);
  });

  it('다시 맞추는 사이에 화면을 또 가리면 away 그대로 두고, 돌아오면 다시 맞춘다', async () => {
    vi.useFakeTimers();
    n = linkedNet(['a', 'b']);
    n.vis('a', true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(n.devs.get('a')!.awayCalls).toEqual([true]);
    n.vis('a', false); // snapreq 보냄
    n.vis('a', true); // 답이 오기 전에 또 가림
    await vi.advanceTimersByTimeAsync(3000);
    expect(n.devs.get('a')!.awayCalls).toEqual([true]);
    expect(n.hosts()).toEqual(['b', 'b']);
    const reqs = n.devs.get('a')!.sent.filter((m) => m.t === 'snapreq').length;
    n.vis('a', false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(n.devs.get('a')!.sent.filter((m) => m.t === 'snapreq').length).toBeGreaterThan(reqs);
    expect(n.devs.get('a')!.awayCalls).toEqual([true, false]);
    expect(n.g('a').frozen()).toBe(false);
    expect(n.hosts()).toEqual(['b', 'b']);
  });

  it('다른 사람이 없으면 다시 이어져도 기다리지 않는다', async () => {
    vi.useFakeTimers();
    n = linkedNet(['a', 'b']);
    n.devs.get('a')!.present.delete('b');
    n.reconnect('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(n.g('a').frozen()).toBe(false);
    expect(n.devs.get('a')!.sent.some((m) => m.t === 'snapreq')).toBe(false);
  });
});

