/**
 * 텍사스 홀덤 화면용 '되돌리기' (브라우저에서 쓴다. 서버 엔진은 쓰지 않는다. 순수 함수라 여기 두고 엔진과 함께 테스트한다).
 *
 * 서버는 한 번의 응답에 여러 동작(AI 베팅 여러 개, 플롭·턴·리버, 쇼다운…)을 담아 보낸다.
 * 화면은 그것을 한 동작씩 보여 줘야 하므로, 새 공개 상태에서 새 사건을 뒤에서부터 하나씩 되돌려
 * 각 사건 직전의 공개 상태를 만든다 (games/lib/shell.ts의 GameUI.rewind).
 *
 * out[i] = events[i]가 일어나기 직전의 화면. 차례 표시(turn)는 그 사건을 하는 자리.
 * prev = 지금 화면에 보이는 (events가 일어나기 전) 공개 상태. 이번 라운드에 이미 낸 돈·마지막 행동 표시를 맞추는 데 쓴다.
 * 되돌릴 수 없는 모양(판 시작의 블라인드·첫 카드 등)이면 예외를 던진다 (화면은 그때 예전 방식: 말풍선 → 새 상태).
 */
import type { GameEvent } from './engine.ts';
import type { HoldemPhase, HoldemPublic } from './holdem.ts';

const BETS = new Set(['fold', 'check', 'call', 'bet', 'raise']);
const STREETS = new Set(['flop', 'turn', 'river']);
const LABEL: Record<string, string> = { fold: '폴드', check: '체크', call: '콜', bet: '베트', raise: '레이즈' };
const streetOf = (n: number): HoldemPhase => (n >= 5 ? 'river' : n === 4 ? 'turn' : n === 3 ? 'flop' : 'preflop');

/** 판 시작 사건 (딜러 버튼 · 블라인드 · 첫 카드 2장): 이것이 든 묶음은 되돌리지 않는다 → 화면은 부르기 전에 이것으로 가른다 (예상된 경우라 경고도 내지 않는다) */
export function holdemRoundStart(events: readonly GameEvent[]): boolean {
  return events.some((e) => e.t === 'button' || e.t === 'blind' || e.t === 'deal');
}

export function rewindHoldem(next: HoldemPublic, events: readonly GameEvent[], prev?: HoldemPublic | null): HoldemPublic[] {
  // 앞에서부터: 사건마다 낸 돈(레이즈는 '얼마까지'만 적혀 있다)과, 공용 카드가 깔리기 직전 각 자리가 그 라운드에 낸 돈
  const br = new Map<number, number>();
  let known = !!prev;
  if (prev) for (const s of prev.seats) br.set(s.seat, s.betRound);
  const paid: number[] = new Array(events.length).fill(0);
  const atStreetEnd: (Map<number, number> | null)[] = new Array(events.length).fill(null);
  events.forEach((e, i) => {
    if (STREETS.has(e.t)) {
      atStreetEnd[i] = known ? new Map(br) : null;
      br.clear();
      known = true;
      return;
    }
    if (typeof e.seat !== 'number' || (e.t !== 'call' && e.t !== 'bet' && e.t !== 'raise')) return;
    if (!known) throw new Error('되돌릴 수 없음: 이번 라운드에 낸 돈을 모른다');
    const had = br.get(e.seat) ?? 0;
    const d = e.t === 'call' ? Number(e.amount) : Number(e.to) - had;
    if (!Number.isFinite(d) || d < 0) throw new Error(`되돌릴 수 없는 사건: ${e.t}`);
    paid[i] = d;
    br.set(e.seat, had + d);
  });

  const out: HoldemPublic[] = new Array(events.length);
  let cur = next;
  for (let i = events.length - 1; i >= 0; i--) {
    cur = JSON.parse(JSON.stringify(cur)) as HoldemPublic;
    undo(cur, events, i, paid[i], atStreetEnd[i], prev ?? null);
    out[i] = cur;
  }
  return out;
}

function undo(p: HoldemPublic, events: readonly GameEvent[], i: number, paid: number, streetEnd: Map<number, number> | null, prev: HoldemPublic | null) {
  const e = events[i];
  const fail = (): never => {
    throw new Error(`되돌릴 수 없는 사건: ${e.t}`);
  };
  const seat = typeof e.seat === 'number' ? p.seats.find((x) => x.seat === e.seat) : undefined;
  const need = () => seat ?? fail();
  /** 이 자리가 이 사건 전에 마지막으로 한 행동 표시 */
  const lastBefore = (s: number): string | null => {
    for (let j = i - 1; j >= 0; j--) {
      const x = events[j];
      if (x.seat !== s) continue;
      if (x.t === 'allin') return '올인';
      if (BETS.has(x.t)) return LABEL[x.t];
    }
    return prev?.seats.find((x) => x.seat === s)?.last ?? null;
  };
  const curBet = () => p.seats.reduce((a, s) => Math.max(a, s.excluded ? 0 : s.betRound), 0);
  // 되돌린 화면에서는 조작 버튼을 그리지 않는다
  p.options = null;
  p.pots = prev?.pots ?? [];
  p.summary = null;

  if (BETS.has(e.t)) {
    const s = need();
    if (e.t === 'fold') s.folded = false;
    else {
      s.betRound -= paid;
      s.total -= paid;
      s.stackLeft += paid;
      p.pot -= paid;
      if (s.betRound < 0 || s.total < 0) fail();
    }
    s.last = lastBefore(s.seat);
    p.curBet = curBet();
    p.phase = streetOf(p.board.length);
    p.turn = s.seat;
    p.showdown = null;
    p.winners = [];
    return;
  }
  if (STREETS.has(e.t)) {
    const n = e.t === 'flop' ? 3 : 1;
    if (p.board.length !== (e.t === 'flop' ? 3 : e.t === 'turn' ? 4 : 5) || !streetEnd) fail();
    p.board.splice(p.board.length - n, n);
    p.phase = streetOf(p.board.length);
    for (const s of p.seats) s.betRound = streetEnd!.get(s.seat) ?? 0;
    p.curBet = curBet();
    p.turn = null;
    p.showdown = null;
    p.winners = [];
    return;
  }
  switch (e.t) {
    case 'win':
      p.winners = p.winners.filter((x) => x !== e.seat);
      p.turn = null;
      return;
    case 'royal':
    case 'straight_flush':
    case 'four_kind':
      return;
    case 'showdown':
      p.showdown = null;
      p.winners = [];
      p.phase = streetOf(p.board.length);
      p.turn = null;
      return;
    case 'runout':
      p.runout = false;
      return;
    case 'allin': {
      // 블라인드 올인(판 시작)은 되돌리지 않는다
      const before = events[i - 1];
      if (!before || before.seat !== e.seat || !BETS.has(before.t)) fail();
      const s = need();
      s.allIn = false;
      s.last = LABEL[before.t];
      p.turn = null;
      return;
    }
    default:
      fail();
  }
}
