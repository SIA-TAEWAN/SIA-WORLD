/**
 * 조각 모양과 나오는 비율 (돌릴 수 없음: 방향마다 다른 조각).
 * cells = [줄, 칸] (왼쪽 위가 0,0). w0 = 시작 비율, w1 = 점수가 RAMP_SCORE 이상일 때 비율.
 * 처음에는 작은 조각이 조금 많고, 점수가 오를수록 큰 조각이 조금씩 많아진다.
 */
export interface Shape {
  id: string;
  /** 종류 이름 (화면 · 시험에서만 씀) */
  kind: string;
  cells: readonly (readonly [number, number])[];
  w0: number;
  w1: number;
}

const bar = (n: number, vertical: boolean): [number, number][] =>
  Array.from({ length: n }, (_, i) => (vertical ? [i, 0] : [0, i]) as [number, number]);
const rect = (h: number, w: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out.push([r, c]);
  return out;
};

/** 비율 표: [시작, 나중] (한 방향 조각 하나의 몫) */
const W = {
  dot: [4, 2],
  bar2: [6, 3.5],
  bar3: [6, 4.5],
  bar4: [3.5, 4],
  bar5: [1.8, 3],
  sq2: [7, 5],
  sq3: [1.2, 2.6],
  rect: [2.2, 3],
  smallL: [4, 2.6],
  bigL: [0.9, 2],
  t: [1.4, 2.2],
  sz: [0.9, 1.8],
} as const;

const S = (id: string, kind: keyof typeof W, cells: [number, number][]): Shape => ({ id, kind, cells, w0: W[kind][0], w1: W[kind][1] });

export const SHAPES: readonly Shape[] = [
  S('dot', 'dot', [[0, 0]]),
  S('h2', 'bar2', bar(2, false)), S('v2', 'bar2', bar(2, true)),
  S('h3', 'bar3', bar(3, false)), S('v3', 'bar3', bar(3, true)),
  S('h4', 'bar4', bar(4, false)), S('v4', 'bar4', bar(4, true)),
  S('h5', 'bar5', bar(5, false)), S('v5', 'bar5', bar(5, true)),
  S('sq2', 'sq2', rect(2, 2)),
  S('sq3', 'sq3', rect(3, 3)),
  S('r23', 'rect', rect(2, 3)), S('r32', 'rect', rect(3, 2)),
  // 작은 ㄱ자 (3칸): 2×2 에서 한 칸 빠진 모양 4방향
  S('l3a', 'smallL', [[0, 0], [1, 0], [1, 1]]),
  S('l3b', 'smallL', [[0, 0], [0, 1], [1, 0]]),
  S('l3c', 'smallL', [[0, 0], [0, 1], [1, 1]]),
  S('l3d', 'smallL', [[0, 1], [1, 0], [1, 1]]),
  // 큰 ㄱ자 (5칸): 3×3 의 두 변 4방향
  S('l5a', 'bigL', [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]),
  S('l5b', 'bigL', [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]]),
  S('l5c', 'bigL', [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]),
  S('l5d', 'bigL', [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]]),
  // T자 (4칸) 4방향
  S('tu', 't', [[0, 1], [1, 0], [1, 1], [1, 2]]),
  S('td', 't', [[0, 0], [0, 1], [0, 2], [1, 1]]),
  S('tl', 't', [[0, 1], [1, 0], [1, 1], [2, 1]]),
  S('tr', 't', [[0, 0], [1, 0], [1, 1], [2, 0]]),
  // S·Z자 (4칸) 가로·세로
  S('sh', 'sz', [[0, 1], [0, 2], [1, 0], [1, 1]]),
  S('sv', 'sz', [[0, 0], [1, 0], [1, 1], [2, 1]]),
  S('zh', 'sz', [[0, 0], [0, 1], [1, 1], [1, 2]]),
  S('zv', 'sz', [[0, 1], [1, 0], [1, 1], [2, 0]]),
];

/** 조각의 줄 수 · 칸 수 */
export function shapeSize(s: Shape): { h: number; w: number } {
  let h = 0, w = 0;
  for (const [r, c] of s.cells) { h = Math.max(h, r + 1); w = Math.max(w, c + 1); }
  return { h, w };
}
