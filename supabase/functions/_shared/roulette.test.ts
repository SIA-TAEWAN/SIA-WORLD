import { describe, expect, it } from 'vitest';
import { seededRng, type Rng, type SeatInfo } from './engine.ts';
import { hits, MULT, normalizeBets, payoutOf, roulette, seasonCells, WHEEL, type RBet, type RouletteState } from './roulette.ts';
import { Runner, type DeckRow, type RoomRow, type SeatRow, type Store } from './runner.ts';
import { ENGINES } from './engines.ts';

const human = (seat: number): SeatInfo => ({ seat, kind: 'human', name: `P${seat}`, stack: 100_000 });
const empty = (seat: number): SeatInfo => ({ seat, kind: 'ai', name: `빈자리${seat}`, stack: null });
/** 정해진 칸이 나오는 난수 */
const fixed = (cell: number): Rng => ({ next: () => cell / 12, int: () => cell });

describe('휠·묶음', () => {
  it('휠은 쥐~돼지 순서', () => {
    expect(WHEEL).toEqual(['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig']);
  });
  it('계절은 이웃한 세 칸 (봄 호랑이·토끼·용 … 겨울 돼지·쥐·소)', () => {
    expect(seasonCells(0).map((i) => WHEEL[i])).toEqual(['tiger', 'rabbit', 'dragon']);
    expect(seasonCells(1).map((i) => WHEEL[i])).toEqual(['snake', 'horse', 'sheep']);
    expect(seasonCells(2).map((i) => WHEEL[i])).toEqual(['monkey', 'rooster', 'dog']);
    expect(seasonCells(3).map((i) => WHEEL[i])).toEqual(['pig', 'rat', 'ox']);
  });
  it('음양은 한 칸씩 번갈아 (양 = 쥐·호랑이·용·말·원숭이·개)', () => {
    const yang = WHEEL.filter((_, i) => hits({ kind: 'yinyang', target: 0 }, i));
    expect(yang).toEqual(['rat', 'tiger', 'dragon', 'horse', 'monkey', 'dog']);
  });
  it('이웃 두 칸 (돼지-쥐 포함 12가지)', () => {
    expect(hits({ kind: 'pair', target: 11 }, 11)).toBe(true);
    expect(hits({ kind: 'pair', target: 11 }, 0)).toBe(true);
    expect(hits({ kind: 'pair', target: 11 }, 1)).toBe(false);
  });
  it('배당: 띠 ×12, 이웃 ×6, 계절 ×4, 음양 ×2 (건 금액 포함)', () => {
    expect(MULT).toEqual({ zodiac: 12, pair: 6, season: 4, yinyang: 2 });
    const bets: RBet[] = [
      { kind: 'zodiac', target: 4, amount: 100 }, // 용
      { kind: 'pair', target: 3, amount: 100 }, // 토끼·용
      { kind: 'season', target: 0, amount: 100 }, // 봄
      { kind: 'yinyang', target: 0, amount: 100 }, // 양
      { kind: 'zodiac', target: 5, amount: 100 }, // 뱀 (꽝)
    ];
    expect(payoutOf(bets, 4)).toBe(1200 + 600 + 400 + 200);
    expect(payoutOf(bets, 5)).toBe(1200 + 400 * 0 + 0); // 뱀: 띠만 (뱀은 여름, 음)
  });
  it('기대값은 모두 공정 (12칸 평균이 건 금액)', () => {
    for (const kind of ['zodiac', 'pair', 'season', 'yinyang'] as const) {
      const avg = Array.from({ length: 12 }, (_, r) => payoutOf([{ kind, target: 0, amount: 1200 }], r)).reduce((a, b) => a + b, 0) / 12;
      expect(avg).toBe(1200);
    }
  });
  it('베팅 검사: 기본 단위 배수, 칸 범위, 같은 칸 합치기', () => {
    expect(() => normalizeBets([{ kind: 'zodiac', target: 0, amount: 150 }], 100)).toThrow();
    expect(() => normalizeBets([{ kind: 'season', target: 4, amount: 100 }], 100)).toThrow();
    expect(() => normalizeBets([{ kind: 'nope', target: 0, amount: 100 }], 100)).toThrow();
    expect(normalizeBets([{ kind: 'zodiac', target: 1, amount: 100 }, { kind: 'zodiac', target: 1, amount: 200 }], 100)).toEqual([{ kind: 'zodiac', target: 1, amount: 300 }]);
  });
});

describe('스핀 진행', () => {
  const start = (seats = [human(0), human(1), empty(2)]) => roulette.newRound({ seats, baseUnit: 100, carry: { history: [1, 2] }, rng: seededRng(1) });

  it('사람만 걸 수 있고, 모두 확정하면 결과', () => {
    let s = start();
    expect(roulette.pending(s)).toEqual([0, 1]);
    s = roulette.apply(s, 0, { type: 'bet', bets: [{ kind: 'zodiac', target: 7, amount: 300 }] }, fixed(7));
    expect(s.phase).toBe('bet');
    expect(() => roulette.apply(s, 0, { type: 'bet', bets: [] }, fixed(7))).toThrow(); // 두 번 확정 불가
    expect(() => roulette.apply(s, 2, { type: 'bet', bets: [] }, fixed(7))).toThrow(); // 빈자리
    s = roulette.apply(s, 1, { type: 'bet', bets: [] }, fixed(7));
    expect(s.phase).toBe('spin');
    expect(s.result).toBe(7);
    expect(s.wins).toEqual({ 0: 3600 });
    expect(s.history).toEqual([1, 2, 7]);
    expect(roulette.spinResult(s)).toEqual({ spin: 1, result: 7 });
  });
  it('마감 뒤 베팅 변경 불가 (회전 중에는 거절)', () => {
    let s = start([human(0)]);
    s = roulette.apply(s, 0, { type: 'bet', bets: [] }, fixed(3));
    expect(s.phase).toBe('spin');
    expect(() => roulette.apply(s, 0, { type: 'bet', bets: [{ kind: 'zodiac', target: 3, amount: 100 }] }, fixed(3))).toThrow();
  });
  it('한 스핀 총액은 기본 단위 ×100까지', () => {
    const s = start([human(0)]);
    const big = [{ kind: 'zodiac', target: 0, amount: 5000 }, { kind: 'zodiac', target: 1, amount: 5100 }] as RBet[];
    expect(() => roulette.apply(s, 0, { type: 'bet', bets: big }, fixed(0))).toThrow(/10000/);
    expect(roulette.apply(s, 0, { type: 'bet', bets: [{ kind: 'zodiac', target: 0, amount: 10000 }] }, fixed(0)).phase).toBe('spin');
  });
  it('3스핀 연속 아무도 안 걸면 멈춘다, 걸면 연속 횟수가 0으로', () => {
    let s = start([human(0)]);
    const seats = [human(0)];
    for (let i = 0; i < 2; i++) {
      s = roulette.apply(s, 0, { type: 'bet', bets: [] }, fixed(0));
      s = roulette.tick(s, fixed(0), seats);
      expect(s.phase).toBe('bet');
    }
    s = roulette.apply(s, 0, { type: 'bet', bets: [{ kind: 'yinyang', target: 1, amount: 100 }] }, fixed(0));
    expect(s.idle).toBe(0);
    for (let i = 0; i < 3; i++) {
      s = roulette.tick(s, fixed(0), seats);
      s = roulette.apply(s, 0, { type: 'bet', bets: [] }, fixed(0));
    }
    expect(s.idle).toBe(3);
    s = roulette.tick(s, fixed(0), seats);
    expect(s.phase).toBe('done');
    expect(s.stopReason).toBe('idle');
    expect(roulette.settle(s).carry.history.length).toBeLessThanOrEqual(20);
  });
  it('최근 20스핀만 기억', () => {
    let s: RouletteState = roulette.newRound({ seats: [human(0)], baseUnit: 100, carry: { history: Array(20).fill(5) }, rng: seededRng(1) });
    s = roulette.apply(s, 0, { type: 'bet', bets: [{ kind: 'zodiac', target: 9, amount: 100 }] }, fixed(9));
    expect(s.history).toHaveLength(20);
    expect(s.history[19]).toBe(9);
  });
  it('중간에 들어온 사람은 다음 베팅부터', () => {
    let s = start([human(0)]);
    expect(() => roulette.apply(s, 1, { type: 'bet', bets: [] }, fixed(0))).toThrow(/다음 베팅/);
    s = roulette.apply(s, 0, { type: 'bet', bets: [] }, fixed(0));
    s = roulette.tick(s, fixed(0), [human(0), human(1)]);
    expect(roulette.pending(s)).toEqual([0, 1]);
  });
  it('마감 시각은 한 번 찍으면 누가 확정해도 그대로', () => {
    let s = roulette.stamp(start(), 1000);
    expect(s.endsAt).toBe(21_000);
    s = roulette.apply(s, 0, { type: 'bet', bets: [] }, fixed(0));
    s = roulette.stamp(s, 5000);
    expect(s.endsAt).toBe(21_000);
    s = roulette.stamp(roulette.apply(s, 1, { type: 'bet', bets: [] }, fixed(0)), 6000);
    expect(s.phase).toBe('spin');
    expect(s.endsAt).toBe(36_000);
  });
  it("결과를 보고 '확인': 모두 확인하면 바로 다음 스핀, 안 누른 사람은 마감 때 자동 확인", () => {
    let s = start([human(0), human(1)]);
    s = roulette.apply(s, 0, { type: 'bet', bets: [] }, fixed(0));
    s = roulette.apply(s, 1, { type: 'bet', bets: [] }, fixed(0));
    expect(s.phase).toBe('spin');
    // 결과 단계: 두 사람 모두 확인할 차례
    expect(roulette.pending(s)).toEqual([0, 1]);
    expect(roulette.tickNow(s)).toBe(false);
    expect(() => roulette.apply(s, 0, { type: 'bet', bets: [] }, fixed(0))).toThrow(/확인/);
    s = roulette.apply(s, 0, { type: 'next' }, fixed(0));
    expect(roulette.pending(s)).toEqual([1]);
    expect(() => roulette.apply(s, 0, { type: 'next' }, fixed(0))).toThrow(/이미/);
    expect(roulette.view(s).public.acked).toEqual([0]);
    // 마감: 안 누른 사람은 자동으로 확인한 것으로
    expect(roulette.timeout(s, 1, fixed(0))).toEqual({ type: 'next' });
    s = roulette.apply(s, 1, roulette.timeout(s, 1, fixed(0)), fixed(0));
    expect(roulette.tickNow(s)).toBe(true);
    s = roulette.tick(s, fixed(0), [human(0), human(1)]);
    expect(s.phase).toBe('bet');
    expect(s.acked).toEqual([]);
    // 베팅 단계에서는 확인을 받지 않는다
    expect(() => roulette.apply(s, 0, { type: 'next' } as never, fixed(0))).toThrow();
    // 나간 사람 자리(AI 대신): 단계에 맞는 행동
    expect(roulette.ai({ phase: 'spin' } as never, {}, 0, fixed(0))).toEqual({ type: 'next' });
    expect(roulette.ai({ phase: 'bet' } as never, {}, 0, fixed(0))).toEqual({ type: 'bet', bets: [] });
  });
});

describe('Runner + 룰렛 (칩은 확정 때 먼저, 지급은 결과 때 한 번)', () => {
  it('확정 → 차감, 결과 → 지급, 회전 뒤 다음 베팅, 3스핀 무베팅이면 대기', async () => {
    const room: RoomRow = { id: 'r1', game: 'roulette', base_unit: 100, status: 'waiting', round_no: 0 };
    const seats: SeatRow[] = Array.from({ length: 8 }, (_, i) => ({ seat_no: i, user_id: i === 0 ? 'u1' : null, nickname: i === 0 ? '나' : '빈자리', avatar: 'tiger', ready: true, left_game: false }));
    const wallet: Record<string, number> = { u1: 10_000 };
    let deck: DeckRow = { version: 0, round_no: 0, state: null, carry: null };
    let pv = 0;
    const pubs: { pub: any; deadline: Date | null; pending: number[] }[] = [];
    const bets = new Map<string, { bets: RBet[]; total: number; paid: boolean }>();
    const store: Store = {
      room: async () => ({ ...room }),
      seats: async () => seats.map((s) => ({ ...s })),
      balances: async (ids) => Object.fromEntries(ids.map((i) => [i, wallet[i] ?? 0])),
      deck: async () => JSON.parse(JSON.stringify(deck)),
      saveDeck: async (_id, v, state, carry, round) => {
        if (deck.version !== v) return false;
        deck = { version: v + 1, round_no: round, state: JSON.parse(JSON.stringify(state)), carry };
        return true;
      },
      beginRound: async () => (room.status === 'waiting' ? ((room.status = 'playing'), ++room.round_no) : null),
      publish: async (_id, v, _r, pub, pending, deadline) => {
        if (v <= pv) return;
        pv = v;
        pubs.push({ pub, deadline, pending });
      },
      applyResult: async () => true,
      finishRound: async () => ((room.status = 'waiting'), true),
      placeBet: async (_id, round, spin, user, b, total) => {
        const key = `${round}:${spin}:${user}`;
        if (bets.has(key)) return;
        if (wallet[user] < total) throw new Error('not enough money');
        wallet[user] -= total;
        bets.set(key, { bets: b as RBet[], total, paid: false });
      },
      paySpin: async (_id, round, spin, result) => {
        for (const [key, row] of bets) {
          if (!key.startsWith(`${round}:${spin}:`) || row.paid) continue;
          row.paid = true;
          wallet[key.split(':')[2]] += payoutOf(row.bets, result);
        }
      },
    };
    let clock = 1_000_000;
    const runner = new Runner(store, ENGINES, fixed(4), () => clock);
    await runner.start('r1', 'u1');
    expect(pubs.at(-1)!.pending).toEqual([0]);
    expect(pubs.at(-1)!.deadline!.getTime()).toBe(clock + 20_000);
    // 칩이 모자라면 거절, 차감 없음
    await expect(runner.act('r1', 'u1', { type: 'bet', bets: [{ kind: 'zodiac', target: 4, amount: 10_100 }] })).rejects.toThrow();
    expect(wallet.u1).toBe(10_000);
    // 용(4)에 500 → 확정 즉시 차감, 결과 용 → 6,000 지급
    await runner.act('r1', 'u1', { type: 'bet', bets: [{ kind: 'zodiac', target: 4, amount: 500 }] });
    expect(pubs.at(-1)!.pub.phase).toBe('spin');
    expect(wallet.u1).toBe(10_000 - 500 + 6000);
    // 결과 단계: 내가 확인할 차례, 마감은 30초 뒤
    expect(pubs.at(-1)!.pending).toEqual([0]);
    expect(pubs.at(-1)!.deadline!.getTime()).toBe(clock + 30_000);
    // '확인' → 마감을 기다리지 않고 바로 다음 베팅
    await runner.act('r1', 'u1', { type: 'next' });
    expect(pubs.at(-1)!.pub.phase).toBe('bet');
    expect(pubs.at(-1)!.pub.spin).toBe(2);
    // 같은 결과로 지급을 다시 불러도 두 번 주지 않는다
    await store.paySpin!('r1', 1, 1, 4);
    expect(wallet.u1).toBe(15_500);
    // 3스핀 무베팅 (시간 초과로 확정) → 판 끝, 대기
    for (let i = 0; i < 3; i++) {
      clock += 20_000;
      await runner.timeout('r1'); // 베팅 마감 → 결과
      clock += 30_000;
      await runner.timeout('r1'); // 결과 확인 마감 (자동 확인) → 다음 베팅 또는 멈춤
    }
    expect(room.status).toBe('waiting');
    expect(wallet.u1).toBe(15_500);
  });
});

describe('전체검사 보강', () => {
  it('constructor·__proto__ 같은 이름은 베팅 종류로 받지 않는다', () => {
    for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(() => normalizeBets([{ kind, target: 3, amount: 100 }], 100)).toThrow();
    }
  });
  it('지급이 한 번 실패해도 다음 마감 처리 때 지급한다 (다음 스핀으로 넘어가기 전에)', async () => {
    const room: RoomRow = { id: 'r1', game: 'roulette', base_unit: 100, status: 'waiting', round_no: 0 };
    const seats: SeatRow[] = [{ seat_no: 0, user_id: 'u1', nickname: '나', avatar: 'tiger', ready: true, left_game: false }];
    let deck: DeckRow = { version: 0, round_no: 0, state: null, carry: null };
    let wallet = 10_000;
    const rows: { bets: RBet[]; paid: boolean }[] = [];
    let failPay = true;
    const store: Store = {
      room: async () => ({ ...room }),
      seats: async () => seats.map((s) => ({ ...s })),
      balances: async () => ({ u1: wallet }),
      deck: async () => JSON.parse(JSON.stringify(deck)),
      saveDeck: async (_id, v, state, carry, round) => {
        if (deck.version !== v) return false;
        deck = { version: v + 1, round_no: round, state: JSON.parse(JSON.stringify(state)), carry };
        return true;
      },
      beginRound: async () => ((room.status = 'playing'), ++room.round_no),
      publish: async () => undefined,
      applyResult: async () => true,
      finishRound: async () => ((room.status = 'waiting'), true),
      placeBet: async (_id, _r, _s, _u, b, total) => {
        wallet -= total;
        rows.push({ bets: b as RBet[], paid: false });
      },
      paySpin: async (_id, _r, _s, result) => {
        if (failPay) {
          failPay = false;
          throw new Error('network');
        }
        for (const row of rows) if (!row.paid) ((row.paid = true), (wallet += payoutOf(row.bets, result)));
      },
    };
    let clock = 0;
    const runner = new Runner(store, ENGINES, fixed(2), () => clock);
    await runner.start('r1', 'u1');
    // 지급이 실패해도 행동은 성공으로 끝난다 (상태는 저장됐고 결과도 공개된다)
    await runner.act('r1', 'u1', { type: 'bet', bets: [{ kind: 'zodiac', target: 2, amount: 1000 }] });
    expect(wallet).toBe(9000);
    clock += 10_000;
    await runner.timeout('r1');
    expect(wallet).toBe(9000 + 12_000);
  });
});

describe('기록에 남은 확정 채우기 (adoptBets) · 늦게 온 결과 확인 (redundant)', () => {
  const start = () => roulette.newRound({ seats: [human(0), human(1)], baseUnit: 100, carry: null, rng: seededRng(1) });
  const bet = [{ kind: 'zodiac' as const, target: 5, amount: 200 }];

  it('확정 안 된 자리만 채우고, 모두 확정되면 결과를 낸다. 이미 확정한 자리 · 참가하지 않은 자리 · 빈 목록은 그대로', () => {
    let s = roulette.apply(start(), 0, { type: 'bet', bets: [] }, fixed(5));
    expect(roulette.betSpin(s)).toBe(1);
    // 0번은 이미 확정 (기록이 있어도 바꾸지 않는다), 7번은 참가자가 아니다
    const same = roulette.adoptBets(s, [{ seat: 0, bets: bet }, { seat: 7, bets: bet }, { seat: 1, bets: [] }], fixed(5));
    expect(same).toBe(s);
    s = roulette.adoptBets(s, [{ seat: 1, bets: bet }], fixed(5));
    expect(s.phase).toBe('spin');
    expect(s.bets).toEqual({ '1': bet });
    expect(s.wins).toEqual({ '1': 2400 });
    expect(roulette.betSpin(s)).toBeNull();
    // 결과가 난 뒤에는 채우지 않는다
    expect(roulette.adoptBets(s, [{ seat: 0, bets: bet }], fixed(5))).toBe(s);
  });

  it('결과 확인: 확인한 자리 · 회전 단계가 아닌 때 · 상태가 없을 때는 이미 처리된 것으로 본다. 베팅은 해당 없음', () => {
    let s = roulette.apply(start(), 0, { type: 'bet', bets: [] }, fixed(5));
    expect(roulette.redundant(s, 0, { type: 'next' })).toBe(true); // 아직 베팅 단계
    s = roulette.apply(s, 1, { type: 'bet', bets: [] }, fixed(5));
    expect(roulette.redundant(s, 0, { type: 'next' })).toBe(false);
    s = roulette.apply(s, 0, { type: 'next' }, fixed(5));
    expect(roulette.redundant(s, 0, { type: 'next' })).toBe(true);
    expect(roulette.redundant(s, 1, { type: 'next' })).toBe(false);
    expect(roulette.redundant(null, 1, { type: 'next' })).toBe(true);
    expect(roulette.redundant(s, 1, { type: 'bet', bets: [] })).toBe(false);
  });
});
