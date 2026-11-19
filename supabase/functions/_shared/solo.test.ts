import { describe, expect, it } from 'vitest';
import { seededRng } from './engine.ts';
import type { SeatInfo } from './engine.ts';
import { matgo, type MatgoAction, type MatgoState } from './matgo.ts';
import { soloOf, soloRng, soloRunAi, soloStep } from './solo.ts';

const SEATS: SeatInfo[] = [
  { seat: 0, kind: 'human', name: '나', stack: 50000 },
  { seat: 1, kind: 'ai', name: 'AI 호랑이', stack: null },
];
function newSolo(seed: number): MatgoState {
  const s = matgo.newRound({ seats: SEATS, baseUnit: 100, carry: null, rng: seededRng(seed) });
  return { ...s, solo: { seed: (seed * 2654435761) >>> 0, n: 0 } } as MatgoState;
}
/** 사람(자리 0) 차례는 pick 으로, AI(자리 1) 차례는 soloStep(…, null) 로 끝까지 */
function playOut(s0: MatgoState, pick: (s: MatgoState) => MatgoAction) {
  let s = s0;
  const log: MatgoAction[] = [];
  for (let i = 0; i < 500 && !matgo.done(s); i++) {
    const seat = matgo.pending(s)[0];
    if (seat === 0) {
      const a = pick(s);
      log.push(a);
      s = soloStep(matgo, s, 0, a);
    } else s = soloStep(matgo, s, seat, null);
  }
  return { s, log };
}
const aiPick = (seed: number) => {
  const rng = seededRng(seed);
  return (s: MatgoState) => {
    const v = matgo.view(s);
    return matgo.ai(v.public, v.private[0], 0, rng);
  };
};

describe('solo: 기기에서 진행하는 판의 한 걸음', () => {
  it('soloOf: solo 칸이 없거나 모양이 틀리면 null', () => {
    expect(soloOf(null)).toBeNull();
    expect(soloOf({})).toBeNull();
    expect(soloOf({ solo: null })).toBeNull();
    expect(soloOf({ solo: { seed: 1.5, n: 0 } })).toBeNull();
    expect(soloOf({ solo: { seed: 1, n: -1 } })).toBeNull();
    expect(soloOf({ solo: { seed: 7, n: 3 } })).toEqual({ seed: 7, n: 3 });
  });

  it('soloRng: (seed, n) 이 같으면 같은 난수, 다르면 다른 난수', () => {
    const seq = (seed: number, n: number) => {
      const r = soloRng({ seed, n });
      return [r.next(), r.next(), r.int(1000)];
    };
    expect(seq(123, 4)).toEqual(seq(123, 4));
    expect(seq(123, 4)).not.toEqual(seq(123, 5));
    expect(seq(123, 4)).not.toEqual(seq(124, 4));
    for (const v of seq(0, 0)) expect(Number.isFinite(v)).toBe(true);
  });

  it('한 걸음마다 n 이 1 늘고 seed 는 그대로, 넘겨받은 상태는 고치지 않는다', () => {
    const s0 = newSolo(11);
    if (matgo.done(s0)) return;
    const before = JSON.stringify(s0);
    const seat = matgo.pending(s0)[0];
    const s1 = soloStep(matgo, s0, seat, null);
    expect(JSON.stringify(s0)).toBe(before);
    expect(soloOf(s1)).toEqual({ seed: soloOf(s0)!.seed, n: 1 });
    // 엔진의 apply 가 solo 칸을 보존한다 (직접 불러도)
    const v = matgo.view(s0);
    const direct = matgo.apply(s0, seat, matgo.ai(v.public, v.private[seat], seat, soloRng(soloOf(s0)!)), soloRng(soloOf(s0)!));
    expect(soloOf(direct)).toEqual(soloOf(s0));
    expect({ ...direct, solo: soloOf(s1) }).toEqual(s1);
  });

  it('solo 상태가 아니면 걸음을 뗄 수 없다', () => {
    const s = matgo.newRound({ seats: SEATS, baseUnit: 100, carry: null, rng: seededRng(3) });
    expect(() => soloStep(matgo, s, matgo.pending(s)[0] ?? 0, null)).toThrow();
  });

  it('view 로 씨앗·solo 칸이 새지 않는다 (공개 · 비공개 모두)', () => {
    let s = newSolo(21);
    for (let i = 0; i < 6 && !matgo.done(s); i++) s = soloStep(matgo, s, matgo.pending(s)[0], null);
    const json = JSON.stringify(matgo.view(s));
    expect(json).not.toContain('solo');
    expect(json).not.toContain('seed');
    expect(json).not.toContain(String(soloOf(s)!.seed));
  });

  it('결정적: 같은 상태에서 같은 사람 행동 목록이면 몇 번을 돌려도, 상태를 JSON 으로 저장했다 꺼내도 결과가 같다', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s0 = newSolo(seed * 37);
      const a = playOut(s0, aiPick(seed));
      expect(matgo.done(a.s)).toBe(true);
      // 기록한 사람 행동만으로 다시 (걸음마다 JSON 으로 저장했다 꺼내며: DB 를 거친 서버 쪽과 같은 조건)
      let i = 0;
      let s = JSON.parse(JSON.stringify(s0)) as MatgoState;
      for (let k = 0; k < 500 && !matgo.done(s); k++) {
        const seat = matgo.pending(s)[0];
        s = soloStep(matgo, s, seat, seat === 0 ? a.log[i++] : null);
        s = JSON.parse(JSON.stringify(s)) as MatgoState;
      }
      expect(i).toBe(a.log.length);
      expect(s).toEqual(JSON.parse(JSON.stringify(a.s)));
      expect(matgo.settle(s)).toEqual(matgo.settle(a.s));
    }
  });

  it('키 순서가 바뀐 상태(DB jsonb 를 거친 것)에서도 AI 는 같은 수를 둔다', () => {
    const reorder = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reorder)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.keys(v as object).sort((x, y) => x.length - y.length || (x < y ? -1 : 1)).map((k) => [k, reorder((v as Record<string, unknown>)[k])]))
          : v;
    for (let seed = 1; seed <= 10; seed++) {
      let a = newSolo(seed * 53);
      let b = reorder(a) as MatgoState;
      const pick = aiPick(seed);
      for (let k = 0; k < 500 && !matgo.done(a); k++) {
        const seat = matgo.pending(a)[0];
        const act = seat === 0 ? pick(a) : null;
        a = soloStep(matgo, a, seat, act);
        b = reorder(soloStep(matgo, b, seat, act)) as MatgoState;
        expect(b).toEqual(a);
      }
    }
  });

  it('soloRunAi: AI 차례만 이어서 두고 사람 차례에서 멈춘다', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s0 = newSolo(seed * 91);
      if (matgo.done(s0)) continue;
      const s = soloRunAi(matgo, s0, (seat) => seat === 1);
      expect(matgo.done(s) || matgo.pending(s)[0] === 0).toBe(true);
      // 사람이 선이면 그대로
      if (matgo.pending(s0)[0] === 0) expect(s).toBe(s0);
    }
  });
});
