/** 시드 Rng (mulberry32). 상태는 정수 하나라 판 상태(JSON)에 그대로 들어간다 */
export function nextRandom(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** 시드(아무 정수) → 처음 Rng 상태 */
export function seedState(seed: number): number {
  return (Math.floor(Math.abs(seed)) % 4294967296) | 0;
}
