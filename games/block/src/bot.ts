/**
 * 자동 플레이 (시험 · 손맛 맞추기용). 놓을 수 있는 모든 (조각, 자리) 가운데
 * 지우는 줄이 많고, 판에 고립된 빈 칸이 적고, 판이 덜 찬 쪽을 고른다. noise 가 크면 사람처럼 가끔 덜 좋은 수를 둔다.
 */
import { canPlace, fitsAnywhere, place, shapeOf, SHAPES, SIZE, type BlockState, type Move } from './rules.ts';

/** 큰 조각이 들어갈 자리가 남았는지 (남겨 두면 좋다) */
const BIG = ['sq3', 'h5', 'v5', 'l5a', 'l5c'].map(id => SHAPES.find(s => s.id === id)!);
const BIG_W = [14, 7, 7, 4, 4];

function holes(b: readonly number[]): number {
  let n = 0;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (b[r * SIZE + c]) continue;
    let walls = 0;
    if (r === 0 || b[(r - 1) * SIZE + c]) walls++;
    if (r === SIZE - 1 || b[(r + 1) * SIZE + c]) walls++;
    if (c === 0 || b[r * SIZE + c - 1]) walls++;
    if (c === SIZE - 1 || b[r * SIZE + c + 1]) walls++;
    if (walls >= 3) n++;
  }
  return n;
}
function filled(b: readonly number[]): number { let n = 0; for (const v of b) if (v) n++; return n; }

export function botMove(st: BlockState, rand: () => number = Math.random, noise = 0): Move | null {
  let best: Move | null = null, bestScore = -Infinity;
  st.tray.forEach((p, slot) => {
    if (!p) return;
    const sh = shapeOf(p);
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      if (!canPlace(st.board, sh, r, c)) continue;
      const { state, ev } = place(st, slot, r, c);
      let s = (ev.rows.length + ev.cols.length) * 30 + ev.gain * 0.01 - holes(state.board) * 6 - filled(state.board) * 0.6;
      BIG.forEach((b, i) => { if (fitsAnywhere(state.board, b)) s += BIG_W[i]; });
      if (state.over) s -= 1000;
      // 남은 조각이 이 놓기 때문에 못 들어가게 되면 크게 뺀다 (사람도 셋의 순서를 본다)
      if (!ev.dealt) for (const q of state.tray) if (q && !fitsAnywhere(state.board, shapeOf(q))) s -= 200;
      s += noise * rand() * 20;
      if (s > bestScore) { bestScore = s; best = [slot, r, c]; }
    }
  });
  return best;
}

/** 시드부터 끝날 때까지 자동으로 둔다 */
export function botGame(seed: number, newGame: (seed: number) => BlockState, noise = 0, maxMoves = 3000): { state: BlockState; moves: Move[] } {
  let st = newGame(seed);
  const moves: Move[] = [];
  let a = (seed * 7 + 3) & 0x7fffffff;
  const rand = () => { a = (Math.imul(a, 1103515245) + 12345) & 0x7fffffff; return a / 0x7fffffff; };
  while (!st.over && moves.length < maxMoves) {
    const m = botMove(st, rand, noise);
    if (!m) break;
    moves.push(m);
    st = place(st, m[0], m[1], m[2]).state;
  }
  return { state: st, moves };
}
