import { describe, expect, it } from 'vitest';
import {
  canContinue, canPlace, comboMult, fitsAnywhere, lineBase, MoveError, newGame, place, previewLines, replay,
  SCORE, SHAPES, shapeSize, SIZE, verifyRun, VerifyError, type BlockState,
} from '../src/rules.ts';
import { botGame } from '../src/bot.ts';

const sh = (id: string) => SHAPES.findIndex(s => s.id === id);
/** 판 · 조각을 마음대로 정한 상태 */
function custom(rows: string[], tray: (string | null)[], extra: Partial<BlockState> = {}): BlockState {
  const st = newGame(1);
  st.board = rows.join('').split('').map(ch => (ch === '#' ? 1 : 0));
  st.tray = tray.map((id, i) => (id ? { shape: sh(id), spirit: i } : null));
  st.over = false;
  return Object.assign(st, extra);
}
const EMPTY: string[] = Array(8).fill('........');
const dot = { shape: sh('dot'), spirit: 0 };

describe('조각', () => {
  it('29가지 모양이 모두 다르고, 왼쪽 위에 붙어 있다', () => {
    expect(SHAPES).toHaveLength(29);
    const keys = new Set(SHAPES.map(s => s.cells.map(c => c.join(',')).sort().join('|')));
    expect(keys.size).toBe(29);
    for (const s of SHAPES) {
      const { h, w } = shapeSize(s);
      expect(h).toBeLessThanOrEqual(5);
      expect(w).toBeLessThanOrEqual(5);
      expect(Math.min(...s.cells.map(c => c[0]))).toBe(0);
      expect(Math.min(...s.cells.map(c => c[1]))).toBe(0);
    }
  });
  it('모양별 칸 수', () => {
    const n = (id: string) => SHAPES[sh(id)].cells.length;
    expect([n('dot'), n('h5'), n('sq3'), n('r23'), n('l3a'), n('l5a'), n('tu'), n('sh')]).toEqual([1, 5, 9, 6, 3, 5, 4, 4]);
  });
});

describe('놓기', () => {
  it('처음엔 빈 판에 조각 3개 (정령 셋은 서로 다름)', () => {
    const st = newGame(123);
    expect(st.board.every(v => v === 0)).toBe(true);
    expect(st.tray).toHaveLength(3);
    expect(new Set(st.tray.map(p => p!.spirit)).size).toBe(3);
    expect(st.over).toBe(false);
  });
  it('판 밖 · 찬 칸에는 못 놓는다', () => {
    const st = custom(['#.......', ...EMPTY.slice(1)], ['h5', 'dot', 'dot']);
    expect(canPlace(st.board, SHAPES[sh('h5')], 0, 4)).toBe(false);
    expect(canPlace(st.board, SHAPES[sh('h5')], 0, 0)).toBe(false);
    expect(canPlace(st.board, SHAPES[sh('h5')], 0, 1)).toBe(true);
    expect(() => place(st, 0, 0, 4)).toThrow(MoveError);
    expect(() => place(st, 0, 0, 0)).toThrow(MoveError);
  });
  it('놓으면 칸 수만큼 점수, 원래 상태는 그대로', () => {
    const st = custom(EMPTY, ['sq3', 'dot', 'dot']);
    const { state, ev } = place(st, 0, 2, 2);
    expect(ev.gain).toBe(9);
    expect(state.score).toBe(9);
    expect(st.score).toBe(0);
    expect(st.board.every(v => v === 0)).toBe(true);
    expect(state.tray[0]).toBeNull();
    expect(() => place(state, 0, 5, 5)).toThrow('empty slot');
  });
  it('3개를 다 놓으면 새로 3개', () => {
    let st = custom(EMPTY, ['dot', 'dot', 'dot']);
    st = place(st, 0, 0, 0).state;
    st = place(st, 1, 0, 2).state;
    const { state, ev } = place(st, 2, 0, 4);
    expect(ev.dealt).toBe(true);
    expect(state.tray.every(p => p)).toBe(true);
  });
});

describe('줄 지우기와 점수', () => {
  it('가로줄이 차면 지워지고 100점 (판이 비면 판 비우기)', () => {
    const st = custom(['#######.', ...EMPTY.slice(1)], ['dot', 'dot', 'dot']);
    const { state, ev } = place(st, 0, 0, 7);
    expect(ev.rows).toEqual([0]);
    expect(ev.cols).toEqual([]);
    expect(ev.linePoints).toBe(100);
    expect(ev.perfect).toBe(true);
    expect(state.board.every(v => v === 0)).toBe(true);
    expect(state.score).toBe(1 + 100 + SCORE.perfect);
  });
  it('가로 · 세로가 같이 차면 모두 지워진다 (겹친 칸은 한 번)', () => {
    const rows = ['#######.', '.......#', '.......#', '.......#', '.......#', '.......#', '.......#', '.......#'];
    const st = custom(rows, ['dot', 'dot', 'dot']);
    const { state, ev } = place(st, 0, 0, 7);
    expect(ev.rows).toEqual([0]);
    expect(ev.cols).toEqual([7]);
    expect(ev.cleared).toHaveLength(15);
    expect(ev.linePoints).toBe(300);
    expect(state.board.every(v => v === 0)).toBe(true);
  });
  it('판에 블록이 남으면 판 비우기 아님', () => {
    const st = custom(['#######.', '#.......', ...EMPTY.slice(2)], ['dot', 'dot', 'dot']);
    const { ev } = place(st, 0, 0, 7);
    expect(ev.perfect).toBe(false);
    expect(ev.gain).toBe(101);
  });
  it('줄 수별 점수', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(lineBase)).toEqual([0, 100, 300, 600, 1000, 1400, 1800]);
  });
  it('미리 보기는 지워질 줄을 알려 준다', () => {
    const st = custom(['####....', ...EMPTY.slice(1)], ['h4', 'dot', 'dot']);
    expect(previewLines(st.board, SHAPES[sh('h4')], 0, 4)).toEqual({ rows: [0], cols: [] });
    expect(previewLines(st.board, SHAPES[sh('h4')], 1, 4)).toEqual({ rows: [], cols: [] });
    expect(previewLines(st.board, SHAPES[sh('h4')], 0, 3)).toEqual({ rows: [], cols: [] });
  });
  it('콤보: 이어서 지우면 배율이 오르고, 못 지운 놓기 3번이면 끊긴다', () => {
    expect([1, 2, 3, 5].map(comboMult)).toEqual([1, 1.5, 2, 3]);
    let st = custom(['#######.', '#######.', '#######.', '#.......', ...EMPTY.slice(4)], []);
    const go = (r: number, c: number) => { st.tray = [dot, dot, dot]; const res = place(st, 0, r, c); st = res.state; return res.ev; };
    expect(go(0, 7).combo).toBe(1);
    const e2 = go(1, 7);
    expect(e2.combo).toBe(2);
    expect(e2.linePoints).toBe(150);
    go(7, 0); go(7, 2);
    const e3 = go(7, 4);
    expect(e3.comboBroken).toBe(true);
    expect(e3.combo).toBe(0);
    const e4 = go(2, 7);
    expect(e4.combo).toBe(1);
    expect(e4.linePoints).toBe(100);
    expect(st.maxCombo).toBe(2);
  });
  it('못 지운 놓기 2번 뒤에 지우면 콤보가 이어진다', () => {
    let st = custom(['#######.', '#######.', '#.......', ...EMPTY.slice(3)], []);
    const go = (r: number, c: number) => { st.tray = [dot, dot, dot]; const res = place(st, 0, r, c); st = res.state; return res.ev; };
    go(0, 7); go(7, 0); go(7, 2);
    expect(go(1, 7).combo).toBe(2);
  });
});

describe('끝 판정', () => {
  it('남은 조각이 어디에도 안 들어가면 끝', () => {
    const rows = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((r + c) % 2 ? '#' : '.')).join(''));
    const st = custom(rows, ['h2', 'v2', 'dot']);
    expect(canContinue(st)).toBe(true);
    const { state, ev } = place(st, 2, 0, 0);
    expect(ev.over).toBe(true);
    expect(state.over).toBe(true);
    expect(() => place(state, 0, 0, 0)).toThrow('game over');
    expect(fitsAnywhere(state.board, SHAPES[sh('h2')])).toBe(false);
  });
  it('시작하자마자 끝나는 판은 없다', () => {
    for (let s = 1; s <= 50; s++) expect(newGame(s).over).toBe(false);
  });
});

describe('같은 시드 + 같은 놓기 → 같은 결과', () => {
  it('자동 플레이를 다시 돌리면 점수 · 판 · 조각이 같다', () => {
    for (const seed of [1, 42, 123, 99999]) {
      const { state, moves } = botGame(seed, newGame, 1);
      expect(state.over).toBe(true);
      expect(replay(seed, moves)).toEqual(state);
      const v = verifyRun(seed, moves);
      expect(v.score).toBe(state.score);
      expect(v.lines).toBe(state.lines);
      expect(v.maxCombo).toBe(state.maxCombo);
    }
  });
  it('시드가 다르면 조각이 다르다', () => {
    expect(newGame(1).tray).not.toEqual(newGame(2).tray);
  });
  it('JSON 으로 저장했다 되살려도 같게 이어진다', () => {
    const { moves } = botGame(7, newGame, 1);
    let st = newGame(7);
    for (const m of moves.slice(0, 20)) st = place(JSON.parse(JSON.stringify(st)), m[0], m[1], m[2]).state;
    for (const m of moves.slice(20)) st = place(st, m[0], m[1], m[2]).state;
    expect(st).toEqual(replay(7, moves));
  });
});

describe('서버 검증', () => {
  const { moves } = botGame(5, newGame, 1);
  it('틀린 기록은 거절', () => {
    expect(() => verifyRun(5, 'x')).toThrow(VerifyError);
    expect(() => verifyRun(5, [[0, 0]])).toThrow('bad log');
    expect(() => verifyRun(5, [[3, 0, 0]])).toThrow('bad log');
    expect(() => verifyRun(5, [[0, 0.5, 0]])).toThrow('bad log');
    expect(() => verifyRun(5, moves.slice(0, 3))).toThrow('not over');
    expect(() => verifyRun(5, [...moves, [0, 0, 0]])).toThrow('bad move');
    expect(() => verifyRun(6, moves)).toThrow(VerifyError);
  });
});

describe('손맛 (자동 플레이)', () => {
  it('판이 너무 짧거나 끝없이 길지 않다', () => {
    const scores: number[] = [], lens: number[] = [];
    for (let s = 1; s <= 20; s++) { const { state } = botGame(s * 31, newGame, 1); scores.push(state.score); lens.push(state.moves); }
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(lens)).toBeGreaterThan(25);
    expect(avg(scores)).toBeGreaterThan(500);
    expect(Math.max(...lens)).toBeLessThan(3000);
  });
  it('판 크기는 8', () => expect(SIZE).toBe(8));
});
