/**
 * 하늘 색 (PRD 14장: 실제 시간에 맞춰 낮 · 저녁 · 밤). 시각은 서버 시각을 한국 시간으로 본다.
 * 마을 위에 곱하기(multiply)로 덮는 색과 진하기, 등불 빛의 세기(0 ~ 1)를 시간 사이에서 부드럽게 바꾼다.
 */
export type Phase = 'day' | 'evening' | 'night';
export interface Sky {
  phase: Phase;
  color: number;
  alpha: number;
  glow: number;
}

/** [한국 시각(시), 덮는 색, 진하기, 등불] — 하루를 한 바퀴 돈다 */
const KEYS: [number, number, number, number][] = [
  [0, 0x3a4890, 0.62, 1],
  [5, 0x3a4890, 0.62, 1],
  [6, 0xffc4a0, 0.24, 0.4],
  [7, 0xffffff, 0, 0],
  [17, 0xffffff, 0, 0],
  [18, 0xffb070, 0.28, 0.3],
  [19, 0x7a68a8, 0.5, 0.8],
  [20, 0x3a4890, 0.62, 1],
  [24, 0x3a4890, 0.62, 1],
];

const mix = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** 한국 시각 (0 ~ 24, 소수) */
export const kstHour = (ms: number) => ((((ms / 3600_000 + 9) % 24) + 24) % 24);

export function skyAt(hour: number): Sky {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, c0, a0, g0] = KEYS[i];
  const [h1, c1, a1, g1] = KEYS[i + 1];
  const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
  const glow = g0 + (g1 - g0) * t;
  const alpha = a0 + (a1 - a0) * t;
  return { phase: glow >= 0.5 ? 'night' : alpha > 0.05 ? 'evening' : 'day', color: mix(c0, c1, t), alpha, glow };
}
