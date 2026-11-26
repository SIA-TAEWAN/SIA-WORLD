/**
 * 시아카드배틀 씨앗 난수 (mulberry32). 규칙 코드의 모든 무작위는 이것으로만 뽑는다.
 * 상태가 숫자 하나라 판 상태(JSON)에 그대로 들어가고, 저장·복원·서버 재실행에서 같은 값이 나온다.
 * 정수 연산(Math.imul · >>>)만 쓰므로 Deno(V8)와 Safari(JavaScriptCore)에서 비트 단위로 같다.
 */

/** 한 걸음: 상태 → [다음 상태, 0 이상 1 미만 값] */
export function rngStep(s: number): [number, number] {
  const n = (s + 0x6d2b79f5) >>> 0;
  let t = n;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [n, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** 상태를 담은 객체(JSON)를 받아 쓰는 난수 — 뽑을 때마다 obj[key] 가 바뀐다 */
export class Rng {
  constructor(
    private readonly box: Record<string, number>,
    private readonly key: string,
  ) {}
  next(): number {
    const [s, v] = rngStep(this.box[this.key] >>> 0);
    this.box[this.key] = s;
    return v;
  }
  /** min 이상 max 이하 정수 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  /** 확률 p (0~1) */
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
  /** 가중치 [값, 무게] 목록에서 하나 */
  weighted<T>(list: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of list) total += w;
    let r = this.next() * total;
    for (const [v, w] of list) {
      r -= w;
      if (r < 0) return v;
    }
    return list[list.length - 1][0];
  }
  /** 제자리 섞기 (Fisher–Yates). sort(() => rng - 0.5) 는 엔진마다 달라 쓰지 않는다 */
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }
}

/** 숫자·글자 여러 개 → 씨앗 하나 (FNV-1a) */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  const mix = (b: number) => {
    h ^= b & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const p of parts) {
    if (typeof p === 'string') {
      for (let i = 0; i < p.length; i++) {
        const c = p.charCodeAt(i);
        mix(c);
        mix(c >>> 8);
      }
      mix(0x1f);
    } else {
      let v = Math.floor(p) >>> 0;
      for (let i = 0; i < 4; i++) {
        mix(v);
        v >>>= 8;
      }
    }
  }
  return h >>> 0;
}
