import { describe, expect, it } from 'vitest';
import { BOSS_STUN_MUL, STUN_GUARD_SEC, TICK } from '../src/data/balance';
import { BOSS_INDEX, BOSSES } from '../src/data/bosses';
import { TOWERS, TOWER_INDEX } from '../src/data/characters';
import { ENEMY_INDEX } from '../src/data/enemies';
import { DASH } from '../src/game/bosses';
import { placeOnRoute, spawnEnemy } from '../src/game/core';
import { command, createGame, step } from '../src/game/sim';
import type { Enemy, State } from '../src/game/state';
import { T, game, rich, start } from './helpers';

/** 웨이브가 없는 빈 판: 요괴를 직접 놓아 가며 공격을 본다 */
function arena(): State {
  const s = rich(game('1-1'));
  s.spawns = [{ t: 1e9, kind: 0, boss: -1, route: 0, hpMul: 1 }]; // 판이 끝나지 않게 먼 뒤의 등장 하나
  start(s);
  return s;
}

/** 0번 칸([2,2])의 바로 위 길(행 1)에 요괴를 세운다. dx: 칸 가운데에서 길을 따라 얼마나 떨어져 있나 */
function foe(s: State, dx = 0, hp = 1000, kind = 'imp'): Enemy {
  const e = spawnEnemy(s, ENEMY_INDEX[kind], -1, 0, 1, s.slotX[0] + 80 + dx)!;
  e.hp = e.maxHp = hp;
  e.speed = 0;
  placeOnRoute(s, e);
  return e;
}
const tick = (s: State, sec: number) => {
  for (let i = 0; i < Math.round(sec / TICK); i++) step(s);
};

describe('쥐: 표창', () => {
  it('사거리 안의 요괴에게 표창을 던져 피해를 준다. 사거리 밖은 건드리지 않는다', () => {
    const s = arena();
    command(s, 'place', 0, T.rat);
    const L = TOWERS[T.rat].levels[0];
    const near = foe(s, 0);
    const far = foe(s, L.range + 60);
    tick(s, 3);
    expect(near.hp).toBeLessThan(1000);
    expect((1000 - near.hp) % L.dmg).toBe(0);
    // 3초 동안 대략 3 / 간격 번
    expect((1000 - near.hp) / L.dmg).toBeGreaterThanOrEqual(Math.floor(2.4 / L.every));
    expect(far.hp).toBe(1000);
  });

  it('3단계: 표창을 2개씩 던진다 (요괴가 둘이면 하나씩, 하나뿐이면 둘 다 그 요괴에게)', () => {
    const s = arena();
    command(s, 'place', 0, T.rat);
    command(s, 'upgrade', 0);
    command(s, 'upgrade', 0);
    const L = TOWERS[T.rat].levels[2];
    const a = foe(s, 20);
    const b = foe(s, -20);
    tick(s, 0.26); // 첫 공격 (배치 뒤 0.25초)
    expect(s.projectiles.n).toBe(2);
    tick(s, 0.3);
    expect(1000 - a.hp).toBe(L.dmg);
    expect(1000 - b.hp).toBe(L.dmg);
    b.alive = false;
    s.enemyN--;
    const hp = a.hp;
    tick(s, L.every);
    expect(hp - a.hp).toBe(L.dmg * 2);
  });

  it('출구에 가장 가까운(가장 앞선) 요괴를 먼저 노린다', () => {
    const s = arena();
    command(s, 'place', 0, T.rat);
    const back = foe(s, -40);
    const front = foe(s, 40);
    tick(s, 1);
    expect(front.hp).toBeLessThan(1000);
    expect(back.hp).toBe(1000);
  });
});

describe('소: 방울', () => {
  it('사거리 안의 요괴를 모두 잠깐 멈춘다. 멈춤이 풀린 직후에는 다시 멈추지 않는다', () => {
    const s = arena();
    command(s, 'place', 0, T.ox);
    const L = TOWERS[T.ox].levels[0];
    const a = foe(s, 10);
    const b = foe(s, -30);
    const far = foe(s, L.range + 80);
    tick(s, 0.3);
    expect(a.stun).toBeGreaterThan(0);
    expect(b.stun).toBeGreaterThan(0);
    expect(far.stun).toBe(0);
    expect(1000 - a.hp).toBe(L.dmg);
    // 멈춘 동안에는 걷지 못한다
    a.speed = 60;
    const d = a.d;
    tick(s, L.stun! - 0.2);
    expect(a.d).toBe(d);
    tick(s, 0.4);
    expect(a.stun).toBeLessThanOrEqual(0);
    expect(a.guard).toBeGreaterThan(0);
    expect(a.guard).toBeLessThanOrEqual(STUN_GUARD_SEC);
    expect(a.d).toBeGreaterThan(d);
    // 보호 시간 안에 방울이 또 울려도 멈추지 않는다 (피해는 입는다)
    a.guard = 99;
    a.speed = 0;
    tick(s, L.every + 0.2);
    expect(a.stun).toBeLessThanOrEqual(0);
    expect(1000 - a.hp).toBeGreaterThanOrEqual(L.dmg * 2);
  });

  it('3단계는 멈춤 시간이 길고, 보스는 멈춤이 짧게 먹힌다', () => {
    const s = arena();
    command(s, 'place', 0, T.ox);
    command(s, 'upgrade', 0);
    command(s, 'upgrade', 0);
    const L = TOWERS[T.ox].levels[2];
    const a = foe(s, 0);
    const boss = spawnEnemy(s, -1, BOSS_INDEX.bigDokkaebi, 0, 1, s.slotX[0] + 60)!;
    tick(s, 0.26);
    expect(a.stun).toBeCloseTo(L.stun!, 1);
    expect(boss.stun).toBeCloseTo(L.stun! * BOSS_STUN_MUL, 1);
  });
});

describe('호랑이: 발톱', () => {
  it('사거리가 짧고 한 번에 크게 벤다. 2단계까지는 한 마리만', () => {
    const s = arena();
    command(s, 'place', 0, T.tiger);
    const L = TOWERS[T.tiger].levels[0];
    const a = foe(s, 20);
    const b = foe(s, -20);
    const far = foe(s, L.range + 40);
    tick(s, 0.26);
    expect(1000 - a.hp).toBe(L.dmg);
    expect(b.hp).toBe(1000);
    expect(far.hp).toBe(1000);
    expect(L.range).toBeLessThan(TOWERS[T.rat].levels[0].range);
  });

  it('3단계: 둘레의 요괴까지 함께 벤다', () => {
    const s = arena();
    command(s, 'place', 0, T.tiger);
    command(s, 'upgrade', 0);
    command(s, 'upgrade', 0);
    const L = TOWERS[T.tiger].levels[2];
    const a = foe(s, 20);
    const b = foe(s, -20);
    tick(s, 0.26);
    expect(1000 - a.hp).toBe(L.dmg);
    expect(1000 - b.hp).toBe(L.dmg);
  });
});

describe('토끼: 달떡', () => {
  it('떡이 떨어진 자리 둘레의 요괴가 함께 피해를 입는다. 3단계는 범위가 넓다', () => {
    const s = arena();
    command(s, 'place', 0, T.rabbit);
    const L = TOWERS[T.rabbit].levels[0];
    const a = foe(s, 40);
    const b = foe(s, 0);
    const edge = foe(s, 40 - (L.splash! + 18 + 12)); // 1단계 범위 밖, 3단계 범위 안
    tick(s, 0.26);
    expect(s.projectiles.n).toBe(1);
    expect(a.hp).toBe(1000); // 떡이 날아가는 중
    tick(s, 0.6);
    expect(1000 - a.hp).toBe(L.dmg);
    expect(1000 - b.hp).toBe(L.dmg);
    expect(edge.hp).toBe(1000);
    command(s, 'upgrade', 0);
    command(s, 'upgrade', 0);
    tick(s, 2.2);
    expect(edge.hp).toBeLessThan(1000);
  });

  it('걷는 요괴가 갈 자리를 겨눠 맞힌다', () => {
    const s = arena();
    command(s, 'place', 0, T.rabbit);
    const a = foe(s, -60, 1000, 'wisp');
    a.speed = 112;
    tick(s, 1);
    expect(a.hp).toBeLessThan(1000);
  });
});

describe('큰 도깨비: 돌진', () => {
  it('가끔 멈춰 벼른 뒤 빠르게 돌진하고, 다시 걷는다', () => {
    const s = arena();
    const def = BOSSES[BOSS_INDEX.bigDokkaebi];
    const boss = spawnEnemy(s, -1, BOSS_INDEX.bigDokkaebi, 0, 1, 0)!;
    expect(boss.hp).toBe(def.hp);
    expect(boss.leak).toBe(5);
    tick(s, def.p.every - 0.5);
    expect(boss.b).toBe(DASH.walk);
    expect(boss.d).toBeCloseTo(def.speed * (def.p.every - 0.5), 0);
    tick(s, 0.5 + def.p.warn / 2);
    expect(boss.b).toBe(DASH.windup);
    const d0 = boss.d;
    tick(s, def.p.warn / 2 - 0.1);
    expect(boss.d).toBe(d0); // 벼르는 동안에는 멈춰 있다
    tick(s, 0.2 + def.p.dur / 2);
    expect(boss.b).toBe(DASH.dash);
    tick(s, def.p.dur / 2 + 0.1);
    expect(boss.b).toBe(DASH.walk);
    // 돌진으로 걸을 때보다 훨씬 멀리 갔다
    expect(boss.d - d0).toBeGreaterThan(def.speed * def.p.dur * (def.p.mul - 0.3));
    expect(boss.mul).toBe(1);
  });
});

describe('고양이: 마무리 사냥 (십이지 밖, 13번째 대원)', () => {
  const C = TOWER_INDEX.cat;
  function catArena(): State {
    const s = rich(createGame({ seed: 1, stage: '1-1', squad: ['rat', 'cat'] }));
    s.spawns = [{ t: 1e9, kind: 0, boss: -1, route: 0, hpMul: 1 }];
    start(s);
    return s;
  }
  it('사거리 안에서 남은 체력이 가장 적은 요괴부터 바로 할퀸다 (투사체 없이, 출구에 가까운 요괴보다 먼저)', () => {
    const s = catArena();
    command(s, 'place', 0, C);
    const L = TOWERS[C].levels[0];
    const ahead = foe(s, 40, 1000);
    const weak = foe(s, -40, 300);
    tick(s, 0.3); // 첫 공격 (배치 뒤 0.25초)
    expect(s.projectiles.n).toBe(0);
    expect(1000 - ahead.hp).toBe(0);
    expect(300 - weak.hp).toBe(L.dmg);
  });
  it('3단계: 할퀸 뒤 체력이 1/5 이하로 남은 요괴는 바로 쓰러진다. 보스는 아니다', () => {
    const s = catArena();
    command(s, 'place', 0, C);
    command(s, 'upgrade', 0);
    command(s, 'upgrade', 0);
    const L = TOWERS[C].levels[2];
    expect(L.execute).toBe(0.2);
    const e = foe(s, 0, 1000);
    e.hp = 200 + L.dmg - 1; // 한 번 할퀴면 1/5 아래
    const kills = s.kills;
    tick(s, 0.3);
    expect(e.alive).toBe(false);
    expect(s.kills).toBe(kills + 1);
    // 보스는 마무리되지 않는다
    const b = spawnEnemy(s, -1, BOSS_INDEX[BOSSES[0].id], 0, 1, s.slotX[0] + 80)!;
    b.speed = 0;
    placeOnRoute(s, b);
    b.hp = b.maxHp * 0.1;
    const hp = b.hp;
    tick(s, 0.8);
    expect(b.alive).toBe(true);
    expect(b.hp).toBeLessThan(hp);
  });
});
