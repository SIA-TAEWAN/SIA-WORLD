/**
 * SIA WORLD 카드 게임 규칙 엔진 공통 규격 (맞고 · 세븐포커 · 블랙잭).
 *
 * - 순수 TypeScript. Deno(Edge Function)와 Node(vitest) 양쪽에서 돈다 → Deno·Node 전용 API 금지.
 *   상대 import는 반드시 `.ts` 확장자까지 쓴다 (Deno 규칙).
 * - 상태(S)는 JSON으로 저장할 수 있어야 한다 (함수·Map·Set·class 인스턴스·undefined 값 금지, 순수 객체/배열/숫자/문자열/불리언/null).
 *   상태는 서버(game_decks.meta)에만 저장되고 브라우저로는 view()의 결과만 간다.
 * - 엔진은 상태를 직접 고치지 말고 새 상태를 돌려준다 (structuredClone 후 수정해도 된다).
 * - 모든 난수는 인자로 받은 Rng만 쓴다 (Math.random 금지) → 테스트에서 시드로 재현 가능.
 * - 규칙 위반 행동은 EngineError를 던진다.
 */

export type SeatKind = 'human' | 'ai';

export interface SeatInfo {
  /** 자리 번호 (0부터) */
  seat: number;
  kind: SeatKind;
  /** 화면에 보일 이름 (닉네임 또는 "AI 호랑이") */
  name: string;
  /** 이번 판에 쓸 수 있는 최대 금액(지갑 잔액). null이면 무한(AI) */
  stack: number | null;
}

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** 0 이상 n 미만 정수 */
  int(n: number): number;
}

export interface RoundInput<C> {
  /** 이번 판 참가 자리 (자리 번호 순) */
  seats: SeatInfo[];
  /** 기본 단위 (100 / 500 / 1000) */
  baseUnit: number;
  /** 지난 판에서 넘어온 값 (첫 판이면 null). 예: 맞고의 선·나가리 배수, 블랙잭의 남은 슈 */
  carry: C | null;
  rng: Rng;
}

/** 화면에 보낼 것: public은 방 참가자 모두에게, private[seat]는 그 자리 사람에게만 */
export interface View<P = unknown, Q = unknown> {
  public: P;
  private: Record<number, Q>;
}

/** 화면 연출용 사건 (고, 뻑, 블랙잭 등). id는 판 안에서 1부터 늘어나는 번호 */
export interface GameEvent {
  id: number;
  /** 사건 종류 (예: 'go', 'stop', 'ppeok', 'bomb', 'blackjack', 'allin') */
  t: string;
  seat?: number;
  [k: string]: unknown;
}

export interface Settlement<C> {
  /** 자리별 지갑 증감 (AI 자리 값은 기록용, 지갑에는 반영 안 함). 사람 자리 손실은 stack을 넘지 않는다 */
  deltas: Record<number, number>;
  /** 결과 화면에 보여 줄 요약 (JSON) */
  summary: unknown;
  /** 다음 판으로 넘길 값 */
  carry: C;
}

export interface Engine<S, A, C = unknown, P = unknown, Q = unknown> {
  readonly game: 'matgo' | 'poker' | 'blackjack';
  /** 한 판 시작 (섞고 나누기) */
  newRound(input: RoundInput<C>): S;
  /** 지금 행동해야 하는 자리들. 비어 있으면 판이 끝났거나(done) 엔진이 스스로 진행할 차례가 없음 */
  pending(s: S): number[];
  /** 행동 적용. 규칙 위반이면 EngineError */
  apply(s: S, seat: number, action: A, rng: Rng): S;
  /** AI 행동 결정. 그 자리에서 볼 수 있는 정보(공개 + 자기 비공개)만 받는다 */
  ai(pub: P, priv: Q | undefined, seat: number, rng: Rng): A;
  /** 시간 초과 때 대신 할 행동 */
  timeout(s: S, seat: number, rng: Rng): A;
  /** 판이 끝났는가 */
  done(s: S): boolean;
  /** 정산 (done일 때만) */
  settle(s: S): Settlement<C>;
  /** 화면용 정보 */
  view(s: S): View<P, Q>;
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

/** 시드 난수 (테스트용). 서버는 crypto 기반 Rng를 쓴다 */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n) };
}

/** crypto.getRandomValues 기반 난수 (서버용) */
export function cryptoRng(): Rng {
  const buf = new Uint32Array(1);
  const next = () => {
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  };
  return {
    next,
    int: (n) => {
      // 치우침 없는 정수 (rejection sampling)
      const limit = Math.floor(4294967296 / n) * n;
      for (;;) {
        crypto.getRandomValues(buf);
        if (buf[0] < limit) return buf[0] % n;
      }
    },
  };
}

/** Fisher–Yates 섞기 (새 배열) */
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 깊은 복사 (상태는 JSON이므로 안전) */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
