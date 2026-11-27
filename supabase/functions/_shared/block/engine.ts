/**
 * 시아블록 판 규칙 (순수 함수): 판 상태 + 놓기 → 새 판 상태.
 * 무작위는 상태 안의 시드 Rng(rng)로만 → 같은 시드 + 같은 놓기 기록이면 결과가 항상 같다 (서버 block-finish 가 다시 돌려 확인).
 * Deno 규칙: 상대 경로 + .ts 확장자.
 */
import { RAMP_SCORE, SCORE, SIZE, SPIRITS, TRAY } from './config.ts';
import { nextRandom, seedState } from './rng.ts';
import { SHAPES, type Shape } from './shapes.ts';

/** 아래에 나온 조각 하나: 모양 번호(SHAPES) + 정령 번호(SPIRITS, 색깔 역할만) */
export interface Piece {
  shape: number;
  spirit: number;
}

export interface BlockState {
  /** 판: SIZE×SIZE 칸, 0 = 빈 칸, 1~9 = 그 칸 정령(SPIRITS 번호 + 1) */
  board: number[];
  /** 아래 조각 3개 (놓은 자리는 null) */
  tray: (Piece | null)[];
  /** Rng 상태 */
  rng: number;
  score: number;
  /** 지금 콤보 (줄을 지운 놓기가 이어진 수. 0 = 없음) */
  combo: number;
  /** 마지막으로 줄을 지운 뒤 줄을 못 지운 놓기 수 */
  miss: number;
  /** 지운 줄 수 (모두) */
  lines: number;
  maxCombo: number;
  /** 놓은 횟수 */
  moves: number;
  /** 판 비우기 횟수 */
  perfects: number;
  /** 조각 3개를 새로 받은 횟수 · 자비 규칙으로 다시 뽑은 횟수 */
  deals: number;
  mercies: number;
  over: boolean;
}

/** 놓기 한 번에 일어난 일 (화면 연출용. 규칙에는 쓰지 않는다) */
export interface PlaceEvent {
  slot: number;
  r: number;
  c: number;
  spirit: number;
  /** 놓은 칸 [줄, 칸] */
  cells: [number, number][];
  /** 꽉 차서 지운 가로줄 · 세로줄 번호 */
  rows: number[];
  cols: number[];
  /** 지운 칸 (판 위 정령 번호 포함, 줄 순서대로) */
  cleared: { r: number; c: number; spirit: number }[];
  placePoints: number;
  linePoints: number;
  perfectPoints: number;
  gain: number;
  /** 이 놓기 뒤의 콤보 (줄을 못 지웠으면 이어지는 중인 값 그대로, 끊겼으면 0) */
  combo: number;
  /** 줄을 못 지운 놓기 때문에 콤보가 끊겼다 */
  comboBroken: boolean;
  perfect: boolean;
  /** 새 조각 3개를 받았다 · 그때 자비 규칙으로 다시 뽑았다 */
  dealt: boolean;
  mercy: boolean;
  over: boolean;
}

export class MoveError extends Error {}

const N = SIZE * SIZE;

export const shapeOf = (p: Piece): Shape => SHAPES[p.shape];

/** 이 모양을 (r, c)(왼쪽 위)에 놓을 수 있나 */
export function canPlace(board: readonly number[], shape: Shape, r: number, c: number): boolean {
  if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
  for (const [dr, dc] of shape.cells) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) return false;
    if (board[rr * SIZE + cc]) return false;
  }
  return true;
}

/** 판 어딘가에 놓을 수 있나 */
export function fitsAnywhere(board: readonly number[], shape: Shape): boolean {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (canPlace(board, shape, r, c)) return true;
  return false;
}

/** 놓았을 때 꽉 차는 가로줄 · 세로줄 (미리 보기용. 놓을 수 없으면 빈 목록) */
export function previewLines(board: readonly number[], shape: Shape, r: number, c: number): { rows: number[]; cols: number[] } {
  if (!canPlace(board, shape, r, c)) return { rows: [], cols: [] };
  const b = board.slice();
  for (const [dr, dc] of shape.cells) b[(r + dr) * SIZE + c + dc] = 1;
  return fullLines(b);
}

function fullLines(b: readonly number[]): { rows: number[]; cols: number[] } {
  const rows: number[] = [], cols: number[] = [];
  for (let i = 0; i < SIZE; i++) {
    let row = true, col = true;
    for (let j = 0; j < SIZE; j++) {
      if (!b[i * SIZE + j]) row = false;
      if (!b[j * SIZE + i]) col = false;
    }
    if (row) rows.push(i);
    if (col) cols.push(i);
  }
  return { rows, cols };
}

/** 동시에 지운 줄 수 → 줄 지우기 기본 점수 */
export function lineBase(n: number): number {
  if (n <= 0) return 0;
  if (n < SCORE.lines.length) return SCORE.lines[n];
  return SCORE.lines[SCORE.lines.length - 1] + (n - (SCORE.lines.length - 1)) * SCORE.extraLine;
}

/** 콤보 배율 (1콤보 ×1, 2콤보 ×1.5, …) */
export const comboMult = (combo: number): number => 1 + Math.max(0, combo - 1) * SCORE.comboStep;

/** 지금 점수에서의 조각 비율 (0 → RAMP_SCORE 동안 w0 → w1) */
export function shapeWeights(score: number): number[] {
  const t = Math.min(1, Math.max(0, score / RAMP_SCORE));
  return SHAPES.map(s => s.w0 + (s.w1 - s.w0) * t);
}

function pickIndex(weights: readonly number[], u: number): number {
  let total = 0;
  for (const w of weights) total += w;
  let x = u * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

/** 조각 3개 뽑기 (정령은 셋이 서로 다르게). [조각들, 새 rng] */
function drawTray(rng: number, score: number): [Piece[], number] {
  const weights = shapeWeights(score);
  const out: Piece[] = [];
  const free = SPIRITS.map((_, i) => i);
  let u: number;
  for (let i = 0; i < TRAY; i++) {
    [u, rng] = nextRandom(rng);
    const shape = pickIndex(weights, u);
    [u, rng] = nextRandom(rng);
    const k = Math.min(free.length - 1, Math.floor(u * free.length));
    out.push({ shape, spirit: free.splice(k, 1)[0] });
  }
  return [out, rng];
}

/** 새 조각 3개. 자비 규칙: 놓을 수 있는 조각이 하나도 없으면 한 번만 다시 뽑는다 */
function deal(st: BlockState): boolean {
  let [tray, rng] = drawTray(st.rng, st.score);
  let mercy = false;
  if (!tray.some(p => fitsAnywhere(st.board, shapeOf(p)))) {
    [tray, rng] = drawTray(rng, st.score);
    mercy = true;
    st.mercies++;
  }
  st.tray = tray;
  st.rng = rng;
  st.deals++;
  return mercy;
}

/** 남은 조각 중 하나라도 놓을 곳이 있나 */
export function canContinue(st: Pick<BlockState, 'board' | 'tray'>): boolean {
  return st.tray.some(p => p && fitsAnywhere(st.board, shapeOf(p)));
}

/** 새 판 (빈 판 + 조각 3개) */
export function newGame(seed: number): BlockState {
  const st: BlockState = {
    board: new Array(N).fill(0),
    tray: [],
    rng: seedState(seed),
    score: 0, combo: 0, miss: 0, lines: 0, maxCombo: 0, moves: 0, perfects: 0, deals: 0, mercies: 0,
    over: false,
  };
  deal(st);
  st.over = !canContinue(st);
  return st;
}

export function cloneState(st: BlockState): BlockState {
  return { ...st, board: st.board.slice(), tray: st.tray.map(p => (p ? { ...p } : null)) };
}

/**
 * slot 번 조각을 (r, c)(조각 왼쪽 위)에 놓는다. 원래 상태는 바꾸지 않는다.
 * 못 놓는 자리 · 빈 칸 · 끝난 판이면 MoveError.
 */
export function place(prev: BlockState, slot: number, r: number, c: number): { state: BlockState; ev: PlaceEvent } {
  if (prev.over) throw new MoveError('game over');
  if (!Number.isInteger(slot) || slot < 0 || slot >= prev.tray.length) throw new MoveError('bad slot');
  const piece = prev.tray[slot];
  if (!piece) throw new MoveError('empty slot');
  const shape = shapeOf(piece);
  if (!canPlace(prev.board, shape, r, c)) throw new MoveError('bad place');

  const st = cloneState(prev);
  const cells: [number, number][] = shape.cells.map(([dr, dc]) => [r + dr, c + dc]);
  for (const [rr, cc] of cells) st.board[rr * SIZE + cc] = piece.spirit + 1;
  st.tray[slot] = null;
  st.moves++;

  const placePoints = cells.length * SCORE.perCell;
  const { rows, cols } = fullLines(st.board);
  const n = rows.length + cols.length;
  const cleared: PlaceEvent['cleared'] = [];
  let linePoints = 0, perfectPoints = 0, perfect = false, comboBroken = false;
  if (n > 0) {
    const seen = new Set<number>();
    const take = (i: number) => {
      if (seen.has(i)) return;
      seen.add(i);
      cleared.push({ r: Math.floor(i / SIZE), c: i % SIZE, spirit: st.board[i] - 1 });
    };
    for (const row of rows) for (let j = 0; j < SIZE; j++) take(row * SIZE + j);
    for (const col of cols) for (let j = 0; j < SIZE; j++) take(j * SIZE + col);
    for (const i of seen) st.board[i] = 0;
    st.combo++;
    st.miss = 0;
    st.lines += n;
    st.maxCombo = Math.max(st.maxCombo, st.combo);
    linePoints = Math.round(lineBase(n) * comboMult(st.combo));
    if (st.board.every(v => v === 0)) {
      perfect = true;
      perfectPoints = SCORE.perfect;
      st.perfects++;
    }
  } else if (st.combo > 0) {
    st.miss++;
    if (st.miss >= SCORE.comboMiss) {
      st.combo = 0;
      st.miss = 0;
      comboBroken = true;
    }
  }
  const gain = placePoints + linePoints + perfectPoints;
  st.score += gain;

  let dealt = false, mercy = false;
  if (st.tray.every(p => p === null)) {
    mercy = deal(st);
    dealt = true;
  }
  st.over = !canContinue(st);

  return {
    state: st,
    ev: {
      slot, r, c, spirit: piece.spirit, cells, rows, cols, cleared,
      placePoints, linePoints, perfectPoints, gain,
      combo: st.combo, comboBroken, perfect, dealt, mercy, over: st.over,
    },
  };
}

/** 놓기 기록 한 줄: [조각 번호(0~2), 줄, 칸] */
export type Move = [number, number, number];

/** 시드부터 기록을 다시 돌린다 (틀린 놓기면 MoveError) */
export function replay(seed: number, moves: readonly Move[]): BlockState {
  let st = newGame(seed);
  for (const [slot, r, c] of moves) st = place(st, slot, r, c).state;
  return st;
}
