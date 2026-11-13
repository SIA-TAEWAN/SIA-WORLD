export const MAP_W = 1600;
export const MAP_H = 800;

/** 픽셀마다 땅(1)/빈 공간(0)을 저장하는 비트맵 지형 */
export class Terrain {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w = MAP_W, h = MAP_H, data?: Uint8Array) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Uint8Array(w * h);
  }

  clone(): Terrain {
    return new Terrain(this.w, this.h, new Uint8Array(this.data));
  }

  solid(x: number, y: number): boolean {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || ix >= this.w || iy < 0 || iy >= this.h) return false;
    return this.data[iy * this.w + ix] === 1;
  }

  set(x: number, y: number, v: 0 | 1): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    this.data[y * this.w + x] = v;
  }

  /** 원 모양으로 깎거나(0) 쌓는다(1). 바뀐 영역을 돌려준다. */
  circle(cx: number, cy: number, r: number, v: 0 | 1): void {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const row = y * this.w;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= r2) this.data[row + x] = v;
      }
    }
  }

  carve(cx: number, cy: number, r: number): void {
    this.circle(cx, cy, r, 0);
  }

  /** 두 점 사이를 굵기 r로 깎는다 (레이저, 드릴 굴) */
  carveLine(x1: number, y1: number, x2: number, y2: number, r: number): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.carve(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r);
    }
  }

  /** x 열에서 y부터 아래로 처음 만나는 땅의 y. 없으면 -1 */
  groundBelow(x: number, y: number): number {
    const ix = x | 0;
    if (ix < 0 || ix >= this.w) return -1;
    for (let yy = Math.max(0, y | 0); yy < this.h; yy++) {
      if (this.data[yy * this.w + ix]) return yy;
    }
    return -1;
  }

  /** 맨 위 지표면 y. 없으면 -1 */
  surface(x: number): number {
    return this.groundBelow(x, 0);
  }

  /** 지형 표면의 바깥쪽 법선 (탄 튕김용) */
  normal(x: number, y: number): { nx: number; ny: number } {
    let nx = 0;
    let ny = 0;
    const R = 5;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        if (this.solid(x + dx, y + dy)) {
          nx -= dx;
          ny -= dy;
        }
      }
    }
    const l = Math.hypot(nx, ny);
    if (l < 1e-6) return { nx: 0, ny: -1 };
    return { nx: nx / l, ny: ny / l };
  }
}
