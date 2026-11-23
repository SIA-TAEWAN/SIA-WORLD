import { describe, expect, it } from 'vitest';
import { BOSSES } from '../src/data/bosses';
import { ELITE, ENEMIES } from '../src/data/enemies';
import { noInput, step, type RunState } from '../src/game/sim';
import { alive, arena, group, place, play, run } from './helpers';

/** 넓은 방 (보스·돌진 시험용): 16×24칸 */
const hall = (over: Parameters<typeof arena>[0] = {}) =>
  arena({ rows: ['################', ...Array.from({ length: 22 }, () => '#..............#'), '################'], start: [8, 20], ...over });

/** 예고가 터질 때까지 진행 */
function untilWarn(s: RunState, max = 5) {
  for (let i = 0; i < max * 60 && !s.warns.length; i++) step(s, noInput());
  return s.warns[0];
}

describe('요괴 행동', () => {
  it('도깨비불: 직선을 예고한 뒤 그 길로 돌진한다. 옆으로 비키면 안 맞는다', () => {
    const go = (dodge: boolean) => {
      const s = run(hall({ groups: [group(8, 10, 'wisp')] }));
      const e = place(s, s.enemies[0], 0, -250);
      e.cd = 0;
      const w = untilWarn(s);
      expect(w.shape).toBe('line');
      expect(w.after).toBe('dash');
      const y0 = e.y;
      if (dodge) s.p.x += 120;
      play(s, ENEMIES.wisp.windup + 0.1);
      expect(e.y).toBeGreaterThan(y0 + 200);
      return s.stats.hp - s.p.hp;
    };
    expect(go(false)).toBeGreaterThan(0);
    expect(go(true)).toBe(0);
  });

  it('방망이 도깨비: 대원이 선 자리를 크게 예고하고 내려찍는다', () => {
    const go = (dodge: boolean) => {
      const s = run(hall({ groups: [group(8, 10, 'club')] }));
      const e = place(s, s.enemies[0], 0, -120);
      e.cd = 0;
      const w = untilWarn(s);
      expect(w.shape).toBe('circle');
      expect(w.big).toBe(true);
      expect(Math.hypot(w.x - s.p.x, w.y - s.p.y)).toBeLessThan(5);
      if (dodge) play(s, 0.3, { mx: 1, roll: true });
      play(s, ENEMIES.club.windup + 0.1);
      return s.stats.hp - s.p.hp;
    };
    expect(go(false)).toBeGreaterThan(0);
    expect(go(true)).toBe(0);
  });

  it('여우불: 거리를 벌리고 불을 쏜다', () => {
    const s = run(hall({ groups: [group(8, 10, 'fox')] }));
    const e = place(s, s.enemies[0], 0, -100);
    e.cd = 1;
    const d0 = Math.hypot(e.x - s.p.x, e.y - s.p.y);
    play(s, 0.9);
    expect(Math.hypot(e.x - s.p.x, e.y - s.p.y)).toBeGreaterThan(d0 + 40);
    play(s, 0.6);
    expect(s.shots.some((sh) => sh.on && sh.foe)).toBe(true);
    play(s, 1.5);
    expect(s.p.hp).toBeLessThan(s.stats.hp);
  });

  it('요괴의 불은 구르는 동안 지나간다', () => {
    const s = run(hall({ groups: [group(8, 10, 'fox')] }));
    const e = place(s, s.enemies[0], 0, -300);
    e.cd = 0;
    for (let i = 0; i < 600 && !s.shots.some((sh) => sh.on && sh.foe); i++) step(s, noInput());
    const sh = s.shots.find((o) => o.on && o.foe)!;
    e.cd = 99;
    for (let i = 0; i < 600 && sh.on; i++) {
      const near = Math.hypot(sh.x - s.p.x, sh.y - s.p.y) < 70;
      step(s, { ...noInput(), my: 1, roll: near });
    }
    expect(s.p.hp).toBe(s.stats.hp);
  });

  it('정예: 체력·공격이 높고, 주변을 크게 휩쓸고, 보상이 크다', () => {
    const s = run(hall({ groups: [group(8, 10, 'imp', 1, 'club')] }));
    const elite = s.enemies.find((e) => e.elite)!;
    const imp = s.enemies.find((e) => !e.elite)!;
    expect(elite.maxHp).toBe(Math.round(ENEMIES.club.hp * ELITE.hp));
    expect(elite.r).toBeCloseTo(ENEMIES.club.r * ELITE.size);
    expect(elite.exp).toBe(ENEMIES.club.exp * ELITE.reward);
    imp.dead = true;
    place(s, elite, 0, -100);
    elite.cd = 99;
    elite.ringCd = 0;
    const w = untilWarn(s);
    expect(w.shape).toBe('circle');
    expect(w.r).toBe(ELITE.ringR);
    expect(w.x).toBe(elite.x);
    // 정예는 따로 센다
    elite.hp = 1;
    s.warns.length = 0;
    play(s, 0.1, { attack: true });
    expect(elite.dead).toBe(true);
    expect(s.eliteKills).toBe(1);
    expect(s.kills.club).toBeUndefined();
  });

  it('어려움 모드: 무리가 더 크고 더 세다', () => {
    const map = hall({ groups: [group(8, 10, 'imp', 10)] });
    const n = run(map);
    const h = run(map, { mode: 'hard', level: 70 });
    expect(h.enemies.length).toBe(13);
    expect(h.enemies[0].maxHp).toBeGreaterThan(n.enemies[0].maxHp * 5);
    expect(h.level).toBe(66);
  });
});

describe('지형 보스', () => {
  const bossRun = (o: Parameters<typeof run>[1] = {}) => {
    const s = run(hall({ boss: [8, 8], groups: [group(3, 20, 'imp', 2)] }), { god: true, ...o });
    const b = s.boss!;
    b.awake = true;
    for (const e of s.enemies) if (!e.bossDef) e.dead = true;
    return { s, b };
  };

  it('공격은 모두 빨간 범위로 예고된다: 내려찍기 → 부채꼴 → 돌진 → 둘레', () => {
    const { s, b } = bossRun();
    const def = BOSSES.bigDokkaebi;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const w = untilWarn(s, 10);
      expect(w.big).toBe(true);
      expect(w.total).toBeGreaterThanOrEqual(0.7);
      seen.push(w.shape);
      const bx = b.x;
      const by = b.y;
      while (s.warns.length) step(s, noInput());
      if (w.after === 'dash') expect(Math.hypot(b.x - bx, b.y - by)).toBeGreaterThan(100);
    }
    expect(seen).toEqual(['circle', 'arc', 'line', 'circle']);
    expect(def.moves.map((m) => m.t)).toEqual(['slam', 'cone', 'charge', 'ring']);
    expect(s.events.filter((v) => v.e === 'hurt').length).toBeGreaterThan(0); // 가만히 서 있으면 맞는다 (무적이라 체력은 그대로)
  });

  it('체력이 내려가면 부하를 부르고, 보스가 쓰러지면 부하도 사라지고 출구가 열린다', () => {
    const { s, b } = bossRun();
    expect(s.exitOpen).toBe(false); // 다른 요괴를 다 잡아도 보스가 남아 있으면 안 열린다
    b.hp = b.maxHp * 0.6;
    play(s, 0.1);
    const minions = alive(s).filter((e) => e.summoned);
    expect(minions.length).toBe(BOSSES.bigDokkaebi.summon.n);
    expect(minions.every((e) => e.awake && e.exp === 0)).toBe(true);
    b.hp = b.maxHp * 0.3;
    play(s, 0.1);
    expect(alive(s).filter((e) => e.summoned).length).toBe(6);
    const total = s.total;
    b.hp = 1;
    s.p.x = b.x;
    s.p.y = b.y + 80;
    s.p.fx = 0;
    s.p.fy = -1;
    play(s, 0.6, { attack: true });
    expect(s.bossDead).toBe(true);
    expect(alive(s).length).toBe(0);
    expect(s.warns.length).toBe(0);
    expect(s.exitOpen).toBe(true);
    expect(s.total).toBe(total);
    expect(s.exp).toBe(Math.round(BOSSES.bigDokkaebi.exp));
  });

  it('보스는 기절하지 않고 거의 밀려나지 않는다', () => {
    const { s, b } = bossRun({ hero: 'tiger' });
    s.p.x = b.x;
    s.p.y = b.y + 120;
    const y0 = b.y;
    step(s, { ...noInput(), unique: true });
    expect(b.stun).toBe(0);
    expect(b.hp).toBeLessThan(b.maxHp);
    play(s, 0.2);
    expect(Math.abs(b.y - y0)).toBeLessThan(40);
  });

  it('어려움 모드: 공격이 하나 더 있다 (이어 찍기 3번)', () => {
    const { s } = bossRun({ mode: 'hard', level: 80 });
    let triple = false;
    for (let i = 0; i < 60 * 40 && !triple; i++) {
      step(s, noInput());
      triple = s.warns.length === 3 && s.warns.every((w) => w.shape === 'circle');
      s.events.length = 0;
    }
    expect(triple).toBe(true);
    // 뒤의 것은 기다렸다가 그때 대원이 선 자리로 온다
    expect(s.warns.filter((w) => w.delay > 0).length).toBe(2);
  });
});
