import { describe, expect, it } from 'vitest';
import * as E from '../src/game/engine.js';
import LEVELS from '../src/data/levels.json';

const open8 = (kinds = ['fire', 'water', 'wind', 'leaf', 'heart']) => ({ map: Array(8).fill('........'), kinds, moves: 20, goals: [{ t: 'score', n: 1e9 }], stars: [1, 2] });
/** 판의 정령을 직접 정한다 (줄마다 한 글자 = 정령 첫 글자: f w i l h e b g d) */
const CODE: Record<string, string> = { f: 'fire', w: 'water', i: 'wind', l: 'leaf', h: 'heart', e: 'earth', b: 'bolt', g: 'light', d: 'dark' };
function setBoard(G: any, rows: string[]) {
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (G.cells[r][c].t) G.cells[r][c].t = { id: 1000 + r * 10 + c, k: CODE[ch], sp: null }; }));
}
const filler = ['fwiflwih', 'wiflwihf', 'iflwihfw', 'flwihfwi', 'lwihfwif', 'wihfwifl', 'ihfwiflw', 'hfwiflwi'];

describe('판 만들기', () => {
  it('처음 판에는 이미 맞춰진 줄이 없고, 둘 수 있는 수가 있다', () => {
    for (let s = 1; s <= 30; s++) {
      const G: any = E.createGame(open8(), s);
      expect(E.findGroups(G)).toEqual([]);
      expect(E.hasMoves(G)).toBe(true);
    }
  });
  it('같은 시드면 같은 판', () => {
    const a = E.createGame(open8(), 7), b = E.createGame(open8(), 7);
    expect(a.cells.map((r: any[]) => r.map((e) => e.t.k).join()).join()).toBe(b.cells.map((r: any[]) => r.map((e) => e.t.k).join()).join());
  });
  it('스테이지 100개 모두 판을 만들 수 있고, 장애물 목표는 0이 아니다', () => {
    expect(LEVELS.length).toBe(100);
    LEVELS.forEach((L: any, i: number) => {
      expect(L.id).toBe(i + 1);
      const G: any = E.createGame(L, 3);
      expect(G.goals.length).toBeGreaterThan(0);
      for (const g of G.goals) expect(g.n).toBeGreaterThan(0);
      expect(L.moves).toBeGreaterThanOrEqual(10);
      expect(L.stars[1]).toBeGreaterThan(L.stars[0]);
      for (const k of L.kinds) expect(E.KINDS).toContain(k);
      for (const g of L.goals) if (g.t === 'collect') expect(L.kinds).toContain(g.k);
    });
  });
});

describe('매치와 특수 블록', () => {
  it('맞춰지지 않는 이동은 되돌리고 이동 수를 쓰지 않는다', () => {
    const G: any = E.createGame(open8(), 1);
    setBoard(G, filler);
    const before = G.moves;
    expect(E.swap(G, [0, 0], [0, 1]).ok).toBe(false);
    expect(G.moves).toBe(before);
  });
  it('4개를 맞추면 그 정령의 강화 정령이 생긴다', () => {
    const G: any = E.createGame(open8(), 1);
    setBoard(G, ['fffwliwh', ...filler.slice(1)]);
    G.cells[1][3].t.k = 'fire';
    expect(E.swap(G, [0, 3], [1, 3]).ok).toBe(true);
    const ev = E.stepClear(G)!;
    expect(ev.created).toEqual([expect.objectContaining({ k: 'fire', sp: 'line', r: 0, c: 3 })]);
  });
  it('불 강화 정령은 가로 한 줄을, 물은 세로 한 줄을 터뜨린다', () => {
    for (const [k, count] of [['fire', 8], ['water', 8]] as const) {
      const G: any = E.createGame(open8(), 2);
      setBoard(G, filler);
      G.cells[3][3].t.sp = 'line'; G.cells[3][3].t.k = k;
      G.forced = [[3, 3]];
      const ev = E.stepClear(G)!;
      expect(ev.cleared.length).toBe(count);
    }
  });
  it('정령왕 구슬과 바꾸면 그 종류가 모두 사라진다', () => {
    const G: any = E.createGame(open8(), 3);
    setBoard(G, filler);
    G.cells[4][4].t = { id: 9999, k: 'orb', sp: 'orb' };
    const k = G.cells[4][5].t.k;
    const n = G.cells.flat().filter((e: any) => e.t && e.t.k === k).length;
    expect(E.swap(G, [4, 4], [4, 5]).ok).toBe(true);
    const ev = E.stepClear(G)!;
    expect(ev.cleared.filter((c: any) => c.k === k).length).toBe(n);
  });
  it('마음 강화 정령은 이동 수를 1 돌려준다', () => {
    const G: any = E.createGame(open8(), 4);
    setBoard(G, filler);
    G.cells[2][2].t.sp = 'line'; G.cells[2][2].t.k = 'heart';
    G.forced = [[2, 2]];
    const before = G.moves;
    E.stepClear(G);
    expect(G.moves).toBe(before + 1);
  });
  it('땅 강화 정령은 판의 상자를 모두 한 번씩 때린다', () => {
    const L = { ...open8(['fire', 'water', 'wind', 'leaf', 'earth']), map: ['b......b', '........', '........', '........', '........', '........', '........', 'B......B'], goals: [{ t: 'box' }] };
    const G: any = E.createGame(L, 5);
    const r = G.cells.findIndex((row: any[]) => row.some((e) => e.t));
    const c = G.cells[3].findIndex((e: any) => e.t);
    G.cells[3][c].t.sp = 'line'; G.cells[3][c].t.k = 'earth';
    G.forced = [[3, c]];
    E.stepClear(G);
    expect(G.cells[0][0].box).toBe(0);
    expect(G.cells[7][0].box).toBe(1);
    expect(G.goals[0].left).toBe(6 - 4);
    void r;
  });
  it('터진 뒤에는 빈 칸 없이 채워진다 (상자·덩굴·구멍은 그대로)', () => {
    const L = { ...open8(), map: ['x......x', '...b....', '..v.....', '........', '....1...', '........', '........', '........'] };
    const G: any = E.createGame(L, 6);
    for (let i = 0; i < 15; i++) {
      const m = E.botMove(G, 0);
      if (!m) break;
      E.swap(G, m[0], m[1]);
      E.resolveAll(G);
      for (const row of G.cells) for (const e of row) {
        if (e.hole) expect(e.t).toBeNull();
        else if (e.box) expect(e.t).toBeNull();
        else expect(e.t).not.toBeNull();
      }
    }
  });
});

describe('스테이지 진행', () => {
  it('자동 플레이가 1장 스테이지를 대부분 깬다', () => {
    let wins = 0;
    for (let s = 0; s < 10; s++) if (E.playBot(LEVELS[1], 100 + s).won) wins++;
    expect(wins).toBeGreaterThanOrEqual(7);
  });
  it('목표를 끝내면 보너스 타임 → 남은 이동이 0이 되고 끝난다', () => {
    const r = E.playBot(LEVELS[4], 11);
    expect(r.won).toBe(true);
    expect(r.score).toBeGreaterThan(r.preBonus);
  });
});
