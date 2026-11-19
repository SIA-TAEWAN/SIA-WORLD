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
/** 방 채널 흉내 (화면끼리 바로 주고받는 알림). lose 가 참을 돌려주면 그 알림은 사라진다 */
function castBus() {
  const subs = new Set<(from: string, msg: unknown) => void>();
  const bus = { subs, sent: 0, lose: null as null | (() => boolean), tamper: null as null | ((msg: unknown) => unknown) };
  return bus;
}

function screen(
  sv: ReturnType<typeof server>,
  user: string,
  o: {
    storage?: ReturnType<typeof memStorage>; turnMs?: number; animMs?: number; fail?: () => boolean;
    /** 사람이 둘인 판: 방 채널. 없으면 알림 없이 (서버 공개 상태로만 따라간다) */
    bus?: ReturnType<typeof castBus>;
    /** 행동을 하나씩 보낼 길이 없는 화면 (사람이 둘인 판을 기기에서 진행하지 못한다) */
    noAct?: boolean;
    /** 서버 왕복에 걸리는 시간 흉내 (ms) */
    latMs?: number;
  } = {},
) {
  /** 화면에 들어온 상태 (기기 진행 · 서버 공개 모두) */
  const shown: StateRow[] = [];
  let st: StateRow | null = null;
  let priv: PrivateRow | null = null;
  let busyUntil = 0;
  const jumps: StateRow[] = [];
  const calls = { sync: 0, replay: [] as ReplayPayload[], exit: [] as ReplayPayload[], reload: 0, toast: [] as string[], act: [] as { n: number; a: unknown; ok: boolean }[] };
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
      sync: () => (calls.sync++, wrap(() => sv.runner.sync('r1', user, { duo: true }))),
      ...(o.noAct
        ? {}
        : {
            act: async (a: unknown, n: number) => {
              const rec = { n, a, ok: false };
              calls.act.push(rec);
              if (o.latMs) await sleep(o.latMs);
              const r = await wrap(() => sv.runner.act('r1', user, JSON.parse(JSON.stringify(a)), n));
              rec.ok = true;
              return r;
            },
            cast: (msg: unknown) => {
              const bus = o.bus;
              if (!bus) return;
              bus.sent++;
              if (bus.lose?.()) return;
              const m = JSON.parse(JSON.stringify(bus.tamper ? bus.tamper(msg) : msg));
              queueMicrotask(() => {
                for (const f of bus.subs) f(user, m);
              });
            },
          }),
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
  const onCast = (from: string, msg: unknown) => {
    if (from !== user) play.onCast(msg);
  };
  o.bus?.subs.add(onCast);
  const off = () => {
    sv.subs.delete(onPub);
    o.bus?.subs.delete(onCast);
  };
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

  it('사람이 둘인 방: 행동을 하나씩 보낼 길이 없는 화면은 기기에서 진행하지 않는다 (행동은 서버로, 서버 상태는 그대로 화면에)', async () => {
    const sv = server(['u1', 'u2'], 111);
    const sc = screen(sv, 'u1', { noAct: true });
    const res = await sv.runner.start('r1', 'u1');
    sc.play.onStart(res);
    expect(sc.shown).toHaveLength(1);
    expect(sc.shown[0].local).toBeUndefined();
    expect(sc.play.act({ type: 'flip' })).toBeNull();
    expect(sc.play.onReload({ room: sv.room as never, state: sv.published[0] })).toBeNull();
    sc.off();
  });
});

/**
 * 사람 둘이 하는 맞고: 두 화면 + 실제 판 진행기. 서버는 계속 심판이고 (행동을 하나씩 받는다), 화면은 먼저 보여 준다.
 */
describe('기기에서 먼저 진행하는 2인 맞고 (화면 쪽 진행기)', () => {
  /** 두 화면으로 판 시작: u1 은 시작 응답으로, u2 는 공개 상태를 보고 sync 로 전체 상태를 받는다 */
  async function begin(seed: number, oa: Parameters<typeof screen>[2] = {}, ob: Parameters<typeof screen>[2] = {}) {
    const sv = server(['u1', 'u2'], seed);
    const bus = castBus();
    const a = screen(sv, 'u1', { bus, ...oa });
    const b = screen(sv, 'u2', { bus, ...ob });
    const res = (await sv.runner.start('r1', 'u1')) as { duo?: unknown };
    a.play.onStart(res);
    if (res.duo) await until(() => !!b.state()?.local, 4000);
    return { sv, bus, a, b, res };
  }
  /** 각자 자기 차례에 두면서 판이 서버에서 정산될 때까지. each: 행동을 하나 둘 때마다 */
  async function finishDuo(sv: ReturnType<typeof server>, screens: ReturnType<typeof screen>[], each?: (i: number) => void | Promise<void>, seed = 5) {
    const rng = seededRng(seed);
    let moves = 0;
    for (let i = 0; i < 3000 && sv.room.status === 'playing'; i++) {
      const sc = screens.find((x) => x.myTurn() && x.play.notice() === null);
      if (!sc) {
        await sleep(2);
        continue;
      }
      await sc.host.settled();
      if (!sc.myTurn() || sv.room.status !== 'playing') continue;
      // 기기 진행이 서버와 다시 맞추는 중이면 (act 가 null) 잠깐 뒤에
      const ok = sc.play.act(sc.pick(rng));
      if (ok === true) await each?.(moves++);
      else await sleep(5);
    }
    expect(sv.room.status).toBe('waiting');
  }
  const nOf = (sc: ReturnType<typeof screen>) => (sc.state()?.public_state as { soloN?: number } | null)?.soloN ?? -1;

  it('한 판: 내 행동은 바로 화면에, 상대 화면에는 알림으로 바로. 서버에는 하나씩 (진행 수와 함께) 가고 서버 공개 상태는 평소에 버린다', async () => {
    const { sv, a, b, res } = await begin(11, { latMs: 20 }, { latMs: 20 });
    expect(res.duo).toBeTruthy();
    // 두 화면 모두 기기 진행 상태 (전체 상태는 u1 시작 응답 · u2 sync 한 번)
    expect(a.state()?.local).toBe(true);
    expect(b.state()?.local).toBe(true);
    expect([a.calls.sync, b.calls.sync]).toEqual([0, 1]);
    // 첫 행동: 서버 응답(20ms)을 기다리지 않고 바로 내 화면에 들어가고, 상대 화면에도 서버 공개보다 먼저 들어간다
    const first = [a, b].find((x) => x.myTurn())!;
    const other = first === a ? b : a;
    const n0 = nOf(first);
    const pubs = sv.published.length;
    expect(first.play.act(first.pick())).toBe(true);
    expect(nOf(first)).toBe(n0 + 1);
    expect(first.state()?.eager).toBe(true);
    await until(() => nOf(other) === n0 + 1, 1000);
    expect(sv.published.length).toBe(pubs); // 아직 서버는 공개하지 않았다 (알림으로 먼저 봤다)
    expect(other.state()?.local).toBe(true);
    await until(() => sv.published.length > pubs);
    await finishDuo(sv, [a, b]);
    // 서버는 각자의 행동을 본인 이름으로 하나씩 받았다: 목록으로 한꺼번에 내지 않았고, 진행 수마다 한 번씩 받아들였다
    // (상대의 앞선 행동이 서버에 닿기 전에 보낸 것은 'out of sync' 로 한 번 거절됐다가 다시 보내 받아들여진다)
    expect(a.calls.replay).toHaveLength(0);
    expect(b.calls.replay).toHaveLength(0);
    const sent = [...a.calls.act, ...b.calls.act];
    const okN = sent.filter((x) => x.ok).map((x) => x.n).sort((x, y) => x - y);
    expect(okN.length).toBeGreaterThan(10);
    expect(new Set(okN).size).toBe(okN.length);
    expect(new Set(sent.map((x) => x.n)).size).toBe(okN.length);
    // 다시 맞춘 일이 없다 (sync 는 u2 의 처음 한 번뿐)
    expect([a.calls.sync, b.calls.sync]).toEqual([0, 1]);
    expect(a.jumps).toHaveLength(0);
    // 진행 중 서버 공개 상태는 화면에 들어가지 않았고, 결과가 든 마지막 공개 상태만 들어갔다
    for (const sc of [a, b]) {
      const fromServer = sc.shown.filter((x) => !x.local);
      expect(fromServer.filter((x) => !x.public_state?.result).length).toBeLessThanOrEqual(1); // (u2: 전체 상태를 받기 전의 첫 공개 상태)
      expect(sc.state()?.public_state?.result).toBeTruthy();
      expect(sc.dropped.length).toBeGreaterThan(5);
    }
    // 정산은 서버가 한 번
    expect(sv.results.size).toBe(1);
    const d = sv.results.get(1)!;
    expect(d[0] + d[1]).toBe(0);
    a.off();
    b.off();
  }, 30_000);

  it('알림을 놓치면 서버 공개 상태를 보고 sync 로 따라잡는다 (판은 끝까지 간다)', async () => {
    const { sv, bus, a, b } = await begin(12);
    // 알림 셋 중 하나는 사라진다
    let k = 0;
    bus.lose = () => k++ % 3 === 0;
    await finishDuo(sv, [a, b]);
    expect(a.calls.sync + b.calls.sync).toBeGreaterThan(1);
    expect(a.jumps.length + b.jumps.length).toBeGreaterThan(0);
    expect([...a.calls.act, ...b.calls.act].every((x) => x.ok)).toBe(true);
    expect(sv.results.size).toBe(1);
    for (const sc of [a, b]) expect(sc.state()?.public_state?.result).toBeTruthy();
    a.off();
    b.off();
  }, 30_000);

  it('알림이 아예 없어도 (방 채널이 안 되는 환경) 서버 공개 상태만으로 끝까지 간다', async () => {
    const { sv, bus, a, b } = await begin(13);
    bus.lose = () => true;
    await finishDuo(sv, [a, b]);
    expect(sv.results.size).toBe(1);
    expect([...a.calls.act, ...b.calls.act].every((x) => x.ok)).toBe(true);
    a.off();
    b.off();
  }, 60_000);

  it('서버가 내 행동을 거절하면 (시간 초과로 서버가 이미 대신 뒀다) 기기 진행을 버리고 서버 상태로 맞춘다. 상대 화면도 같은 서버 상태로', async () => {
    const { sv, a, b } = await begin(14);
    const me = [a, b].find((x) => x.myTurn())!;
    const other = me === a ? b : a;
    await me.host.settled();
    // 서버가 시간 초과로 내 차례를 대신 뒀다 (공개 상태는 곧 온다). 그것을 보기 전에 나는 내 행동을 뒀다
    const n0 = nOf(me);
    const mine = me.pick(seededRng(77));
    const timedOut = sv.runner.timeout('r1');
    expect(me.play.act(mine)).toBe(true);
    await timedOut;
    // 내 행동은 거절된다 (진행 수가 이미 늘었다) → 서버 상태로
    await until(() => me.calls.act.length > 0 && me.calls.sync > (me === b ? 1 : 0), 3000);
    expect(me.calls.act[0]).toMatchObject({ n: n0, ok: false });
    await until(() => me.jumps.length > 0 && other.state() !== null && nOf(me) === soloOf(sv.deck.state)!.n, 3000);
    const want = JSON.parse(JSON.stringify(matgo.view(sv.deck.state as never).public));
    delete want.result;
    const got = (sc: ReturnType<typeof screen>) => {
      const p = { ...(sc.state()!.public_state as Record<string, unknown>) };
      for (const key of ['round', 'result', 'deltas', 'soloN']) delete p[key];
      return JSON.parse(JSON.stringify(p));
    };
    expect(got(me)).toEqual(want);
    // 상대 화면: 내 (거절된) 행동의 알림을 먼저 적용했더라도 서버 공개 상태와 달라 서버 상태로 맞춘다
    await until(() => nOf(other) === soloOf(sv.deck.state)!.n && JSON.stringify(got(other)) === JSON.stringify(want), 3000);
    // 그 뒤로도 판은 끝까지 간다
    await finishDuo(sv, [a, b]);
    expect(sv.results.size).toBe(1);
    a.off();
    b.off();
  }, 30_000);

  it('가짜 알림: 규칙에 안 맞으면 버리고, 규칙에는 맞지만 서버가 받은 것과 다르면 서버 공개 상태를 보고 바로잡는다', async () => {
    const { sv, bus, a, b } = await begin(15);
    const me = [a, b].find((x) => x.myTurn())!;
    const other = me === a ? b : a;
    await me.host.settled();
    const n0 = nOf(me);
    // 규칙에 안 맞는 알림 · 내 자리라고 우기는 알림 · 다른 판의 알림: 상대 화면은 그대로
    const seat = me === a ? 0 : 1;
    for (const f of bus.subs) {
      f('x', { r: 1, n: n0, seat, a: { type: 'play', card: 'm99-none' } });
      f('x', { r: 1, n: n0, seat: 1 - seat, a: { type: 'flip' } });
      f('x', { r: 9, n: n0, seat, a: { type: 'flip' } });
      f('x', { r: 1, n: n0, seat, a: 'flip' });
      f('x', null);
    }
    await sleep(30);
    expect(nOf(other)).toBe(n0);
    // 규칙에는 맞는 가짜: 내가 실제로 낸 것과 다른 패를 냈다고 알린다 (상대 화면은 일단 그렇게 본다)
    const real = me.pick(seededRng(3));
    const hand = (me.priv()!.hand as { hand: string[] }).hand;
    const fake = hand.find((id) => real.type !== 'play' || id !== real.card)!;
    bus.tamper = (msg) => ({ ...(msg as object), a: { type: 'play', card: fake } });
    expect(me.play.act(real)).toBe(true);
    bus.tamper = null;
    // 서버가 공개한 상태(진짜)와 달라 상대 화면이 서버 상태로 맞춘다
    await until(() => other.jumps.length > 0, 3000);
    await until(() => nOf(other) === soloOf(sv.deck.state)!.n, 3000);
    await finishDuo(sv, [a, b]);
    expect(sv.results.size).toBe(1);
    a.off();
    b.off();
  }, 30_000);

  it('상대가 나가면: 서버 AI 가 그 자리를 이어 두고, 남은 화면은 서버 상태를 받아 혼자 하는 판으로 이어 간다 (정산까지)', async () => {
    const { sv, a, b } = await begin(16);
    // 몇 수 둔 뒤 u2 가 나간다
    await finishDuoSome(sv, [a, b], 4);
    await a.host.settled();
    await b.play.flush('leave');
    b.off();
    sv.seats[1].left_game = true;
    // 서버가 나간 자리를 AI 로 이어 둔다 (정리 작업이 autoOnly 로 부른다)
    await sv.runner.timeout('r1', undefined, true);
    const syncs = a.calls.sync;
    // 남은 화면: 내 차례가 오면 계속 둔다. 상대 알림은 더 오지 않는다 → 서버 공개 상태를 보고 sync → 혼자 하는 판(기기 AI)으로
    await finishRoundSolo(sv, a);
    expect(a.calls.sync).toBeGreaterThan(syncs);
    expect(sv.results.size).toBe(1);
    expect(a.state()?.public_state?.result).toBeTruthy();
    a.off();
  }, 30_000);

  /** 몇 수만 둔다 */
  async function finishDuoSome(sv: ReturnType<typeof server>, screens: ReturnType<typeof screen>[], count: number) {
    const rng = seededRng(8);
    for (let moves = 0, i = 0; moves < count && i < 2000 && sv.room.status === 'playing'; i++) {
      const sc = screens.find((x) => x.myTurn());
      if (!sc) {
        await sleep(2);
        continue;
      }
      await sc.host.settled();
      if (!sc.myTurn()) continue;
      if (sc.play.act(sc.pick(rng)) === true) moves++;
    }
    // 보낸 행동이 서버에 다 닿을 때까지
    await until(() => screens.every((x) => x.calls.act.every((r) => r.ok)), 3000);
  }
  /** 남은 한 사람이 끝까지 (서버가 대신 둔 것을 따라가는 동안은 기다린다) */
  async function finishRoundSolo(sv: ReturnType<typeof server>, sc: ReturnType<typeof screen>) {
    const rng = seededRng(6);
    for (let i = 0; i < 4000 && sv.room.status === 'playing'; i++) {
      if (!sc.myTurn() || sc.play.notice() !== null) {
        await sleep(2);
        continue;
      }
      await sc.host.settled();
      if (!sc.myTurn()) continue;
      if (sc.play.act(sc.pick(rng)) !== true) await sleep(5);
    }
    expect(sv.room.status).toBe('waiting');
  }
});
