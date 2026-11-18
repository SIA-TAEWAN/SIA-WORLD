/**
 * 세븐포커 화면용 '되돌리기' (브라우저에서 쓴다. 서버 엔진은 쓰지 않는다. 순수 함수라 여기 두고 엔진과 함께 테스트한다).
 *
 * 서버는 한 번의 응답에 여러 동작(내 고르기, 카드 공개, 카드 돌리기, AI 베팅 여러 개, 쇼다운…)을 담아 보낸다.
 * 화면은 그것을 한 동작씩 보여 줘야 하므로, 새 공개 상태에서 새 사건을 뒤에서부터 하나씩 되돌려
 * 각 사건 직전의 공개 상태를 만든다 (games/lib/shell.ts의 GameUI.rewind).
 *
 * out[i] = events[i]가 일어나기 직전의 화면. 차례 표시(turn)는 그 사건을 하는 자리.
 * prev = 지금 화면에 보이는 (events가 일어나기 전) 공개 상태. 앞 베팅 라운드의 베팅액·마지막 행동 표시를 맞추는 데만 쓴다.
 * 되돌릴 수 없는 모양(판 시작의 앤티·첫 카드 등)이면 예외를 던진다 (화면은 그때 예전 방식: 말풍선 → 새 상태).
 */
import type { GameEvent } from './engine.ts';
import { evaluateOpen, type PokerPhase, type PokerPublic } from './poker.ts';

const BETS = new Set(['check', 'bbing', 'call', 'ddadang', 'half', 'die']);
const LABEL: Record<string, string> = { check: '체크', bbing: '삥', call: '콜', ddadang: '따당', half: '하프', die: '다이' };

export function rewindPoker(next: PokerPublic, events: readonly GameEvent[], prev?: PokerPublic | null): PokerPublic[] {
  const out: PokerPublic[] = new Array(events.length);
  let cur = next;
  for (let i = events.length - 1; i >= 0; i--) {
    cur = JSON.parse(JSON.stringify(cur)) as PokerPublic;
    undo(cur, events, i, prev ?? null);
    out[i] = cur;
  }
  return out;
}

function undo(p: PokerPublic, events: readonly GameEvent[], i: number, prev: PokerPublic | null) {
  const e = events[i];
  const fail = (): never => {
    throw new Error(`되돌릴 수 없는 사건: ${e.t}`);
  };
  const seat = typeof e.seat === 'number' ? p.seats.find((x) => x.seat === e.seat) : undefined;
  const need = () => seat ?? fail();
  const amount = typeof e.amount === 'number' ? e.amount : 0;
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
  p.actions = [];
  p.summary = null;

  if (BETS.has(e.t)) {
    const s = need();
    if (e.t === 'die') s.folded = false;
    else {
      s.betRound -= amount;
      s.total -= amount;
      p.pot -= amount;
      if (s.betRound < 0 || s.total < 0) fail();
    }
    s.last = lastBefore(s.seat);
    p.curBet = curBet();
    p.phase = `bet${p.round}` as PokerPhase;
    p.turn = s.seat;
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
      p.phase = `bet${p.round}` as PokerPhase;
      p.turn = null;
      return;
    case 'allin': {
      // 앤티 올인(판 시작)은 되돌리지 않는다
      const before = events[i - 1];
      if (!before || before.seat !== e.seat || !BETS.has(before.t)) fail();
      const s = need();
      s.allIn = false;
      s.last = LABEL[before.t];
      p.turn = null;
      return;
    }
    case 'deal': {
      const r = typeof e.round === 'number' ? e.round : 0;
      if (r < 4 || r !== p.round) fail();
      const s = need();
      if (e.hidden) {
        s.hiddenCount -= 1;
        if (s.hiddenCount < 0) fail();
      } else {
        if (s.open.pop() !== e.card) fail();
        s.openLabel = evaluateOpen(s.open)?.name ?? null;
      }
      p.phase = `bet${r}` as PokerPhase;
      p.turn = null;
      p.showdown = null;
      p.winners = [];
      const before = events[i - 1];
      const first = !before || before.t !== 'deal' || before.round !== r;
      if (first && r > 4) {
        // 이 구의 첫 카드 전 = 앞 구 베팅이 끝난 화면
        p.round = r - 1;
        p.phase = `bet${r - 1}` as PokerPhase;
        const inWindow = new Map<number, number>();
        let whole = false;
        for (let j = i - 1; j >= 0; j--) {
          const x = events[j];
          if (x.t === 'deal' || x.t === 'reveal') {
            whole = true;
            break;
          }
          if (BETS.has(x.t) && typeof x.seat === 'number' && typeof x.amount === 'number') inWindow.set(x.seat, (inWindow.get(x.seat) ?? 0) + x.amount);
        }
        const base = !whole && prev && prev.round === r - 1 && prev.phase === p.phase ? prev : null;
        for (const x of p.seats) x.betRound = (base?.seats.find((y) => y.seat === x.seat)?.betRound ?? 0) + (inWindow.get(x.seat) ?? 0);
      } else for (const x of p.seats) x.betRound = 0;
      p.curBet = curBet();
      return;
    }
    case 'reveal':
      if (p.round !== 4) fail();
      p.phase = 'choose';
      p.round = 3;
      p.turn = null;
      p.curBet = 0;
      for (const s of p.seats) {
        if (s.excluded) continue;
        if (s.open.length !== 1 || s.hiddenCount !== 2) fail();
        s.open = [];
        s.openLabel = null;
        s.hiddenCount = 3;
        s.chosen = true;
      }
      return;
    case 'choose': {
      if (p.phase !== 'choose') fail();
      const s = need();
      s.chosen = false;
      s.hiddenCount = 4;
      return;
    }
    default:
      fail();
  }
}
