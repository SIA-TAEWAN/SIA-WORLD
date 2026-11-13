import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
import type { PlayerSetup, TurnInput } from '../src/game/types';
import { Terrain } from '../src/physics/terrain';
import { autoplay } from '../src/ai/autoplay';
import { MAP_IDS } from '../src/data/maps';

const duo = (a: PlayerSetup['tank'] = 'bolt', b: PlayerSetup['tank'] = 'bolt', items: PlayerSetup['items'] = []): PlayerSetup[] => [
  { name: 'A', tank: a, team: 0, ai: null, items },
  { name: 'B', tank: b, team: 1, ai: null, items: [] },
];
const shot = (p: Partial<TurnInput> = {}): TurnInput => ({ angle: 45, facing: 1, power: 70, weapon: 0, itemSlot: null, ...p });

describe('지형', () => {
  it('폭발하면 원 모양으로 깎인다', () => {
    const t = new Terrain(100, 100);
    t.data.fill(1);
    t.carve(50, 50, 10);
    expect(t.solid(50, 50)).toBe(false);
    expect(t.solid(50, 39)).toBe(true);
    expect(t.solid(58, 50)).toBe(false);
  });
});

describe('결정론', () => {
  it('같은 시드·같은 입력이면 모든 기기에서 결과가 같다', () => {
    const run = () => {
      const m = new Match(duo('driller', 'bubble'), 'valley', 777);
      const out: unknown[] = [];
      for (let i = 0; i < 6; i++) {
        m.startTurn();
        const r = m.fire(shot({ facing: m.cur.team === 0 ? 1 : -1, power: 60 + i * 5, weapon: (i % 2) as 0 | 1 }));
        out.push(r.frames, m.tanks.map((t) => [t.x, t.y, t.hp]), m.wind);
      }
      let sum = 0;
      for (let i = 0; i < m.terrain.data.length; i++) sum = (sum * 31 + m.terrain.data[i] * i) >>> 0;
      return JSON.stringify([out, sum]);
    };
    expect(run()).toBe(run());
  });

  it('맵마다 탱크가 땅 위에 선다', () => {
    for (const id of MAP_IDS) {
      const m = new Match(duo(), id, 5);
      for (const t of m.tanks) expect(m.supported(t)).toBe(true);
    }
  });
});

describe('턴 규칙', () => {
  it('누적 딜레이가 가장 낮은 탱크가 다음 턴을 갖는다', () => {
    const m = new Match(duo('sparrow', 'bubble'), 'valley', 1);
    const first = m.startTurn();
    m.fire(shot({ power: 5 }));
    const second = m.startTurn();
    const other = m.tanks.find((t) => t !== first)!;
    expect(second.idx).toBe(first.delay < other.delay ? first.idx : other.idx);
  });

  it('무거운 무기·아이템·이동은 딜레이를 더 쌓는다', () => {
    const a = new Match(duo('bolt', 'bolt', ['double']), 'valley', 3);
    a.current = 0;
    a.moveLeft = 100;
    const base = a.tanks[0].delay;
    a.fire(shot({ power: 5 }));
    const plain = a.tanks[0].delay - base;
    const b = new Match(duo('bolt', 'bolt', ['double']), 'valley', 3);
    b.current = 0;
    b.moveLeft = 100;
    for (let i = 0; i < 20; i++) b.moveStep(1);
    b.fire(shot({ power: 5, weapon: 1, itemSlot: 0 }));
    expect(b.tanks[0].delay - base).toBeGreaterThan(plain + 150 + 250);
  });

  it('필살기는 게이지가 차야 쓸 수 있고 쓰면 0이 된다', () => {
    const m = new Match(duo(), 'valley', 9);
    m.current = 0;
    const before = m.tanks[0].delay;
    m.fire(shot({ weapon: 2, power: 5 }));
    // 게이지가 없으면 1번 무기로 대체(추가 딜레이 0)
    expect(m.tanks[0].delay - before).toBe(m.tanks[0].def.delay);
    m.tanks[0].ult = 100;
    m.fire(shot({ weapon: 2, power: 5 }));
    expect(m.tanks[0].ult).toBe(0);
  });

  it('같은 팀은 피해를 받지 않는다', () => {
    const setups: PlayerSetup[] = [
      { name: 'A1', tank: 'bolt', team: 0, ai: null, items: [] },
      { name: 'A2', tank: 'bolt', team: 0, ai: null, items: [] },
      { name: 'B', tank: 'bolt', team: 1, ai: null, items: [] },
    ];
    const m = new Match(setups, 'valley', 11);
    m.current = 0;
    // 아군 바로 옆에 붙여 놓고 아군 머리 위로 떨어뜨린다
    m.tanks[1].x = m.tanks[0].x + 30;
    m.settle(m.tanks[1]);
    m.fire(shot({ angle: 70, power: 18 }));
    expect(m.tanks[1].hp).toBe(m.tanks[1].maxHp);
  });

  it('수리킷은 체력 20%를 회복한다', () => {
    const m = new Match(duo('bolt', 'bolt', ['repair']), 'valley', 2);
    m.current = 0;
    m.tanks[0].hp = 500;
    m.fire(shot({ power: 5, itemSlot: 0 }));
    expect(m.tanks[0].hp).toBe(700);
    expect(m.tanks[0].items[0]).toBeNull();
  });

  it('맵 아래로 떨어지면 탈락한다', () => {
    const m = new Match(duo(), 'sky', 4);
    m.current = 0;
    const t = m.tanks[0];
    m.terrain.data.fill(0);
    m.settle(t);
    expect(t.alive).toBe(false);
  });
});

describe('AI', () => {
  it('AI끼리 한 판을 끝까지 둔다', () => {
    const r = autoplay('bolt', 'sparrow', 'valley', 42, 'hard');
    expect([0, 1]).toContain(r.winner);
    expect(r.turns).toBeLessThan(200);
  });
});
