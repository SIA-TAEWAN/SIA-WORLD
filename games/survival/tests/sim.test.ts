import { describe, expect, it } from 'vitest';
import { LIMIT, PLAYER, TICKS_PER_SEC } from '../src/data/balance';
import { CHARACTERS } from '../src/data/characters';
import { presetUpgrades } from '../src/data/upgrades';
import { normalPolicy, simulate } from '../src/game/policy';
import { createRun, makeInput, step, summarize } from '../src/game/sim';
import { EV } from '../src/game/state';
import { advance, disarm, emptyRun, live, move, put } from './helpers';

describe('이동', () => {
  it('1초에 기본 속도만큼 간다', () => {
    const s = disarm(emptyRun());
    advance(s, 1, { input: move(1, 0) });
    expect(s.player.x).toBeCloseTo(PLAYER.speed, 3);
    expect(s.player.y).toBeCloseTo(0, 6);
  });

  it('대각선도 같은 빠르기다 (8방향)', () => {
    const s = disarm(emptyRun());
    advance(s, 1, { input: move(1, 1) });
    expect(Math.hypot(s.player.x, s.player.y)).toBeCloseTo(PLAYER.speed, 3);
    expect(s.player.fx).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('조이스틱을 반만 밀면 반만 간다, 손을 떼면 멈추고 마지막 방향을 기억한다', () => {
    const s = disarm(emptyRun());
    advance(s, 1, { input: move(0, -0.5) });
    expect(s.player.y).toBeCloseTo(-PLAYER.speed / 2, 3);
    const y = s.player.y;
    advance(s, 0.5);
    expect(s.player.y).toBe(y);
    expect(s.player.moving).toBe(false);
    expect([s.player.fx, s.player.fy]).toEqual([0, -1]);
  });

  it('이동 속도 특성(토끼 +8%)과 강화(+3%씩)가 더해진다', () => {
    const s = disarm(emptyRun({ char: 'rabbit', upgrades: { speed: 5 } }));
    expect(s.stats.speed).toBeCloseTo(PLAYER.speed * 1.23, 6);
  });
});

describe('요괴 추적과 피격', () => {
  it('요괴가 내 쪽으로 다가온다', () => {
    const s = disarm(emptyRun());
    const e = put(s, 'imp', 300, 0);
    advance(s, 1, { immortal: true });
    expect(e.x).toBeCloseTo(300 - e.speed, 0);
  });

  it('닿으면 체력이 줄고, 무적 시간 동안은 다시 맞지 않는다', () => {
    const s = disarm(emptyRun());
    const e = put(s, 'imp', 10, 0);
    step(s, makeInput());
    expect(s.player.hp).toBe(100 - Math.round(e.dmg));
    expect(s.player.inv).toBe(Math.round(PLAYER.invSec * TICKS_PER_SEC) );
    const hp = s.player.hp;
    advance(s, PLAYER.invSec - 0.1);
    expect(s.player.hp).toBe(hp);
    advance(s, 0.2);
    expect(s.player.hp).toBe(hp - Math.round(e.dmg));
  });

  it('방어(거북 등껍질·강화)는 받는 피해를 줄이되 1 아래로는 안 내려간다', () => {
    const s = disarm(emptyRun({ upgrades: { armor: 5 } }));
    put(s, 'imp', 10, 0).dmg = 10;
    step(s, makeInput());
    expect(s.player.hp).toBe(100 - 5);
    const t = disarm(emptyRun({ upgrades: { armor: 5 } }));
    put(t, 'imp', 10, 0).dmg = 2;
    step(t, makeInput());
    expect(t.player.hp).toBe(99);
  });

  it('체력이 0이 되면 게임 오버이고 더 진행하지 않는다', () => {
    const s = disarm(emptyRun());
    put(s, 'imp', 10, 0).dmg = 500;
    step(s, makeInput());
    expect(s.phase).toBe('over');
    expect(live({ items: s.events, n: s.evN }).some((e) => e.t === EV.over)).toBe(true);
    const tick = s.tick;
    step(s, makeInput());
    expect(s.tick).toBe(tick);
    expect(summarize(s).cleared).toBe(false);
  });

  it('부활 강화가 있으면 한 번 되살아나고 둘레의 요괴가 사라진다', () => {
    const s = disarm(emptyRun({ upgrades: { revive: 1 } }));
    put(s, 'imp', 10, 0).dmg = 500;
    put(s, 'imp', 100, 0);
    step(s, makeInput());
    expect(s.phase).toBe('play');
    expect(s.player.hp).toBe(50);
    expect(s.player.revives).toBe(0);
    expect(s.enemies.n).toBe(0);
    put(s, 'imp', 10, 0).dmg = 500;
    advance(s, PLAYER.reviveInvSec + 0.2);
    expect(s.phase).toBe('over');
  });

  it('요괴끼리는 겹치지 않게 밀려난다', () => {
    const s = disarm(emptyRun());
    const a = put(s, 'imp', 300, 0);
    const b = put(s, 'imp', 301, 0);
    advance(s, 1, { immortal: true });
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r);
  });

  it('너무 멀어진 요괴는 내 근처(화면 밖 둘레)로 다시 놓인다', () => {
    const s = disarm(emptyRun());
    const e = put(s, 'imp', 5000, 0);
    step(s, makeInput());
    expect(Math.abs(e.x)).toBeLessThanOrEqual(441);
    expect(Math.abs(e.y)).toBeLessThanOrEqual(861);
    expect(Math.abs(e.x) > 430 || Math.abs(e.y) > 850).toBe(true);
  });
});

describe('캐릭터', () => {
  it('기본 체력·이동 속도는 모두 같고, 특성으로만 조금 다르다', () => {
    for (const c of CHARACTERS) {
      const s = createRun({ seed: 1, char: c.id, map: 'field' });
      expect(s.stats.maxHp).toBe(c.id === 'ox' ? 110 : 100);
      expect(s.stats.speed).toBeCloseTo(PLAYER.speed * (c.id === 'rabbit' ? 1.08 : 1), 6);
      expect(s.weapons.length).toBe(1);
      expect(Math.abs(c.trait.value)).toBeLessThanOrEqual(0.25);
    }
  });

  it('영구 강화가 능력치에 반영된다 (49레벨 전부)', () => {
    const s = createRun({ seed: 1, char: 'rat', map: 'field', upgrades: presetUpgrades(49) });
    expect(s.stats.might).toBeCloseTo(1.5, 6);
    expect(s.stats.maxHp).toBe(200);
    expect(s.stats.armor).toBe(5);
    expect(s.stats.xp).toBeCloseTo(1.35, 6);
    expect(s.player.revives).toBe(1);
    expect(s.rerolls).toBe(3);
  });
});

describe('결정성과 풀', () => {
  it('같은 시드·같은 조작이면 결과가 같다', () => {
    const run = () => simulate({ seed: 777, char: 'tiger', map: 'field' }, normalPolicy(5), 150);
    const a = run();
    const b = run();
    expect([a.time, a.kills, a.level, a.coins, a.state.rng, a.state.player.x, a.state.player.y]).toEqual([b.time, b.kills, b.level, b.coins, b.state.rng, b.state.player.x, b.state.player.y]);
    expect(Array.from(a.state.dmgByWeapon)).toEqual(Array.from(b.state.dmgByWeapon));
    const c = simulate({ seed: 778, char: 'tiger', map: 'field' }, normalPolicy(5), 150);
    expect(c.state.rng).not.toBe(a.state.rng);
  }, 60000);

  it('오래 돌려도 객체 수가 늘지 않는다 (풀 재사용)', () => {
    const s = createRun({ seed: 3, char: 'rat', map: 'field', upgrades: presetUpgrades(49), startAt: 300 });
    const pools = [s.enemies, s.projectiles, s.zones, s.pickups, s.fx, s.nums] as { items: object[]; n: number }[];
    const before = pools.map((p) => new Set(p.items));
    const sizes = pools.map((p) => p.items.length);
    let maxEnemies = 0;
    advance(s, 120, { immortal: true, each: (st) => (maxEnemies = Math.max(maxEnemies, st.enemies.n)) });
    expect(s.kills).toBeGreaterThan(300);
    expect(maxEnemies).toBeGreaterThan(50);
    pools.forEach((p, i) => {
      expect(p.items.length).toBe(sizes[i]);
      expect(p.n).toBeLessThanOrEqual(sizes[i]);
      // 풀 안의 객체는 처음 만든 그 객체들 그대로다 (자리만 바뀐다)
      expect(p.items.every((o) => before[i].has(o))).toBe(true);
      expect(new Set(p.items).size).toBe(sizes[i]);
    });
    expect(s.events.length).toBe(48);
    expect(s.cards.length).toBe(3);
    expect(s.weapons.length).toBeLessThanOrEqual(LIMIT.weapons);
  }, 60000);
});
