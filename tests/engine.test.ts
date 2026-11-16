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

  it('아군 포탄에 맞으면 피해를 입고 게이지도 찬다 (딜량은 적에게 준 것만)', () => {
    const setups: PlayerSetup[] = [
      { name: 'A1', tank: 'tiger', team: 0, ai: null, items: [] },
      { name: 'A2', tank: 'tiger', team: 0, ai: null, items: [] },
      { name: 'B', tank: 'tiger', team: 1, ai: null, items: [] },
    ];
    let hit = false;
    for (let p = 5; p <= 40 && !hit; p += 1) {
      const m = new Match(setups, 'valley', 11);
      m.current = 0;
      m.wind = 0;
      m.tanks[0].x = 300; m.tanks[0].y = 0; m.settle(m.tanks[0]);
      m.tanks[1].x = 360; m.tanks[1].y = 0; m.settle(m.tanks[1]);
      m.fire(shot({ angle: 60, power: p, facing: 1 }));
      if (m.tanks[1].hp < m.tanks[1].maxHp) {
        hit = true;
        expect(m.tanks[1].ult).toBeGreaterThan(0);
        expect(m.tanks[0].damageDealt).toBe(0);
      }
    }
    expect(hit).toBe(true);
  });

  it('수리킷은 체력 20%를 회복한다', () => {
    const m = new Match(duo('tiger', 'tiger', ['repair']), 'valley', 2);
    m.current = 0;
    m.tanks[0].hp = 500;
    // 멀리 쏴서 내 포탄에 맞지 않게
    m.fire(shot({ power: 70, facing: m.tanks[0].facing, itemSlot: 0 }));
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
    const m = new Match(duo('monkey', 'ox'), 'valley', 8);
    m.current = 0;
    const r = m.fire(shot({ weapon: 1, angle: 55, power: 70, facing: m.tanks[0].facing }));
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
      m.tanks[0].x = 250;
      m.tanks[0].y = 0;
      m.settle(m.tanks[0]);
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

describe('아슬아슬 맵', () => {
  it('모두 멍뭉이, 무기는 2번만, 정통으로 맞힐 수 있다', () => {
    const base = new Match(duo('tiger', 'rat'), 'ledge', 1);
    base.startTurn();
    expect(base.tanks.every((t) => t.tankId === 'dog')).toBe(true);
    expect(base.weaponLock).toBe(1);
    const snap = base.snapshot();
    let direct = 0, fell = 0, near = 0, survivedNear = 0;
    for (let a = 20; a <= 70; a += 2)
      for (let p = 10; p <= 100; p += 1) {
        const m = Match.fromSnapshot(snap);
        const shooter = m.cur;
        const target = m.tanks[1 - shooter.idx];
        const facing = target.x > shooter.x ? 1 : -1;
        const r = m.fire({ angle: a, facing, power: p, weapon: 0, itemSlot: null });
        const d = r.events.find((e) => e.type === 'damage' && e.target === target.idx) as { direct: boolean } | undefined;
        const imp = r.firstImpact;
        if (d?.direct) {
          direct++;
          if (!target.alive) fell++;
        } else if (imp && Math.abs(imp.x - target.x) > 130 && Math.abs(imp.x - target.x) < 220 && Math.abs(imp.y - target.y) < 40) {
          near++;
          if (target.alive) survivedNear++;
        }
      }
    if (process.env.DBG) console.log({ direct, fell, near, survivedNear });
    expect(direct).toBeGreaterThan(0);
  }, 30000);
});

describe('새 무기 효과', () => {
  const setup = (a: PlayerSetup['tank'], b: PlayerSetup['tank'], seed = 11) => {
    const m = new Match(duo(a, b), 'valley', seed);
    m.startTurn();
    m.current = 0;
    m.wind = 0;
    return m;
  };
  const near = (m: Match, dist: number) => {
    m.tanks[0].x = 300;
    m.tanks[0].y = 0;
    m.settle(m.tanks[0]);
    m.tanks[1].x = 300 + dist;
    m.tanks[1].y = 0;
    m.settle(m.tanks[1]);
  };

  it('쟁기탄은 세 번 터지고 구덩이가 점점 작아진다', () => {
    // 탱크에 맞지 않고 땅에 떨어지는 발사를 고른다
    let ex: { crater: number }[] = [];
    for (let p = 40; p <= 70 && ex.length !== 3; p += 3) {
      const m = setup('ox', 'tiger');
      near(m, 700);
      const r = m.fire(shot({ weapon: 1, angle: 40, power: p, facing: 1 }));
      ex = r.events.filter((e) => e.type === 'explode') as { crater: number }[];
    }
    expect(ex.length).toBe(3);
    expect(ex[1].crater).toBeLessThan(ex[0].crater);
    expect(ex[2].crater).toBeLessThan(ex[1].crater);
  });

  it('쥐떼탄은 세 마리가 굴러간다', () => {
    const m = setup('rat', 'tiger');
    near(m, 700);
    const r = m.fire(shot({ weapon: 1, angle: 40, power: 55, facing: 1 }));
    expect(r.shells.length).toBe(3);
    expect(r.shells.every((s) => s.look === 'rat')).toBe(true);
  });

  it('불·독은 초당 2%씩 최대 10%, 체력 1은 남기고, 장판은 쓰이면 사라진다', () => {
    for (const [tank, slot, kind] of [['dragon', 0, 'fire'], ['snake', 1, 'poison']] as const) {
      // 상대 바로 위로 떨어지는 탄을 찾는다
      let found = false;
      for (let a = 30; a <= 80 && !found; a += 1)
        for (let p = 20; p <= 100 && !found; p += 1) {
          const m = setup(tank, 'ox');
          near(m, 160);
          const before = m.tanks[1].hp;
          const r = m.fire(shot({ weapon: slot, angle: a, power: p, facing: 1 }));
          const dots = r.events.filter((e) => e.type === 'dot' && e.target === 1) as { amount: number; kind: string }[];
          if (!dots.length) continue;
          found = true;
          const direct = r.events.filter((e) => e.type === 'damage' && e.target === 1).reduce((s, e) => s + (e as { amount: number }).amount, 0);
          const dotSum = dots.reduce((s, e) => s + e.amount, 0);
          expect(dots.length).toBe(5);
          expect(dots[0].kind).toBe(kind);
          expect(dotSum).toBeLessThanOrEqual(Math.round(m.tanks[1].maxHp * 0.1));
          expect(m.tanks[1].hp).toBe(Math.max(1, before - direct - dotSum));
          expect(m.tanks[1].hp).toBeGreaterThanOrEqual(1);
          expect(m.zones.length).toBe(0);
        }
      expect(found).toBe(true);
    }
  });

  it('맞히지 못한 독안개는 남았다가 내 다음 차례에 사라진다', () => {
    const m = setup('snake', 'ox');
    near(m, 700);
    m.fire(shot({ weapon: 1, angle: 45, power: 30, facing: 1 }));
    expect(m.zones.length).toBe(1);
    const snap = Match.fromSnapshot(m.snapshot());
    expect(snap.zones.length).toBe(1);
    m.current = 1;
    m.tanks[0].delay = 0;
    m.tanks[1].delay = 999;
    m.startTurn();
    expect(m.current).toBe(0);
    expect(m.zones.length).toBe(0);
  });

  it('꿀꿀이 왕도토리는 폭발·구덩이가 1.25배', () => {
    const m = setup('pig', 'tiger');
    expect(m.weaponOf(m.tanks[0], 0).radius).toBe(71);
    expect(m.weaponOf(m.tanks[0], 0).crater).toBe(50);
  });
});

describe('필살기·상태 개편', () => {
  const setup = (a: PlayerSetup['tank'], b: PlayerSetup['tank']) => {
    const m = new Match(duo(a, b), 'valley', 21);
    m.startTurn();
    m.current = 0;
    m.wind = 0;
    for (const [i, x] of [[0, 300], [1, 900]] as const) {
      m.tanks[i].x = x;
      m.tanks[i].y = 0;
      m.settle(m.tanks[i]);
      m.tanks[i].ult = 100;
    }
    return m;
  };
  const fire = (m: Match, weapon: 0 | 1 | 2) => m.fire(shot({ weapon, angle: 45, power: 45, facing: 1 }));
  const explodes = (r: ReturnType<Match['fire']>) => r.events.filter((e) => e.type === 'explode');

  it('달토끼 절구: 맞은 자리에 하늘에서 떨어진다', () => {
    const r = fire(setup('rabbit', 'ox'), 2);
    expect(r.shells.length).toBe(2);
    expect(r.shells[1].path[1]).toBeLessThan(0);
    expect(explodes(r).length).toBe(1);
  });
  it('스르르 이무기: 세 번 터진다', () => {
    const r = setup('snake', 'ox').fire(shot({ weapon: 2, angle: 40, power: 35, facing: 1 }));
    expect(explodes(r).length).toBe(3);
  });
  it('꿀꿀 대폭발: 보통 크기 도토리, 다섯 번 터지고 이벤트는 시간 순', () => {
    const r = fire(setup('pig', 'ox'), 2);
    expect(r.shells[0].big).toBe(false);
    expect(explodes(r).length).toBe(5);
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].f).toBeGreaterThanOrEqual(r.events[i - 1].f);
    expect(r.frames).toBeGreaterThanOrEqual(r.events[r.events.length - 1].f);
  });
  it('여의룡 불은 땅 위에 생기고 3턴 동안 남는다', () => {
    // 아무도 없는 땅에 떨어지는 발사를 고른다
    let m = setup('dragon', 'ox');
    for (let p = 20; p <= 60; p += 2) {
      m = setup('dragon', 'ox');
      m.fire(shot({ angle: 45, power: p, facing: 1 }));
      if (m.zones.length) break;
    }
    expect(m.zones.length).toBe(1);
    const z = m.zones[0];
    expect(m.terrain.solid(z.x, z.y + 1)).toBe(true);
    expect(m.terrain.solid(z.x, z.y - 2)).toBe(false);
    const t0 = m.turn;
    m.startTurn();
    m.startTurn();
    expect(m.turn).toBe(t0 + 2);
    expect(m.zones.length).toBe(1);
    m.startTurn();
    expect(m.zones.length).toBe(0);
  });
  it('중독은 누구 차례든 3번 동안 피해', () => {
    const m = setup('rooster', 'ox');
    m.tanks[1].poison = 3;
    // 누구 차례든 차례가 끝날 때마다 3번
    for (let k = 0; k < 4; k++) {
      m.current = k % 2;
      const r = m.fire(shot({ weapon: 0, angle: 45, power: 45, facing: k % 2 ? -1 : 1 }));
      const n = r.events.filter((e) => e.type === 'dot' && e.target === 1).length;
      expect(n).toBe(k < 3 ? 5 : 0);
    }
    expect(m.tanks[1].poison).toBe(0);
  });
});

describe('중독 걸기', () => {
  it('깃털탄·이무기에 맞으면 중독(3턴)', () => {
    for (const [tank, slot] of [['rooster', 1], ['snake', 2]] as const) {
      let ok = false;
      for (let a = 20; a <= 80 && !ok; a += 1)
        for (let p = 20; p <= 100 && !ok; p += 1) {
          const m = new Match(duo(tank, 'ox'), 'valley', 31);
          m.startTurn();
          m.current = 0;
          m.wind = 0;
          m.tanks[0].ult = 100;
          m.tanks[0].x = 300; m.tanks[0].y = 0; m.settle(m.tanks[0]);
          m.tanks[1].x = 460; m.tanks[1].y = 0; m.settle(m.tanks[1]);
          const r = m.fire(shot({ weapon: slot, angle: a, power: p, facing: 1 }));
          if (r.events.some((e) => e.type === 'poisoned')) {
            ok = true;
            expect(m.tanks[1].poison).toBe(3);
            expect(r.events.some((e) => e.type === 'dot' && e.kind === 'poison' && e.target === 1)).toBe(false);
          }
        }
      expect(ok).toBe(true);
    }
  });
});

describe('팀킬·장판 높이', () => {
  it('내 포탄에 나도 맞는다 (게이지·딜량은 적에게 준 것만)', () => {
    const m = new Match(duo('pig', 'ox'), 'valley', 41);
    m.startTurn();
    m.current = 0;
    m.wind = 0;
    const me = m.tanks[0];
    const hp = me.hp;
    // 바로 앞 땅에 쏜다
    const r = m.fire(shot({ angle: 10, power: 3, facing: 1 }));
    expect(r.events.some((e) => e.type === 'damage' && e.target === 0)).toBe(true);
    expect(me.hp).toBeLessThan(hp);
    expect(me.damageDealt).toBe(0);
  });
  it('독안개는 위로 2배 높이까지 닿는다', () => {
    const m = new Match(duo('snake', 'ox'), 'valley', 41);
    m.startTurn();
    const o = m.tanks[1];
    const mk = (dy: number) => [{ id: 1, kind: 'poison' as const, x: o.x, y: o.y + dy, r: 36, h: 72, owner: 0 }];
    m.current = 0;
    m.zones = mk(70); // 탱크가 장판 바닥보다 70px 위
    m.tanks[0].x = 100; m.tanks[0].y = 0; m.settle(m.tanks[0]);
    let r = m.fire(shot({ angle: 80, power: 20, facing: -1 }));
    expect(r.events.some((e) => e.type === 'dot' && e.target === 1)).toBe(true);
    m.current = 0;
    m.zones = mk(110);
    r = m.fire(shot({ angle: 80, power: 20, facing: -1 }));
    expect(r.events.some((e) => e.type === 'dot' && e.target === 1)).toBe(false);
  });
});

describe('특수 벽', () => {
  const run = (kind: 'amp' | 'whirl' | 'double' | 'triple', power = 55) => {
    const m = new Match(duo('tiger', 'ox'), 'valley', 51);
    m.startTurn();
    m.current = 0;
    m.wind = 0;
    m.tanks[0].x = 300; m.tanks[0].y = 0; m.settle(m.tanks[0]);
    m.tanks[1].x = 1300; m.tanks[1].y = 0; m.settle(m.tanks[1]);
    let bottom = 0;
    while (!m.terrain.solid(500, bottom)) bottom++;
    m.wall = { kind, x: 500, bottom, top: 0, until: m.turn + 3 };
    return m.fire(shot({ angle: 45, power, facing: 1 }));
  };

  it('더블벽은 한 발, 트리플벽은 두 발이 더 생긴다', () => {
    expect(run('double').shells.length).toBe(2);
    expect(run('triple').shells.length).toBe(3);
  });
  it('증폭벽을 지나면 구덩이가 커진다', () => {
    const plain = new Match(duo('tiger', 'ox'), 'valley', 51);
    const a = run('amp').events.find((e) => e.type === 'explode') as { crater: number };
    expect(a.crater).toBeGreaterThan(Math.round(plain.weaponOf(plain.tanks[0], 0).crater * (1 + 0.5 * 0.55)));
  });
  it('회오리는 돌며 천장 위로 올라간다', () => {
    const r = run('whirl');
    const p = r.shells[0].path;
    let minY = Infinity;
    for (let i = 1; i < p.length; i += 2) minY = Math.min(minY, p[i]);
    expect(minY).toBeLessThan(0);
  });
  it('천장 위로 넘어가면 효과가 없다', () => {
    // 아주 높이 쏴서 벽 위(천장 밖)로 넘긴다
    const m = new Match(duo('tiger', 'ox'), 'valley', 51);
    m.startTurn();
    m.current = 0;
    m.wind = 0;
    m.tanks[0].x = 300; m.tanks[0].y = 0; m.settle(m.tanks[0]);
    m.wall = { kind: 'triple', x: 700, bottom: 700, top: 560, until: 99 };
    const r = m.fire(shot({ angle: 70, power: 100, facing: 1 }));
    expect(r.shells.length).toBe(1);
  });
  it('벽은 없을 때만 턴마다 5% 확률로 생기고 3턴 뒤 사라진다', () => {
    const m = new Match(duo(), 'valley', 61);
    let made = 0;
    for (let i = 0; i < 2000; i++) {
      const had = m.wall;
      m.startTurn();
      if (!had && m.wall) {
        made++;
        expect(m.wall.until).toBe(m.turn + 3);
      }
      if (had && m.turn < had.until) expect(m.wall).toEqual(had);
    }
    expect(made).toBeGreaterThan(40);
  });
});

describe('초보 모드', () => {
  const play = (mode: 'easy' | 'normal', ai: boolean) => {
    const setups: PlayerSetup[] = [
      { name: 'A', tank: 'tiger', team: 0, ai: ai ? 'normal' : null, items: [] },
      { name: 'B', tank: 'ox', team: 1, ai: null, items: [] },
    ];
    const m = new Match(setups, 'valley', 71, { mode });
    m.startTurn();
    m.current = 0;
    m.wind = 0;
    m.tanks[0].x = 300; m.tanks[0].y = 0; m.settle(m.tanks[0]);
    m.tanks[1].x = 800; m.tanks[1].y = 0; m.settle(m.tanks[1]);
    const r = m.fire(shot({ angle: 55, power: 60, facing: 1 }));
    return Math.abs(r.firstImpact!.x - m.tanks[1].x);
  };
  it('사람이 쏜 탄은 초보 모드에서 적 쪽으로 더 휜다', () => {
    expect(play('easy', false)).toBeLessThan(play('normal', false));
  });
  it('AI는 초보 모드 도움을 받지 않는다', () => {
    expect(play('easy', true)).toBe(play('normal', true));
  });
});

describe('벽과 독·불', () => {
  const fireThrough = (tank: 'rooster' | 'snake' | 'dragon', slot: 0 | 1, kind: 'amp' | 'double' | 'triple' | null) => {
    for (let a = 20; a <= 70; a += 1)
      for (let p = 20; p <= 100; p += 1) {
        const m = new Match(duo(tank, 'ox'), 'valley', 5);
        m.startTurn();
        m.current = 0;
        m.wind = 0;
        m.tanks[0].x = 300; m.tanks[0].y = 0; m.settle(m.tanks[0]);
        m.tanks[1].x = 700; m.tanks[1].y = 0; m.settle(m.tanks[1]);
        let b = 0;
        while (!m.terrain.solid(500, b)) b++;
        m.wall = kind ? { kind, x: 500, bottom: b, top: 0, until: 99 } : null;
        const r = m.fire(shot({ weapon: slot, angle: a, power: p, facing: 1 }));
        if (r.events.some((e) => e.type === 'damage' && e.target === 1)) return { m, r };
      }
    throw new Error('no hit');
  };
  it('벽을 지난 깃털탄도 맞으면 중독, 증폭벽이면 독이 1.3배', () => {
    for (const kind of ['amp', 'double', 'triple'] as const) {
      const { m } = fireThrough('rooster', 1, kind);
      expect(m.tanks[1].poison).toBe(3);
      expect(m.tanks[1].poisonMul).toBe(kind === 'amp' ? 1.3 : 1);
    }
  });
  it('증폭벽을 지난 독안개·불은 넓고 세다', () => {
    for (const [tank, slot] of [['snake', 1], ['dragon', 0]] as const) {
      const plain = fireThrough(tank, slot, null).r.events.find((e) => e.type === 'explode') as { zone?: { r: number } };
      const amp = fireThrough(tank, slot, 'amp').r.events.find((e) => e.type === 'explode') as { zone?: { r: number; mul?: number } };
      expect(amp.zone!.r).toBeGreaterThan(plain.zone!.r);
      expect(amp.zone!.mul).toBe(1.3);
    }
  });
});
