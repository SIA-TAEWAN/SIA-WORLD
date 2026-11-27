/**
 * 시아블록 서버 검증 (block-finish Edge Function 이 쓴다).
 * 기록 = 놓기 목록 [조각 번호, 줄, 칸] 만. 서버가 고른 시드부터 같은 규칙으로 다시 돌려 점수를 확정한다.
 */
import { BLOCK_RULES, MAX_MOVES, SIZE, TRAY } from './config.ts';
import { MoveError, newGame, place, type Move } from './engine.ts';

export { BLOCK_RULES };

export class VerifyError extends Error {}

export interface VerifiedRun {
  score: number;
  lines: number;
  maxCombo: number;
  moves: number;
  perfects: number;
  over: boolean;
}

/** 기록 모양 검사 (숫자 셋짜리 목록) */
export function parseLog(log: unknown): Move[] {
  if (!Array.isArray(log) || log.length > MAX_MOVES) throw new VerifyError('bad log');
  return log.map(m => {
    if (!Array.isArray(m) || m.length !== 3) throw new VerifyError('bad log');
    const [s, r, c] = m;
    if (![s, r, c].every(v => Number.isInteger(v))) throw new VerifyError('bad log');
    if (s < 0 || s >= TRAY || r < 0 || r >= SIZE || c < 0 || c >= SIZE) throw new VerifyError('bad log');
    return [s, r, c] as Move;
  });
}

/** 시드부터 다시 돌린다. 틀린 놓기 · 끝난 뒤의 놓기 · 안 끝난 판이면 VerifyError */
export function verifyRun(seed: number, log: unknown): VerifiedRun {
  const moves = parseLog(log);
  let st = newGame(seed);
  try {
    for (const [slot, r, c] of moves) st = place(st, slot, r, c).state;
  } catch (e) {
    if (e instanceof MoveError) throw new VerifyError('bad move');
    throw e;
  }
  if (!st.over) throw new VerifyError('not over');
  return { score: st.score, lines: st.lines, maxCombo: st.maxCombo, moves: st.moves, perfects: st.perfects, over: st.over };
}
