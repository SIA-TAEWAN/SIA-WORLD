import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
import type { PlayerSetup, TurnInput } from '../src/game/types';
import { Terrain } from '../src/physics/terrain';
import { autoplay } from '../src/ai/autoplay';
import { MAP_IDS } from '../src/data/maps';

const duo = (a: PlayerSetup['tank'] = 'tiger', b: PlayerSetup['tank'] = 'tiger', items: PlayerSetup['items'] = []): PlayerSetup[] => [
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
      const m = new Match(duo('snake', 'sheep'), 'valley', 777);
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
    const m = new Match(duo('rooster', 'sheep'), 'valley', 1);
    const first = m.startTurn();
    m.fire(shot({ power: 5 }));
    const second = m.startTurn();
    const other = m.tanks.find((t) => t !== first)!;
    expect(second.idx).toBe(first.delay < other.delay ? first.idx : other.idx);
  });

  it('무거운 무기·아이템·이동은 딜레이를 더 쌓는다', () => {
    const a = new Match(duo('tiger', 'tiger', ['double']), 'valley', 3);
    a.current = 0;
    a.moveLeft = 100;
    const base = a.tanks[0].delay;
    a.fire(shot({ power: 5 }));
    const plain = a.tanks[0].delay - base;
    const b = new Match(duo('tiger', 'tiger', ['double']), 'valley', 3);
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
      { name: 'A1', tank: 'tiger', team: 0, ai: null, items: [] },
      { name: 'A2', tank: 'tiger', team: 0, ai: null, items: [] },
      { name: 'B', tank: 'tiger', team: 1, ai: null, items: [] },
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
    const m = new Match(duo('tiger', 'tiger', ['repair']), 'valley', 2);
    m.current = 0;
    m.tanks[0].hp = 500;
    m.fire(shot({ power: 5, itemSlot: 0 }));
    expect(m.tanks[0].hp).toBe(500 + Math.round(m.tanks[0].maxHp * 0.2));
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
    const r = autoplay('tiger', 'rooster', 'valley', 42, 'hard');
    expect([0, 1]).toContain(r.winner);
    expect(r.turns).toBeLessThan(200);
  });
});

describe('온라인 동기화', () => {
  it('스냅샷으로 되살린 판은 같은 입력에 같은 결과를 낸다', () => {
    const a = new Match(duo('tiger', 'snake'), 'sphinx', 99);
    for (let i = 0; i < 3; i++) {
      a.startTurn();
      a.fire(shot({ facing: a.cur.team === 0 ? 1 : -1, power: 55 + i * 10 }));
    }
    const b = Match.fromSnapshot(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.stateHash()).toBe(a.stateHash());
    for (const m of [a, b]) {
      m.startTurn();
      m.fire(shot({ facing: m.cur.team === 0 ? 1 : -1, power: 77, weapon: 1 }));
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });

  it('지형 압축을 풀면 원래와 같다', () => {
    const m = new Match(duo(), 'sky', 1);
    m.terrain.carve(400, 400, 50);
    const t = new Terrain();
    t.decode(m.terrain.encode());
    expect(t.hash()).toBe(m.terrain.hash());
    expect(m.terrain.encode().length).toBeLessThan(60000);
  });
});

describe('바람·경사·분열탄', () => {
  it('바람은 직전 바람에서 5 넘게 바뀌지 않고 -10~10 안에 있다', () => {
    const m = new Match(duo(), 'valley', 123);
    let prev = m.startTurn() && m.wind;
    expect(Math.abs(prev)).toBeLessThanOrEqual(5);
    for (let i = 0; i < 200; i++) {
      m.skipTurn();
      m.startTurn();
      expect(Math.abs(m.wind - prev)).toBeLessThanOrEqual(5);
      expect(Math.abs(m.wind)).toBeLessThanOrEqual(10);
      prev = m.wind;
    }
  });

  it('오르막에 서면 그만큼 발사각이 올라간다', () => {
    const m = new Match(duo(), 'valley', 1);
    const t = m.tanks[0];
    // 오른쪽으로 45도 오르막
    m.terrain.data.fill(0);
    for (let x = 0; x < m.terrain.w; x++) for (let y = Math.max(0, 600 - x); y < m.terrain.h; y++) m.terrain.data[y * m.terrain.w + x] = 1;
    t.x = 200;
    t.y = 0;
    m.settle(t);
    const tilt = m.tilt(t);
    expect(tilt).toBeGreaterThan(30);
    expect(m.worldAngle(t, 30, 1)).toBe(30 + tilt);
    expect(m.worldAngle(t, 30, -1)).toBe(30 - tilt);
  });

  it('분열탄은 꼭대기에서 여러 발로 갈라진다', () => {
    const m = new Match(duo('rat', 'ox'), 'valley', 8);
    m.current = 0;
    const r = m.fire(shot({ weapon: 1, angle: 55, power: 70 }));
    expect(r.shells.length).toBe(4);
    expect(r.events.filter((e) => e.type === 'explode').length).toBeGreaterThanOrEqual(2);
  });
});

describe('바람 빠르기·굴러가는 탄·유도탄', () => {
  it('바람 빠르기 설정에 따라 턴마다 바뀌는 폭이 다르다', () => {
    for (const [mode, step] of [['slow', 2], ['fast', 8]] as const) {
      const m = new Match(duo(), 'valley', 5, { wind: mode });
      m.startTurn();
      let prev = m.wind;
      let maxStep = 0;
      for (let i = 0; i < 300; i++) {
        m.skipTurn();
        m.startTurn();
        maxStep = Math.max(maxStep, Math.abs(m.wind - prev));
        prev = m.wind;
      }
      expect(maxStep).toBeLessThanOrEqual(step);
      if (mode === 'fast') expect(maxStep).toBeGreaterThan(5);
    }
  });

  it('스냅샷에 바람 빠르기가 남는다', () => {
    const m = new Match(duo(), 'valley', 5, { wind: 'slow' });
    expect(Match.fromSnapshot(JSON.parse(JSON.stringify(m.snapshot()))).options.wind).toBe('slow');
  });

  it('코코넛은 땅에 떨어진 뒤 굴러간다', () => {
    const m = new Match(duo('monkey', 'ox'), 'valley', 3);
    m.current = 0;
    m.tanks[1].x = 1500;
    const r = m.fire(shot({ angle: 30, power: 35 }));
    const path = r.shells[0].path;
    // 마지막 몇 프레임은 땅 위를 수평으로 이동
    const n = path.length / 2;
    const xs = [path[(n - 10) * 2], path[(n - 1) * 2]];
    expect(Math.abs(xs[1] - xs[0])).toBeGreaterThan(15);
  });

  it('유도 뼈다귀는 적 쪽으로 휜다', () => {
    const plain = new Match(duo('tiger', 'ox'), 'valley', 3);
    const homing = new Match(duo('dog', 'ox'), 'valley', 3);
    for (const m of [plain, homing]) {
      m.current = 0;
      m.tanks[1].x = m.tanks[0].x + 500;
      m.tanks[1].y = 0;
      m.settle(m.tanks[1]);
    }
    const target = homing.tanks[1].x;
    const a = plain.fire(shot({ angle: 60, power: 62 })).firstImpact!;
    const b = homing.fire(shot({ angle: 60, power: 62 })).firstImpact!;
    expect(Math.abs(b.x - target)).toBeLessThan(Math.abs(a.x - target));
  });
});

describe('수리킷 즉시 사용·파워에 따른 구덩이', () => {
  it('수리킷은 쏘지 않아도 누르는 즉시 회복된다', () => {
    const m = new Match(duo('tiger', 'tiger', ['repair']), 'valley', 2);
    m.current = 0;
    m.tanks[0].hp = 500;
    const d0 = m.tanks[0].delay;
    const heal = Math.round(m.tanks[0].maxHp * 0.2);
    expect(m.useItemNow(0)).toBe(heal);
    expect(m.tanks[0].hp).toBe(500 + heal);
    expect(m.tanks[0].items[0]).toBeNull();
    expect(m.tanks[0].delay - d0).toBe(200);
    expect(m.useItemNow(0)).toBeNull();
  });

  it('세게 쏠수록, 파워업을 쓰면 땅을 더 크게 판다', () => {
    const crater = (power: number, items: PlayerSetup['items'] = []) => {
      const m = new Match(duo('tiger', 'tiger', items), 'valley', 7);
      m.current = 0;
      const r = m.fire(shot({ angle: 80, power, itemSlot: items.length ? 0 : null }));
      return (r.events.find((e) => e.type === 'explode') as { crater: number }).crater;
    };
    const base = crater(0);
    expect(crater(60)).toBeGreaterThan(base * 1.25);
    expect(crater(60, ['power'])).toBeGreaterThan(crater(60) * 1.25);
  });
});

describe('보급 상자·십이지신', () => {
  it('10턴마다 살아 있는 플레이어마다 상자가 떨어지고, 닿으면 빈 칸에 들어간다', () => {
    const m = new Match(duo(), 'valley', 31);
    for (let i = 0; i < 9; i++) {
      m.startTurn();
      expect(m.lastDrop).toBeNull();
      m.skipTurn();
    }
    m.startTurn();
    expect(m.lastDrop!.length).toBe(2);
    const c = m.crates[0];
    expect(c).toBeDefined();
    const t = m.tanks[0];
    t.items = [null, null, null];
    t.x = c.x;
    t.y = 0;
    m.settle(t);
    m.pickup();
    expect(t.items[0]).toBe(c.item);
    expect(m.crates.find((x) => x.id === c.id)).toBeUndefined();
    // 스냅샷으로 상자도 이어진다
    const b = Match.fromSnapshot(JSON.parse(JSON.stringify(m.snapshot())));
    expect(b.stateHash()).toBe(m.stateHash());
  });

  it('랜덤 선택은 약 20% 확률로 십이지신, 십이지신은 평균보다 20% 튼튼하다', async () => {
    const { randomTank, TANKS, TANK_IDS } = await import('../src/game/data');
    let n = 0;
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 5000; i++) if (randomTank(rand) === 'zodiac') n++;
    expect(n / 5000).toBeGreaterThan(0.17);
    expect(n / 5000).toBeLessThan(0.23);
    const avg = TANK_IDS.reduce((s, id) => s + TANKS[id].hp, 0) / TANK_IDS.length;
    expect(Math.abs(TANKS.zodiac.hp - avg)).toBeLessThan(10);
    expect(randomTank(() => 0.99, '시아')).toBe('zodiac');
  });
});

it('필살기를 쓴 발사로는 게이지가 다시 차지 않는다', () => {
  const m = new Match(duo('tiger', 'ox'), 'valley', 4);
  m.current = 0;
  m.tanks[1].x = m.tanks[0].x + 40;
  m.tanks[1].y = 0;
  m.settle(m.tanks[1]);
  m.tanks[0].ult = 100;
  m.fire(shot({ weapon: 2, angle: 60, power: 8 }));
  expect(m.tanks[1].hp).toBeLessThan(m.tanks[1].maxHp);
  expect(m.tanks[0].ult).toBe(0);
});
