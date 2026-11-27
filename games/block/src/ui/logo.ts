// 메인 화면 그림: 정령 블록 몇 개가 쌓인 모습 (코드 그림, 한 번만 그린다)
import { tile } from './tiles.ts';

/** [줄, 칸, 정령] — 작은 테트로미노 탑 */
const ART: [number, number, number][] = [
  [0, 3, 3],
  [1, 2, 0], [1, 3, 3], [1, 4, 8],
  [2, 0, 1], [2, 1, 1], [2, 2, 0], [2, 4, 8], [2, 5, 4], [2, 6, 4],
  [3, 0, 1], [3, 1, 6], [3, 2, 6], [3, 3, 7], [3, 4, 7], [3, 5, 4], [3, 6, 2],
];

export function drawLogo(cv: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 220, H = cv.clientHeight || 120;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const x = cv.getContext('2d')!;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = Math.min(W / 7.4, H / 4.2);
  const ox = (W - 7 * s) / 2, oy = H - 4 * s - 2;
  // 이미지가 준비되는 대로 (글꼴과 상관없이 코드로 그린다)
  for (const [r, c, sp] of ART) x.drawImage(tile(sp, s, dpr), ox + c * s, oy + r * s, s, s);
}
