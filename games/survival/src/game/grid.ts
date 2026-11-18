/**
 * 충돌용 격자 (공간 해시). 내 캐릭터를 가운데 둔 고정 크기 격자에 적을 칸별로 나눠 담아,
 * "이 원 근처의 적" 을 전부 훑지 않고 찾는다. 걸음마다 다시 채우며, 배열은 처음 한 번만 만든다.
 */
const CELL = 64;
const COLS = 44;
const ROWS = 60;
/** 찾을 때 더 넓게 보는 여유: 가장 큰 적(보스)의 반지름 */
const PAD = 72;

interface Body {
  x: number;
  y: number;
}

export class Grid {
  readonly cell = CELL;
  readonly cols = COLS;
  readonly rows = ROWS;
  /** 칸 c 의 적은 items[start[c] .. start[c+1]) */
  readonly start = new Int32Array(COLS * ROWS + 1);
  readonly items: Int32Array;
  private readonly cellOf: Int32Array;
  private readonly fill = new Int32Array(COLS * ROWS);
  private ox = 0;
  private oy = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  private col(x: number) {
    const c = Math.floor((x - this.ox) / CELL);
    return c < 0 ? 0 : c >= COLS ? COLS - 1 : c;
  }
  private row(y: number) {
    const r = Math.floor((y - this.oy) / CELL);
    return r < 0 ? 0 : r >= ROWS ? ROWS - 1 : r;
  }

  /** 적 n마리를 칸에 나눠 담는다 (cx, cy: 격자의 가운데 = 내 캐릭터 자리) */
  build(list: readonly Body[], n: number, cx: number, cy: number) {
    this.ox = Math.floor(cx / CELL) * CELL - (COLS / 2) * CELL;
    this.oy = Math.floor(cy / CELL) * CELL - (ROWS / 2) * CELL;
    const { start, fill, cellOf, items } = this;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.row(list[i].y) * COLS + this.col(list[i].x);
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < COLS * ROWS; c++) start[c + 1] += start[c];
    fill.fill(0);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      items[start[c] + fill[c]++] = i;
    }
  }

  /** 원(x, y, r) 근처 칸에 든 적의 번호를 out 에 담고 개수를 돌려준다 (정확한 거리 판정은 부르는 쪽에서) */
  query(x: number, y: number, r: number, out: Int32Array): number {
    const c0 = this.col(x - r - PAD);
    const c1 = this.col(x + r + PAD);
    const r0 = this.row(y - r - PAD);
    const r1 = this.row(y + r + PAD);
    const { start, items } = this;
    let n = 0;
    for (let row = r0; row <= r1; row++) {
      const a = start[row * COLS + c0];
      const b = start[row * COLS + c1 + 1];
      for (let k = a; k < b && n < out.length; k++) out[n++] = items[k];
    }
    return n;
  }
}
