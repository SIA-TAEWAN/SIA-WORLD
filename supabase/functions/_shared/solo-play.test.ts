/**
 * 화면 쪽 '기기에서 진행' (games/lib/solo-play.ts) 을 가짜 화면(host)과 실제 판 진행기(Runner, 메모리 DB)로 돌려 본다.
 * 서버가 공개한 상태는 실시간처럼 진행기의 filterState 를 거쳐 화면에 들어간다.
 */
import { describe, expect, it } from 'vitest';
import { seededRng } from './engine.ts';
import { ENGINES } from './engines.ts';
import { matgo, type MatgoAction, type MatgoPublic } from './matgo.ts';
import { GameError, Runner, type DeckRow, type RoomRow, type SeatRow, type Store } from './runner.ts';
import { soloOf } from './solo.ts';
import { soloPlay, type LocalHost, type LocalPlay, type ReplayPayload } from '../../../games/lib/solo-play.ts';
import type { PrivateRow, StateRow } from '../../../games/lib/world.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 8000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('기다리던 일이 일어나지 않았어요');
    await sleep(2);
  }
}

/** 메모리 DB + 판 진행기 (runner.test.ts 와 같은 규칙) */
function server(humans: string[], seed: number) {
  const room: RoomRow = { id: 'r1', game: 'matgo', base_unit: 100, status: 'waiting', round_no: 0 };
  const seats: (SeatRow & { pending_user_id: string | null })[] = [0, 1].map((i) => ({
    seat_no: i, user_id: humans[i] ?? null, nickname: humans[i] ?? `AI ${i}`, avatar: 'tiger', ready: true, left_game: false, pending_user_id: null,
  }));
  const wallets: Record<string, number> = Object.fromEntries(humans.map((h) => [h, 100000]));
  let deck: DeckRow = { version: 0, round_no: 0, state: null, carry: null };
  let pubVersion = 0;
  let clock = 0;
  const published: StateRow[] = [];
  const results = new Map<number, Record<number, number>>();
  /** 실시간 구독 (공개 상태가 저장되면 불린다) */
  const subs = new Set<(s: StateRow, privs: PrivateRow[]) => void>();
  const store: Store = {
    room: async () => ({ ...room }),
    seats: async () => seats.map((s) => ({ ...s })),
    balances: async (ids) => Object.fromEntries(ids.map((i) => [i, wallets[i] ?? 0])),
    deck: async () => JSON.parse(JSON.stringify(deck)),
    saveDeck: async (_id, v, state, carry, round) => {
      if (deck.version !== v) return false;
      deck = { version: v + 1, round_no: round, state: JSON.parse(JSON.stringify(state)), carry: JSON.parse(JSON.stringify(carry ?? null)) };
      return true;
    },
    beginRound: async () => {
      if (room.status !== 'waiting') return null;
      room.status = 'playing';
      return ++room.round_no;
    },
    publish: async (_id, version, round, pub, pending, deadline, privates) => {
      if (version <= pubVersion) return;
      pubVersion = version;
      const row: StateRow = {
        round_no: round,
        public_state: JSON.parse(JSON.stringify(pub)),
        pending_seats: pending,
        turn_deadline: deadline ? deadline.toISOString() : null,
        updated_at: new Date(1_700_000_000_000 + ++clock).toISOString(),
      };
      published.push(row);
      const privs = privates.filter((p) => p.userId !== null).map((p) => ({ seat_no: p.seat, round_no: round, hand: JSON.parse(JSON.stringify(p.hand)) }));
      for (const f of subs) f(row, privs);
    },
    applyResult: async (_id, round, deltas) => {
      if (results.has(round)) return false;
      results.set(round, deltas);
      for (const s of seats) if (s.user_id) wallets[s.user_id] += deltas[s.seat_no] ?? 0;
      return true;
    },
    finishRound: async () => {
      for (const s of seats) s.ready = s.user_id === null;
      room.status = 'waiting';
      return true;
    },
  };
  const runner = new Runner(store, ENGINES, seededRng(seed));
  return { room, seats, wallets, published, results, subs, runner, get deck() { return deck; } };
}

function memStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

/** 가짜 화면: 진행기가 넣은 상태를 차례로 받아 적고, '연출'은 짧게 기다리는 것으로 흉내 낸다 */
function screen(sv: ReturnType<typeof server>, user: string, o: { storage?: ReturnType<typeof memStorage>; turnMs?: number; animMs?: number; fail?: () => boolean } = {}) {
  /** 화면에 들어온 상태 (기기 진행 · 서버 공개 모두) */
  const shown: StateRow[] = [];
  let st: StateRow | null = null;
  let priv: PrivateRow | null = null;
  let busyUntil = 0;
  const jumps: StateRow[] = [];
  const calls = { sync: 0, replay: [] as ReplayPayload[], exit: [] as ReplayPayload[], reload: 0, toast: [] as string[] };
  /** 서버 오류를 화면이 받는 모양으로 (shared/room.js: code = 서버 문구, status = HTTP 상태) */
  const wrap = async <T,>(f: () => Promise<T>): Promise<T> => {
    if (o.fail?.()) throw new Error('network');
    try {
      return await f();
    } catch (e) {
      if (e instanceof GameError) throw Object.assign(new Error(e.message), { code: e.message, status: e.status });
      throw e;
    }
  };
  const mySeat = () => sv.seats.find((s) => s.user_id === user && !s.left_game)?.seat_no ?? null;
  const take = (s: StateRow, p: PrivateRow | null) => {
    shown.push(s);
    st = s;
    if (p) priv = p;
    busyUntil = Date.now() + (o.animMs ?? 3);
  };
  let play: LocalPlay;
  const host: LocalHost = {
    roomId: 'r1',
    get: () => ({ room: sv.room as never, seats: sv.seats as never, mySeat: mySeat() }),
    api: {
      sync: () => (calls.sync++, wrap(() => sv.runner.sync('r1', user))),
      replay: (p) => (calls.replay.push(p), wrap(() => sv.runner.replay('r1', user, JSON.parse(JSON.stringify(p))))),
      replayOnExit: (p) => {
        calls.exit.push(p);
        void sv.runner.replay('r1', user, JSON.parse(JSON.stringify(p))).catch(() => undefined);
        return true;
      },
    },
    push: (s, p) => take(s, p),
    jump: (s, p) => {
      jumps.push(s);
      take(s, p);
    },
    settled: async () => {
      while (Date.now() < busyUntil) await sleep(1);
    },
    setDeadline: (iso) => {
      if (st) st = { ...st, turn_deadline: iso };
    },
    reload: async () => {
      calls.reload++;
      const last = sv.published[sv.published.length - 1] ?? null;
      const sub = play.onReload({ room: sv.room as never, state: last });
      if (sub) {
        st = sub.state;
        priv = sub.priv;
      } else st = last;
    },
    refresh: () => undefined,
    toast: (m) => void calls.toast.push(m),
  };
  play = soloPlay(matgo, { thinkMs: 0, turnMs: o.turnMs ?? 60_000, storage: o.storage ?? null })(host);
  // 실시간: 서버가 공개한 상태 → 진행기가 거른 뒤 화면으로
  const dropped: StateRow[] = [];
  const onPub = (s: StateRow, privs: PrivateRow[]) => {
    if (play.filterState(s)) dropped.push(s);
    else take(s, null);
    for (const p of privs) if (!play.filterPrivate(p)) priv = p;
  };
  sv.subs.add(onPub);
  const off = () => sv.subs.delete(onPub);
  const pub = () => st?.public_state as unknown as MatgoPublic & { soloN?: number; result: unknown };
  const myTurn = () => !!st && mySeat() !== null && st.pending_seats.includes(mySeat()!) && !st.public_state?.result;
  /** 내 차례에 고를 행동 (화면에 보이는 정보만으로: 공개 상태 + 내 패) */
  const pick = (rng = seededRng(5)): MatgoAction => matgo.ai(pub(), priv!.hand as never, mySeat()!, rng);
  return { play, host, shown, jumps, dropped, calls, off, pub, myTurn, pick, state: () => st, priv: () => priv };
}

/** 내 차례마다 두면서 판이 서버에서 정산될 때까지 */
async function finishRound(sv: ReturnType<typeof server>, sc: ReturnType<typeof screen>, seed = 5) {
  const rng = seededRng(seed);
  for (let i = 0; i < 400 && sv.room.status === 'playing'; i++) {
    await until(() => sc.myTurn() || sv.room.status !== 'playing' || sc.play.notice() !== null);
    if (sv.room.status !== 'playing') break;
    if (sc.play.notice() !== null) {
      await until(() => sv.room.status !== 'playing');
      break;
    }
    await sc.host.settled();
    if (!sc.myTurn()) continue;
    expect(sc.play.act(sc.pick(rng))).toBe(true);
  }
  expect(sv.room.status).toBe('waiting');
}

describe('기기에서 진행하는 혼자 맞고 (화면 쪽 진행기)', () => {
  it('한 판: 내 행동은 서버에 보내지 않고 바로 적용, AI 는 한 수씩, 끝나면 행동 목록을 보내 서버가 정산한다', async () => {
    const sv = server(['u1'], 11);
    const store = memStorage();
    const sc = screen(sv, 'u1', { storage: store });
    const res = await sv.runner.start('r1', 'u1');
    sc.play.onStart(res);
    // 판 시작: 서버가 공개한 상태(실시간)와 기기 상태가 같은 진행 수 → 하나는 걸러지거나 같은 내용이다
    expect(sc.shown.length).toBeGreaterThanOrEqual(1);
    const n0 = soloOf((res as { solo: unknown }).solo)!.n;
    expect(sc.pub().soloN).toBe(n0);
    await finishRound(sv, sc);
    // 서버 공개는 판 시작과 판 끝 두 번뿐 (그 사이 서버와 닿지 않았다)
    expect(sv.published.length).toBe(2);
    expect(sc.calls.replay.length).toBe(1);
    expect(sc.calls.replay[0].n).toBe(n0);
    expect(sc.calls.sync).toBe(0);
    // 화면에 들어온 기기 상태는 한 행동씩 (진행 수가 1씩 는다), 결과는 마지막 서버 상태에만
    const locals = sc.shown.filter((s) => s.local);
    locals.forEach((s, i) => {
      expect(s.public_state!.result).toBeNull();
      if (i) expect(s.public_state!.soloN).toBe((locals[i - 1].public_state!.soloN as number) + 1);
    });
    const last = sc.shown[sc.shown.length - 1];
    expect(last.local).toBeUndefined();
    expect(last.public_state!.result).toBeTruthy();
    // 서버의 결과 상태는 기기가 마지막에 보여 준 것과 사건 번호까지 같다 → 연출이 두 번 나오지 않는다
    expect(last.public_state!.events).toEqual(locals[locals.length - 1].public_state!.events);
    expect(last.public_state!.soloN).toBe(locals[locals.length - 1].public_state!.soloN);
    // 정산이 지갑에 들어갔다
    expect(sv.wallets.u1).toBe(100000 + (sv.results.get(1)![0] ?? 0));
    // 판이 끝나면 기기 진행도 끝 (다음 행동은 서버로), 보관한 목록도 지운다
    expect(sc.play.act({ type: 'go' })).toBeNull();
    expect(sc.play.notice()).toBeNull();
    expect([...store.m.keys()]).toEqual([]);
    sc.off();
  });

  it('AI 는 내 차례의 연출이 다 끝난 뒤에 둔다 (연달아 둘 때도 한 행동씩 연출이 끝난 뒤)', async () => {
    const sv = server(['u1'], 21);
    const sc = screen(sv, 'u1', { animMs: 120 });
    sc.play.onStart(await sv.runner.start('r1', 'u1'));
    await until(() => sc.myTurn());
    await sc.host.settled();
    const before = sc.shown.length;
    const t0 = Date.now();
    const times: number[] = [];
    const orig = sc.host.push;
    sc.host.push = (s, p) => {
      times.push(Date.now() - t0);
      orig(s, p);
    };
    // 내 행동 뒤에 AI 가 둘 때까지 (내가 또 골라야 하면 계속 고른다)
    const rng = seededRng(3);
    for (let i = 0; i < 6; i++) {
      expect(sc.play.act(sc.pick(rng))).toBe(true);
      // 내 행동 뒤에도 내가 골라야 하면 (같은 달 2장 중 고르기 · 고/스톱) 그 연출이 끝난 뒤 이어서 고른다
      if (!sc.myTurn() || sc.play.notice()) break;
      await sc.host.settled();
    }
    await until(() => sc.myTurn() || sc.play.notice() !== null);
    expect(sc.shown.length).toBeGreaterThan(before + 1);
    // 내 행동은 바로(0ms 근처), 그 뒤의 행동은 앞 행동의 연출(120ms)이 끝난 뒤에야 들어온다
    expect(times[0]).toBeLessThan(60);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(110);
    sc.off();
  });

  it('내 차례 시간이 지나면 기기에서 자동 행동을 내 행동으로 둔다 (목록에 들어가 서버 정산에도 반영)', async () => {
    const sv = server(['u1'], 31);
    const sc = screen(sv, 'u1', { turnMs: 15 });
    sc.play.onStart(await sv.runner.start('r1', 'u1'));
    await until(() => sv.room.status === 'waiting', 20000);
    expect(sc.calls.replay.length).toBe(1);
    expect(sc.calls.replay[0].actions.length).toBeGreaterThan(3);
    expect(sv.results.has(1)).toBe(true);
    sc.off();
  });

  it('새로고침: sync 로 서버 상태를 받고, 보관해 둔 그 뒤의 내 행동을 다시 적용해 이어 간다', async () => {
    const sv = server(['u1'], 41);
    const store = memStorage();
    const a = screen(sv, 'u1', { storage: store });
    a.play.onStart(await sv.runner.start('r1', 'u1'));
    const rng = seededRng(9);
    let acted = 0;
    while (acted < 3) {
      await until(() => a.myTurn());
      await a.host.settled();
      expect(a.play.act(a.pick(rng))).toBe(true);
      acted++;
    }
    const mid = a.state()!;
    expect(sv.published.length).toBe(1); // 서버는 아직 판 시작 상태
    expect(JSON.parse([...store.m.values()][0]).log).toHaveLength(3);
    // 페이지를 새로 연다 (앞의 화면은 사라진다: 보관한 목록만 남는다)
    a.play.dispose();
    a.off();
    const b = screen(sv, 'u1', { storage: store });
    await b.host.reload(); // 처음 읽기: 서버 상태(판 시작) → 혼자 하는 판이니 sync
    await until(() => b.jumps.length > 0);
    expect(b.calls.sync).toBe(1);
    // 세 번째 내 행동까지 그대로 되살아났다 (연출 없이)
    expect(b.jumps[0].public_state!.soloN).toBe(mid.public_state!.soloN);
    expect(b.jumps[0].public_state!.events).toEqual(mid.public_state!.events);
    expect(b.priv()!.hand).toEqual(a.priv()!.hand);
    await finishRound(sv, b, 4);
    expect(sv.results.has(1)).toBe(true);
    expect(sv.wallets.u1).toBe(100000 + (sv.results.get(1)![0] ?? 0));
    b.off();
  });

  it('보관한 행동이 서버 상태와 맞지 않으면 서버 상태를 따른다', async () => {
    const sv = server(['u1'], 43);
    const store = memStorage();
    const res = (await sv.runner.start('r1', 'u1')) as { round: number; solo: unknown };
    const n0 = soloOf(res.solo)!.n;
    // 엉뚱한 보관분: 진행 수가 안 맞는 것, 규칙에 어긋나는 것
    store.setItem('sia-solo:r1:1', JSON.stringify({ t: Date.now(), log: [{ n: n0, a: { type: 'play', card: 'm99-none' } }, { n: n0 + 5, a: { type: 'go' } }] }));
    store.setItem('sia-solo:r1:0', JSON.stringify({ t: Date.now(), log: [] })); // 지난 판 것은 치운다
    const sc = screen(sv, 'u1', { storage: store });
    sc.play.onStart(res);
    expect(sc.pub().soloN).toBe(n0);
    expect(store.m.has('sia-solo:r1:0')).toBe(false);
    await finishRound(sv, sc);
    expect(sv.results.has(1)).toBe(true);
    sc.off();
  });

  it('페이지를 떠날 때 그때까지의 목록을 보낸다. 페이지가 살아 돌아와 이어 두면 서버와 다시 맞춘 뒤 끝낸다', async () => {
    const sv = server(['u1'], 51);
    const store = memStorage();
    const sc = screen(sv, 'u1', { storage: store });
    sc.play.onStart(await sv.runner.start('r1', 'u1'));
    const rng = seededRng(2);
    for (let i = 0; i < 2; i++) {
      await until(() => sc.myTurn());
      await sc.host.settled();
      sc.play.act(sc.pick(rng));
    }
    await sc.play.flush('pagehide');
    expect(sc.calls.exit).toHaveLength(1);
    expect(sc.calls.exit[0].actions).toHaveLength(2);
    await until(() => sv.published.length === 2); // 서버가 중간 저장을 공개했다
    // 그 공개 상태는 화면에 넣지 않는다 (되돌아가지 않게). 서버가 AI 차례까지 이어 둬서 잠깐 앞서 있어도 내 행동만으로 간 데까지면 그대로 이어 간다
    expect(sc.shown.filter((s) => !s.local && s !== sv.published[0])).toEqual([]);
    await finishRound(sv, sc, 8);
    expect(sv.results.has(1)).toBe(true);
    // 다시 맞출 일 없이 (sync · 건너뛰기 없음), 남은 행동만 한 번 더 보냈다
    expect(sc.calls.sync).toBe(0);
    expect(sc.jumps).toHaveLength(0);
    expect(sc.calls.replay).toHaveLength(1);
    expect(sc.calls.replay[0].n).toBeGreaterThan(sc.calls.exit[0].n);
    expect(sv.wallets.u1).toBe(100000 + (sv.results.get(1)![0] ?? 0));
    sc.off();
  });

  it('나가기: 그때까지를 서버에 보내고 기기 진행을 끝낸다 → 서버 AI 가 이어 두어 정산', async () => {
    const sv = server(['u1'], 61);
    const sc = screen(sv, 'u1');
    sc.play.onStart(await sv.runner.start('r1', 'u1'));
    await until(() => sc.myTurn());
    await sc.host.settled();
    sc.play.act(sc.pick());
    await sc.play.flush('leave');
    expect(sc.calls.replay).toHaveLength(1);
    expect(sc.play.act({ type: 'go' })).toBeNull();
    expect(soloOf(sv.deck.state)!.n).toBeGreaterThan(0);
    sv.seats[0].left_game = true; // leave_room
    await sv.runner.timeout('r1', sv.deck.version, true);
    expect(sv.room.status).toBe('waiting');
    expect(sv.results.has(1)).toBe(true);
    sc.off();
  });

  it('구경하는 사람(다음 판 예약)이 있으면 행동마다 보내 진행을 보여 주되, 되돌아온 공개 상태는 내 화면에 넣지 않는다', async () => {
    const sv = server(['u1'], 71);
    const sc = screen(sv, 'u1');
    sc.play.onStart(await sv.runner.start('r1', 'u1'));
    sv.seats[1].pending_user_id = 'u2';
    await finishRound(sv, sc);
    expect(sc.calls.replay.length).toBeGreaterThan(2);
    expect(sv.published.length).toBeGreaterThan(3);
    // 내 화면: 서버 상태는 판 시작(같은 내용)과 결과뿐
    const fromServer = sc.shown.filter((s) => !s.local);
    expect(fromServer.every((s) => s === sv.published[0] || !!s.public_state!.result)).toBe(true);
    expect(sc.dropped.length).toBeGreaterThan(1);
    expect(sv.wallets.u1).toBe(100000 + (sv.results.get(1)![0] ?? 0));
    sc.off();
  });

  it('서버가 대신 끝낸 판(30분 마감)은 서버 결과를 따른다: 기기 진행을 버리고 내 목록은 받지 않는다', async () => {
    const sv = server(['u1'], 81);
    const sc = screen(sv, 'u1');
    sc.play.onStart(await sv.runner.start('r1', 'u1'));
    await until(() => sc.myTurn());
    await sc.host.settled();
    sc.play.act(sc.pick());
    await sv.runner.timeout('r1', sv.deck.version); // 마감이 지나 서버가 남은 판을 대신 뒀다
    expect(sv.room.status).toBe('waiting');
    // 결과가 든 서버 상태가 화면에 들어왔고, 기기 진행은 끝났다
    expect(sc.state()!.public_state!.result).toBeTruthy();
    expect(sc.play.act({ type: 'go' })).toBeNull();
    expect(sc.calls.replay).toHaveLength(0);
    expect(sv.results.size).toBe(1);
    sc.off();
  });

  it('판 끝 전송이 실패하면 다시 보낸다 (그동안 "결과를 저장하는 중…")', async () => {
    const sv = server(['u1'], 91);
    let down = false;
    let failed = 0;
    const sc = screen(sv, 'u1', { fail: () => down && ++failed <= 2 });
    sc.play.onStart(await sv.runner.start('r1', 'u1'));
    down = true;
    const rng = seededRng(6);
    for (let i = 0; i < 400 && sc.play.notice() === null; i++) {
      await until(() => sc.myTurn() || sc.play.notice() !== null);
      if (sc.play.notice() !== null) break;
      await sc.host.settled();
      if (sc.myTurn()) sc.play.act(sc.pick(rng));
    }
    expect(sc.play.notice()).toBe('결과를 저장하는 중…');
    expect(sv.room.status).toBe('playing');
    await until(() => sv.room.status === 'waiting', 10000);
    expect(failed).toBe(3);
    expect(sc.calls.replay.length).toBe(3);
    expect(sv.results.has(1)).toBe(true);
    expect(sc.play.notice()).toBeNull();
    sc.off();
  }, 20000);

  it('판 시작 응답을 못 받았으면 (공개 상태가 먼저 왔다) 잠깐 뒤 sync 로 받아 온다', async () => {
    const sv = server(['u1'], 101);
    const sc = screen(sv, 'u1');
    await sv.runner.start('r1', 'u1'); // 응답은 화면에 전하지 않는다
    expect(sc.play.act({ type: 'flip' })).toBeNull(); // 아직 기기 진행 전: 서버로 갈 행동
    await until(() => sc.calls.sync === 1, 3000);
    await until(() => sc.shown.some((s) => s.local));
    await finishRound(sv, sc);
    expect(sv.results.has(1)).toBe(true);
    sc.off();
  });

  it('사람이 둘인 방은 기기에서 진행하지 않는다 (행동은 서버로, 서버 상태는 그대로 화면에)', async () => {
    const sv = server(['u1', 'u2'], 111);
    const sc = screen(sv, 'u1');
    const res = await sv.runner.start('r1', 'u1');
    sc.play.onStart(res);
    expect(sc.shown).toHaveLength(1);
    expect(sc.shown[0].local).toBeUndefined();
    expect(sc.play.act({ type: 'flip' })).toBeNull();
    expect(sc.play.onReload({ room: sv.room as never, state: sv.published[0] })).toBeNull();
    await sleep(900);
    expect(sc.calls.sync).toBe(0);
    sc.off();
  });
});
