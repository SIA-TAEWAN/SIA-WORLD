import { describe, expect, it } from 'vitest';
import { TICK } from '../src/data/balance';
import { BOSSES, BOSS_INDEX } from '../src/data/bosses';
import { TOWERS, TOWER_INDEX } from '../src/data/characters';
import { ENEMIES, ENEMY_INDEX } from '../src/data/enemies';
import { canTarget, hurt, placeOnRoute, spawnEnemy } from '../src/game/core';
import { MARK_MUL, RUSH_MUL, command, createGame, step } from '../src/game/sim';
import type { Enemy, State } from '../src/game/state';

const T = TOWER_INDEX;

/** 웨이브가 없는 빈 판 (1-1 의 길과 칸): 요괴를 직접 놓아 가며 본다. 0번 칸 [2,2], 1번 칸 [5,2] 은 윗길(행 1) 바로 아래 */
function arena(): State {
  const s = createGame({ seed: 5, stage: '1-1', squad: TOWERS.slice(0, 5).map((t) => t.id) });
  s.squad = TOWERS.map((_, i) => i); // 시험에서는 모든 캐릭터를 놓을 수 있게
  s.energy = 1e6;
  s.lives = s.startLives = 1e6;
  s.spawns = [{ t: 1e9, kind: 0, boss: -1, route: 0, hpMul: 1 }];
  command(s, 'start');
  return s;
}
/** 0번 칸 위 길에 요괴를 세운다 (dx: 길을 따라 칸 가운데에서 떨어진 거리). 걷지 않는다 */
function foe(s: State, kind: string, dx = 0, hp = 1000): Enemy {
  const e = spawnEnemy(s, ENEMY_INDEX[kind], -1, 0, 1, s.slotX[0] + 80 + dx)!;
  e.hp = e.maxHp = hp;
  e.speed = 0;
  placeOnRoute(s, e);
  return e;
}
const boss = (s: State, id: string, d = 200) => spawnEnemy(s, -1, BOSS_INDEX[id], 0, 1, d)!;
const tick = (s: State, sec: number) => {
  for (let i = 0; i < Math.round(sec / TICK); i++) step(s);
};
const put = (s: State, slot: number, id: string, lv = 1) => {
  expect(command(s, 'place', slot, T[id])).toBe(true);
  for (let i = 1; i < lv; i++) expect(command(s, 'upgrade', slot)).toBe(true);
};

describe('2~6지역의 캐릭터', () => {
  it('용: 광선이 일직선의 요괴를 모두 맞힌다. 3단계는 맞은 요괴가 계속 탄다', () => {
    const s = arena();
    put(s, 0, 'dragon');
    const L = TOWERS[T.dragon].levels[0];
    // 칸에서 오른쪽 위로 뻗는 한 줄 위의 셋 + 줄 밖의 하나
    const a = foe(s, 'imp', 60);
    const b = foe(s, 'imp', 120);
    const off = foe(s, 'imp', -120);
    // b 를 a 와 같은 방향의 조금 먼 곳(길을 따라 겹친 자리)에 둔다: 가장 앞선 요괴(b)를 겨눈 광선이 a 도 지난다
    b.d = a.d + 30;
    tick(s, 0.3);
    expect(1000 - a.hp).toBeCloseTo(L.dmg);
    expect(1000 - b.hp).toBeCloseTo(L.dmg);
    expect(off.hp).toBe(1000);
    expect(a.dotT).toBe(0);
    command(s, 'upgrade', 0);
    command(s, 'upgrade', 0);
    tick(s, 1.3);
    expect(a.dotT).toBeGreaterThan(0);
    const hp = a.hp;
    s.towers[0].off = 99; // 광선을 멈추고 불만 본다
    tick(s, 0.5);
    expect(hp - a.hp).toBeCloseTo(TOWERS[T.dragon].levels[2].burn! * 0.5, 0);
  });

  it('뱀: 독이 시간에 걸쳐 피해를 준다. 체력이 많은 요괴일수록 더 아프고, 독에 걸린 물귀신은 회복하지 못한다', () => {
    const s = arena();
    put(s, 0, 'snake');
    const L = TOWERS[T.snake].levels[0];
    const small = foe(s, 'imp', 0, 100);
    tick(s, 0.6);
    expect(small.dotT).toBeGreaterThan(0);
    expect(small.dot).toBeCloseTo(L.poison! + 100 * L.poisonPct!);
    small.alive = false;
    s.enemyN--;
    const big = foe(s, 'water', 0, 3000);
    tick(s, 1.4);
    expect(big.dot).toBeCloseTo(L.poison! + 3000 * L.poisonPct!);
    const hp = big.hp;
    s.towers[0].off = 99;
    tick(s, 1);
    // 독 1초: 회복 없이 그만큼 줄었다
    expect(hp - big.hp).toBeCloseTo(big.dot, 0);
    tick(s, 5);
    big.hp = 1000;
    tick(s, 1);
    // 독이 풀리면 다시 회복한다
    expect(big.hp).toBeGreaterThan(1000);
  });

  it('뱀 3단계: 독이 둘레의 요괴에게 번진다', () => {
    const s = arena();
    put(s, 0, 'snake', 3);
    const a = foe(s, 'imp', 30);
    const b = foe(s, 'imp', -10);
    tick(s, 0.7);
    expect(a.dotT).toBeGreaterThan(0);
    expect(b.dotT).toBeGreaterThan(0);
  });

  it('말: 사거리가 매우 길고, 체력이 가장 많은 요괴를 노린다. 3단계는 보스에게 더 큰 피해', () => {
    const s = arena();
    put(s, 0, 'horse');
    const L = TOWERS[T.horse].levels[0];
    const front = foe(s, 'imp', 60, 200);
    const strong = foe(s, 'club', -40, 5000);
    const far = foe(s, 'imp', 200, 9000); // 쥐의 사거리(175) 밖
    expect(L.range).toBeGreaterThan(300);
    tick(s, 1);
    expect(front.hp).toBe(200);
    expect(strong.hp).toBe(5000);
    expect(9000 - far.hp).toBeCloseTo(L.dmg);
    const s2 = arena();
    put(s2, 0, 'horse', 3);
    const b = boss(s2, 'bigDokkaebi', s2.slotX[0] + 80);
    b.speed = 0;
    tick(s2, 1);
    const L3 = TOWERS[T.horse].levels[2];
    expect(b.maxHp - b.hp).toBeCloseTo(L3.dmg * L3.bossMul!);
  });

  it('양: 사거리 안의 요괴가 느려진다. 3단계는 느려진 요괴가 피해를 더 받는다', () => {
    const s = arena();
    put(s, 0, 'sheep');
    const L = TOWERS[T.sheep].levels[0];
    const a = foe(s, 'imp', 0);
    const free = foe(s, 'imp', 400);
    a.speed = free.speed = 50;
    const d0 = [a.d, free.d];
    tick(s, 0.4); // 첫 구름이 닿기까지
    const d1 = [a.d, free.d];
    tick(s, 0.4);
    // 구름 안의 요괴는 0.4초 동안 50 × 느려진 배율만큼만 간다
    expect(a.d - d1[0]).toBeCloseTo(50 * L.slow! * 0.4, 0);
    expect(free.d - d0[1]).toBeCloseTo(50 * 0.8, 0);
    const s2 = arena();
    put(s2, 0, 'sheep', 3);
    const b = foe(s2, 'imp', 60); // 양의 구름 안이면서 1번 칸(쥐)의 사거리 안
    tick(s2, 0.6);
    put(s2, 1, 'rat');
    tick(s2, 1);
    const one = TOWERS[T.rat].levels[0].dmg * (1 + TOWERS[T.sheep].levels[2].vuln!);
    const hits = Math.round((1000 - b.hp) / one);
    expect(hits).toBeGreaterThanOrEqual(1);
    expect(1000 - b.hp).toBeCloseTo(hits * one);
  });

  it('원숭이: 공중 요괴를 먼저 노리고 공중에 큰 피해를 준다. 3단계는 숨은 요괴를 찾아낸다', () => {
    const s = arena();
    put(s, 0, 'monkey');
    const L = TOWERS[T.monkey].levels[0];
    const ground = foe(s, 'imp', 60);
    const air = foe(s, 'fox', -60);
    tick(s, 0.5);
    expect(ground.hp).toBe(1000);
    expect(1000 - air.hp).toBeCloseTo(L.dmg * L.airMul!);
    const s2 = arena();
    const hidden = foe(s2, 'bamboo', 0);
    hidden.on = true;
    hidden.cyc = 99;
    put(s2, 1, 'rat'); // 쥐는 숨은 요괴를 보지 못한다
    tick(s2, 1.5);
    expect(hidden.hp).toBe(1000);
    put(s2, 0, 'monkey', 3);
    tick(s2, 1);
    expect(hidden.seen).toBeGreaterThan(0);
    expect(hidden.hp).toBeLessThan(1000);
  });

  it('닭: 사거리 안 다른 캐릭터의 공격 속도를 올린다 (직접 공격은 약하다)', () => {
    const count = (withRooster: boolean) => {
      const s = arena();
      put(s, 1, 'tiger');
      if (withRooster) put(s, 2, 'rooster'); // [6,3]: 1번 칸 [5,2] 곁
      foe(s, 'imp', 240, 1e6); // 1번 칸 바로 위
      const e = s.enemies[0];
      tick(s, 20);
      return { hits: (1e6 - e.hp) / TOWERS[T.tiger].levels[0].dmg, haste: s.towers[1].haste };
    };
    const a = count(false);
    const b = count(true);
    expect(a.haste).toBe(0);
    expect(b.haste).toBeCloseTo(TOWERS[T.rooster].levels[0].haste!);
    expect(b.hits / a.hits).toBeGreaterThan(1.12);
    // 직접 공격은 쥐보다 약하다 (초당 피해)
    expect(TOWERS[T.rooster].levels[0].dmg / TOWERS[T.rooster].levels[0].every).toBeLessThan(TOWERS[T.rat].levels[0].dmg / TOWERS[T.rat].levels[0].every);
  });
});

describe('2~6지역의 요괴', () => {
  it('여우불(공중): 공중을 맞힐 수 있는 캐릭터만 노린다 (호랑이·토끼·소는 못 맞힌다)', () => {
    expect(TOWERS.filter((t) => !t.air).map((t) => t.id)).toEqual(['ox', 'tiger', 'rabbit', 'dog', 'pig']);
    const s = arena();
    put(s, 0, 'tiger');
    put(s, 1, 'rabbit');
    const fox = foe(s, 'fox', 40);
    tick(s, 3);
    expect(fox.hp).toBe(1000);
    command(s, 'sell', 0);
    put(s, 0, 'rat');
    tick(s, 1);
    expect(fox.hp).toBeLessThan(1000);
  });

  it('죽순 요괴(은신): 숨어 있는 동안에는 노릴 수 없고, 고개를 내밀면 맞는다', () => {
    const s = arena();
    const e = foe(s, 'bamboo', 0);
    const cyc = ENEMIES[ENEMY_INDEX.bamboo].cycle!;
    e.on = true;
    e.cyc = cyc.on;
    expect(canTarget(e, true)).toBe(false);
    put(s, 0, 'rat');
    tick(s, cyc.on - 0.2);
    expect(e.hp).toBe(1000);
    tick(s, 0.2 + cyc.off);
    expect(e.hp).toBeLessThan(1000);
    // 다시 숨는다
    tick(s, 0.2);
    expect(e.on).toBe(true);
  });

  it('물귀신: 체력이 조금씩 회복된다 / 방망이 도깨비: 느리고 단단하다', () => {
    const s = arena();
    const w = foe(s, 'water', 0, 1000);
    w.hp = 500;
    tick(s, 2);
    expect(w.hp).toBeCloseTo(500 + 1000 * ENEMIES[ENEMY_INDEX.water].regen! * 2, 0);
    const club = ENEMIES[ENEMY_INDEX.club];
    const imp = ENEMIES[ENEMY_INDEX.imp];
    expect(club.hp).toBeGreaterThan(imp.hp * 4);
    expect(club.speed).toBeLessThan(imp.speed * 0.7);
  });
});

describe('2~6지역의 보스', () => {
  it('두억시니: 꼬마 도깨비를 계속 불러낸다', () => {
    const s = arena();
    boss(s, 'dueoksini');
    const p = BOSSES[BOSS_INDEX.dueoksini].p;
    tick(s, p.every * 2.6);
    // 처음은 절반 시간 뒤, 그 뒤로 every 초마다
    expect(s.enemyN).toBe(1 + 3 * p.count);
    expect(s.enemies.filter((e) => e.alive && e.boss < 0).every((e) => e.kind === p.kind)).toBe(true);
  });

  it('불가살: 시간이 갈수록 받는 피해가 줄어든다', () => {
    const s = arena();
    const b = boss(s, 'bulgasal', s.slotX[0] + 80);
    b.speed = 0;
    b.hp = b.maxHp = 1e7;
    const p = BOSSES[BOSS_INDEX.bulgasal].p;
    tick(s, 2);
    let hp = b.hp;
    hurt(s, b, 100);
    expect(hp - b.hp).toBeCloseTo(100 * (1 - p.rate * 2), 0);
    tick(s, 60);
    expect(b.armor).toBeCloseTo(Math.min(p.max, p.rate * 62), 1);
    hp = b.hp;
    hurt(s, b, 100);
    expect(hp - b.hp).toBeCloseTo(100 * (1 - Math.min(p.max, p.rate * 62)), 0);
    // 끝없이 단단해지지는 않는다
    tick(s, 200);
    expect(b.armor).toBe(p.max);
  });

  it('장산범: 잠깐 사라졌다가(그동안 노릴 수 없다) 앞쪽에서 다시 나타난다', () => {
    const s = arena();
    const b = boss(s, 'jangsanbeom');
    const p = BOSSES[BOSS_INDEX.jangsanbeom].p;
    tick(s, p.every + 0.2);
    expect(b.gone).toBeGreaterThan(0);
    expect(canTarget(b, true)).toBe(false);
    const d = b.d;
    tick(s, p.gone);
    expect(b.gone).toBe(0);
    expect(b.d - d).toBeGreaterThanOrEqual(p.jump);
    expect(canTarget(b, true)).toBe(true);
  });

  it('왕지네: 마디가 줄지어 따라오고, 마디가 남아 있는 동안 머리는 다치지 않는다', () => {
    const s = arena();
    const b = boss(s, 'centipede', s.slotX[0] + 80);
    const p = BOSSES[BOSS_INDEX.centipede].p;
    tick(s, 0.1);
    const segs = s.enemies.filter((e) => e.alive && e.look === b.boss);
    expect(segs).toHaveLength(p.segs);
    expect(b.armor).toBe(1);
    put(s, 0, 'tiger');
    b.speed = 0;
    for (const m of segs) m.speed = 0;
    tick(s, 1);
    expect(b.hp).toBe(b.maxHp);
    // 마디를 모두 쓰러뜨리면 머리가 다친다
    for (const m of segs) {
      m.alive = false;
      s.enemyN--;
    }
    tick(s, 1.2);
    expect(b.armor).toBe(0);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('구미호: 체력이 1/4 씩 줄 때마다 분신이 생긴다 (길이 여럿이면 다른 길로 나뉘어 온다)', () => {
    const s = createGame({ seed: 1, stage: '6-5', squad: ['rat'] });
    s.lives = s.startLives = 1e6;
    s.spawns = [{ t: 1e9, kind: 0, boss: -1, route: 0, hpMul: 1 }];
    command(s, 'start');
    const b = spawnEnemy(s, -1, BOSS_INDEX.gumiho, 0, 1, 300)!;
    const p = BOSSES[BOSS_INDEX.gumiho].p;
    tick(s, 0.1);
    expect(s.enemyN).toBe(1);
    b.hp = b.maxHp * 0.7;
    tick(s, 0.1);
    const clones = s.enemies.filter((e) => e.alive && e.look === b.boss);
    expect(clones).toHaveLength(s.ground.length - 1);
    expect(clones[0].route).not.toBe(b.route);
    expect(clones[0].leak).toBe(p.leak);
    expect(clones[0].maxHp).toBe(Math.round(b.maxHp * p.hp));
    b.hp = b.maxHp * 0.2;
    tick(s, 0.1);
    tick(s, 0.1);
    // 3/4 · 2/4 · 1/4: 모두 세 번
    expect(s.enemies.filter((e) => e.alive && e.look === b.boss)).toHaveLength(3 * (s.ground.length - 1));
  });
});

describe('7~12지역의 캐릭터·요괴', () => {
  it('개: 숨은 요괴를 드러내고, 강아지가 물어 세운다. 3단계는 2마리', () => {
    const s = arena();
    const hidden = foe(s, 'bamboo', 0);
    hidden.on = true;
    hidden.cyc = 99;
    put(s, 0, 'dog');
    tick(s, 1.2);
    expect(hidden.seen).toBeGreaterThan(0);
    expect(hidden.hp).toBeLessThan(1000);
    expect(hidden.stun + hidden.guard).toBeGreaterThan(0);
    command(s, 'upgrade', 0);
    command(s, 'upgrade', 0);
    foe(s, 'imp', 30);
    s.projectiles.n = 0;
    s.towers[0].cd = 0;
    tick(s, 0.05);
    expect(s.projectiles.n).toBe(2);
  });

  it('돼지: 웨이브가 시작될 때마다 기운을 번다. 3단계는 엽전도 (공격은 하지 않는다)', () => {
    const s = createGame({ seed: 1, stage: '1-1', squad: ['rat'] });
    s.squad = TOWERS.map((_, i) => i);
    s.energy = 10000;
    s.lives = s.startLives = 1e6;
    put(s, 0, 'pig');
    put(s, 1, 'pig', 3);
    const L = TOWERS[T.pig].levels;
    command(s, 'start');
    let e0 = s.energy;
    tick(s, 0.1); // 첫 웨이브 시작
    expect(s.energy - e0).toBe(L[0].income! + L[2].income!);
    expect(s.bonus).toBe(L[2].coin);
    e0 = s.energy;
    const kills0 = s.kills;
    tick(s, 60); // 웨이브 둘 더
    expect(s.energy - e0).toBe(2 * (L[0].income! + L[2].income!));
    expect(s.bonus).toBe(3 * L[2].coin!);
    expect(s.kills).toBe(kills0);
  });

  it('수문장 요괴: 앞에서 온 공격은 방패가 막고, 뒤에서 온 공격·광선·독은 그대로 받는다', () => {
    const s = arena();
    const g = foe(s, 'guard', 0);
    const shield = ENEMIES[ENEMY_INDEX.guard].shield!;
    // 요괴는 오른쪽으로 간다: 오른쪽에서 온 공격이 정면
    hurt(s, g, 100, g.x + 50, g.y);
    expect(1000 - g.hp).toBeCloseTo(100 * shield);
    hurt(s, g, 100, g.x - 50, g.y);
    expect(1000 - g.hp).toBeCloseTo(100 * shield + 100);
    hurt(s, g, 100);
    expect(1000 - g.hp).toBeCloseTo(100 * shield + 200);
  });

  it('해골 병사: 쓰러져도 한 번 되살아난다 (누워 있는 동안에는 노릴 수 없다)', () => {
    const s = arena();
    const k = foe(s, 'skeleton', 0, 100);
    hurt(s, k, 999);
    expect(k.alive).toBe(true);
    expect(k.down).toBeGreaterThan(0);
    expect(canTarget(k, true)).toBe(false);
    expect(s.kills).toBe(0);
    tick(s, 2.1);
    expect(k.down).toBeLessThanOrEqual(0);
    expect(k.hp).toBeCloseTo(50);
    hurt(s, k, 999);
    expect(k.alive).toBe(false);
    expect(s.kills).toBe(1);
  });

  it('원혼: 무적인 동안에는 피해를 받지 않지만 멈춤·감속은 먹힌다', () => {
    const s = arena();
    const g = foe(s, 'spirit', 0);
    g.on = true;
    g.cyc = 99;
    hurt(s, g, 100);
    expect(g.hp).toBe(1000);
    put(s, 0, 'ox');
    tick(s, 0.4);
    expect(g.stun).toBeGreaterThan(0);
    expect(g.hp).toBe(1000);
    g.on = false;
    hurt(s, g, 100);
    expect(g.hp).toBe(900);
  });
});

describe('7~12지역의 보스', () => {
  const near = (s: State, id: string) => {
    const b = boss(s, id, s.slotX[0] + 80);
    b.speed = 0;
    return b;
  };
  it('수문장 대장: 정면 방패 + 둘레의 요괴를 빠르게 한다', () => {
    const s = arena();
    const b = near(s, 'guardCaptain');
    expect(b.shield).toBeLessThan(1);
    const a = foe(s, 'imp', 40);
    a.speed = 50;
    const d = a.d;
    tick(s, 1);
    expect(a.d - d).toBeCloseTo(50 * RUSH_MUL, 0);
  });

  it('야광귀: 가까운 캐릭터 하나를 잠깐 멈춘다 (멈춘 동안 공격하지 못한다)', () => {
    const s = arena();
    put(s, 0, 'tiger');
    put(s, 3, 'tiger'); // 먼 칸
    const b = near(s, 'yagwanggwi');
    b.hp = b.maxHp = 1e7;
    const p = BOSSES[BOSS_INDEX.yagwanggwi].p;
    tick(s, p.every * 0.5 + 0.1);
    expect(s.towers[0].off).toBeGreaterThan(0);
    expect(s.towers[3].off).toBe(0);
    const hp = b.hp;
    tick(s, p.dur - 0.5);
    expect(b.hp).toBe(hp);
    tick(s, 1.5);
    expect(b.hp).toBeLessThan(hp);
  });

  it('이무기: 물기둥으로 둘레의 캐릭터들을 한꺼번에 멈춘다', () => {
    const s = arena();
    put(s, 0, 'rat');
    put(s, 1, 'rat');
    put(s, 9, 'rat');
    const b = boss(s, 'imugi', s.slotX[0] + 160);
    b.speed = 0;
    const p = BOSSES[BOSS_INDEX.imugi].p;
    tick(s, p.every * 0.5 + 0.1);
    expect(s.towers[0].off).toBeGreaterThan(0);
    expect(s.towers[1].off).toBeGreaterThan(0);
    expect(s.towers[9].off).toBe(0);
  });

  it('저승사자: 표식이 찍힌 캐릭터는 공격 속도가 절반이 된다 (가장 많이 키운 캐릭터부터)', () => {
    const s = arena();
    put(s, 0, 'rat');
    put(s, 1, 'tiger', 3);
    near(s, 'reaper');
    const p = BOSSES[BOSS_INDEX.reaper].p;
    tick(s, p.every * 0.5 + 0.1);
    expect(s.towers[1].mark).toBeGreaterThan(0);
    expect(s.towers[0].mark).toBe(0);
    expect(MARK_MUL).toBe(0.5);
  });

  it('강철이: 가까운 배치 칸을 잠시 못 쓰게 한다 (빈 칸에는 놓을 수 없다)', () => {
    const s = arena();
    near(s, 'gangcheori');
    const p = BOSSES[BOSS_INDEX.gangcheori].p;
    tick(s, p.every * 0.5 + 0.1);
    expect(s.towers.filter((t) => t.off > 0)).toHaveLength(p.count);
    expect(s.towers[0].off).toBeGreaterThan(0);
    expect(command(s, 'place', 0, T.rat)).toBe(false);
    tick(s, p.dur);
    expect(command(s, 'place', 0, T.rat)).toBe(true);
  });

  it('염라대왕: 졸개를 계속 부르고, 곁에서 쓰러진 요괴를 가끔 되살린다 (한 요괴는 한 번만)', () => {
    const s = arena();
    const b = near(s, 'yeomra');
    const p = BOSSES[BOSS_INDEX.yeomra].p;
    let raised = 0;
    for (let i = 0; i < 40; i++) {
      const e = foe(s, 'imp', 20, 10);
      hurt(s, e, 99);
      if (e.alive) {
        raised++;
        expect(e.down).toBeGreaterThan(0);
        e.down = 0;
        hurt(s, e, 9999);
        expect(e.alive).toBe(false);
      }
    }
    expect(raised).toBeGreaterThan(40 * p.chance * 0.4);
    expect(raised).toBeLessThan(40 * p.chance * 1.8);
    const n = s.enemyN;
    tick(s, p.every * 0.5 + 0.1);
    expect(s.enemyN).toBe(n + p.count);
    expect(s.enemies.some((e) => e.alive && e.boss < 0 && e.kind === p.kind)).toBe(true);
    expect(b.alive).toBe(true);
  });
});
