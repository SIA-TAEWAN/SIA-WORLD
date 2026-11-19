import { describe, expect, it } from 'vitest';
import { seededRng } from './engine.ts';
import { ENGINES } from './engines.ts';
import { Runner, SOLO_DEADLINE_MS, type DeckRow, type GameId, type RoomRow, type SeatRow, type Store } from './runner.ts';
import { matgo, type MatgoAction, type MatgoState } from './matgo.ts';
import { soloOf, soloStep } from './solo.ts';

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
    expect(pub.seats.find((x: any) => x.seat === 1).bet).not.toBeNull(); // 나간 자리는 AI가 베팅
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
    m.seats[2].left_game = true; // u3는 베팅 단계에서 나감 → 다음 행동 때 AI가 대신 베팅
    await runner.act('r1', 'u1', { type: 'bet', amount: 100 });
    const last = m.published[m.published.length - 1];
    expect(last.pub.phase).not.toBe('bet');
    expect(last.pub.seats.find((x: any) => x.seat === 1).out).toBe(true);
    expect(last.pub.seats.find((x: any) => x.seat === 2).hands.length).toBeGreaterThan(0);
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

  it('사람이 둘인 방·다른 게임은 서버 진행 그대로 (solo 아님, 마감 20초)', async () => {
    const two = memStore('matgo', ['u1', 'u2'], 2);
    const r2 = new Runner(two.store, ENGINES, seededRng(4), () => 1_000_000);
    const started = (await r2.start('r1', 'u1')) as { solo?: unknown };
    expect(started.solo).toBeUndefined();
    expect(soloOf(two.deck.state)).toBeNull();
    const last = two.published[two.published.length - 1];
    expect(last.pub.soloN).toBeUndefined();
    expect(last.deadline?.getTime()).toBe(1_000_000 + 20_000);
    await expect(r2.sync('r1', 'u1')).rejects.toThrow('not solo');
    await expect(r2.replay('r1', 'u1', { n: 0, actions: [] })).rejects.toThrow('not solo');

    const pk = memStore('poker', ['u1'], 4);
    const r3 = new Runner(pk.store, ENGINES, seededRng(5), () => 1_000_000);
    expect(((await r3.start('r1', 'u1')) as { solo?: unknown }).solo).toBeUndefined();
    expect(soloOf(pk.deck.state)).toBeNull();
    expect(pk.published[pk.published.length - 1].deadline?.getTime()).toBe(1_000_000 + 20_000);
  });

  it('결정성: 화면이 기기에서 둔 결과와 서버가 행동 목록으로 다시 둔 결과(최종 상태·정산)가 같다', async () => {
    let finished = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const { m, runner, r } = await begin(seed * 101);
      if (!r.solo) continue; // 총통으로 바로 끝난 판
      const before = m.published.length;
      const local = playLocal(r.solo, picker(seed * 7 + 1));
      expect(matgo.done(local.state)).toBe(true);
      const res = await runner.replay('r1', 'u1', { n: soloOf(r.solo)!.n, actions: JSON.parse(JSON.stringify(local.actions)) });
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
    await a.runner.replay('r1', 'u1', { n: soloOf(a.r.solo)!.n, actions: local.actions });
    for (const act of local.actions) await b.runner.act('r1', 'u1', act);
    expect(b.m.deck.state).toEqual(a.m.deck.state);
    expect(b.m.results.get(1)).toEqual(a.m.results.get(1));
  });

  it('서버 진행 수와 안 맞으면 out of sync (상태는 그대로)', async () => {
    const { m, runner, r } = await begin(9);
    const n = soloOf(r.solo)!.n;
    const local = playLocal(r.solo!, picker(2), 2);
    const v = m.deck.version;
    await expect(runner.replay('r1', 'u1', { n: n + 1, actions: local.actions })).rejects.toMatchObject({ message: 'out of sync', status: 409 });
    await expect(runner.replay('r1', 'u1', { n: n - 1, actions: local.actions })).rejects.toMatchObject({ message: 'out of sync', status: 409 });
    expect(m.deck.version).toBe(v);
    // 잘못된 모양
    await expect(runner.replay('r1', 'u1', { n, actions: 'x' })).rejects.toThrow('bad replay');
    await expect(runner.replay('r1', 'u1', { n, actions: [null] })).rejects.toThrow('bad replay');
    await expect(runner.replay('r1', 'u1', { actions: [] })).rejects.toThrow('bad replay');
    await expect(runner.replay('r1', 'u1', null)).rejects.toThrow('bad replay');
    expect(m.deck.version).toBe(v);
  });

  it('남의 방: 그 방에 앉은 사람이 아니면 상태도 못 받고 행동도 못 넣는다', async () => {
    const { m, runner, r } = await begin(10);
    const n = soloOf(r.solo)!.n;
    await expect(runner.sync('r1', 'zz')).rejects.toMatchObject({ message: 'not in room', status: 403 });
    await expect(runner.replay('r1', 'zz', { n, actions: [] })).rejects.toMatchObject({ message: 'not in room', status: 403 });
    // 판 도중 나간 사람도 마찬가지
    m.seats[0].left_game = true;
    await expect(runner.sync('r1', 'u1')).rejects.toThrow('not in room');
    await expect(runner.replay('r1', 'u1', { n, actions: [] })).rejects.toThrow('not in room');
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
    await expect(runner.replay('r1', 'u1', { n, actions: [...one.actions, forged] })).rejects.toMatchObject({ status: 400 });
    expect(m.deck.version).toBe(v); // 아무것도 저장되지 않았다
    // 사람 행동만 보내면 AI 차례는 서버가 정한 대로 (화면의 soloStep(…, null) 과 같은 수)
    const withAi = playLocal(r.solo!, picker(3), 1, true);
    const res = await runner.replay('r1', 'u1', { n, actions: one.actions });
    expect(res.n).toBe(soloOf(withAi.state)!.n);
    expect(m.deck.state).toEqual(JSON.parse(JSON.stringify(withAi.state)));
    // 판이 끝난 뒤에 남은 행동이 있어도 거절 (방은 이미 대기)
    const full = playLocal(withAi.state, picker(4));
    await runner.replay('r1', 'u1', { n: res.n, actions: full.actions });
    expect(m.room.status).toBe('waiting');
    await expect(runner.replay('r1', 'u1', { n: soloOf(full.state)!.n, actions: [{ type: 'stop' }] })).rejects.toMatchObject({ message: 'not playing', status: 409 });
    expect(m.results.size).toBe(1);
  });

  it('판이 끝났는데 행동이 더 남아 있으면 거절하고 정산하지 않는다', async () => {
    const { m, runner, r } = await begin(14);
    const local = playLocal(r.solo!, picker(6));
    const v = m.deck.version;
    await expect(runner.replay('r1', 'u1', { n: soloOf(r.solo)!.n, actions: [...local.actions, { type: 'go' }] })).rejects.toMatchObject({ message: 'not your turn', status: 400 });
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
    const res = await runner.replay('r1', 'u1', { n: n0, actions: all.actions.slice(0, k) });
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
    await expect(runner.replay('r1', 'u1', { n: n0, actions: all.actions.slice(0, k) })).rejects.toThrow('out of sync');
    const rest = await runner.replay('r1', 'u1', { n: res.n, actions: all.actions.slice(k) });
    expect(rest.done).toBe(true);
    expect(m.deck.state).toEqual(JSON.parse(JSON.stringify(all.state)));
    expect(m.results.get(1)).toEqual(matgo.settle(all.state).deltas);
    last = m.published[m.published.length - 1];
    expect(last.pub.result).toBeTruthy();
  });

  it('빈 목록도 받는다 (나가기 직전 저장: 달라질 것이 없다)', async () => {
    const { m, runner, r } = await begin(23);
    const res = await runner.replay('r1', 'u1', { n: soloOf(r.solo)!.n, actions: [] });
    expect(res).toEqual({ ok: true, n: soloOf(r.solo)!.n, done: false });
    expect(m.deck.state).toEqual(r.solo);
  });

  it('나가면 서버 AI가 저장된 데서 이어 두어 정산한다', async () => {
    const { m, runner, r } = await begin(31);
    const part = playLocal(r.solo!, picker(9), 2, true);
    await runner.replay('r1', 'u1', { n: soloOf(r.solo)!.n, actions: part.actions });
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
    await expect(runner.replay('r1', 'u1', { n: soloOf(r.solo)!.n, actions: local.actions })).rejects.toMatchObject({ status: 409 });
    expect(m.results.size).toBe(1);
  });
});
