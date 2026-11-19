/**
 * 혼자 하는 판(사람 1명 + AI)을 기기에서 진행하기 위한 공용 도우미.
 *
 * 서버(Runner)와 화면(브라우저)이 **같은 함수**로 한 걸음씩 진행한다 → 사람이 한 행동 목록이 같으면 결과가 완전히 같다.
 * 그래서 화면은 판이 끝났을 때(또는 접속이 끊길 때) 사람 행동 목록만 보내고, 서버가 그대로 다시 두어 보고 정산한다.
 *
 * 상태에 `solo: { seed, n }` 을 싣는다. seed 는 판마다 서버가 정한 값, n 은 지금까지 적용한 행동 수(사람 + AI).
 * 걸음마다 난수는 (seed, n) 으로만 정해진다: AI 결정도, 엔진이 쓰는 난수도 같은 걸음이면 언제 어디서 돌려도 같다.
 *
 * engine.ts 규격대로 순수 TS (Deno·Node·브라우저 공용). 상대 import 는 `.ts` 까지 쓴다.
 */
import { seededRng } from './engine.ts';
import type { Engine, Rng } from './engine.ts';

export interface SoloInfo {
  /** 판마다 서버가 정한 값 (0 이상 2^32 미만 정수) */
  seed: number;
  /** 지금까지 적용한 행동 수 (사람 + AI) */
  n: number;
  /** 사람 둘이 시작한 판 (상대가 나가 혼자 남아도 '버려진 혼자 하는 판'으로 보지 않는다) */
  duo?: boolean;
}

/** 상태에 실린 solo 칸 (없거나 모양이 틀리면 null) */
export function soloOf(state: unknown): SoloInfo | null {
  const s = (state as { solo?: unknown } | null | undefined)?.solo as Partial<SoloInfo> | null | undefined;
  if (!s || typeof s !== 'object') return null;
  if (!Number.isInteger(s.seed) || !Number.isInteger(s.n) || (s.n as number) < 0) return null;
  return s.duo === true ? { seed: s.seed as number, n: s.n as number, duo: true } : { seed: s.seed as number, n: s.n as number };
}

/** (seed, n) → 그 걸음의 난수. 정수 연산만 써서 어느 실행 환경에서도 같은 값이 나온다 */
export function soloRng(solo: SoloInfo): Rng {
  let h = (solo.seed ^ Math.imul(solo.n + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return seededRng(h);
}

// deno-lint-ignore no-explicit-any
type AnyEngine<S, A> = Engine<S, A, any, any, any>;

/**
 * 한 걸음: seat 자리의 행동 하나를 적용하고 solo.n 을 1 늘린 새 상태를 돌려준다.
 * action 이 null 이면 그 자리의 AI 가 정한다 (그 자리에서 볼 수 있는 정보만 받는다). 규칙 위반은 EngineError.
 */
export function soloStep<S, A>(engine: AnyEngine<S, A>, state: S, seat: number, action: A | null): S {
  const solo = soloOf(state);
  if (!solo) throw new Error('solo 상태가 아닙니다');
  const rng = soloRng(solo);
  let a = action;
  if (a === null) {
    const v = engine.view(state);
    a = engine.ai(v.public, v.private[seat], seat, rng) as A;
  }
  const next = engine.apply(state, seat, a, rng);
  return { ...next, solo: solo.duo ? { seed: solo.seed, n: solo.n + 1, duo: true } : { seed: solo.seed, n: solo.n + 1 } } as S;
}

/** AI 자리 차례를 사람 차례(또는 판 끝)까지 이어서 둔다. isAuto(seat): 사람이 직접 두지 않는 자리인가 */
export function soloRunAi<S, A>(engine: AnyEngine<S, A>, state: S, isAuto: (seat: number) => boolean, maxSteps = 5000): S {
  let s = state;
  for (let i = 0; i < maxSteps && !engine.done(s); i++) {
    const seat = engine.pending(s).find(isAuto);
    if (seat === undefined) return s;
    s = soloStep(engine, s, seat, null);
  }
  return s;
}
