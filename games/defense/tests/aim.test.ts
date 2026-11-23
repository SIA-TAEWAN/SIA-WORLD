import { describe, expect, it } from 'vitest';
import { TICK, type CharId } from '../src/data/balance';
import { ROSTER, TOWERS, TOWER_INDEX } from '../src/data/characters';
import { ENDLESS_ID } from '../src/data/endless';
import { ENEMY_INDEX } from '../src/data/enemies';
import { AIM, AIM_AIR, AIM_CHOICES, findTarget, placeOnRoute, spawnEnemy } from '../src/game/core';
import { SKILLS, simulate, skillPolicy } from '../src/game/policy';
import { LIMITS } from '../src/game/progress';
import { AIM_CMDS_MAX, canSetAim, command, createGame, replay, step, summarize } from '../src/game/sim';
import type { Enemy, State } from '../src/game/state';
import { aimMode, canAim, defaultAim } from '../src/game/towers';

/** 조준 우선순위 바꾸기: 방식별 과녁 고르기 · 'aim' 명령 · 기본값이면 예전과 같은 결과 */

function arena(squad: CharId[] = ['rat', 'ox', 'tiger', 'rabbit']): State {
  const s = createGame({ seed: 1, stage: '1-1', squad });
  s.energy = 100000;
  s.spawns = [{ t: 1e9, kind: 0, boss: -1, route: 0, hpMul: 1 }];
  command(s, 'start');
  return s;
}
/** 0번 칸 가까운 길 위에 멈춰 선 요괴. dx 가 클수록 출구 쪽(앞쪽) */
function foe(s: State, dx: number, hp: number, kind = 'imp'): Enemy {
  const e = spawnEnemy(s, ENEMY_INDEX[kind], -1, 0, 1, s.slotX[0] + 80 + dx)!;
  e.hp = hp;
  e.maxHp = 1000;
  e.speed = 0;
  placeOnRoute(s, e);
  return e;
}
const tick = (s: State, sec: number) => {
  for (let i = 0; i < Math.round(sec / TICK); i++) step(s);
};
const pick = (s: State, aim: number, air = true, skip = -1) => {
  const i = findTarget(s, s.slotX[0], s.slotY[0], 400, air, aim, skip);
  return i < 0 ? null : s.enemies[i];
};

describe('findTarget: 조준 방식별 과녁', () => {
  it('앞쪽 = 출구에 가장 가까운 요괴, 뒤쪽 = 가장 먼 요괴, 강한 놈 = 체력이 가장 많은, 약한 놈 = 가장 적은 요괴', () => {
    const s = arena();
    const front = foe(s, 40, 500);
    const back = foe(s, -40, 300);
    const strong = foe(s, 10, 900);
    const weak = foe(s, -10, 100);
    expect(pick(s, AIM.first)).toBe(front);
    expect(pick(s, AIM.last)).toBe(back);
    expect(pick(s, AIM.strong)).toBe(strong);
    expect(pick(s, AIM.weak)).toBe(weak);
    // skip: 그 요괴를 빼고 다음 것
    expect(pick(s, AIM.last, true, back.uid)).toBe(weak);
    // 사거리 밖은 어느 방식으로도 고르지 않는다
    expect(findTarget(s, s.slotX[0], s.slotY[0], 1, true, AIM.last)).toBe(-1);
  });

  it('공중 먼저(AIM_AIR): 공중 요괴가 있으면 그 안에서 방식을 따르고, 없으면 땅 위에서 고른다', () => {
    const s = arena();
    const ground = foe(s, 60, 50);
    const groundBig = foe(s, -60, 990);
    const airFront = foe(s, 20, 800, 'fox');
    const airBack = foe(s, -20, 200, 'fox');
    // 예전의 '공중 먼저'(AIM.air) = 공중 먼저 + 앞쪽
    expect(pick(s, AIM.air)).toBe(airFront);
    expect(pick(s, AIM.first | AIM_AIR)).toBe(airFront);
    expect(pick(s, AIM.last | AIM_AIR)).toBe(airBack);
    expect(pick(s, AIM.strong | AIM_AIR)).toBe(airFront);
    expect(pick(s, AIM.weak | AIM_AIR)).toBe(airBack);
    // 공중 먼저가 아니면 체력만 본다
    expect(pick(s, AIM.weak)).toBe(ground);
    expect(pick(s, AIM.strong)).toBe(groundBig);
    // 공중을 못 맞히는 캐릭터는 공중 요괴를 고르지 않는다 (제약은 그대로)
    expect(pick(s, AIM.last, false)).toBe(groundBig);
    airFront.alive = airBack.alive = false;
    expect(pick(s, AIM.weak | AIM_AIR)).toBe(ground);
  });
});

describe("'aim' 명령", () => {
  it('기본값은 캐릭터의 고정값: 쥐 앞쪽 · 말 강한 놈 · 고양이 약한 놈 · 원숭이는 공중 먼저(앞쪽으로 보인다)', () => {
    const s = arena(['rat', 'horse', 'cat', 'monkey', 'ox']);
    (['rat', 'horse', 'cat', 'monkey'] as const).forEach((c, i) => command(s, 'place', i, TOWER_INDEX[c]));
    expect(s.towers.slice(0, 4).map((t) => t.aim)).toEqual([-1, -1, -1, -1]);
    expect(s.towers.slice(0, 4).map(aimMode)).toEqual([AIM.first, AIM.strong, AIM.weak, AIM.first]);
    expect(defaultAim(TOWER_INDEX.monkey)).toBe(AIM.air);
  });

  it('고른 방식의 요괴를 공격한다. 같은 방식·없는 방식·빈 칸·둘레 공격 캐릭터는 받지 않는다', () => {
    const s = arena();
    const rat = TOWER_INDEX.rat;
    command(s, 'place', 0, rat);
    command(s, 'place', 1, TOWER_INDEX.ox);
    const front = foe(s, 30, 400);
    const big = foe(s, -30, 900);
    const n = s.log.length;
    expect(command(s, 'aim', 0, AIM.first)).toBe(false); // 이미 앞쪽
    expect(command(s, 'aim', 0, AIM.air)).toBe(false); // 고를 수 없는 방식
    expect(command(s, 'aim', 0, 7)).toBe(false);
    expect(command(s, 'aim', 5, AIM.strong)).toBe(false); // 빈 칸
    expect(canAim(TOWER_INDEX.ox)).toBe(false);
    expect(command(s, 'aim', 1, AIM.strong)).toBe(false); // 소는 둘레 전부를 멈춘다
    expect(s.log.length).toBe(n);
    expect(command(s, 'aim', 0, AIM.strong)).toBe(true);
    expect(s.log[n]).toEqual({ tick: s.tick, op: 'aim', slot: 0, char: AIM.strong });
    expect(aimMode(s.towers[0])).toBe(AIM.strong);
    // 소를 치우고(둘레 피해가 섞이지 않게) 쥐만 본다
    command(s, 'sell', 1);
    tick(s, 2);
    expect(big.hp).toBeLessThan(900);
    expect(front.hp).toBe(400);
    // 뒤쪽으로 바꾸면 다음 공격부터 (지금은 big 이 더 뒤다 → 그대로), 앞쪽으로 돌리면 front
    expect(command(s, 'aim', 0, AIM.first)).toBe(true);
    tick(s, 2);
    expect(front.hp).toBeLessThan(400);
  });

  it('호랑이·토끼·용도 조준을 바꿀 수 있다 (기본은 앞쪽)', () => {
    const s = arena(['tiger', 'rabbit', 'dragon', 'rat', 'ox']);
    command(s, 'place', 0, TOWER_INDEX.tiger);
    const front = foe(s, 20, 600);
    const back = foe(s, -20, 600);
    tick(s, 0.5);
    expect(front.hp).toBeLessThan(600);
    expect(back.hp).toBe(600);
    const was = front.hp;
    expect(command(s, 'aim', 0, AIM.last)).toBe(true);
    tick(s, TOWERS[TOWER_INDEX.tiger].levels[0].every + 0.1);
    expect(back.hp).toBeLessThan(600);
    expect(front.hp).toBe(was);
    for (const c of ['rabbit', 'dragon', 'snake', 'horse', 'monkey', 'dog', 'cat']) expect(canAim(TOWER_INDEX[c]), c).toBe(true);
    for (const c of ['ox', 'sheep', 'pig']) expect(canAim(TOWER_INDEX[c]), c).toBe(false);
  });

  it('원숭이는 조준을 바꿔도 공중 요괴를 먼저 노린다', () => {
    const s = arena(['monkey', 'rat', 'ox', 'tiger', 'rabbit']);
    command(s, 'place', 0, TOWER_INDEX.monkey);
    expect(command(s, 'aim', 0, AIM.weak)).toBe(true);
    const ground = foe(s, 0, 50);
    const fly = foe(s, 10, 900, 'fox');
    tick(s, 1.5);
    expect(fly.hp).toBeLessThan(900);
    expect(ground.hp).toBe(50);
  });

  it('되팔거나 새로 놓으면 기본값으로 돌아간다', () => {
    const s = arena();
    command(s, 'place', 0, TOWER_INDEX.rat);
    command(s, 'aim', 0, AIM.weak);
    command(s, 'sell', 0);
    expect(s.towers[0].aim).toBe(-1);
    command(s, 'place', 0, TOWER_INDEX.rat);
    expect(aimMode(s.towers[0])).toBe(AIM.first);
  });

  it('명령 수 상한(cmds_max) 안에 머문다: 명령이 많이 쌓이면 조준은 더 받지 않고, 배치·강화 자리는 남는다', () => {
    expect(AIM_CMDS_MAX).toBeLessThan(LIMITS.cmds_max);
    const s = arena();
    command(s, 'place', 0, TOWER_INDEX.rat);
    let n = 0;
    while (command(s, 'aim', 0, AIM_CHOICES[(n + 1) % AIM_CHOICES.length])) n++;
    expect(s.log.length).toBe(AIM_CMDS_MAX);
    expect(canSetAim(s, 0, AIM.last)).toBe(false);
    expect(command(s, 'place', 1, TOWER_INDEX.ox)).toBe(true);
    expect(summarize(s).cmds).toBeLessThanOrEqual(LIMITS.cmds_max);
  });

  it('조준 명령이 섞인 판도 명령 기록으로 똑같이 다시 만들어진다', () => {
    const cfg = { seed: 9, stage: '1-2', squad: ['rat', 'ox', 'tiger', 'rabbit'] as CharId[] };
    const s = createGame(cfg);
    command(s, 'place', 0, TOWER_INDEX.rat);
    command(s, 'place', 1, TOWER_INDEX.tiger);
    command(s, 'aim', 0, AIM.weak);
    command(s, 'start');
    for (let i = 0; i < 3600 && s.phase === 'play'; i++) {
      if (i === 600) command(s, 'aim', 1, AIM.strong);
      if (i === 1500) command(s, 'aim', 0, AIM.last);
      if (i === 2000) command(s, 'place', 2, TOWER_INDEX.rabbit);
      step(s);
    }
    expect(s.log.filter((c) => c.op === 'aim')).toHaveLength(3);
    const again = replay(cfg, s.log, s.time);
    expect(again.tick).toBe(s.tick);
    expect(summarize(again)).toEqual(summarize(s));
    expect(again.energy).toBe(s.energy);
    // 조준이 실제로 판을 바꾼다: 조준 명령만 뺀 판과 다르다
    const plain = replay(cfg, s.log.filter((c) => c.op !== 'aim'), s.time);
    expect([plain.kills, plain.energy, plain.lives]).not.toEqual([s.kills, s.energy, s.lives]);
  });
});

/**
 * 기본 조준이면 판의 결과가 조준 기능을 넣기 전과 똑같다 (자동 조종은 조준을 바꾸지 않는다 → 밸런스 도구의 수치도 그대로).
 * 아래 값은 기능을 넣기 전의 코드로 같은 판을 돌려 적어 둔 것이다. 수치(data)를 고치면 함께 달라지니 그때는 다시 적는다.
 */
describe('기본 조준 = 예전과 같은 결과', () => {
  const all = ROSTER.map((r) => r.id);
  const cases: [string, CharId[], number, { kills: number; lives: number; time: number; tick: number; energy: number; cmds: number; uid: number }][] = [
    ['1-3', ['rat', 'ox', 'tiger', 'rabbit'], 1, { kills: 127, lives: 20, time: 185, tick: 11152, energy: 148, cmds: 9, uid: 127 }],
    ['1-5', ['rat', 'ox', 'tiger', 'rabbit'], 3, { kills: 126, lives: 20, time: 185, tick: 11156, energy: 26, cmds: 12, uid: 126 }],
    ['4-2', ['rat', 'rabbit', 'dragon', 'snake', 'horse'], 5, { kills: 77, lives: 5, time: 203, tick: 12192, energy: 48, cmds: 11, uid: 92 }],
    ['5-5', ['horse', 'sheep', 'monkey', 'dragon', 'snake'], 6, { kills: 104, lives: 20, time: 204, tick: 12246, energy: 56, cmds: 13, uid: 104 }],
    ['9-3', ['monkey', 'rooster', 'dog', 'horse', 'rabbit'], 9, { kills: 56, lives: 6, time: 203, tick: 12192, energy: 26, cmds: 9, uid: 70 }],
    ['12-5', ['cat', 'pig', 'dog', 'monkey', 'horse'], 12, { kills: 70, lives: 17, time: 181, tick: 10909, energy: 71, cmds: 19, uid: 73 }],
    [ENDLESS_ID, ['cat', 'monkey', 'horse', 'sheep', 'rabbit'], 8, { kills: 154, lives: 0, time: 327, tick: 19636, energy: 16, cmds: 15, uid: 209 }],
  ];
  for (const [stage, squad, lv, want] of cases) {
    it(`${stage} (${squad.join('·')})`, { timeout: 60_000 }, () => {
      const levels = Object.fromEntries(all.map((c) => [c, lv]));
      const r = simulate({ seed: 77, stage, squad, levels }, skillPolicy(5, SKILLS.expert), stage === ENDLESS_ID ? 600 : 900);
      expect(r.state.log.some((c) => c.op === 'aim')).toBe(false);
      expect({
        kills: r.summary.kills, lives: r.summary.lives, time: r.summary.time, tick: r.state.tick,
        energy: Math.round(r.state.energy * 1000) / 1000, cmds: r.summary.cmds, uid: r.state.uid,
      }).toEqual(want);
    });
  }
});
