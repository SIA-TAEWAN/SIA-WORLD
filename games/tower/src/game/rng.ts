/** 씨앗 난수 (mulberry32). 시뮬레이션·층 생성의 모든 난수는 이것으로 (같은 씨앗 = 같은 결과) */
export interface Rng {
  /** 0 이상 1 미만 */
  next(): number;
  /** min 이상 max 이하 정수 */
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  /** 지금 상태 (저장·복원용) */
  state(): number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    state: () => s,
  };
}

/** 숫자 여러 개 → 씨앗 하나 */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    let v = Math.floor(p) >>> 0;
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      v >>>= 8;
    }
  }
  return h >>> 0;
}
