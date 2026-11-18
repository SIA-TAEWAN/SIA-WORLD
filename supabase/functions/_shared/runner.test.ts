import { describe, expect, it } from 'vitest';
import { seededRng } from './engine.ts';
import { ENGINES } from './engines.ts';
import { Runner, type DeckRow, type GameId, type RoomRow, type SeatRow, type Store } from './runner.ts';

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
    expect(last.deadline?.getTime()).toBe(1_000_000 + 20_000);
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
