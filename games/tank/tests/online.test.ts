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
