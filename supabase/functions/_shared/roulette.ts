/**
 * 십이지신 룰렛 규칙 엔진 (AI 없음, 최대 8명).
 *
 * ## 휠 (시계 방향, 칸 번호 0~11)
 * 쥐(0) 소(1) 호랑이(2) 토끼(3) 용(4) 뱀(5) 말(6) 양(7) 원숭이(8) 닭(9) 개(10) 돼지(11)
 * 계절: 봄 = 호랑이·토끼·용, 여름 = 뱀·말·양, 가을 = 원숭이·닭·개, 겨울 = 돼지·쥐·소 (휠에서 이웃한 세 칸)
 * 음양: 양 = 쥐·호랑이·용·말·원숭이·개 (짝수 칸), 음 = 소·토끼·뱀·양·닭·돼지 (홀수 칸)
 *
 * ## 베팅 (건 금액 포함 돌려받는 배수)
 * zodiac(띠 하나) ×12 · pair(이웃 두 칸: target과 target+1, 돼지-쥐 포함) ×6 · season ×4 · yinyang ×2
 * 한 곳 최소 = 기본 단위 (기본 단위의 배수만), 한 스핀 총액 ≤ 기본 단위 ×100.
 *
 * ## 진행 (한 '판' = 레디 뒤 이어지는 여러 스핀)
 * bet: 사람마다 한 번 확정(아무것도 안 걸어도 확정). 모두 확정하거나 마감(betMs)이 지나면 결과를 정한다.
 * spin: 휠 회전·결과 표시(spinMs). 지나면 다음 스핀의 bet (그때 자리에 있는 사람으로 다시 꾸린다).
 * 3스핀 연속 아무도 안 걸었거나 사람이 없으면 판이 끝난다(다시 레디 대기).
 *
 * ## 돈
 * 칩은 확정할 때 서버(SQL roulette_place_bet)가 먼저 빼고, 결과가 나오면 SQL roulette_pay가 기록(roulette_bets) 기준으로 지급한다.
 * 그래서 settle()의 정산값은 모두 0이다. 엔진은 화면 표시와 규칙 검사만 한다.
 */
import { clone, EngineError, type Engine, type GameEvent, type Rng, type RoundInput, type SeatInfo, type Settlement, type View } from './engine.ts';

// ───────────────────────── 휠 ─────────────────────────

export const WHEEL = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig'] as const;
export const SEASONS = ['봄', '여름', '가을', '겨울'] as const;
/** 계절 t의 세 칸 */
export const seasonCells = (t: number) => [(2 + 3 * t) % 12, (3 + 3 * t) % 12, (4 + 3 * t) % 12];
export type BetKind = 'zodiac' | 'pair' | 'season' | 'yinyang';
export const MULT: Record<BetKind, number> = { zodiac: 12, pair: 6, season: 4, yinyang: 2 };
/** yinyang target: 0 = 양(짝수 칸), 1 = 음(홀수 칸) */
export interface RBet {
  kind: BetKind;
  target: number;
  amount: number;
}

/** 이 베팅이 결과 칸에 맞는가 */
export function hits(b: Pick<RBet, 'kind' | 'target'>, result: number): boolean {
  switch (b.kind) {
    case 'zodiac':
      return b.target === result;
    case 'pair':
      return result === b.target || result === (b.target + 1) % 12;
    case 'season':
      return seasonCells(b.target).includes(result);
    case 'yinyang':
      return result % 2 === b.target;
  }
}

/** 받는 돈 (건 금액 포함) */
export const payoutOf = (bets: RBet[], result: number) => bets.reduce((a, b) => a + (hits(b, result) ? b.amount * MULT[b.kind] : 0), 0);

const TARGETS: Record<BetKind, number> = { zodiac: 12, pair: 12, season: 4, yinyang: 2 };

/** 베팅 목록 검사 + 같은 칸 합치기 → 정리된 목록 */
export function normalizeBets(raw: unknown, baseUnit: number): RBet[] {
  if (!Array.isArray(raw)) throw new EngineError('베팅이 잘못되었습니다');
  if (raw.length > 60) throw new EngineError('베팅이 너무 많습니다');
  const m = new Map<string, RBet>();
  for (const x of raw) {
    const b = x as Partial<RBet>;
    // 자기 속성만 (constructor·__proto__ 같은 이름이 통과하지 않게)
    if (!b || typeof b !== 'object' || typeof b.kind !== 'string' || !Object.prototype.hasOwnProperty.call(MULT, b.kind)) throw new EngineError('베팅 종류가 잘못되었습니다');
    const target = Number(b.target);
    const amount = Number(b.amount);
    if (!Number.isInteger(target) || target < 0 || target >= TARGETS[b.kind as BetKind]) throw new EngineError('베팅 칸이 잘못되었습니다');
    if (!Number.isInteger(amount) || amount < baseUnit || amount % baseUnit !== 0) throw new EngineError(`한 곳에 ${baseUnit}의 배수로 걸어야 합니다`);
    const key = `${b.kind}:${target}`;
    const cur = m.get(key);
    if (cur) cur.amount += amount;
    else m.set(key, { kind: b.kind as BetKind, target, amount });
  }
  return [...m.values()];
}

// ───────────────────────── 타입 ─────────────────────────

export type RoulettePhase = 'bet' | 'spin' | 'done';
/** bet: 베팅 확정 · next: 결과를 보고 '확인' (모두 확인하면 다음 스핀) */
export type RouletteAction = { type: 'bet'; bets: RBet[] } | { type: 'next' };

export interface RouletteCarry {
  /** 최근 결과 (최신이 끝) */
  history: number[];
}

export interface RPlayer {
  seat: number;
  name: string;
}

export interface RouletteState {
  phase: RoulettePhase;
  baseUnit: number;
  maxTotal: number;
  /** 몇 번째 스핀 (판 안에서 1부터) */
  spin: number;
  /** 이번 스핀에 걸 수 있는 사람 (스핀 시작 때 자리에 있던 사람) */
  players: RPlayer[];
  confirmed: number[];
  /** 결과를 보고 '확인'을 누른 자리 (회전·결과 단계) */
  acked?: number[];
  bets: Record<string, RBet[]>;
  result: number | null;
  /** 이번 스핀 받은 돈 (자리별, 건 금액 포함) */
  wins: Record<string, number>;
  history: number[];
  /** 아무도 안 건 스핀 연속 횟수 */
  idle: number;
  /** 단계 마감 시각 (ms, 서버가 찍는다) */
  endsAt: number | null;
  stopReason: 'idle' | 'empty' | null;
  events: GameEvent[];
  nextEventId: number;
}

export interface RoulettePublic {
  phase: RoulettePhase;
  baseUnit: number;
  maxTotal: number;
  spin: number;
  players: RPlayer[];
  confirmed: number[];
  /** 결과를 확인한 자리 */
  acked: number[];
  /** 확정한 사람의 베팅 (자리 → 목록) */
  bets: Record<string, RBet[]>;
  /** 이번 스핀 결과 칸 (공개 상태의 result는 판 정산 요약 자리라 이름을 따로 쓴다) */
  landed: number | null;
  wins: Record<string, number>;
  history: number[];
  idle: number;
  endsAt: number | null;
  /** 회전 시간 (화면이 같은 칸에 멈추게) */
  spinMs: number;
  stopReason: 'idle' | 'empty' | null;
  events: GameEvent[];
}

export const BET_MS = 20_000;
/** 회전·결과 단계 길이: 휠이 도는 시간(약 6초) + 결과를 보고 '확인'을 누를 시간. 모두 확인하면 바로 넘어간다 */
export const SPIN_MS = 30_000;
const HISTORY = 20;
const IDLE_STOP = 3;
const EVENT_KEEP = 30;

function emit(s: RouletteState, t: string, extra: Record<string, unknown> = {}): void {
  s.events.push({ id: s.nextEventId++, t, ...extra });
  if (s.events.length > EVENT_KEEP) s.events.splice(0, s.events.length - EVENT_KEEP);
}

const humans = (seats: SeatInfo[]) => seats.filter((x) => x.kind === 'human').map((x) => ({ seat: x.seat, name: x.name }));

function startBet(s: RouletteState, players: RPlayer[]): void {
  s.phase = 'bet';
  s.spin += 1;
  s.players = players;
  s.confirmed = [];
  s.acked = [];
  s.bets = {};
  s.result = null;
  s.wins = {};
  s.endsAt = null;
  emit(s, 'bet_open', { spin: s.spin });
}

function resolve(s: RouletteState, rng: Rng): void {
  const result = rng.int(12);
  s.result = result;
  s.history = [...s.history, result].slice(-HISTORY);
  const anyBet = Object.values(s.bets).some((b) => b.length > 0);
  s.idle = anyBet ? 0 : s.idle + 1;
  s.wins = {};
  for (const [seat, bets] of Object.entries(s.bets)) {
    const w = payoutOf(bets, result);
    if (w > 0) s.wins[seat] = w;
  }
  s.phase = 'spin';
  s.acked = [];
  s.endsAt = null;
  emit(s, 'spin', { spin: s.spin, result, animal: WHEEL[result] });
  for (const [seat, w] of Object.entries(s.wins)) emit(s, 'win', { seat: Number(seat), amount: w });
}

// ───────────────────────── 엔진 ─────────────────────────

export const roulette: Engine<RouletteState, RouletteAction, RouletteCarry, RoulettePublic, Record<string, never>> & {
  timerMs(s: RouletteState): number | null;
  deadlineAt(s: RouletteState): number | null;
  stamp(s: RouletteState, now: number): RouletteState;
  tick(s: RouletteState, rng: Rng, seats: SeatInfo[]): RouletteState;
  tickNow(s: RouletteState): boolean;
  charge(s: RouletteState, seat: number, action: RouletteAction): { spin: number; bets: RBet[]; total: number } | null;
  spinResult(s: RouletteState): { spin: number; result: number } | null;
  betSpin(s: RouletteState): number | null;
  adoptBets(s: RouletteState, rows: { seat: number; bets: unknown }[], rng: Rng): RouletteState;
  redundant(s: RouletteState | null, seat: number, action: RouletteAction): boolean;
} = {
  game: 'roulette',

  newRound(input: RoundInput<RouletteCarry>): RouletteState {
    const { baseUnit } = input;
    if (!(baseUnit > 0)) throw new EngineError('기본 단위가 잘못되었습니다');
    const s: RouletteState = {
      phase: 'bet',
      baseUnit,
      maxTotal: baseUnit * 100,
      spin: 0,
      players: [],
      confirmed: [],
      bets: {},
      result: null,
      wins: {},
      history: Array.isArray(input.carry?.history) ? input.carry!.history.filter((x) => Number.isInteger(x) && x >= 0 && x < 12).slice(-HISTORY) : [],
      idle: 0,
      endsAt: null,
      stopReason: null,
      events: [],
      nextEventId: 1,
    };
    const ps = humans(input.seats);
    if (!ps.length) {
      s.phase = 'done';
      s.stopReason = 'empty';
      return s;
    }
    startBet(s, ps);
    return s;
  },

  pending(s: RouletteState): number[] {
    // 회전·결과: 결과를 보고 '확인'을 누르지 않은 사람 (마감이 지나면 자동으로 확인)
    if (s.phase === 'spin') return s.players.filter((p) => !(s.acked ?? []).includes(p.seat)).map((p) => p.seat);
    if (s.phase !== 'bet') return [];
    return s.players.filter((p) => !s.confirmed.includes(p.seat)).map((p) => p.seat);
  },

  apply(s0: RouletteState, seat: number, action: RouletteAction, rng: Rng): RouletteState {
    if (s0.phase === 'spin') {
      // 결과 확인: 모두 확인하면 tickNow가 참이 되어 러너가 바로 다음 스핀을 연다
      // (마감 직후에 늦게 도착한 베팅 확정은 '확인'이 아니다)
      if (action && action.type === 'bet') throw new EngineError('베팅 시간이 끝났어요');
      if (!action || action.type !== 'next') throw new EngineError('지금은 결과를 확인할 차례입니다');
      if (!s0.players.some((p) => p.seat === seat)) throw new EngineError('이번 스핀에 참가하지 않은 자리입니다');
      if ((s0.acked ?? []).includes(seat)) throw new EngineError('이미 확인했습니다');
      const s = clone(s0);
      s.acked = [...(s.acked ?? []), seat];
      emit(s, 'ack', { seat });
      return s;
    }
    if (s0.phase !== 'bet') throw new EngineError('베팅 시간이 아닙니다');
    if (!s0.players.some((p) => p.seat === seat)) throw new EngineError('이번 스핀에 참가하지 않은 자리입니다 (다음 베팅부터)');
    if (s0.confirmed.includes(seat)) throw new EngineError('이미 확정했습니다');
    if (!action || action.type !== 'bet') throw new EngineError('잘못된 행동입니다');
    const bets = normalizeBets(action.bets, s0.baseUnit);
    const total = bets.reduce((a, b) => a + b.amount, 0);
    if (total > s0.maxTotal) throw new EngineError(`한 번에 ${s0.maxTotal}까지 걸 수 있습니다`);
    const s = clone(s0);
    s.confirmed.push(seat);
    if (bets.length) s.bets[String(seat)] = bets;
    emit(s, 'confirm', { seat, total });
    if (s.players.every((p) => s.confirmed.includes(p.seat))) resolve(s, rng);
    return s;
  },

  // AI는 없다: 나간 사람 자리는 걸지 않은 것으로 (결과 단계에서는 확인한 것으로)
  ai(pub: RoulettePublic): RouletteAction {
    return pub?.phase === 'spin' ? { type: 'next' } : { type: 'bet', bets: [] };
  },

  timeout(s: RouletteState): RouletteAction {
    return s?.phase === 'spin' ? { type: 'next' } : { type: 'bet', bets: [] };
  },

  done(s: RouletteState): boolean {
    return s.phase === 'done';
  },

  settle(s: RouletteState): Settlement<RouletteCarry> {
    if (s.phase !== 'done') throw new EngineError('아직 끝나지 않았습니다');
    // 돈은 스핀마다 SQL로 이미 오갔다
    return { deltas: {}, summary: { roulette: true, spins: s.spin, history: s.history.slice(), stopReason: s.stopReason }, carry: { history: s.history.slice() } };
  },

  view(s: RouletteState): View<RoulettePublic, Record<string, never>> {
    return {
      public: {
        phase: s.phase,
        baseUnit: s.baseUnit,
        maxTotal: s.maxTotal,
        spin: s.spin,
        players: clone(s.players),
        confirmed: s.confirmed.slice(),
        acked: (s.acked ?? []).slice(),
        bets: clone(s.bets),
        landed: s.result,
        wins: { ...s.wins },
        history: s.history.slice(),
        idle: s.idle,
        endsAt: s.endsAt,
        spinMs: SPIN_MS,
        stopReason: s.stopReason,
        events: clone(s.events),
      },
      private: {},
    };
  },

  /** 사람 차례가 아닐 때 다음 단계까지 남은 시간 (회전·결과) */
  timerMs(s: RouletteState): number | null {
    return s.phase === 'spin' ? SPIN_MS : null;
  },

  deadlineAt(s: RouletteState): number | null {
    return s.phase === 'done' ? null : s.endsAt;
  },

  /** 단계 마감 시각을 찍는다 (이미 찍혔으면 그대로 → 누가 확정해도 마감이 밀리지 않는다) */
  stamp(s0: RouletteState, now: number): RouletteState {
    if (s0.phase === 'done' || s0.endsAt !== null) return s0;
    const s = clone(s0);
    s.endsAt = now + (s.phase === 'bet' ? BET_MS : SPIN_MS);
    return s;
  },

  /** 회전·결과가 끝나면: 그만둘지, 다음 스핀 베팅을 열지 */
  tick(s0: RouletteState, _rng: Rng, seats: SeatInfo[]): RouletteState {
    if (s0.phase !== 'spin') return s0;
    const s = clone(s0);
    const ps = humans(seats);
    if (!ps.length || s.idle >= IDLE_STOP) {
      s.phase = 'done';
      s.stopReason = ps.length ? 'idle' : 'empty';
      s.endsAt = null;
      emit(s, 'stop', { reason: s.stopReason });
      return s;
    }
    startBet(s, ps);
    return s;
  },

  /** 모두 결과를 확인했다: 마감을 기다리지 않고 바로 다음 단계로 */
  tickNow(s: RouletteState): boolean {
    return s.phase === 'spin' && s.players.every((p) => (s.acked ?? []).includes(p.seat));
  },

  /** 확정 때 먼저 뺄 칩 (걸지 않았으면 null) */
  charge(s: RouletteState, _seat: number, action: RouletteAction) {
    if (s.phase !== 'bet' || !action || action.type !== 'bet') return null;
    const bets = normalizeBets(action.bets, s.baseUnit);
    const total = bets.reduce((a, b) => a + b.amount, 0);
    return total > 0 ? { spin: s.spin, bets, total } : null;
  },

  /** 결과가 나온 스핀 (지급할 것) */
  spinResult(s: RouletteState) {
    return s.result !== null && (s.phase === 'spin' || s.phase === 'done') ? { spin: s.spin, result: s.result } : null;
  },

  /** 베팅을 받는 중인 스핀 (러너가 이 스핀의 확정 기록을 읽는다) */
  betSpin(s: RouletteState) {
    return s?.phase === 'bet' ? s.spin : null;
  },

  /**
   * 기록(roulette_bets)에 남은 확정 베팅을 상태에 채운다 — 확정 요청이 칩을 뺀 뒤 마감 처리가 먼저 저장하면
   * 상태에는 '안 걸었다'로 남는다(돈은 기록 기준으로 지급되므로 맞다). 기록이 있는 자리는 확정한 것으로 본다.
   * 모두 확정되면 여기서 결과를 정한다 (apply 와 같은 흐름)
   */
  adoptBets(s0: RouletteState, rows: { seat: number; bets: unknown }[], rng: Rng): RouletteState {
    if (s0.phase !== 'bet') return s0;
    let s: RouletteState | null = null;
    for (const r of rows) {
      if (!s0.players.some((p) => p.seat === r.seat) || (s ?? s0).confirmed.includes(r.seat)) continue;
      let bets: RBet[];
      try {
        bets = normalizeBets(r.bets, s0.baseUnit);
      } catch {
        continue; // SQL 이 이미 검사한 기록이라 여기 올 일은 없다
      }
      if (!bets.length) continue;
      s ??= clone(s0);
      s.confirmed.push(r.seat);
      s.bets[String(r.seat)] = bets;
      emit(s, 'confirm', { seat: r.seat, total: bets.reduce((a, b) => a + b.amount, 0) });
    }
    if (!s) return s0;
    if (s.players.every((p) => s!.confirmed.includes(p.seat))) resolve(s, rng);
    return s;
  },

  /** 결과 '확인'이 이미 처리됐거나 단계가 넘어갔다 (여럿이 한꺼번에 누르면 늦게 온 것) → 조용히 받는다 */
  redundant(s: RouletteState | null, seat: number, action: RouletteAction) {
    if (!action || action.type !== 'next') return false;
    if (!s || s.phase !== 'spin') return true;
    return !s.players.some((p) => p.seat === seat) || (s.acked ?? []).includes(seat);
  },
};
