import { describe, expect, it } from 'vitest';
import { ENV, ROLL, SLOW_TILE_MUL } from '../src/data/balance';
import { BOSSES } from '../src/data/bosses';
import { HOME_BONUS, playerStats } from '../src/data/growth';
import { REGION_TABLE } from '../src/data/regions';
import { ELITE, ENEMIES } from '../src/data/enemies';
import { FX } from '../src/data/economy';
import { createRun, noInput, step, type RunState } from '../src/game/sim';
import { alive, arena, group, lo, place, play, run } from './helpers';

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

  it('진흙 요괴(2지형): 쓰러지면 작은 것 둘로 갈라진다. 작은 것은 다시 갈라지지 않고 세지 않는다', () => {
    const s = run(hall({ groups: [group(8, 10, 'mud', 1), group(3, 3, 'imp', 9)] }));
    const e = place(s, s.enemies[0], 0, -70);
    e.hp = 1;
    play(s, 0.1, { attack: true });
    expect(e.dead).toBe(true);
    expect(s.killed).toBe(1);
    expect(s.kills.mud).toBe(1);
    const minis = alive(s).filter((m) => m.summoned);
    expect(minis.length).toBe(ENEMIES.mud.split!.n);
    for (const m of minis) {
      expect(m.r).toBeCloseTo(ENEMIES.mud.r * ENEMIES.mud.split!.size);
      expect(m.maxHp).toBe(Math.round(ENEMIES.mud.hp * ENEMIES.mud.split!.hp));
      expect(m.awake).toBe(true);
      expect(m.exp).toBe(0);
      m.hp = 1;
    }
    const exp = s.exp;
    for (const m of minis) {
      place(s, m, 0, -60);
      play(s, 0.5, { attack: true });
    }
    expect(alive(s).filter((m) => m.summoned).length).toBe(0);
    expect(s.killed).toBe(1);
    expect(s.exp).toBe(exp);
    expect(s.total).toBe(10);
  });

  it('살쾡이 요괴(3지형): 내가 선 자리를 예고하고 뛰어든다. 벗어나면 안 맞는다', () => {
    const go = (dodge: boolean) => {
      const s = run(hall({ groups: [group(8, 10, 'lynx')] }));
      const e = place(s, s.enemies[0], 0, -220);
      e.cd = 0;
      const w = untilWarn(s);
      expect(w.shape).toBe('circle');
      expect(w.after).toBe('jump');
      expect(Math.hypot(w.x - s.p.x, w.y - s.p.y)).toBeLessThan(5);
      const [wx, wy] = [w.x, w.y];
      if (dodge) play(s, 0.3, { mx: 1, roll: true });
      play(s, ENEMIES.lynx.windup + 0.05);
      // 예고한 자리에 떨어진다
      expect(Math.hypot(e.x - wx, e.y - wy)).toBeLessThan(40);
      return s.stats.hp - s.p.hp;
    };
    expect(go(false)).toBeGreaterThan(0);
    expect(go(true)).toBe(0);
  });

  it('요괴 번호가 자리와 달라도(떨어진 것과 번호를 같이 쓴다) 예고는 낸 요괴를 따라간다', () => {
    const s = run(hall({ groups: [group(8, 10, 'club')] }));
    const e = place(s, s.enemies[0], 0, -120);
    e.id = 77;
    e.cd = 0;
    const w = untilWarn(s);
    expect(w.src).toBe(77);
    play(s, 0.2);
    expect(s.warns.length).toBe(1);
    e.stun = 1; // 낸 요괴가 기절하면 끊긴다
    play(s, 0.05);
    expect(s.warns.length).toBe(0);
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

  it('2지형 두억시니: 진흙 덩이를 여러 곳에 던진다 (하나는 내 자리, 조금씩 늦게 터진다)', () => {
    const s = run(hall({ region: 2, id: '2-8', no: 8, boss: [8, 8], groups: [] }), { god: true });
    const b = s.boss!;
    expect(b.bossDef!.id).toBe('dueoksini');
    b.awake = true;
    untilWarn(s, 10);
    const m = BOSSES.dueoksini.moves[0];
    if (m.t !== 'barrage') throw new Error('첫 공격이 던지기가 아니다');
    expect(s.warns.length).toBe(m.n);
    expect(s.warns.every((w) => w.shape === 'circle' && w.big && w.r === m.r)).toBe(true);
    expect(Math.hypot(s.warns[0].x - s.p.x, s.warns[0].y - s.p.y)).toBeLessThan(5);
    for (const w of s.warns.slice(1)) expect(Math.hypot(w.x - s.p.x, w.y - s.p.y)).toBeLessThanOrEqual(m.spread + 1);
    expect(s.warns[m.n - 1].t).toBeGreaterThan(s.warns[0].t);
    // 서 있으면 맞고(무적이라 체력은 그대로), 터진 뒤 보스는 다음 공격으로 넘어간다
    while (s.warns.length) step(s, noInput());
    expect(s.events.some((v) => v.e === 'hurt')).toBe(true);
    expect(new Set(BOSSES.dueoksini.moves.map((v) => v.t)).has('barrage')).toBe(true);
  });

  it('3지형 불가살: 쇠가시가 사방으로 뻗는다 (하나는 내 쪽). 사이에 서면 안 맞는다', () => {
    const go = (side: boolean) => {
      const s = run(hall({ region: 3, id: '3-8', no: 8, boss: [8, 8], groups: [] }));
      const b = s.boss!;
      expect(b.bossDef!.id).toBe('bulgasal');
      b.awake = true;
      s.p.x = b.x;
      s.p.y = b.y + 260;
      untilWarn(s, 10);
      const m = BOSSES.bulgasal.moves[0];
      if (m.t !== 'cross') throw new Error('첫 공격이 쇠가시가 아니다');
      expect(s.warns.length).toBe(m.n);
      expect(s.warns.every((w) => w.shape === 'line' && w.len === m.len && w.after === 'none')).toBe(true);
      const d = Math.hypot(s.p.x - b.x, s.p.y - b.y);
      // 가시 사이(45도 옆)로 옮겨 서면 안 맞는다
      if (side) {
        const a = Math.atan2(s.p.y - b.y, s.p.x - b.x) + Math.PI / 4;
        s.p.x = b.x + Math.cos(a) * d;
        s.p.y = b.y + Math.sin(a) * d;
      }
      const hp = s.p.hp;
      for (let i = 0; i < 120 && s.warns.length; i++) step(s, noInput());
      return hp - s.p.hp;
    };
    expect(go(false)).toBeGreaterThan(0);
    expect(go(true)).toBe(0);
  });

  it('1~3지형 보스: 저마다 다른 공격 순서, 대사 2~3줄과 쓰러질 때 한마디', () => {
    const three = REGION_TABLE.slice(0, 3).map((r) => BOSSES[r.boss]);
    expect(new Set(three.map((b) => JSON.stringify(b.moves))).size).toBe(3);
    for (const b of three) {
      expect(b.lines.length).toBeGreaterThanOrEqual(2);
      expect(b.lines.length).toBeLessThanOrEqual(3);
      expect(b.last.length).toBeGreaterThan(0);
      for (const m of [...b.moves, ...b.hardMoves]) expect(m.warn).toBeGreaterThanOrEqual(0.7);
    }
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

describe('지형 환경 효과 · 고향 보너스', () => {
  /** 가운데 가로 띠가 진흙(물)인 방 */
  const bog = (region: number) => {
    const rows = ['################', ...Array.from({ length: 22 }, (_, i) => (i >= 8 && i <= 14 ? '#~~~~~~~~~~~~~~#' : '#..............#')), '################'];
    return arena({ rows, start: [8, 12], region, id: `${region}-1` as '2-1' });
  };
  const rollDist = (region: number, o: Parameters<typeof run>[1] = {}) => {
    const s = run(bog(region), o);
    const x0 = s.p.x;
    play(s, 0.5, { mx: 1, roll: true });
    // 구르기가 끝난 뒤(0.28초) 남은 시간은 걷는다 — 구른 거리만 보려고 걷는 만큼을 뺀다
    return { s, d: s.p.x - x0 };
  };

  it('2지형 진흙: 진흙탕에서는 더 느리고 구르기가 짧다. 1지형의 물은 그대로다', () => {
    const water = rollDist(1);
    const mud = rollDist(2, { hero: 'rat' });
    expect(water.s.env.id).toBe('none');
    expect(mud.s.env).toMatchObject({ id: 'mud', f: 1 });
    expect(mud.d).toBeLessThan(water.d * 0.7);
    // 걷기
    const walk = (region: number, hero: 'rat' | 'rabbit') => {
      const s = run(bog(region), { hero });
      const x0 = s.p.x;
      play(s, 1, { mx: 1 });
      return (s.p.x - x0) / s.stats.speed;
    };
    expect(walk(1, 'rat')).toBeCloseTo(SLOW_TILE_MUL, 1);
    expect(walk(2, 'rat')).toBeCloseTo(ENV.mud.slow, 1);
    expect(ENV.mud.roll * ROLL.dist).toBeLessThan(ROLL.dist);
  });

  it('2지형: 막는 대원(토끼)은 진흙에 걸리지 않고, 수호 갑옷은 절반만 받는다', () => {
    const rat = rollDist(2, { hero: 'rat' });
    const rabbit = rollDist(2, { hero: 'rabbit' });
    expect(REGION_TABLE[1].counter).toBe('rabbit');
    expect(rabbit.s.env.f).toBe(0);
    expect(rabbit.d).toBeGreaterThan(rat.d * 1.4);
    // 수호 갑옷 (레어 방어구 효과 ward)
    const w = createRun(bog(2), 'normal', { ...lo('rat'), fx: ['ward'] });
    expect(w.env.f).toBe(FX.ward.env);
    const x0 = w.p.x;
    play(w, 0.5, { mx: 1, roll: true });
    const half = w.p.x - x0;
    expect(half).toBeGreaterThan(rat.d);
    expect(half).toBeLessThan(rabbit.d);
  });

  it('3지형 골바람: 예고한 뒤 한쪽으로 밀고, 다음에는 반대쪽으로 민다. 소는 밀리지 않는다', () => {
    const wide = (hero: 'rat' | 'ox') => run(hall({ region: 3, id: '3-1', start: [4, 20] }), { hero });
    const s = wide('rat');
    expect(s.env).toMatchObject({ id: 'wind', f: 1 });
    const w = ENV.wind;
    const x0 = s.p.x;
    play(s, w.every - w.warn - 0.1);
    expect(s.p.x).toBe(x0); // 처음에는 불지 않는다
    expect(s.events.some((v) => v.e === 'env')).toBe(false);
    play(s, 0.2);
    expect(s.events.find((v) => v.e === 'env')).toMatchObject({ id: 'wind', dir: 1 });
    expect(s.env.warn).toBe(1);
    play(s, w.warn + w.dur + 0.1);
    expect(s.env.gust).toBe(0);
    expect(s.p.x - x0).toBeCloseTo(w.push * w.dur, -1);
    const x1 = s.p.x;
    play(s, w.every);
    expect(s.p.x).toBeLessThan(x1 - w.push * w.dur * 0.8); // 반대쪽
    const ox = wide('ox');
    expect(ox.env.f).toBe(0);
    const ox0 = ox.p.x;
    play(ox, w.every + w.dur + 0.2);
    expect(ox.p.x).toBe(ox0);
    expect(ox.events.some((v) => v.e === 'env')).toBe(true); // 바람은 분다 (화면이 '밀리지 않아요'라고 알린다)
  });

  it('고향 지형: 공격·방어 +10% (소 = 2지형, 호랑이 = 3지형)', () => {
    for (const [hero, home] of [['rat', 1], ['ox', 2], ['tiger', 3]] as const) {
      const l = { ...lo(hero, 'bow', 10), armorDef: 5 };
      const at = playerStats(l, home);
      const away = playerStats(l, home === 1 ? 2 : 1);
      expect(at.home).toBe(true);
      expect(away.home).toBe(false);
      expect(at.atk / away.atk).toBeCloseTo(HOME_BONUS, 5);
      expect(at.def / away.def).toBeCloseTo(HOME_BONUS, 5);
      expect(at.hp).toBe(away.hp);
      expect(REGION_TABLE[home - 1].home).toBe(hero);
    }
  });
});
