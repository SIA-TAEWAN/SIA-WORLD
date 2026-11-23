import { describe, expect, it } from 'vitest';
import { CRIT_MUL, EXIT_KILL_RATIO, MP_REGEN, PLAYER_R, ROLL, SLOW_TILE_MUL, TILE, damageOf } from '../src/data/balance';
import { ENEMIES } from '../src/data/enemies';
import { WEAPONS } from '../src/data/weapons';
import { STAR_CHEST, STAR_NO_DEATH, STAR_TIME, STEP, createRun, noInput, starBits, starCount, step } from '../src/game/sim';
import { alive, arena, at, group, lo, place, play, run } from './helpers';

describe('피해 계산', () => {
  it('공격력 × 계수 − 방어, 최소 1, 치명타 1.5배', () => {
    expect(damageOf(20, 1.5, 4, false)).toBe(26);
    expect(damageOf(20, 1.5, 4, true)).toBe(Math.round(26 * CRIT_MUL));
    expect(damageOf(5, 1, 100, false)).toBe(1);
  });
});

describe('이동', () => {
  it('조이스틱 방향으로 이동 속도만큼 간다', () => {
    const s = run(arena());
    const x0 = s.p.x;
    play(s, 1, { mx: 1 });
    expect(s.p.x - x0).toBeCloseTo(s.stats.speed, 0);
    expect(s.p.fx).toBe(1);
  });

  it('멈추면 바라보던 방향이 남는다', () => {
    const s = run(arena());
    play(s, 0.2, { mx: -1 });
    play(s, 0.5);
    expect(s.p.fx).toBe(-1);
    expect(s.p.moving).toBe(false);
  });

  it('대각선도 같은 빠르기', () => {
    const s = run(arena());
    const { x, y } = s.p;
    play(s, 0.5, { mx: 1, my: -1 });
    expect(Math.hypot(s.p.x - x, s.p.y - y)).toBeCloseTo(s.stats.speed * 0.5, 0);
  });

  it('벽을 지나가지 못한다 (구르기로도)', () => {
    const s = run(arena());
    play(s, 5, { mx: 1 });
    expect(s.p.x).toBeLessThanOrEqual(15 * TILE - PLAYER_R);
    play(s, 0.5, { mx: 1, roll: true });
    expect(s.p.x).toBeLessThanOrEqual(15 * TILE - PLAYER_R);
  });

  it('물 위에서는 느려진다', () => {
    const rows = arena().rows.map((r, y) => (y === 11 ? '#~~~~~~~~~~~~~~#' : r));
    const s = run(arena({ rows }));
    const x0 = s.p.x;
    play(s, 1, { mx: 1 });
    expect(s.p.x - x0).toBeCloseTo(s.stats.speed * SLOW_TILE_MUL, 0);
  });
});

describe('칼 공격', () => {
  it('앞쪽 요괴가 맞고, 피해 숫자가 뜨고, 밀려난다', () => {
    const s = run(arena({ groups: [group(8, 5)] }), { seed: 3 });
    const e = place(s, s.enemies[0], 0, -70);
    e.cd = 99;
    step(s, { ...noInput(), attack: true });
    const dmg = s.events.find((v) => v.e === 'dmg');
    expect(dmg && dmg.e === 'dmg' && [damageOf(s.stats.atk, 1, 0, false), damageOf(s.stats.atk, 1, 0, true)]).toContain(e.maxHp - e.hp);
    const y0 = e.y;
    play(s, 0.2);
    expect(e.y).toBeLessThan(y0);
  });

  it('뒤에 있는 요괴는 맞지 않는다', () => {
    const s = run(arena({ groups: [group(8, 5)] }));
    const e = place(s, s.enemies[0], 0, 90, false);
    step(s, { ...noInput(), attack: true });
    expect(e.hp).toBe(e.maxHp);
  });

  it('누르고 있으면 대기 시간마다 이어서 벤다', () => {
    const s = run(arena());
    play(s, 1, { attack: true });
    expect(s.events.filter((v) => v.e === 'fx').length).toBe(Math.floor(1 / WEAPONS.sword.basic.cd) + 1);
  });

  it('서 있을 때는 둘레의 가까운 요괴 쪽으로 돌아서 벤다 (조준 보정)', () => {
    const s = run(arena({ groups: [group(8, 5)] }));
    const e = place(s, s.enemies[0], 80, 10);
    e.cd = 99;
    step(s, { ...noInput(), attack: true });
    expect(s.p.fx).toBeGreaterThan(0.9);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('요괴를 쓰러뜨리면 처치 수·경험치·엽전이 오른다', () => {
    const s = run(arena({ groups: [group(8, 5)] }), { level: 30 });
    place(s, s.enemies[0], 0, -70);
    step(s, { ...noInput(), attack: true });
    expect(alive(s).length).toBe(0);
    expect(s.kills.imp).toBe(1);
    expect(s.exp).toBe(ENEMIES.imp.exp);
    expect(s.coins).toBe(ENEMIES.imp.coin);
    expect(s.events.some((v) => v.e === 'kill')).toBe(true);
  });
});

describe('구르기', () => {
  it('짧게 밀려나고 대기 1초', () => {
    const s = run(arena());
    const y0 = s.p.y;
    play(s, ROLL.time + 0.05, { roll: true });
    expect(y0 - s.p.y).toBeCloseTo(ROLL.dist, -1);
    const y1 = s.p.y;
    play(s, 0.3, { roll: true });
    expect(s.p.y).toBe(y1);
    play(s, ROLL.cd);
    play(s, ROLL.time + 0.05, { roll: true });
    expect(s.p.y).toBeLessThan(y1 - 50);
  });

  it('구르는 동안에는 맞지 않는다', () => {
    const hit = (roll: boolean) => {
      const s = run(arena({ groups: [group(8, 5)] }));
      const e = place(s, s.enemies[0], 0, -50);
      e.cd = 0;
      step(s, noInput()); // 요괴가 공격을 예고한다
      expect(s.warns.length).toBe(1);
      const w = s.warns[0];
      // 터지기 직전에 제자리 구르기 (왼쪽 벽 쪽이 아니라 범위 안에서 끝나도록 짧게 본다)
      while (s.warns.length && w.t > STEP * 1.5) step(s, noInput());
      s.p.x = w.x;
      s.p.y = w.y;
      if (roll) s.p.invuln = ROLL.invuln;
      step(s, noInput());
      step(s, noInput());
      return s.stats.hp - s.p.hp;
    };
    expect(hit(false)).toBeGreaterThan(0);
    expect(hit(true)).toBe(0);
  });
});

describe('요괴', () => {
  it('멀리 있으면 잠들어 있고, 가까이 가면 무리가 함께 깨어나 다가온다', () => {
    const s = run(arena({ rows: [...arena().rows.slice(0, 13), ...Array.from({ length: 12 }, () => '#..............#'), '################'], start: [8, 24], groups: [group(8, 3, 'imp', 3)] }));
    play(s, 1);
    expect(s.enemies.every((e) => !e.awake)).toBe(true);
    const y0 = s.enemies[0].y;
    s.p.y = at(8);
    play(s, 1);
    expect(s.enemies.every((e) => e.awake)).toBe(true);
    expect(s.enemies[0].y).toBeGreaterThan(y0);
  });

  it('예고 뒤에 때리고, 피해는 공격력 − 방어', () => {
    const s = run(arena({ groups: [group(8, 5)] }));
    const e = place(s, s.enemies[0], 0, -50);
    e.cd = 0;
    play(s, ENEMIES.imp.windup - 0.05);
    expect(s.p.hp).toBe(s.stats.hp);
    play(s, 0.1);
    expect(s.stats.hp - s.p.hp).toBe(Math.max(1, Math.round(e.atk - s.stats.def)));
    expect(s.events.some((v) => v.e === 'hurt')).toBe(true);
  });

  it('예고 중에 쓰러뜨리면 공격이 끊긴다', () => {
    const s = run(arena({ groups: [group(8, 5)] }), { level: 30 });
    const e = place(s, s.enemies[0], 0, -50);
    e.cd = 0;
    step(s, noInput());
    expect(s.warns.length).toBe(1);
    play(s, 0.1, { attack: true });
    play(s, 1);
    expect(s.p.hp).toBe(s.stats.hp);
  });

  it('벽 뒤에 있어도 길을 돌아서 찾아온다', () => {
    // 가운데를 가로막는 벽 (오른쪽 끝 두 칸만 뚫려 있다)
    const rows = arena().rows.map((r, y) => (y === 6 ? '############..##' : r));
    const s = run(arena({ rows, start: [2, 10], groups: [group(2, 3)] }));
    const e = s.enemies[0];
    e.awake = true;
    e.cd = 99;
    play(s, 12);
    expect(e.y).toBeGreaterThan(at(7));
    expect(Math.hypot(e.x - s.p.x, e.y - s.p.y)).toBeLessThan(90);
  });

  it('서로 겹치지 않는다', () => {
    const s = run(arena({ groups: [group(8, 8, 'imp', 6)] }));
    for (const e of s.enemies) place(s, e, 0, -60).cd = 99;
    play(s, 2);
    const es = alive(s);
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) expect(Math.hypot(es[i].x - es[j].x, es[i].y - es[j].y)).toBeGreaterThan(es[i].r);
  });
});

describe('체력 · 마력 · 끝', () => {
  it('체력이 0이 되면 쓰러지고 판이 멈춘다', () => {
    const s = run(arena({ groups: [group(8, 9, 'imp', 6)] }));
    s.p.hp = 3;
    play(s, 6);
    expect(s.phase).toBe('dead');
    expect(s.p.hp).toBe(0);
    const t = s.t;
    play(s, 1, { mx: 1 });
    expect(s.t).toBe(t);
  });

  it('무적(개발용)이면 체력이 줄지 않는다', () => {
    const s = run(arena({ groups: [group(8, 9, 'imp', 6)] }), { god: true });
    play(s, 6);
    expect(s.p.hp).toBe(s.stats.hp);
    expect(s.events.some((v) => v.e === 'hurt')).toBe(true);
  });

  it('마력은 조금씩 저절로 찬다', () => {
    const s = run(arena());
    s.p.mp = 0;
    play(s, 2);
    expect(s.p.mp).toBeCloseTo(s.stats.mp * MP_REGEN * 2, 1);
    play(s, 100);
    expect(s.p.mp).toBe(s.stats.mp);
  });

  it('요괴를 충분히 잡아야 출구가 열리고, 출구에 닿으면 클리어', () => {
    const s = run(arena({ groups: [group(2, 3), group(13, 3), group(2, 8), group(13, 8)] }), { level: 40 });
    s.p.x = s.exitX;
    s.p.y = s.exitY;
    for (const e of s.enemies) e.awake = false;
    step(s, noInput());
    expect(s.phase).toBe('play');
    const need = Math.ceil(4 * EXIT_KILL_RATIO);
    for (let i = 0; i < need; i++) {
      expect(s.exitOpen).toBe(false);
      for (const e of s.enemies) e.awake = false;
      s.p.x = s.enemies[i].x;
      s.p.y = s.enemies[i].y + 60;
      s.p.fx = 0;
      s.p.fy = -1;
      play(s, 0.5, { attack: true });
    }
    expect(s.killed).toBe(need);
    expect(s.exitOpen).toBe(true);
    s.p.x = s.exitX;
    s.p.y = s.exitY;
    step(s, noInput());
    expect(s.phase).toBe('clear');
  });

  it('숨은 상자에 닿으면 열린다 (한 번만)', () => {
    const s = run(arena());
    s.p.x = s.chestX + 10;
    s.p.y = s.chestY;
    step(s, noInput());
    expect(s.chest).toBe(true);
    const c = s.coins;
    expect(c).toBeGreaterThan(0);
    step(s, noInput());
    expect(s.coins).toBe(c);
  });
});

describe('별', () => {
  it('시간 · 안 쓰러짐 · 숨은 상자를 따로 센다', () => {
    expect(starBits(false, 10, 60, 0, true)).toBe(0);
    expect(starBits(true, 60, 60, 0, true)).toBe(STAR_TIME | STAR_NO_DEATH | STAR_CHEST);
    expect(starBits(true, 61, 60, 1, false)).toBe(0);
    expect(starBits(true, 61, 60, 0, false)).toBe(STAR_NO_DEATH);
    expect(starCount(7)).toBe(3);
    expect(starCount(5)).toBe(2);
  });
});

describe('결정적', () => {
  it('같은 씨앗 + 같은 입력 = 같은 결과', () => {
    const go = (seed: number) => {
      const s = createRun(arena({ groups: [group(8, 5, 'imp', 5), group(4, 8, 'imp', 3)] }), 'normal', lo('tiger', 'sword', 3), { seed });
      for (let i = 0; i < 60 * 4; i++) {
        const inp = noInput();
        inp.mx = Math.sin(i / 37);
        inp.my = Math.cos(i / 53);
        inp.attack = i % 90 < 60;
        inp.roll = i % 200 === 0;
        step(s, inp);
        s.events.length = 0;
      }
      return JSON.stringify([s.seed, s.p.x, s.p.y, s.p.hp, s.killed, s.enemies.map((e) => [e.x, e.y, e.hp])]);
    };
    expect(go(7)).toBe(go(7));
    expect(go(7)).not.toBe(go(8));
  });
});
