/**
 * 캐릭터 미리보기 (DOM 캔버스): 레이어 4장(몸 → 얼굴 → 옷 → 머리)을 같은 칸에서 잘라 겹친다.
 * 캐릭터 만들기 화면과 처음 화면이 쓴다 (게임 화면은 Phaser 가 같은 시트를 쓴다).
 */
import { layerSheet } from '../art/load';
import { FRAME, frameIndex, layerNames, walkCol, COLS } from '../art/sheets';
import type { Look } from '../game/progress';

export async function lookLayers(look: Look): Promise<HTMLCanvasElement[]> {
  return Promise.all(layerNames(look).map(layerSheet));
}

/** 한 칸 그리기 (scale 배 정수 확대) */
export function drawFrame(cv: HTMLCanvasElement, layers: HTMLCanvasElement[], dir: number, col: number, scale: number) {
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  const f = frameIndex(dir, col);
  const sx = (f % COLS) * FRAME;
  const sy = Math.floor(f / COLS) * FRAME;
  const ox = Math.round((cv.width - FRAME * scale) / 2);
  const oy = Math.round((cv.height - FRAME * scale) / 2);
  for (const l of layers) g.drawImage(l, sx, sy, FRAME, FRAME, ox, oy, FRAME * scale, FRAME * scale);
}

/** 정지 그림 (아래를 보고 서 있는 모습) */
export async function stillImage(cv: HTMLCanvasElement, look: Look, scale: number, dir = 0) {
  drawFrame(cv, await lookLayers(look), dir, 0, scale);
}

/** 걸으며 도는 미리보기 (아래 → 오른쪽 → 위 → 왼쪽, 1.4초마다) */
export function makePreview(cv: HTMLCanvasElement, look: Look, scale: number) {
  let layers: HTMLCanvasElement[] | null = null;
  let want = 0;
  let raf = 0;
  const t0 = performance.now();
  const setLook = (l: Look) => {
    const my = ++want;
    void lookLayers(l).then((ls) => {
      if (my === want) layers = ls;
    });
  };
  const ORDER = [0, 2, 3, 1];
  const tick = (now: number) => {
    const t = (now - t0) / 1000;
    if (layers) drawFrame(cv, layers, ORDER[Math.floor(t / 1.4) % 4], walkCol(t), scale);
    raf = requestAnimationFrame(tick);
  };
  setLook(look);
  raf = requestAnimationFrame(tick);
  return {
    setLook,
    destroy: () => cancelAnimationFrame(raf),
  };
}
