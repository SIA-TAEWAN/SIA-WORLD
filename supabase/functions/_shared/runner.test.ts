import { describe, expect, it } from 'vitest';
import { seededRng } from './engine.ts';
import { ENGINES } from './engines.ts';
import { GameError, Runner, SOLO_DEADLINE_MS, type DeckRow, type GameId, type RoomRow, type SeatRow, type Store } from './runner.ts';
import { matgo, MATGO_RULES, type MatgoAction, type MatgoState } from './matgo.ts';
import { RULES_CHANGED, soloOf, soloStep } from './solo.ts';
import { payoutOf, type RBet } from './roulette.ts';

/** 메모리 DB (SQL 함수와 같은 규칙으로 흉내) */
function memStore(game: GameId, humans: string[], seatCount: number, balance = 100000) {
  const room: RoomRow = { id: 'r1', game, base_unit: 100, status: 'waiting', round_no: 0 };
  const seats: SeatRow[] = Array.from({ length: seatCount }, (_, i) => ({
    seat_no: i,
    user_id: humans[i] ?? null,
    nickname: humans[i] ?? `AI ${i}`,
    avatar: 'tiger',
    ready: true,
    left_game: false,
  }));
  const wallets: Record<string, number> = Object.fromEntries(humans.map((h) => [h, balance]));
  let deck: DeckRow = { version: 0, round_no: 0, state: null, carry: null };
  let pubVersion = 0;
  const published: { pub: any; pending: number[]; deadline: Date | null; privates: { seat: number; userId: string | null; hand: unknown }[] }[] = [];
  const results = new Map<number, Record<number, number>>();
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
      if (room.status !== 'waiting' || seats.some((s) => s.user_id && !s.left_game && !s.ready)) return null;
      room.status = 'playing';
      return ++room.round_no;
    },
    publish: async (_id, version, _r, pub, pending, deadline, privates) => {
      if (version <= pubVersion) return; // 옛 상태는 버린다 (publish_state와 같은 규칙)
      pubVersion = version;
      published.push({ pub: JSON.parse(JSON.stringify(pub)), pending, deadline, privates });
    },
    applyResult: async (_id, round, deltas) => {
      if (results.has(round)) return false;
      results.set(round, deltas);
      for (const s of seats) {
        if (!s.user_id) continue;
        const d = deltas[s.seat_no] ?? 0;
        wallets[s.user_id] += Math.max(d, -wallets[s.user_id]);
      }
      return true;
    },
    finishRound: async () => {
      for (const s of seats) if (s.left_game) Object.assign(s, { user_id: null, left_game: false });
      for (const s of seats) s.ready = s.user_id === null;
      room.status = 'waiting';
      return true;
    },
  };
  return { store, room, seats, wallets, published, results, get deck() { return deck; }, set deck(d: DeckRow) { deck = d; } };
}

/** 사람 차례면 엔진의 AI로 대신 두면서 판을 끝까지 */
async function playOut(m: ReturnType<typeof memStore>, runner: Runner, game: GameId, users: string[], seed: number) {
  const rng = seededRng(seed);
  for (let i = 0; i < 2000 && m.room.status === 'playing'; i++) {
    const last = m.published[m.published.length - 1];
    const seat = last.pending[0];
    const user = m.seats.find((s) => s.seat_no === seat)?.user_id;
    expect(user && users.includes(user)).toBe(true);
    const priv = last.privates.find((p) => p.seat === seat)?.hand;
    const action = ENGINES[game].ai(last.pub, priv, seat, rng);
    await runner.act('r1', user!, action);
  }
  expect(m.room.status).toBe('waiting');
}

describe('Runner', () => {
  for (const [game, seats] of [['matgo', 2], ['poker', 4], ['blackjack', 4]] as [GameId, number][]) {
    it(`${game}: 사람 1명 + AI로 여러 판 (정산·이어받기)`, async () => {
      const m = memStore(game, ['u1'], seats);
      const runner = new Runner(m.store, ENGINES, seededRng(7));
      for (let round = 1; round <= 5; round++) {
        m.seats[0].ready = true;
        const r = await runner.start('r1', 'u1');
        expect(r.started).toBe(true);
        if (m.room.status === 'playing') await playOut(m, runner, game, ['u1'], round * 13);
        expect(m.results.has(round)).toBe(true);
        // 마지막 공개 상태에 결과가 있고, 남의 비공개 패가 사람에게 가지 않는다
        const last = m.published[m.published.length - 1];
        expect(last.pub.result).toBeTruthy();
        expect(last.pending).toEqual([]);
        expect(m.wallets.u1).toBeGreaterThanOrEqual(0);
      }
      // 판마다 실제 정산 기록과 지갑이 맞는다
      const total = [...m.results.values()].reduce((a, d) => a + (d[0] ?? 0), 0);
      expect(m.wallets.u1).toBe(100000 + total);
    });
  }

  it('사람 차례면 마감 시각을 정하고, AI 차례는 바로 이어서 둔다', async () => {
    const m = memStore('matgo', ['u1'], 2);
    const runner = new Runner(m.store, ENGINES, seededRng(3), () => 1_000_000);
    await runner.start('r1', 'u1');
    const last = m.published[m.published.length - 1];
    expect(last.pending).toEqual([0]);
    // 혼자 하는 맞고는 기기에서 진행한다: 서버 마감은 버려진 판 정리용 30분
    expect(last.deadline?.getTime()).toBe(1_000_000 + SOLO_DEADLINE_MS);
    // 비공개 패: AI 자리(user null)에도 쓰지만 user_id가 없으니 아무도 못 읽는다
    expect(last.privates.find((p) => p.seat === 1)?.userId).toBeNull();
  });

  it('내 차례가 아니면 거절, 방에 없으면 거절', async () => {
    const m = memStore('blackjack', ['u1', 'u2'], 4);
    const runner = new Runner(m.store, ENGINES, seededRng(5));
    await runner.start('r1', 'u1');
    await expect(runner.act('r1', 'zz', { type: 'stand' })).rejects.toThrow('not in room');
    await runner.act('r1', 'u1', { type: 'bet', amount: 100 });
    await expect(runner.act('r1', 'u1', { type: 'bet', amount: 100 })).rejects.toThrow('not your turn');
  });

  it('행동이 객체가 아니면 400 으로 거절 (null 은 solo 걸음 규칙에서 AI 가 정한다는 뜻이라 화면이 보내면 안 된다)', async () => {
    const m = memStore('matgo', ['u1'], 2);
    const runner = new Runner(m.store, ENGINES, seededRng(3));
    await runner.start('r1', 'u1');
    const v = m.deck.version;
    for (const bad of [null, undefined, 0, 'play', [], [{ type: 'play' }]]) {
      await expect(runner.act('r1', 'u1', bad)).rejects.toMatchObject({ message: 'bad action', status: 400 });
    }
    expect(m.deck.version).toBe(v);
  });

  it('룰렛: 결과 지급이 실패해도 결과는 공개하고, 다음 스핀으로 넘어가기 전에 다시 지급한다', async () => {
    const m = memStore('roulette', ['u1'], 1);
    const paid: number[] = [];
    let fail = true;
    m.store.placeBet = async () => undefined;
    m.store.paySpin = async (_id, _r, spin) => {
      if (fail) throw new Error('network');
      paid.push(spin);
    };
    const runner = new Runner(m.store, ENGINES, seededRng(4), () => 1_000_000);
    await runner.start('r1', 'u1');
    const pubs = m.published.length;
    await runner.act('r1', 'u1', { type: 'bet', bets: [] });
    // 지급은 실패했지만 결과가 나온 상태는 공개됐다
    expect(m.published.length).toBe(pubs + 1);
    const last = m.published[m.published.length - 1];
    expect(last.pub.phase).toBe('spin');
    expect(last.pub.landed).not.toBeNull();
    expect(paid).toEqual([]);
    // 확인을 누르면 다음 스핀을 열기 전에 그 스핀을 다시 지급한다
    fail = false;
    await runner.act('r1', 'u1', { type: 'next' });
    expect(paid).toContain(last.pub.spin);
    expect(m.published[m.published.length - 1].pub.phase).toBe('bet');
  });

  it('시간 초과: 상태 버전이 바뀌었으면 건너뛰고, 아니면 자동 행동', async () => {
    const m = memStore('poker', ['u1'], 4);
    const runner = new Runner(m.store, ENGINES, seededRng(9));
    await runner.start('r1', 'u1');
    const v = m.deck.version;
    expect((await runner.timeout('r1', v - 1)).acted).toBe(false);
    expect((await runner.timeout('r1', v)).acted).toBe(true);
    expect(m.deck.version).toBe(v + 1);
  });

  it('게임 중 나간 사람 자리는 AI가 대신해 판을 끝내고, 결과는 그 사람 지갑에', async () => {
    const m = memStore('matgo', ['u1'], 2);
    const runner = new Runner(m.store, ENGINES, seededRng(11));
    await runner.start('r1', 'u1');
    m.seats[0].left_game = true; // leave_room이 하는 일
    await runner.timeout('r1');
    expect(m.room.status).toBe('waiting');
    expect(m.results.has(1)).toBe(true);
    expect(m.wallets.u1).toBe(100000 + (m.results.get(1)![0] ?? 0));
    expect(m.seats[0].user_id).toBeNull(); // 판이 끝나면 AI 자리
  });

  it('나간 자리만 처리(autoOnly)할 때 남은 사람은 자동 행동하지 않는다', async () => {
    const m = memStore('blackjack', ['u1', 'u2'], 4);
    const runner = new Runner(m.store, ENGINES, seededRng(31));
    await runner.start('r1', 'u1');
    m.seats[1].left_game = true; // u2가 베팅 단계에서 나감
    await runner.timeout('r1', m.deck.version, true);
    const pub = m.published[m.published.length - 1].pub;
    expect(pub.waitingBets).toEqual([0]); // u1은 그대로 고민 중
    expect(pub.seats.find((x: any) => x.seat === 1).out).toBe(true); // 나간 자리는 이번 판을 쉰다 (그 사람 칩을 걸지 않는다)
  });

  it('블랙잭: 판 시작 때 AI는 바로 베팅하고, 사람이 모두 베팅하면 마감을 기다리지 않고 바로 카드를 나눈다', async () => {
    const m = memStore('blackjack', ['u1', 'u2'], 4);
    const runner = new Runner(m.store, ENGINES, seededRng(61), () => 5_000_000);
    await runner.start('r1', 'u1');
    let last = m.published[m.published.length - 1];
    // 시작 상태: 베팅 단계, AI 두 자리는 이미 베팅 (화면은 '새 판 시작' 뒤에 하나씩 보여 준다), 사람만 남음
    expect(last.pub.phase).toBe('bet');
    expect(last.pending).toEqual([0, 1]);
    expect(last.pub.events.filter((e: any) => e.t === 'bet').map((e: any) => e.seat)).toEqual([2, 3]);
    expect(last.pub.seats.every((x: any) => x.hands.length === 0)).toBe(true);
    // 한 사람만 베팅: 아직 베팅 단계 (다른 사람을 기다린다)
    await runner.act('r1', 'u1', { type: 'bet', amount: 100 });
    last = m.published[m.published.length - 1];
    expect(last.pub.phase).toBe('bet');
    expect(last.pending).toEqual([1]);
    // 마지막 사람이 베팅하는 그 응답에서 바로 딜 (시간 초과 처리 없이)
    const before = m.published.length;
    await runner.act('r1', 'u2', { type: 'bet', amount: 200 });
    expect(m.published.length).toBe(before + 1);
    last = m.published[m.published.length - 1];
    expect(last.pub.phase).not.toBe('bet');
    expect(last.pub.waitingBets).toEqual([]);
    expect(last.pub.events.some((e: any) => e.t === 'deal')).toBe(true);
    expect(last.pub.dealer.cards.length).toBeGreaterThanOrEqual(2);
  });

  it('블랙잭: 쉬기를 고른 사람·나간 사람은 기다리지 않는다', async () => {
    const m = memStore('blackjack', ['u1', 'u2', 'u3'], 4);
    const runner = new Runner(m.store, ENGINES, seededRng(62));
    await runner.start('r1', 'u1');
    await runner.act('r1', 'u2', { type: 'sitout' });
    m.seats[2].left_game = true; // u3는 베팅 단계에서 나감 → 다음 행동 때 이번 판을 쉰다
    await runner.act('r1', 'u1', { type: 'bet', amount: 100 });
    const last = m.published[m.published.length - 1];
    expect(last.pub.phase).not.toBe('bet');
    expect(last.pub.seats.find((x: any) => x.seat === 1).out).toBe(true);
    expect(last.pub.seats.find((x: any) => x.seat === 2).out).toBe(true);
  });

  it('시작하다 멈춘 방(이번 판 상태 없음)은 정산 없이 대기로 되돌린다', async () => {
    const m = memStore('poker', ['u1'], 4);
    const runner = new Runner(m.store, ENGINES, seededRng(41));
    m.room.status = 'playing';
    m.room.round_no = 3; // begin_round 뒤 오류로 엔진 상태가 저장되지 않은 상황
    const r = await runner.timeout('r1');
    expect(r).toMatchObject({ recovered: true });
    expect(m.room.status).toBe('waiting');
    expect(m.results.size).toBe(0);
    await expect(runner.act('r1', 'u1', { type: 'check' })).rejects.toThrow('not playing');
  });

  it('정산 도중 멈춘 판은 다시 정산하지 않고 정리만 마친다', async () => {
    const m = memStore('matgo', ['u1'], 2);
    const runner = new Runner(m.store, ENGINES, seededRng(51));
    await runner.start('r1', 'u1');
    await playOut(m, runner, 'matgo', ['u1'], 5);
    const before = m.wallets.u1;
    // 판은 끝났는데 방이 playing으로 남은 상황을 흉내
    m.room.status = 'playing';
    await runner.timeout('r1');
    expect(m.room.status).toBe('waiting');
    expect(m.wallets.u1).toBe(before);
    expect(m.results.size).toBe(1);
  });

  it('동시에 두 행동이 오면 하나만 저장된다 (버전 충돌 시 다시 시도)', async () => {
    const m = memStore('blackjack', ['u1', 'u2'], 4);
    const runner = new Runner(m.store, ENGINES, seededRng(21));
    await runner.start('r1', 'u1');
    await Promise.all([runner.act('r1', 'u1', { type: 'bet', amount: 100 }), runner.act('r1', 'u2', { type: 'bet', amount: 200 })]);
    const pub = m.published[m.published.length - 1].pub;
    const bets = Object.fromEntries(pub.seats.map((s: any) => [s.seat, s.bet ?? s.hands?.[0]?.bet]));
    expect(bets[0]).toBe(100);
    expect(bets[1]).toBe(200);
  });
});

/**
 * 혼자 하는 맞고: 화면이 기기에서 진행하고 사람 행동 목록만 보낸다 (solo.ts).
 * '화면'은 여기서 서버와 같은 soloStep 으로 흉내 낸다: 사람 차례는 정해 둔 방식으로 고르고 기록, AI 차례는 soloStep(…, null).
 */
describe('Runner: 혼자 하는 맞고 (기기에서 진행 → replay)', () => {
  const ME = 0;
  /** 화면 쪽 진행: 사람 행동을 max개까지 두고(그 앞의 AI 차례 포함), 기록한 행동과 상태를 돌려준다. trailing: 마지막 사람 행동 뒤의 AI 차례도 둔다 */
  function playLocal(state: MatgoState, pick: (s: MatgoState) => MatgoAction, max = Infinity, trailing = true) {
    const actions: MatgoAction[] = [];
    let s = state;
    for (let i = 0; i < 500 && !matgo.done(s); i++) {
      const seat = matgo.pending(s)[0];
      if (seat !== ME) {
        if (actions.length >= max && !trailing) break;
        s = soloStep(matgo, s, seat, null);
        continue;
      }
      if (actions.length >= max) break;
      const a = pick(s);
      actions.push(a);
      s = soloStep(matgo, s, ME, a);
    }
    return { state: s, actions };
  }
  /** 사람 대신 고르기: 엔진의 AI 를 따로 정한 난수로 (서버가 모르는 선택) */
  const picker = (seed: number) => {
    const rng = seededRng(seed);
    return (s: MatgoState) => {
      const v = matgo.view(s);
      return matgo.ai(v.public, v.private[ME], ME, rng);
    };
  };
  const begin = async (seed: number, now?: () => number) => {
    const m = memStore('matgo', ['u1'], 2);
    const runner = new Runner(m.store, ENGINES, seededRng(seed), now);
    const r = (await runner.start('r1', 'u1')) as { started: boolean; round?: number; solo?: MatgoState };
    return { m, runner, r };
  };

  it('판 시작: 전체 상태를 응답으로 주고, 공개 상태에는 진행 수(soloN)만 싣는다 (씨앗·더미·AI 패는 안 나간다)', async () => {
    const { m, r } = await begin(3);
    expect(r.started).toBe(true);
    const solo = soloOf(r.solo);
    expect(solo).not.toBeNull();
    expect(r.solo).toEqual(m.deck.state);
    expect(matgo.pending(r.solo!)).toEqual([ME]); // AI가 선이면 서버가 먼저 둔 뒤의 상태
    const last = m.published[m.published.length - 1];
    expect(last.pub.soloN).toBe(solo!.n);
    expect(last.pub.solo).toBeUndefined();
    const sent = JSON.stringify([last.pub, last.privates.filter((p) => p.userId === 'u1')]);
    expect(sent).not.toContain(String(solo!.seed));
    for (const id of r.solo!.pile) expect(sent).not.toContain(`"${id}"`);
    for (const id of r.solo!.hands[1]) expect(sent).not.toContain(`"${id}"`);
  });

  it('다른 게임은 서버 진행 그대로 (solo 아님, 마감 20초)', async () => {
    const pk = memStore('poker', ['u1'], 4);
    const r3 = new Runner(pk.store, ENGINES, seededRng(5), () => 1_000_000);
    const started = (await r3.start('r1', 'u1')) as { solo?: unknown; duo?: unknown };
    expect(started.solo).toBeUndefined();
    expect(started.duo).toBeUndefined();
    expect(soloOf(pk.deck.state)).toBeNull();
    expect(pk.published[pk.published.length - 1].pub.soloN).toBeUndefined();
    expect(pk.published[pk.published.length - 1].deadline?.getTime()).toBe(1_000_000 + 20_000);
    await expect(r3.sync('r1', 'u1', { duo: true })).rejects.toThrow('not solo');
  });

  it('결정성: 화면이 기기에서 둔 결과와 서버가 행동 목록으로 다시 둔 결과(최종 상태·정산)가 같다', async () => {
    let finished = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const { m, runner, r } = await begin(seed * 101);
      if (!r.solo) continue; // 총통으로 바로 끝난 판
      const before = m.published.length;
      const local = playLocal(r.solo, picker(seed * 7 + 1));
      expect(matgo.done(local.state)).toBe(true);
      const res = await runner.replay('r1', 'u1', { rules: MATGO_RULES, n: soloOf(r.solo)!.n, actions: JSON.parse(JSON.stringify(local.actions)) });
      expect(res).toEqual({ ok: true, n: soloOf(local.state)!.n, done: true });
      // 최종 상태가 한 글자도 다르지 않다
      expect(m.deck.state).toEqual(JSON.parse(JSON.stringify(local.state)));
      // 정산도 같다
      const settle = matgo.settle(local.state);
      expect(m.results.get(1)).toEqual(settle.deltas);
      expect(m.wallets.u1).toBe(100000 + settle.deltas[ME]);
      expect(m.room.status).toBe('waiting');
      // 공개는 한 번 (결과 포함), 사건 번호는 화면이 본 것과 같다 → 화면이 연출을 두 번 하지 않는다
      expect(m.published.length).toBe(before + 1);
      const last = m.published[m.published.length - 1];
      expect(last.pub.result).toEqual(JSON.parse(JSON.stringify(settle.summary)));
      expect(last.pub.events).toEqual(JSON.parse(JSON.stringify(matgo.view(local.state).public.events)));
      expect(last.pending).toEqual([]);
      finished++;
    }
    expect(finished).toBeGreaterThan(20);
  });

  it('행동 하나씩 서버에 보내며 두는 것(act)과도 결과가 같다', async () => {
    const a = await begin(77);
    const b = await begin(77);
    expect(a.r.solo).toEqual(b.r.solo);
    const local = playLocal(a.r.solo!, picker(5));
    await a.runner.replay('r1', 'u1', { rules: MATGO_RULES, n: soloOf(a.r.solo)!.n, actions: local.actions });
    for (const act of local.actions) await b.runner.act('r1', 'u1', act);
    expect(b.m.deck.state).toEqual(a.m.deck.state);
    expect(b.m.results.get(1)).toEqual(a.m.results.get(1));
  });

  it('서버 진행 수와 안 맞으면 out of sync (상태는 그대로)', async () => {
    const { m, runner, r } = await begin(9);
    const n = soloOf(r.solo)!.n;
    const local = playLocal(r.solo!, picker(2), 2);
    const v = m.deck.version;
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n: n + 1, actions: local.actions })).rejects.toMatchObject({ message: 'out of sync', status: 409 });
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n: n - 1, actions: local.actions })).rejects.toMatchObject({ message: 'out of sync', status: 409 });
    expect(m.deck.version).toBe(v);
    // 잘못된 모양
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n, actions: 'x' })).rejects.toThrow('bad replay');
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n, actions: [null] })).rejects.toThrow('bad replay');
    await expect(runner.replay('r1', 'u1', { actions: [] })).rejects.toThrow('bad replay');
    await expect(runner.replay('r1', 'u1', null)).rejects.toThrow('bad replay');
    expect(m.deck.version).toBe(v);
  });

  it('남의 방: 그 방에 앉은 사람이 아니면 상태도 못 받고 행동도 못 넣는다', async () => {
    const { m, runner, r } = await begin(10);
    const n = soloOf(r.solo)!.n;
    await expect(runner.sync('r1', 'zz')).rejects.toMatchObject({ message: 'not in room', status: 403 });
    await expect(runner.replay('r1', 'zz', { rules: MATGO_RULES, n, actions: [] })).rejects.toMatchObject({ message: 'not in room', status: 403 });
    // 판 도중 나간 사람도 마찬가지
    m.seats[0].left_game = true;
    await expect(runner.sync('r1', 'u1')).rejects.toThrow('not in room');
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n, actions: [] })).rejects.toThrow('not in room');
  });

  it('AI 행동은 넣을 수 없다: AI 차례는 서버가 직접 두고, 목록의 행동은 모두 사람 차례에만 적용한다', async () => {
    const { m, runner, r } = await begin(12);
    const n = soloOf(r.solo)!.n;
    const one = playLocal(r.solo!, picker(3), 1, false); // 사람 행동 하나만 (그 뒤 AI 차례는 아직)
    expect(matgo.done(one.state)).toBe(false);
    const v = m.deck.version;
    // 사람 행동 뒤에 'AI가 이렇게 뒀다'고 AI 손패의 패를 내는 행동을 끼워 넣는다
    const aiSeat = one.state.seats.find((x) => x !== ME)!;
    const aiHand = matgo.view(one.state).private[aiSeat].hand;
    const forged: MatgoAction = { type: 'play', card: aiHand[aiHand.length - 1] };
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n, actions: [...one.actions, forged] })).rejects.toMatchObject({ status: 400 });
    expect(m.deck.version).toBe(v); // 아무것도 저장되지 않았다
    // 사람 행동만 보내면 AI 차례는 서버가 정한 대로 (화면의 soloStep(…, null) 과 같은 수)
    const withAi = playLocal(r.solo!, picker(3), 1, true);
    const res = await runner.replay('r1', 'u1', { rules: MATGO_RULES, n, actions: one.actions });
    expect(res.n).toBe(soloOf(withAi.state)!.n);
    expect(m.deck.state).toEqual(JSON.parse(JSON.stringify(withAi.state)));
    // 판이 끝난 뒤에 남은 행동이 있어도 거절 (방은 이미 대기)
    const full = playLocal(withAi.state, picker(4));
    await runner.replay('r1', 'u1', { rules: MATGO_RULES, n: res.n, actions: full.actions });
    expect(m.room.status).toBe('waiting');
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n: soloOf(full.state)!.n, actions: [{ type: 'stop' }] })).rejects.toMatchObject({ message: 'not playing', status: 409 });
    expect(m.results.size).toBe(1);
  });

  it('판이 끝났는데 행동이 더 남아 있으면 거절하고 정산하지 않는다', async () => {
    const { m, runner, r } = await begin(14);
    const local = playLocal(r.solo!, picker(6));
    const v = m.deck.version;
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n: soloOf(r.solo)!.n, actions: [...local.actions, { type: 'go' }] })).rejects.toMatchObject({ message: 'not your turn', status: 400 });
    expect(m.deck.version).toBe(v);
    expect(m.results.size).toBe(0);
    expect(m.room.status).toBe('playing');
  });

  it('부분 저장 뒤 이어서: 중간까지 보내 두고(공개·30분 마감), 나머지를 보내면 한 번에 보낸 것과 같다', async () => {
    const { m, runner, r } = await begin(21, () => 2_000_000);
    const n0 = soloOf(r.solo)!.n;
    const all = playLocal(r.solo!, picker(8));
    expect(all.actions.length).toBeGreaterThan(3);
    const k = 3;
    const part = playLocal(r.solo!, picker(8), k, true);
    expect(part.actions).toEqual(all.actions.slice(0, k));
    const res = await runner.replay('r1', 'u1', { rules: MATGO_RULES, n: n0, actions: all.actions.slice(0, k) });
    expect(res).toEqual({ ok: true, n: soloOf(part.state)!.n, done: false });
    expect(m.deck.state).toEqual(JSON.parse(JSON.stringify(part.state)));
    expect(m.room.status).toBe('playing');
    let last = m.published[m.published.length - 1];
    expect(last.pub.soloN).toBe(res.n);
    expect(last.pub.result).toBeNull();
    expect(last.pending).toEqual([ME]);
    expect(last.deadline?.getTime()).toBe(2_000_000 + SOLO_DEADLINE_MS);
    // 새로고침한 화면: sync 로 받은 상태에서 이어 간다
    const synced = await runner.sync('r1', 'u1');
    expect(synced.state).toEqual(m.deck.state);
    expect(synced.version).toBe(m.deck.version);
    expect(synced.round).toBe(1);
    // 같은 목록을 한 번 더 보내면 (응답을 못 받은 화면) 진행 수가 달라 거절 → 화면은 sync 로 맞춘다
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n: n0, actions: all.actions.slice(0, k) })).rejects.toThrow('out of sync');
    const rest = await runner.replay('r1', 'u1', { rules: MATGO_RULES, n: res.n, actions: all.actions.slice(k) });
    expect(rest.done).toBe(true);
    expect(m.deck.state).toEqual(JSON.parse(JSON.stringify(all.state)));
    expect(m.results.get(1)).toEqual(matgo.settle(all.state).deltas);
    last = m.published[m.published.length - 1];
    expect(last.pub.result).toBeTruthy();
  });

  it('빈 목록도 받는다 (나가기 직전 저장: 달라질 것이 없다)', async () => {
    const { m, runner, r } = await begin(23);
    const res = await runner.replay('r1', 'u1', { rules: MATGO_RULES, n: soloOf(r.solo)!.n, actions: [] });
    expect(res).toEqual({ ok: true, n: soloOf(r.solo)!.n, done: false });
    expect(m.deck.state).toEqual(r.solo);
  });

  it('나가면 서버 AI가 저장된 데서 이어 두어 정산한다', async () => {
    const { m, runner, r } = await begin(31);
    const part = playLocal(r.solo!, picker(9), 2, true);
    await runner.replay('r1', 'u1', { rules: MATGO_RULES, n: soloOf(r.solo)!.n, actions: part.actions });
    m.seats[0].left_game = true; // leave_room
    await runner.timeout('r1', m.deck.version, true);
    expect(m.room.status).toBe('waiting');
    expect(m.results.has(1)).toBe(true);
    expect(m.wallets.u1).toBe(100000 + (m.results.get(1)![0] ?? 0));
    // 사람이 둔 두 수까지는 그대로다 (사건 기록의 앞부분이 같다)
    const kept = matgo.view(part.state).public.events;
    const final = (m.deck.state as MatgoState).events;
    for (const e of kept) if (final.some((x) => x.id === e.id)) expect(final.find((x) => x.id === e.id)).toEqual(e);
  });

  it('30분 마감이 지나면(버려진 판) 서버가 남은 판을 대신 두어 끝낸다. 그 뒤 화면의 목록은 받지 않는다', async () => {
    const { m, runner, r } = await begin(41);
    const local = playLocal(r.solo!, picker(1), 2, false);
    const out = await runner.timeout('r1', m.deck.version);
    expect(out.acted).toBe(true);
    expect(m.room.status).toBe('waiting');
    expect(m.results.has(1)).toBe(true);
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n: soloOf(r.solo)!.n, actions: local.actions })).rejects.toMatchObject({ status: 409 });
    expect(m.results.size).toBe(1);
  });
});

/**
 * 사람 둘이 하는 맞고: 화면이 자기 행동을 기기에서 먼저 적용해 보여 주고, 서버에는 하나씩 (진행 수 n 과 함께) 보낸다.
 * 서버는 계속 심판이다: 차례·규칙·진행 수를 확인하고, 같은 걸음 규칙(soloStep)으로 적용한다.
 */
describe('Runner: 사람 둘이 하는 맞고 (기기에서 먼저 진행 → act + n)', () => {
  const begin = async (seed: number, now: () => number = () => 1_000_000) => {
    const m = memStore('matgo', ['u1', 'u2'], 2);
    const runner = new Runner(m.store, ENGINES, seededRng(seed), now);
    const r = (await runner.start('r1', 'u1')) as { started: boolean; round?: number; solo?: MatgoState; duo?: MatgoState };
    return { m, runner, r };
  };
  const userOf = (seat: number) => (seat === 0 ? 'u1' : 'u2');
  /** 그 자리에서 보이는 정보만으로 고른 행동 */
  const pick = (s: MatgoState, seat: number, rng = seededRng(9)) => {
    const v = matgo.view(s);
    return matgo.ai(v.public, v.private[seat], seat, rng);
  };

  it('판 시작: 상태에 씨앗·진행 수를 싣고 전체 상태를 duo 칸으로 준다 (solo 칸이 아니다). 마감은 차례 시간 20초 그대로', async () => {
    const { m, r } = await begin(4);
    expect(r.solo).toBeUndefined(); // 예전 화면이 혼자 하는 판으로 잘못 알지 않게
    expect(soloOf(r.duo)).not.toBeNull();
    expect(r.duo).toEqual(m.deck.state);
    const last = m.published[m.published.length - 1];
    expect(last.pub.soloN).toBe(soloOf(r.duo)!.n);
    expect(last.pub.solo).toBeUndefined();
    expect(last.deadline?.getTime()).toBe(1_000_000 + 20_000);
    // 공개 상태에는 씨앗·더미·남의 패가 나가지 않는다
    const sent = JSON.stringify(last.pub);
    expect(sent).not.toContain(String(soloOf(r.duo)!.seed));
    for (const id of r.duo!.pile) expect(sent).not.toContain(`"${id}"`);
  });

  it('sync: 그 판에 앉아 있는 두 사람 모두 받는다 (duo 표시로 불렀을 때만). 예전 화면처럼 부르면·앉아 있지 않으면·목록으로 한꺼번에 내면 거절', async () => {
    const { m, runner } = await begin(4);
    for (const u of ['u1', 'u2']) {
      const got = await runner.sync('r1', u, { duo: true });
      expect(got.duo).toBe(true);
      expect(got.state).toEqual(m.deck.state);
    }
    await expect(runner.sync('r1', 'u1')).rejects.toThrow('not solo');
    await expect(runner.sync('r1', 'u9', { duo: true })).rejects.toMatchObject({ status: 403 });
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n: 0, actions: [] })).rejects.toThrow('not solo');
    // 혼자 하는 판은 표시가 있든 없든 받고, duo 가 아니라고 알려 준다
    const one = memStore('matgo', ['u1'], 2);
    const r1 = new Runner(one.store, ENGINES, seededRng(4));
    await r1.start('r1', 'u1');
    expect((await r1.sync('r1', 'u1', { duo: true })).duo).toBe(false);
    expect((await r1.sync('r1', 'u1')).duo).toBe(false);
  });

  it('act + n: 진행 수가 맞으면 받고 새 진행 수를 돌려준다. 다르면 409 out of sync (같은 행동 두 번 · 순서 뒤바뀜), 상태는 그대로', async () => {
    const { m, runner, r } = await begin(21);
    let s = r.duo!;
    const seat = matgo.pending(s)[0];
    const a = pick(s, seat);
    const n0 = soloOf(s)!.n;
    // 앞선 진행 수 · 지난 진행 수는 거절
    await expect(runner.act('r1', userOf(seat), { ...a, rules: MATGO_RULES }, n0 + 1)).rejects.toMatchObject({ message: 'out of sync', status: 409 });
    await expect(runner.act('r1', userOf(seat), { ...a, rules: MATGO_RULES }, n0 - 1)).rejects.toMatchObject({ message: 'out of sync', status: 409 });
    expect(m.deck.state).toEqual(s);
    // 내 차례가 아닌 사람은 진행 수가 맞아도 거절
    await expect(runner.act('r1', userOf(1 - seat), { ...a, rules: MATGO_RULES }, n0)).rejects.toMatchObject({ message: 'not your turn', status: 409 });
    expect(await runner.act('r1', userOf(seat), { ...a, rules: MATGO_RULES }, n0)).toEqual({ ok: true, n: n0 + 1 });
    s = m.deck.state as MatgoState;
    expect(soloOf(s)!.n).toBe(n0 + 1);
    // 같은 행동이 한 번 더 오면 (응답을 못 받아 다시 보냈다) 거절: 두 번 적용되지 않는다
    await expect(runner.act('r1', userOf(seat), { ...a, rules: MATGO_RULES }, n0)).rejects.toMatchObject({ message: 'out of sync', status: 409 });
    expect(m.deck.state).toEqual(s);
    // 규칙 위반은 진행 수가 맞아도 거절
    const next = matgo.pending(s)[0];
    await expect(runner.act('r1', userOf(next), { type: 'play', card: 'm99-x', rules: MATGO_RULES }, n0 + 1)).rejects.toBeInstanceOf(GameError);
    expect(m.deck.state).toEqual(s);
  });

  it('예전 화면 호환: n 없이 보낸 행동은 예전처럼 지금 상태에 적용한다 (같은 걸음 규칙)', async () => {
    const { m, runner, r } = await begin(22);
    const s = r.duo!;
    const seat = matgo.pending(s)[0];
    const a = pick(s, seat);
    expect(await runner.act('r1', userOf(seat), a)).toEqual({ ok: true, n: soloOf(s)!.n + 1 });
    expect(m.deck.state).toEqual(JSON.parse(JSON.stringify(soloStep(matgo, s, seat, a))));
  });

  it('결정성: 두 화면이 받은 상태에서 같은 행동을 soloStep 으로 적용하면 걸음마다 서버 상태와 완전히 같다 (한 판 끝까지, 정산까지)', async () => {
    let finished = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { m, runner, r } = await begin(seed * 77);
      if (!r.duo) continue; // 총통으로 바로 끝난 판
      // 화면 A(시작 응답) · 화면 B(sync) 가 각자 들고 있는 상태
      let a = r.duo;
      let b = (await runner.sync('r1', 'u2', { duo: true })).state as MatgoState;
      expect(b).toEqual(a);
      const rng = seededRng(seed);
      for (let i = 0; i < 400 && !matgo.done(a); i++) {
        const seat = matgo.pending(a)[0];
        const act = pick(a, seat, rng);
        const n = soloOf(a)!.n;
        a = soloStep(matgo, a, seat, act);
        b = soloStep(matgo, b, seat, act);
        await runner.act('r1', userOf(seat), { ...act, rules: MATGO_RULES }, n);
        expect(JSON.parse(JSON.stringify(a))).toEqual(m.deck.state);
        expect(b).toEqual(a);
        // 서버가 공개한 상태 = 화면이 만든 공개 상태 + 서버가 덧붙인 칸
        const pub = m.published[m.published.length - 1].pub;
        expect(pub.soloN).toBe(n + 1);
        const mine = JSON.parse(JSON.stringify(matgo.view(a).public));
        for (const k of Object.keys(mine)) if (k !== 'result') expect(pub[k]).toEqual(mine[k]);
      }
      expect(matgo.done(a)).toBe(true);
      expect(m.room.status).toBe('waiting');
      expect(m.results.get(1)).toEqual(matgo.settle(a).deltas);
      finished++;
    }
    expect(finished).toBeGreaterThanOrEqual(10);
  });

  it('시간 초과: 차례를 넘긴 사람의 이번 차례만 서버가 대신 둔다 (판을 끝까지 두지 않는다). 진행 수가 늘어 그 사람의 늦은 행동은 거절된다', async () => {
    const { m, runner, r } = await begin(31);
    const s = r.duo!;
    const seat = matgo.pending(s)[0];
    const n0 = soloOf(s)!.n;
    const late = pick(s, seat);
    expect((await runner.timeout('r1', m.deck.version)).acted).toBe(true);
    const after = m.deck.state as MatgoState;
    expect(matgo.done(after)).toBe(false);
    // 고르기·고/스톱처럼 같은 사람이 이어 정할 수도 있으니 '적어도 한 걸음' 으로 본다 (끝까지 두지는 않는다)
    expect(soloOf(after)!.n).toBe(n0 + 1);
    expect(m.room.status).toBe('playing');
    await expect(runner.act('r1', userOf(seat), { ...late, rules: MATGO_RULES }, n0)).rejects.toMatchObject({ message: 'out of sync', status: 409 });
  });

  it('상대가 나가면: 그 자리는 서버 AI 가 같은 걸음 규칙으로 이어 두고, 남은 사람은 sync 로 따라간다 (혼자 하는 판이 된다)', async () => {
    const { m, runner, r } = await begin(41);
    let s = r.duo!;
    // 둘째 자리(u2)가 나갔다
    m.seats[1].left_game = true;
    // 남은 사람 차례가 될 때까지 서버가 나간 자리를 대신 둔다 (autoOnly)
    await runner.timeout('r1', m.deck.version, true);
    s = m.deck.state as MatgoState;
    expect(matgo.done(s) || matgo.pending(s).includes(0)).toBe(true);
    if (!matgo.done(s)) {
      const got = await runner.sync('r1', 'u1', { duo: true });
      expect(got.duo).toBe(false);
      // 판은 그대로이고, 혼자 하는 판으로 바뀌었다 (duo 표시만 떨어진다)
      expect(got.state).toEqual({ ...s, solo: { seed: soloOf(s)!.seed, n: soloOf(s)!.n, rules: MATGO_RULES } });
      expect(got.state).toEqual(m.deck.state);
      s = got.state as MatgoState;
      // 이제 혼자 하는 판과 같다: 내 행동 뒤에 서버가 AI 차례를 이어 둔다
      const n = soloOf(s)!.n;
      await runner.act('r1', 'u1', { ...pick(s, 0), rules: MATGO_RULES }, n);
      const next = m.deck.state as MatgoState;
      expect(matgo.done(next) || matgo.pending(next).includes(0)).toBe(true);
      expect(soloOf(next)!.n).toBeGreaterThan(n);
    }
  });

  /** u1(자리 0) 차례가 될 때까지 u2 가 둔다 → 그때의 상태 */
  const toSeat0 = async (m: ReturnType<typeof memStore>, runner: Runner, s0: MatgoState) => {
    let s = s0;
    for (let i = 0; i < 20 && !matgo.pending(s).includes(0); i++) {
      await runner.act('r1', 'u2', { ...pick(s, 1, seededRng(40 + i)), rules: MATGO_RULES }, soloOf(s)!.n);
      s = m.deck.state as MatgoState;
    }
    expect(matgo.done(s)).toBe(false);
    expect(matgo.pending(s)).toEqual([0]);
    return s;
  };
  const deadlineOf = (m: ReturnType<typeof memStore>) => m.published[m.published.length - 1].deadline?.getTime() ?? null;
  const cardsLeft = (s: MatgoState, seat: number) => matgo.view(s).public.players[seat].handCount;

  it('상대가 내 차례에 나간 뒤 20초를 넘기면: 내 이번 차례만 대신 둔다 (판은 계속된다. 판 전체를 끝내지 않는다)', async () => {
    let now = 1_000_000;
    const { m, runner, r } = await begin(51, () => now);
    const s = await toSeat0(m, runner, r.duo!);
    // 내 차례의 마감은 차례 시간 20초. 이때 상대(u2)가 나간다 (나간 자리 차례가 아니라서 서버는 아무것도 하지 않는다 → 마감도 그대로)
    expect(deadlineOf(m)).toBe(now + 20_000);
    m.seats[1].left_game = true;
    const n0 = soloOf(s)!.n;
    const hand0 = cardsLeft(s, 0);
    // 20초를 넘겼다 → 시간 초과 처리
    now += 20_500;
    expect((await runner.timeout('r1', m.deck.version)).acted).toBe(true);
    const after = m.deck.state as MatgoState;
    // 판은 끝나지 않았고 정산도 없다. 내 차례는 한 번만 넘어갔고 (낸 패는 많아야 한 장), 나간 자리는 AI 가 이어 둔 뒤 다시 내 차례에서 멈췄다
    expect(m.room.status).toBe('playing');
    expect(matgo.done(after)).toBe(false);
    expect(m.results.size).toBe(0);
    expect(soloOf(after)!.n).toBeGreaterThan(n0);
    expect(hand0 - cardsLeft(after, 0)).toBeLessThanOrEqual(1);
    expect(matgo.pending(after)).toEqual([0]);
    // 남은 화면이 아직 sync 하지 않아(duo 표시 그대로) 다음 차례 마감도 20초 (30분이면 방이 몇 시간씩 'playing' 으로 남는다)
    expect(soloOf(after)!.duo).toBe(true);
    expect(deadlineOf(m)).toBe(now + 20_000);
    expect(matgo.view(after).public.events.filter((e) => e.id > Math.max(0, ...matgo.view(s).public.events.map((x) => x.id)) && e.seat === 0 && (e.t === 'play' || e.t === 'bomb')).length).toBeLessThanOrEqual(1);
    // 남은 사람은 이어서 둘 수 있다
    await runner.act('r1', 'u1', { ...pick(after, 0), rules: MATGO_RULES }, soloOf(after)!.n);
    expect(soloOf(m.deck.state)!.n).toBeGreaterThan(soloOf(after)!.n);
    // sync 전이면 남은 사람이 직접 둔 뒤의 마감도 20초 그대로
    if (!matgo.done(m.deck.state as MatgoState)) expect(deadlineOf(m)).toBe(now + 20_000);
  });

  it('상대가 나간 뒤 남은 사람이 sync 하면 혼자 하는 판이 된다: 마감이 20초에서 30분으로 바뀌어 화면의 (기기) 차례 시간과 어긋나지 않는다', async () => {
    let now = 1_000_000;
    const { m, runner, r } = await begin(52, () => now);
    const s = await toSeat0(m, runner, r.duo!);
    expect(deadlineOf(m)).toBe(now + 20_000);
    m.seats[1].left_game = true;
    // 화면이 자리 변화를 보고 5초 뒤 sync 했다
    now += 5_000;
    const got = await runner.sync('r1', 'u1', { duo: true });
    expect(got.duo).toBe(false);
    expect(soloOf(got.state)).toEqual({ seed: soloOf(s)!.seed, n: soloOf(s)!.n, rules: MATGO_RULES });
    expect(got.version).toBe(m.deck.version);
    expect(deadlineOf(m)).toBe(now + SOLO_DEADLINE_MS);
    // 공개 상태의 진행 수는 그대로 (판은 한 걸음도 나아가지 않았다)
    expect(m.published[m.published.length - 1].pub.soloN).toBe(soloOf(s)!.n);
    // 다시 불러도 더 바뀌지 않는다 (저장 · 공개를 되풀이하지 않는다)
    const v = m.deck.version;
    const pubs = m.published.length;
    expect((await runner.sync('r1', 'u1', { duo: true })).version).toBe(v);
    expect(m.published.length).toBe(pubs);
    // 이제 혼자 하는 판: 행동 목록(replay)도 받는다
    const res = await runner.replay('r1', 'u1', { rules: MATGO_RULES, n: soloOf(s)!.n, actions: [pick(got.state as MatgoState, 0)] });
    expect(res.ok).toBe(true);
    // 30분 마감이 지나면 버려진 판이다 → 서버가 남은 판을 대신 두어 끝낸다 (혼자 하는 판과 같다)
    if (m.room.status === 'playing') {
      now += SOLO_DEADLINE_MS + 1000;
      await runner.timeout('r1', m.deck.version);
      expect(m.room.status).toBe('waiting');
      expect(m.results.size).toBe(1);
    }
  });

  it('상대가 나간 자리 차례에 sync 하면: 나간 자리는 AI 가 이어 둔 상태를 준다 (저장이 겹치면 다시 읽는다)', async () => {
    const { m, runner, r } = await begin(53);
    let s = r.duo!;
    // u2(자리 1) 차례가 될 때까지
    for (let i = 0; i < 20 && !matgo.pending(s).includes(1); i++) {
      await runner.act('r1', 'u1', { ...pick(s, 0, seededRng(60 + i)), rules: MATGO_RULES }, soloOf(s)!.n);
      s = m.deck.state as MatgoState;
    }
    expect(matgo.pending(s)).toEqual([1]);
    m.seats[1].left_game = true;
    // 첫 저장은 버전 충돌로 실패하게 한다
    const save0 = m.store.saveDeck;
    let failed = false;
    m.store.saveDeck = async (...a) => {
      if (!failed) {
        failed = true;
        return false;
      }
      return save0(...a);
    };
    const got = await runner.sync('r1', 'u1', { duo: true });
    expect(failed).toBe(true);
    expect(got.duo).toBe(false);
    expect(got.state).toEqual(m.deck.state);
    const st = got.state as MatgoState;
    expect(soloOf(st)!.duo).toBeUndefined();
    expect(soloOf(st)!.n).toBeGreaterThan(soloOf(s)!.n);
    expect(matgo.done(st) || matgo.pending(st).includes(0)).toBe(true);
  });
});

describe('Runner: 판 도중 나간 사람 자리 (포커·홀덤은 체크 아니면 다이/폴드만)', () => {
  /** 상태 JSON 안의 카드 id 두 개씩을 맞바꾼다 (중복 없이 원하는 카드를 쥐여 주기) */
  const swapCards = (state: unknown, pairs: [string, string][]) => {
    let j = JSON.stringify(state);
    for (const [a, b] of pairs) {
      if (a === b) continue;
      j = j.split(`"${a}"`).join('"@@"').split(`"${b}"`).join(`"${a}"`).split('"@@"').join(`"${b}"`);
    }
    return JSON.parse(j);
  };
  for (const game of ['holdem', 'poker'] as const) {
    it(`${game}: 센 패를 쥔 채 나간 자리도 레이즈·콜 없이 체크 아니면 ${game === 'poker' ? '다이' : '폴드'}, 잃는 돈은 이미 낸 것까지`, async () => {
      let actedLeft = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const m = memStore(game, ['u1', 'u2'], 4);
        const left: { type: string }[] = [];
        const base = ENGINES[game];
        const spy = { ...base, apply: (s: unknown, seat: number, a: { type: string }, rng: never) => (seat === 1 && left.push(a), base.apply(s, seat, a, rng)) };
        const runner = new Runner(m.store, { ...ENGINES, [game]: spy }, seededRng(seed));
        await runner.start('r1', 'u1');
        // u2 가 나갔다 (leave_room). 그 자리에는 에이스를 쥐여 준다 (AI 라면 크게 걸 패)
        m.seats[1].left_game = true;
        const st = m.deck.state as { players: { seat: number; hole?: string[]; choices?: string[]; total: number }[] };
        const me = st.players.find((p) => p.seat === 1)!;
        const mine = (game === 'holdem' ? me.hole : me.choices) ?? [];
        const aces = ['AS', 'AH', 'AD', 'AC'].slice(0, mine.length);
        m.deck = { ...m.deck, state: swapCards(st, aces.map((a, i) => [a, mine[i]] as [string, string])) };
        const paid = me.total;
        await runner.timeout('r1', m.deck.version, true);
        const rng = seededRng(seed * 31);
        for (let i = 0; i < 500 && m.room.status === 'playing'; i++) {
          const last = m.published[m.published.length - 1];
          if (!last.pending.includes(0)) {
            await runner.timeout('r1');
            continue;
          }
          const priv = last.privates.find((p) => p.seat === 0)?.hand;
          await runner.act('r1', 'u1', ENGINES[game].ai(last.pub, priv, 0, rng));
        }
        expect(m.room.status).toBe('waiting');
        const betting = left.filter((a) => a.type !== 'choose');
        actedLeft += betting.length;
        for (const a of betting) expect(['check', game === 'poker' ? 'die' : 'fold']).toContain(a.type);
        // 나간 자리의 손실은 나가기 전에 이미 낸 돈(앤티·블라인드)을 넘지 않는다 (체크로 이기면 딸 수는 있다)
        expect(m.results.get(1)![1] ?? 0).toBeGreaterThanOrEqual(-paid);
      }
      // 나간 자리가 실제로 차례를 받아 뒀다 (검사가 비어 있지 않다)
      expect(actedLeft).toBeGreaterThan(0);
    });
  }

  it('블랙잭: 베팅 단계에 나간 자리는 이번 판을 쉰다 (AI 가 그 사람 칩으로 걸지 않는다)', async () => {
    for (const seed of [31, 32, 33, 34]) {
      const m = memStore('blackjack', ['u1', 'u2'], 4);
      const runner = new Runner(m.store, ENGINES, seededRng(seed));
      await runner.start('r1', 'u1');
      m.seats[1].left_game = true;
      await runner.timeout('r1', m.deck.version, true);
      const pub = m.published[m.published.length - 1].pub;
      const left = pub.seats.find((x: any) => x.seat === 1);
      expect(left.out).toBe(true);
      expect(left.bet ?? null).toBeNull();
    }
  });

  it('블랙잭: 나간 자리의 행동은 쉬기(베팅 단계) 아니면 스탠드뿐이다', () => {
    const bet = { phase: 'bet' } as any;
    const play = { phase: 'play' } as any;
    expect(ENGINES.blackjack.leftAction!(bet, 1)).toEqual({ type: 'sitout' });
    expect(ENGINES.blackjack.leftAction!(play, 1)).toEqual({ type: 'stand' });
  });
});

describe('Runner: 맞고 규칙 판 (MATGO_RULES)', () => {
  const bumped = { ...ENGINES, matgo: { ...matgo, rulesVersion: MATGO_RULES + 1 } };
  const start = async (engines = ENGINES, humans = ['u1']) => {
    const m = memStore('matgo', humans, 2);
    const runner = new Runner(m.store, engines, seededRng(5));
    const r = (await runner.start('r1', 'u1')) as { solo?: MatgoState; duo?: MatgoState };
    return { m, runner, r };
  };

  it('판 시작: 상태의 solo 에 규칙 판을 싣고, sync 도 지금 서버의 규칙 판을 준다', async () => {
    const { m, runner, r } = await start();
    expect(soloOf(r.solo)!.rules).toBe(MATGO_RULES);
    expect(soloOf(m.deck.state)!.rules).toBe(MATGO_RULES);
    expect(soloOf((await runner.sync('r1', 'u1')).state)!.rules).toBe(MATGO_RULES);
    // 걸음을 둬도 규칙 판은 남는다
    const seat = matgo.pending(r.solo!)[0];
    expect(soloOf(soloStep(matgo, r.solo!, seat, null))!.rules).toBe(MATGO_RULES);
    // 판 도중 서버가 새 규칙으로 바뀌었으면 sync 는 새 판을 알려 준다 (저장된 상태는 그대로)
    const later = new Runner(m.store, bumped, seededRng(1));
    expect(soloOf((await later.sync('r1', 'u1')).state)!.rules).toBe(MATGO_RULES + 1);
    expect(soloOf(m.deck.state)!.rules).toBe(MATGO_RULES);
  });

  it('replay: 판이 다르면 409 RULES_CHANGED, 같거나 안 실었으면(예전 화면 = 1판) 받는다', async () => {
    const { m, runner, r } = await start();
    const n = soloOf(r.solo)!.n;
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n, actions: [], rules: MATGO_RULES + 1 })).rejects.toMatchObject({ message: RULES_CHANGED, status: 409 });
    await expect(runner.replay('r1', 'u1', { rules: MATGO_RULES, n, actions: [], rules: 'x' })).rejects.toMatchObject({ status: 409 });
    expect(await runner.replay('r1', 'u1', { rules: MATGO_RULES, n, actions: [], rules: MATGO_RULES })).toMatchObject({ ok: true });
    expect(await runner.replay('r1', 'u1', { rules: MATGO_RULES, n, actions: [] })).toMatchObject({ ok: true });
    // 새 규칙(2판) 서버: 판을 안 실은 예전 화면은 1판으로 보고 거절한다
    const later = new Runner(m.store, bumped, seededRng(1));
    await expect(later.replay('r1', 'u1', { n, actions: [] })).rejects.toMatchObject({ message: RULES_CHANGED, status: 409 });
    expect(await later.replay('r1', 'u1', { n, actions: [], rules: MATGO_RULES + 1 })).toMatchObject({ ok: true });
  });

  it('act: 진행 수(n)와 함께 온 행동은 판을 견주고(행동에 실린 rules 는 떼어 낸다), 서버 진행(n 없음)은 그대로 받는다', async () => {
    const { m, runner, r } = await start(ENGINES, ['u1', 'u2']);
    let s = r.duo!;
    const turn = () => matgo.pending(s)[0];
    const user = () => (turn() === 0 ? 'u1' : 'u2');
    const pick = () => {
      const v = matgo.view(s);
      return matgo.ai(v.public, v.private[turn()], turn(), seededRng(3));
    };
    const n = soloOf(s)!.n;
    await expect(runner.act('r1', user(), { ...pick(), rules: MATGO_RULES + 1 }, n)).rejects.toMatchObject({ message: RULES_CHANGED, status: 409 });
    await runner.act('r1', user(), { ...pick(), rules: MATGO_RULES }, n);
    s = m.deck.state as MatgoState;
    expect(soloOf(s)!.n).toBe(n + 1);
    // 서버가 새 규칙이면: 판을 안 실은 n 행동(예전 화면)은 거절, n 없는 행동(서버가 진행하는 화면)은 받는다
    const later = new Runner(m.store, bumped, seededRng(1));
    await expect(later.act('r1', user(), pick(), soloOf(s)!.n)).rejects.toMatchObject({ message: RULES_CHANGED });
    await later.act('r1', user(), pick());
    expect(soloOf(m.deck.state)!.n).toBe(soloOf(s)!.n + 1);
  });

  it('sync: 판을 실어 보내면 견준다 (지금 화면은 싣지 않는다 → 응답을 보고 화면이 가린다)', async () => {
    const { runner } = await start();
    await expect(runner.sync('r1', 'u1', { duo: true, rules: MATGO_RULES + 1 })).rejects.toMatchObject({ message: RULES_CHANGED, status: 409 });
    expect((await runner.sync('r1', 'u1', { duo: true, rules: MATGO_RULES })).round).toBe(1);
    expect((await runner.sync('r1', 'u1', { duo: true })).round).toBe(1);
  });
});

describe('Runner: 룰렛 확정·마감 엇갈림과 결과 확인', () => {
  /** 룰렛 메모리 DB: roulette_place_bet · roulette_pay · roulette_bets 읽기를 SQL 과 같은 규칙으로 */
  function rouletteStore(humans: string[]) {
    const m = memStore('roulette', humans, 8);
    const bets = new Map<string, { bets: unknown; total: number; paid: boolean }>();
    const closed = new Set<string>();
    const gate = { wait: null as Promise<void> | null };
    m.store.placeBet = async (_id, round, spin, user, b, total) => {
      const key = `${round}:${spin}:${user}`;
      if (closed.has(`${round}:${spin}`)) throw new Error('spin closed');
      if (bets.has(key)) return;
      m.wallets[user] -= total;
      bets.set(key, { bets: JSON.parse(JSON.stringify(b)), total, paid: false });
      // 기록한 뒤 응답이 늦어진다 (그 사이 마감 처리가 끼어든다)
      if (gate.wait) {
        const g = gate.wait;
        gate.wait = null;
        await g;
      }
    };
    m.store.paySpin = async (_id, round, spin, result) => {
      closed.add(`${round}:${spin}`);
      for (const [key, row] of bets) {
        if (!key.startsWith(`${round}:${spin}:`) || row.paid) continue;
        row.paid = true;
        m.wallets[key.split(':')[2]] += payoutOf(row.bets as RBet[], result);
      }
    };
    m.store.spinBets = async (_id, round, spin) =>
      [...bets].filter(([k]) => k.startsWith(`${round}:${spin}:`)).map(([k, v]) => ({ userId: k.split(':')[2], bets: JSON.parse(JSON.stringify(v.bets)) }));
    return { m, gate };
  }

  it('마지막 사람의 확정이 칩을 뺀 뒤 마감 처리가 먼저 저장해도, 공개 상태에 그 베팅과 받은 돈이 보인다 (확정 요청도 오류 없이 끝난다)', async () => {
    const { m, gate } = rouletteStore(['u1']);
    let clock = 1_000_000;
    // 결과는 용(4)
    const runner = new Runner(m.store, ENGINES, { next: () => 4 / 12, int: () => 4 }, () => clock);
    await runner.start('r1', 'u1');
    let release!: () => void;
    gate.wait = new Promise((r) => (release = r));
    const actP = runner.act('r1', 'u1', { type: 'bet', bets: [{ kind: 'zodiac', target: 4, amount: 500 }] }).then(
      (x) => x,
      (e) => ({ error: (e as Error).message }),
    );
    await new Promise((r) => setTimeout(r, 10));
    clock += 21_000;
    await runner.timeout('r1');
    release();
    expect(await actP).toEqual({ ok: true });
    const pub = m.published[m.published.length - 1].pub;
    expect(pub.phase).toBe('spin');
    expect(pub.landed).toBe(4);
    expect(pub.bets['0']).toEqual([{ kind: 'zodiac', target: 4, amount: 500 }]);
    expect(pub.wins['0']).toBe(6000);
    expect(pub.confirmed).toEqual([0]);
    // 돈: 500 을 걸고 6000 을 받았다 (한 번만)
    expect(m.wallets.u1).toBe(100000 - 500 + 6000);
  });

  it('여럿 중 한 사람의 확정만 기록에 있고 상태에는 없을 때: 마감 처리가 그 사람은 확정으로, 나머지는 안 건 것으로 결과를 낸다', async () => {
    const { m } = rouletteStore(['u1', 'u2']);
    let clock = 1_000_000;
    const runner = new Runner(m.store, ENGINES, { next: () => 0, int: () => 0 }, () => clock);
    await runner.start('r1', 'u1');
    // u2 의 확정이 칩을 빼고 기록만 남긴 채 끊겼다
    await m.store.placeBet!('r1', 1, 1, 'u2', [{ kind: 'yinyang', target: 0, amount: 100 }], 100);
    clock += 21_000;
    await runner.timeout('r1');
    const pub = m.published[m.published.length - 1].pub;
    expect(pub.phase).toBe('spin');
    expect(pub.bets).toEqual({ '1': [{ kind: 'yinyang', target: 0, amount: 100 }] });
    expect(pub.wins).toEqual({ '1': 200 });
    expect(m.wallets.u2).toBe(100000 - 100 + 200);
  });

  it('확정하자 다른 사람 확정이 기록에서 채워져 모두 확정되면 바로 결과를 낸다 (회전 단계를 마감으로 바로 넘기지 않는다)', async () => {
    const { m } = rouletteStore(['u1', 'u2']);
    const runner = new Runner(m.store, ENGINES, { next: () => 0, int: () => 2 }, () => 1_000_000);
    await runner.start('r1', 'u1');
    await m.store.placeBet!('r1', 1, 1, 'u2', [{ kind: 'zodiac', target: 2, amount: 100 }], 100);
    await runner.act('r1', 'u1', { type: 'bet', bets: [] });
    const pub = m.published[m.published.length - 1].pub;
    expect(pub.phase).toBe('spin');
    expect(pub.acked).toEqual([]);
    expect(pub.wins).toEqual({ '1': 1200 });
    // 마감 처리가 기록을 채워 결과를 낸 경우도 회전 단계를 바로 넘기지 않는다
    const r2 = rouletteStore(['u1', 'u2']);
    let clock = 1_000_000;
    const runner2 = new Runner(r2.m.store, ENGINES, { next: () => 0, int: () => 2 }, () => clock);
    await runner2.start('r1', 'u1');
    await r2.m.store.placeBet!('r1', 1, 1, 'u1', [{ kind: 'zodiac', target: 2, amount: 100 }], 100);
    await r2.m.store.placeBet!('r1', 1, 1, 'u2', [{ kind: 'zodiac', target: 3, amount: 100 }], 100);
    clock += 21_000;
    await runner2.timeout('r1');
    const pub2 = r2.m.published[r2.m.published.length - 1].pub;
    expect(pub2.phase).toBe('spin');
    expect(pub2.acked).toEqual([]);
    expect(pub2.confirmed.sort()).toEqual([0, 1]);
  });

  it('결과 확인(next)은 여럿이 한꺼번에 눌러도, 두 번 눌러도, 단계가 넘어간 뒤에 와도 오류 없이 받는다', async () => {
    const users = Array.from({ length: 8 }, (_, i) => `u${i + 1}`);
    const { m } = rouletteStore(users);
    const runner = new Runner(m.store, ENGINES, seededRng(3), () => 1_000_000);
    await runner.start('r1', 'u1');
    for (const u of users) await runner.act('r1', u, { type: 'bet', bets: [] });
    expect(m.published[m.published.length - 1].pub.phase).toBe('spin');
    const out = await Promise.all(users.map((u) => runner.act('r1', u, { type: 'next' }).then(() => 'ok', (e) => (e as Error).message)));
    expect(out).toEqual(users.map(() => 'ok'));
    // 모두 확인했다 → 다음 스핀 베팅
    const pub = m.published[m.published.length - 1].pub;
    expect(pub.phase).toBe('bet');
    expect(pub.spin).toBe(2);
    // 늦게 온 확인 · 두 번째 확인
    expect(await runner.act('r1', 'u1', { type: 'next' })).toEqual({ ok: true });
    // 베팅 단계의 다른 행동은 그대로 규칙 검사를 받는다
    await expect(runner.act('r1', 'u1', { type: 'bet', bets: 'x' })).rejects.toThrow();
  });
});
