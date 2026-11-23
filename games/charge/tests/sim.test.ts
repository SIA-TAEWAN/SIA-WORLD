import { describe, expect, it } from 'vitest';
import { GATE_STEP_DMG, MAX_TROOPS } from '../src/data/balance';
import { stagesOf, type StageDef } from '../src/data/stages';
import { STEP, applyOp, createRun, setTarget, step } from '../src/game/sim';
import { greedy, simulate, stay } from './policy';

const tiny = (over: Partial<StageDef>): StageDef => ({
  id: 't',
  region: 1,
  no: 1,
  name: 't',
  startTroops: 10,
  items: [],
  bossZ: 4000,
  boss: { kind: 'chief', hp: 100, every: 3, warn: 1, width: 200, frac: 0.5 },
  stars: [5, 10],
  ...over,
});

function runFor(s: ReturnType<typeof createRun>, sec: number, x = s.targetX) {
  setTarget(s, x);
  for (let i = 0; i < sec / STEP; i++) step(s);
}

describe('문', () => {
  it('+ − × ÷ 계산', () => {
    expect(applyOp(10, '+', 5)).toBe(15);
    expect(applyOp(10, '-', 15)).toBe(-5);
    expect(applyOp(10, 'x', 3)).toBe(30);
    expect(applyOp(10, '/', 3)).toBe(3);
  });

  it('무리 가운데가 서 있는 문 하나만 통과한다', () => {
    const s = createRun(tiny({ items: [{ t: 'gates', z: 300, gates: [{ op: '+', v: 5 }, { op: 'x', v: 3 }] }] }), 'ox');
    runFor(s, 2, 140); // 오른쪽 문 (×3)
    expect(s.troops).toBe(30);
  });

  it('총을 맞히면 − 문이 0을 지나 + 문이 된다', () => {
    const s = createRun(tiny({ startTroops: 30, items: [{ t: 'gates', z: 3000, gates: [{ op: '-', v: 2 }, { op: '+', v: 1 }] }] }), 'ox');
    runFor(s, 9.5, -140); // 왼쪽 − 문 앞에서 쏘면서 달린다
    const g = s.gates[0];
    expect(g.op).toBe('+');
    expect(g.v).toBeGreaterThan(1);
  });

  it('문 숫자는 상한을 넘지 않고, 대원은 최대치를 넘지 않는다', () => {
    const s = createRun(tiny({ startTroops: 5000, items: [{ t: 'gates', z: 300, gates: [{ op: 'x', v: 5 }] }] }), 'ox');
    runFor(s, 2, 0);
    expect(s.troops).toBe(MAX_TROOPS);
    expect(GATE_STEP_DMG).toBeGreaterThan(0);
  });
});

describe('요괴 무리와 보스', () => {
  it('부딪히면 요괴 수만큼 대원을 잃는다', () => {
    // 쏘기 전에 바로 부딪히도록 아주 가까이 둔다
    const s = createRun(tiny({ startTroops: 50, items: [{ t: 'horde', z: 20, kind: 'imp', count: 20, span: 'full' }] }), 'rat');
    const before = s.troops;
    step(s);
    expect(s.troops).toBeLessThan(before);
    expect(s.hordes[0].count).toBe(0);
  });

  it('대원이 모두 없어지면 실패', () => {
    const s = createRun(tiny({ startTroops: 3, items: [{ t: 'horde', z: 20, kind: 'club', count: 30, span: 'full' }] }), 'rat');
    step(s);
    expect(s.phase).toBe('fail');
  });

  it('고양이 아홉 목숨: 모두 쓰러지면 한 번만 최소 9명으로 다시 일어난다', () => {
    const s = createRun(tiny({ startTroops: 3, items: [{ t: 'horde', z: 20, kind: 'club', count: 30, span: 'full' }] }), 'cat');
    step(s);
    expect(s.phase).toBe('run');
    expect(s.troops).toBe(9);
    expect(s.lives).toBe(0);
    expect(s.events.some((e) => e.type === 'lives')).toBe(true);
    for (let i = 0; i < 30 && s.phase === 'run'; i++) step(s);
    expect(s.phase).toBe('fail');
  });

  it('고양이: 다시 일어날 때는 이번 판 최대 대원의 15%', () => {
    const s = createRun(tiny({ startTroops: 200, items: [{ t: 'horde', z: 20, kind: 'club', count: 300, span: 'full' }] }), 'cat');
    step(s);
    expect(s.troops).toBe(30);
  });

  it('보스를 쓰러뜨리면 클리어, 공격 자리에서 비키면 잃지 않는다', () => {
    const s = createRun(tiny({ startTroops: 20, bossZ: 600, boss: { kind: 'chief', hp: 400, every: 1.5, warn: 1, width: 120, frac: 0.5 } }), 'rat');
    for (let i = 0; i < 60 / STEP && s.phase !== 'clear' && s.phase !== 'fail'; i++) {
      setTarget(s, greedy(s));
      step(s);
    }
    expect(s.phase).toBe('clear');
    expect(s.lost).toBe(0);
  });

  it('같은 입력이면 늘 같은 결과', () => {
    const a = simulate('1-3', 'tiger', greedy);
    const b = simulate('1-3', 'tiger', greedy);
    expect(a.troops).toBe(b.troops);
    expect(a.time).toBe(b.time);
  });
});

describe('1지역 스테이지', () => {
  for (const st of stagesOf(1)) {
    it(`${st.id}: 잘 고르면 클리어하고 1분 안팎, 아무것도 고르지 않으면 어렵다`, () => {
      const good = simulate(st.id, 'rat', greedy);
      expect(good.cleared).toBe(true);
      expect(good.time).toBeGreaterThan(45);
      expect(good.time).toBeLessThan(90);
      const idle = [stay(-200), stay(0), stay(200)].map((p) => simulate(st.id, 'rat', p));
      // 가만히 있으면 별 3개는 못 딴다
      expect(idle.every((r) => r.stars < 3)).toBe(true);
    });
  }

});

describe('장애물 · 상자 · 요괴 버릇', () => {
  it('구덩이에 겹치면 잃고, 비켜 가면 잃지 않는다', () => {
    const mk = () => createRun(tiny({ startTroops: 40, items: [{ t: 'obstacle', z: 300, kind: 'pit', x: 140 }] }), 'rat');
    const a = mk();
    runFor(a, 2, 140);
    const b = mk();
    runFor(b, 2, -200);
    expect(a.lost).toBeGreaterThan(0);
    expect(b.lost).toBe(0);
  });

  it('상자를 쏘아 부수면 보상을 받는다', () => {
    const s = createRun(tiny({ startTroops: 40, items: [{ t: 'crate', z: 1500, x: 0, reward: { kind: 'troops', v: 30 } }] }), 'rat');
    runFor(s, 5, 0);
    expect(s.crates[0].broken).toBe(true);
    expect(s.troops).toBeGreaterThanOrEqual(44 + 30 - 1);
  });

  it('해골 병사는 한 번 되살아난다, 숨은 요괴는 나오기 전에 맞힐 수 없다', () => {
    const s = createRun(tiny({ startTroops: 200, items: [{ t: 'horde', z: 900, kind: 'skeleton', count: 6, span: 'full' }] }), 'rat');
    runFor(s, 3, 0);
    expect(s.hordes[0].revived).toBe(true);
    const w = createRun(tiny({ startTroops: 200, items: [{ t: 'horde', z: 1400, kind: 'bamboo', count: 6, span: 'full' }] }), 'rat');
    runFor(w, 1, 0);
    expect(w.hordes[0].shown).toBe(false);
    expect(w.hordes[0].count).toBe(6);
  });

  it('보스가 둘로 칠 때 두 자리를 모두 피할 수 있다', () => {
    const s = createRun(
      tiny({ startTroops: 20, bossZ: 600, boss: { kind: 'gumiho', hp: 1500, every: 1.5, warn: 1, width: 160, frac: 0.5, traits: { double: true } } }),
      'rat',
    );
    for (let i = 0; i < 60 / STEP && s.phase !== 'clear' && s.phase !== 'fail'; i++) {
      setTarget(s, greedy(s));
      step(s);
    }
    expect(s.phase).toBe('clear');
  });
});
