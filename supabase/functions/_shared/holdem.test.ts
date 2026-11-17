import { describe, expect, it } from 'vitest';
import { seededRng, type SeatInfo } from './engine.ts';
import { holdem, holdemOptions, type HoldemAction, type HoldemState } from './holdem.ts';

const human = (seat: number, stack = 100_000): SeatInfo => ({ seat, kind: 'human', name: `P${seat}`, stack });
const round = (seats: SeatInfo[], button: number | null = null, seed = 1, baseUnit = 100) =>
  holdem.newRound({ seats, baseUnit, carry: button === null ? null : { button }, rng: seededRng(seed) });
const act = (s: HoldemState, a: HoldemAction) => holdem.apply(s, s.turn!, a, seededRng(9));
const opts = (s: HoldemState) => holdemOptions(s, s.players.find((p) => p.seat === s.turn)!)!;

/** 리버까지 와 있는 상태로 바꾼다 (카드를 정해서 쇼다운 결과를 확인) */
function atRiver(s0: HoldemState, holes: Record<number, string>, board: string): HoldemState {
  const s = JSON.parse(JSON.stringify(s0)) as HoldemState;
  s.board = board.split(' ');
  for (const p of s.players) if (holes[p.seat]) p.hole = holes[p.seat].split(' ');
  s.phase = 'river';
  for (const p of s.players) {
    p.betRound = 0;
    p.acted = false;
    p.mayRaise = true;
  }
  s.curBet = 0;
  const actors = s.players.filter((p) => !p.excluded && !p.folded && !p.allIn).map((p) => p.seat).sort((a, b) => a - b);
  s.turn = actors.find((x) => x > s.button) ?? actors[0];
  return s;
}
const checkDown = (s: HoldemState) => {
  while (s.phase !== 'done') s = act(s, { type: 'check' });
  return s;
};

describe('블라인드·버튼', () => {
  it('버튼은 지난 판 다음 자리, 그다음 SB·BB, 프리플롭은 BB 다음부터', () => {
    const s = round([human(0), human(1), human(2), human(3)], 1);
    expect(s.button).toBe(2);
    expect(s.sbSeat).toBe(3);
    expect(s.bbSeat).toBe(0);
    expect(s.players.find((p) => p.seat === 3)!.total).toBe(100);
    expect(s.players.find((p) => p.seat === 0)!.total).toBe(200);
    expect(s.turn).toBe(1);
    expect(holdem.settle({ ...s, phase: 'done', result: { cancelled: false, uncontested: true, winners: [], pots: [], hands: {}, deltas: {}, excluded: [], board: [] } }).carry.button).toBe(2);
  });
  it('헤즈업: 버튼이 SB이고 프리플롭 먼저, 플롭부터는 BB가 먼저', () => {
    let s = round([human(0), human(2)], 0);
    expect(s.button).toBe(2);
    expect(s.sbSeat).toBe(2);
    expect(s.bbSeat).toBe(0);
    expect(s.turn).toBe(2);
    s = act(s, { type: 'call' });
    expect(s.turn).toBe(0); // BB 옵션
    s = act(s, { type: 'check' });
    expect(s.phase).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(s.turn).toBe(0);
  });
  it('플롭부터는 버튼 다음 남은 사람이 먼저', () => {
    let s = round([human(0), human(1), human(2), human(3)], 1); // 버튼 2, SB 3, BB 0, 첫 행동 1
    s = act(s, { type: 'call' }); // 1
    s = act(s, { type: 'fold' }); // 2 (버튼)
    s = act(s, { type: 'call' }); // 3 (SB)
    s = act(s, { type: 'check' }); // 0 (BB)
    expect(s.phase).toBe('flop');
    expect(s.turn).toBe(3);
  });
});

describe('베팅', () => {
  it('최소 레이즈 = BB 또는 직전 레이즈 폭', () => {
    let s = round([human(0), human(1), human(2)], 0); // 버튼 1, SB 2, BB 0, 첫 행동 1
    expect(s.turn).toBe(1);
    expect(opts(s).minTo).toBe(400);
    expect(() => act(s, { type: 'raise', to: 300 })).toThrow();
    s = act(s, { type: 'raise', to: 1000 }); // 폭 800
    expect(opts(s).minTo).toBe(1800);
    expect(() => act(s, { type: 'raise', to: 1700 })).toThrow();
  });
  it('모자란 올인 레이즈는 이미 행동한 사람에게 레이즈를 다시 열지 않는다', () => {
    let s = round([human(0), human(1), human(2, 1500)], 0); // 버튼 1, SB 2(1500칩), BB 0
    s = act(s, { type: 'raise', to: 1000 }); // 1: 1000 (폭 800)
    s = act(s, { type: 'allin' }); // 2: 1500까지 올인 (폭 500 < 800)
    expect(s.turn).toBe(0);
    expect(opts(s).canRaise).toBe(true); // BB는 아직 행동 전 → 레이즈 가능
    s = act(s, { type: 'call' });
    expect(s.turn).toBe(1);
    const o = opts(s);
    expect(o.call).toBe(500);
    expect(o.canRaise).toBe(false); // 이미 행동했으므로 콜·폴드만
    expect(() => act(s, { type: 'raise', to: 3000 })).toThrow();
  });
  it('완전한 레이즈는 다시 연다', () => {
    let s = round([human(0), human(1), human(2)], 0);
    s = act(s, { type: 'raise', to: 1000 }); // 1
    s = act(s, { type: 'raise', to: 2000 }); // 2 (폭 1000 ≥ 800)
    s = act(s, { type: 'call' }); // 0
    expect(s.turn).toBe(1);
    expect(opts(s).canRaise).toBe(true);
  });
  it('시간 초과: 체크할 수 있으면 체크, 아니면 폴드', () => {
    const s = round([human(0), human(1), human(2)], 0);
    expect(holdem.timeout(s, s.turn!, seededRng(1))).toEqual({ type: 'fold' });
    let t = act(s, { type: 'call' });
    t = act(t, { type: 'call' });
    expect(holdem.timeout(t, t.turn!, seededRng(1))).toEqual({ type: 'check' }); // BB
  });
  it('혼자 남으면 공개 없이 팟', () => {
    let s = round([human(0), human(1), human(2)], 0);
    s = act(s, { type: 'raise', to: 600 });
    s = act(s, { type: 'fold' });
    s = act(s, { type: 'fold' });
    expect(s.phase).toBe('done');
    expect(s.result!.uncontested).toBe(true);
    expect(s.result!.deltas).toEqual({ 0: -200, 1: 300, 2: -100 });
    expect(holdem.view(s).public.showdown).toBeNull();
  });
});

describe('쇼다운', () => {
  it('키커로 가린다', () => {
    let s = atRiver(round([human(0), human(1)], 0), { 0: 'AD KC', 1: 'AH QC' }, 'AS 9D 7H 4C 2S');
    s = checkDown(s);
    expect(s.result!.winners).toEqual([0]);
  });
  it('나머지 칩은 버튼 다음 자리부터 가까운 승자에게', () => {
    // 기본 단위 1 → SB 1, BB 2. 버튼 1, SB 2, BB 0
    let s = round([human(0), human(1), human(2)], 0, 1, 1);
    s = act(s, { type: 'call' }); // 1: 2
    s = act(s, { type: 'fold' }); // 2: SB 1 남기고 폴드
    s = act(s, { type: 'check' }); // 0
    s = atRiver(s, { 0: '2D 3C', 1: '4D 5C' }, 'TS JD QH KC AS'); // 둘 다 보드 = 동점, 팟 5
    s = checkDown(s);
    expect(s.result!.winners).toEqual([0, 1]);
    // 버튼(1) 다음 순서: 2 → 0 → 1 → 0이 나머지 1칩
    expect(s.result!.deltas).toEqual({ 0: 1, 1: 0, 2: -1 });
  });
  it('완전 동점이면 팟을 똑같이 나눈다', () => {
    let s = round([human(0), human(1), human(2)], 0);
    s = act(s, { type: 'call' }); // 1
    s = act(s, { type: 'call' }); // 2 SB
    s = act(s, { type: 'check' }); // 0 BB
    s = atRiver(s, { 0: '2D 3C', 1: '4D 5C', 2: '2H 3H' }, 'TS JD QH KC AS');
    s = checkDown(s);
    expect(s.result!.winners).toEqual([0, 1, 2]);
    expect(s.result!.deltas).toEqual({ 0: 0, 1: 0, 2: 0 });
  });
  it('A-2-3-4-5는 가장 낮은 스트레이트', () => {
    let s = atRiver(round([human(0), human(1)], 0), { 0: 'AD 2C', 1: '6H 2H' }, '3S 4D 5H KC KS');
    s = checkDown(s);
    expect(s.result!.winners).toEqual([1]); // 2-3-4-5-6 > A-2-3-4-5
  });
  it('사이드 팟: 적게 올인한 사람은 메인 팟만', () => {
    let s = round([human(0, 1000), human(1), human(2)], 2); // 버튼 0, SB 1, BB 2
    expect(s.turn).toBe(0);
    s = act(s, { type: 'allin' }); // 0: 1000 올인
    s = act(s, { type: 'raise', to: 3000 }); // 1
    s = act(s, { type: 'call' }); // 2
    // 플롭: 1, 2만 베팅
    s = atRiver(s, { 0: 'AS AD', 1: 'KS KD', 2: 'QS QD' }, '2C 7H 9D 4S 3C');
    s = checkDown(s);
    const r = s.result!;
    expect(r.pots).toEqual([
      { amount: 3000, eligible: [0, 1, 2], winners: [0] },
      { amount: 4000, eligible: [1, 2], winners: [1] },
    ]);
    expect(r.deltas).toEqual({ 0: 2000, 1: 1000, 2: -3000 });
  });
});

describe('무작위 판 (AI끼리 · 사람 섞어서)', () => {
  it('불변식: 정산 합 0, 사람 손실 ≤ 칩, 종료, 공개 정보에 남의 개인 카드 없음', () => {
    for (let g = 0; g < 300; g++) {
      const rng = seededRng(1000 + g);
      const n = 2 + rng.int(3);
      const seats: SeatInfo[] = Array.from({ length: n }, (_, i) =>
        rng.next() < 0.5 ? { seat: i, kind: 'ai', name: `AI${i}`, stack: null } : human(i, 400 + rng.int(20_000)),
      );
      let s = holdem.newRound({ seats, baseUnit: 100, carry: { button: rng.int(n) }, rng });
      let guard = 0;
      while (!holdem.done(s)) {
        const seat = holdem.pending(s)[0];
        const v = holdem.view(s);
        // 공개 정보에 개인 카드가 없어야 한다
        const pubText = JSON.stringify(v.public);
        for (const p of s.players) for (const c of p.hole) if (!s.board.includes(c)) expect(pubText.includes(`"${c}"`)).toBe(false);
        const a = rng.next() < 0.05 ? holdem.timeout(s, seat, rng) : holdem.ai(v.public, v.private[seat], seat, rng);
        s = holdem.apply(s, seat, a, rng);
        if (++guard > 200) throw new Error('끝나지 않음');
      }
      const st = holdem.settle(s);
      const sum = Object.values(st.deltas).reduce((a, b) => a + b, 0);
      expect(sum).toBe(0);
      for (const x of seats) if (x.stack !== null) expect(st.deltas[x.seat]).toBeGreaterThanOrEqual(-x.stack);
      // 보드 5장 + 개인 카드 + 버린 카드 = 겹침 없음
      const all = [...s.board, ...s.players.flatMap((p) => p.hole), ...s.deck];
      expect(new Set(all).size).toBe(all.length);
    }
  });
});
