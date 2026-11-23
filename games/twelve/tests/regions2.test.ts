import { describe, expect, it } from 'vitest';
import { ENV, TILE } from '../src/data/balance';
import { BOSSES } from '../src/data/bosses';
import { ENEMIES } from '../src/data/enemies';
import { FX } from '../src/data/economy';
import { HOME_BONUS, playerStats } from '../src/data/growth';
import { HEROES, heroOf, joinsAt } from '../src/data/heroes';
import { REGION_TABLE, mapScale, regionOf } from '../src/data/regions';
import { POOL_TICK, createRun, noInput, sightOf, step, type RunState } from '../src/game/sim';
import { alive, arena, group, lo, place, play, run } from './helpers';

/**
 * 4~7지형 (6단계): 지형마다 새 요괴 행동 하나 · 보스 고유 공격 · 환경 효과와 막는 대원.
 * 1~3지형의 것은 tests/enemies.test.ts 에 있다.
 */
const hall = (over: Parameters<typeof arena>[0] = {}) =>
  arena({ rows: ['################', ...Array.from({ length: 22 }, () => '#..............#'), '################'], start: [8, 20], ...over });
/** 가운데 줄들이 물·늪인 방 */
const bog = (region: number) =>
  arena({
    rows: ['################', ...Array.from({ length: 22 }, (_, i) => (i >= 8 && i <= 14 ? '#~~~~~~~~~~~~~~#' : '#..............#')), '################'],
    start: [8, 12], region, id: `${region}-1` as '5-1',
  });
const untilWarn = (s: RunState, max = 5) => {
  for (let i = 0; i < max * 60 && !s.warns.length; i++) step(s, noInput());
  return s.warns[0];
};
const bossRoom = (region: number, o: Parameters<typeof run>[1] = {}) => {
  const s = run(hall({ region, id: `${region}-8` as '4-8', no: 8, boss: [8, 8], groups: [] }), o);
  const b = s.boss!;
  b.awake = true;
  return { s, b };
};
const hurts = (s: RunState) => s.events.filter((v) => v.e === 'hurt').length;

describe('4지형 토끼의 달동산 — 숨기 · 달그림자 · 장산범', () => {
  it('그슨대: 숨어서 다가와 바로 옆에서 나타나 친다. 숨은 동안에는 조준이 안 되고, 맞으면 드러난다', () => {
    const s = run(hall({ groups: [group(8, 6, 'shade')] }), { weapon: 'bow' });
    const e = place(s, s.enemies[0], 0, -300);
    expect(ENEMIES.shade.ai).toBe('lurk');
    expect(e.hidden).toBe(true);
    // 숨어 있으면 활이 그쪽으로 돌아서지 않는다 (오른쪽을 보고 쏘면 그대로 오른쪽으로 나간다)
    s.p.fx = 1;
    s.p.fy = 0;
    step(s, { ...noInput(), attack: true });
    expect(s.p.fx).toBe(1);
    expect(e.hp).toBe(e.maxHp);
    // 다가와서 닿을 거리에 오면 나타나고 예고한다
    const w = untilWarn(s, 6);
    expect(e.hidden).toBe(false);
    expect(w.shape).toBe('circle');
    expect(Math.hypot(e.x - s.p.x, e.y - s.p.y)).toBeLessThanOrEqual(ENEMIES.shade.reach + 2);
    const hp = s.p.hp;
    play(s, ENEMIES.shade.windup + 0.1);
    expect(s.p.hp).toBeLessThan(hp);
    // 드러난 동안에는 조준이 된다
    s.p.fx = 1;
    s.p.fy = 0;
    step(s, { ...noInput(), attack: true });
    expect(s.p.fx).toBeLessThan(0.5);
    // 멀어지면 다시 숨고, 범위 공격에 맞으면 잠깐 드러난다
    place(s, e, 0, -700);
    play(s, 2.4);
    expect(e.hidden).toBe(true);
    const far = run(hall({ groups: [group(8, 6, 'shade')] }), { hero: 'tiger' });
    const f = place(far, far.enemies[0], 0, -150);
    f.cd = 9;
    step(far, { ...noInput(), unique: true }); // 포효 (둘레)
    expect(f.hp).toBeLessThan(f.maxHp);
    expect(f.hidden).toBe(false);
  });

  it('달그림자: 멀리 있는 요괴는 조준하지 못한다. 쥐는 다 보고, 수호 갑옷은 두 배 멀리 본다', () => {
    const dark = (hero: 'rabbit' | 'rat') => run(hall({ region: 4, id: '4-1', groups: [group(8, 6, 'imp')] }), { hero, weapon: 'bow' });
    const shot = (s: RunState, dist: number) => {
      place(s, s.enemies[0], 0, -dist).cd = 9;
      s.p.fx = 1;
      s.p.fy = 0;
      step(s, { ...noInput(), attack: true });
      return s.p.fy < -0.9; // 요괴 쪽(위)으로 돌아섰는지
    };
    expect(REGION_TABLE[3]).toMatchObject({ env: 'dark', counter: 'rat', home: 'rabbit' });
    const s = dark('rabbit');
    expect(sightOf(s)).toBe(ENV.dark.see);
    expect(shot(dark('rabbit'), ENV.dark.see + 80)).toBe(false);
    expect(shot(dark('rabbit'), ENV.dark.see - 60)).toBe(true);
    expect(sightOf(dark('rat'))).toBe(Infinity);
    expect(shot(dark('rat'), ENV.dark.see + 80)).toBe(true);
    const ward = createRun(hall({ region: 4, id: '4-1' }), 'normal', { ...lo('rabbit'), fx: ['ward'] });
    expect(sightOf(ward)).toBeCloseTo(ENV.dark.see / FX.ward.env);
    // 다른 지형은 끝없이 본다
    expect(sightOf(run(hall({ region: 3, id: '3-1' })))).toBe(Infinity);
  });

  it('장산범: 대원이 선 자리로 세 번 이어 뛰어든다 (그때마다 자리를 다시 본다)', () => {
    const { s, b } = bossRoom(4, { god: true });
    expect(b.bossDef!.id).toBe('jangsanbeom');
    const m = BOSSES.jangsanbeom.moves[0];
    if (m.t !== 'leap') throw new Error('첫 공격이 뛰어들기가 아니다');
    s.p.x = b.x;
    s.p.y = b.y + 330;
    untilWarn(s, 10);
    expect(s.warns.length).toBe(m.count);
    expect(s.warns.every((w) => w.shape === 'circle' && w.after === 'jump' && w.total >= 0.7)).toBe(true);
    expect(s.warns.filter((w) => w.delay > 0).length).toBe(m.count! - 1);
    // 첫 번째가 터지면 보스가 그 자리에 와 있다
    const x0 = s.p.x;
    const y0 = s.p.y;
    while (s.warns.filter((w) => w.delay <= 0).length && s.warns.length === m.count) step(s, noInput());
    expect(Math.hypot(b.x - x0, b.y - y0)).toBeLessThan(40);
    // 옮겨 서면 다음 것은 새 자리를 노린다
    s.p.x += 300;
    while (s.warns.length) step(s, noInput());
    expect(Math.hypot(b.x - s.p.x, b.y - s.p.y)).toBeLessThan(40);
    expect(hurts(s)).toBeGreaterThan(0);
  });
});

describe('5지형 용의 연못 — 끌어당기기 · 물길 · 왕지네', () => {
  it('메기 요괴: 직선을 예고하고, 맞으면 제 앞으로 끌어당긴다. 비키면 끌려가지 않는다', () => {
    const go = (dodge: boolean) => {
      const s = run(hall({ groups: [group(8, 6, 'catfish')] }), { level: 20 });
      const e = place(s, s.enemies[0], 0, -300);
      e.cd = 0;
      const w = untilWarn(s);
      expect(w).toMatchObject({ shape: 'line', after: 'pull', aux: ENEMIES.catfish.pull! });
      expect(w.total).toBeGreaterThanOrEqual(0.7);
      if (dodge) s.p.x += 110;
      const d0 = Math.hypot(e.x - s.p.x, e.y - s.p.y);
      play(s, ENEMIES.catfish.windup + 0.05);
      return d0 - Math.hypot(e.x - s.p.x, e.y - s.p.y);
    };
    expect(go(false)).toBeGreaterThan(ENEMIES.catfish.pull! * 0.8);
    expect(Math.abs(go(true))).toBeLessThan(40);
  });

  it('물길: 물에 서 있으면 물살이 아래로 민다. 뱀은 밀리지 않고, 다른 지형의 물은 밀지 않는다', () => {
    const drift = (region: number, o: Parameters<typeof run>[1] = {}) => {
      const s = run(bog(region), o);
      const y0 = s.p.y;
      play(s, 1);
      return { s, d: s.p.y - y0 };
    };
    expect(REGION_TABLE[4]).toMatchObject({ env: 'water', counter: 'snake', home: 'dragon' });
    expect(drift(5, { hero: 'dragon' }).d).toBeCloseTo(ENV.water.push, 0);
    expect(drift(5, { hero: 'snake' }).d).toBe(0);
    expect(drift(1).d).toBe(0);
    const ward = createRun(bog(5), 'normal', { ...lo('rat'), fx: ['ward'] });
    const y0 = ward.p.y;
    play(ward, 1);
    expect(ward.p.y - y0).toBeCloseTo(ENV.water.push * FX.ward.env, 0);
    // 마른 땅에서는 밀리지 않는다
    const dry = run(hall({ region: 5, id: '5-1' }));
    const dy0 = dry.p.y;
    play(dry, 1);
    expect(dry.p.y).toBe(dy0);
    // 물살을 거슬러 올라갈 수 있다 (걷는 속도가 물살보다 빠르다)
    const up = run(bog(5), { hero: 'dragon' });
    const uy0 = up.p.y;
    play(up, 1, { my: -1 });
    expect(up.p.y).toBeLessThan(uy0 - 40);
  });

  it('왕지네: 나란한 줄로 훑는다 (가운데 줄이 내 자리). 줄 사이에 서면 안 맞는다', () => {
    const go = (side: boolean) => {
      const { s, b } = bossRoom(5);
      expect(b.bossDef!.id).toBe('centipede');
      const m = BOSSES.centipede.moves[0];
      if (m.t !== 'rake') throw new Error('첫 공격이 훑기가 아니다');
      s.p.x = b.x;
      s.p.y = b.y + 300;
      untilWarn(s, 10);
      expect(s.warns.length).toBe(m.n);
      expect(s.warns.every((w) => w.shape === 'line' && w.len === m.len && w.total >= 0.7)).toBe(true);
      // 모두 같은 방향 (나란하다)
      expect(new Set(s.warns.map((w) => w.ang.toFixed(4))).size).toBe(1);
      expect(m.space - m.w).toBeGreaterThan(60); // 줄 사이에 설 자리
      if (side) s.p.x += m.space / 2;
      const hp = s.p.hp;
      for (let i = 0; i < 120 && s.warns.length; i++) step(s, noInput());
      return hp - s.p.hp;
    };
    expect(go(false)).toBeGreaterThan(0);
    expect(go(true)).toBe(0);
  });
});

describe('6지형 뱀의 늪 — 독 웅덩이 · 독안개 · 구미호', () => {
  it('독두꺼비: 내 자리에 독을 뱉어 웅덩이를 남긴다. 서 있으면 계속 다치고, 나오면 멈추고, 시간이 지나면 사라진다', () => {
    const s = run(hall({ groups: [group(8, 6, 'toad')] }), { level: 10 });
    const e = place(s, s.enemies[0], 0, -300);
    e.cd = 0;
    const w = untilWarn(s);
    expect(w).toMatchObject({ shape: 'circle', after: 'pool', r: ENEMIES.toad.area });
    expect(Math.hypot(w.x - s.p.x, w.y - s.p.y)).toBeLessThan(5);
    e.cd = 99;
    play(s, ENEMIES.toad.windup + 0.05);
    expect(s.pools.length).toBe(1);
    expect(s.pools[0].left).toBeCloseTo(ENEMIES.toad.pool!.dur, 0);
    const n0 = hurts(s); // 뱉은 독에 맞은 것
    expect(n0).toBe(1);
    play(s, POOL_TICK * 2 + 0.45);
    expect(hurts(s)).toBeGreaterThanOrEqual(n0 + 2);
    // 웅덩이에서 나오면 더 다치지 않는다
    s.p.x += ENEMIES.toad.area + 60;
    const n1 = hurts(s);
    play(s, 1);
    expect(hurts(s)).toBe(n1);
    play(s, ENEMIES.toad.pool!.dur);
    expect(s.pools.length).toBe(0);
  });

  it('독안개: 늪에 서 있으면 독 피해 (방어 무시). 말은 독을 입지 않고, 수호 갑옷은 절반', () => {
    const stand = (o: Parameters<typeof run>[1], fx = false) => {
      const s = fx ? createRun(bog(6), 'normal', { ...lo('rat', 'sword', 30), fx: ['ward'], armorDef: 500 }) : run(bog(6), { level: 30, ...o });
      const hp = s.p.hp;
      play(s, ENV.poison.tick * 3 + 0.1);
      return { s, lost: hp - s.p.hp };
    };
    expect(REGION_TABLE[5]).toMatchObject({ env: 'poison', counter: 'horse', home: 'snake' });
    const rat = stand({ hero: 'rat' });
    expect(rat.lost).toBe(3 * Math.round(rat.s.stats.hp * ENV.poison.pct));
    expect(stand({ hero: 'horse' }).lost).toBe(0);
    const ward = stand({}, true);
    expect(ward.lost).toBe(3 * Math.round(ward.s.stats.hp * ENV.poison.pct * FX.ward.env));
    // 마른 땅 · 다른 지형의 물에서는 독이 없다
    const dry = run(hall({ region: 6, id: '6-1' }));
    play(dry, 3);
    expect(dry.p.hp).toBe(dry.stats.hp);
    const pond = run(bog(1));
    play(pond, 3);
    expect(pond.p.hp).toBe(pond.stats.hp);
    // 독으로도 쓰러진다
    const weak = run(bog(6), { hero: 'rat' });
    weak.p.hp = 2;
    play(weak, ENV.poison.tick + 0.1);
    expect(weak.phase).toBe('dead');
  });

  it('구미호: 둘레를 친 뒤 여우구슬을 사방으로 쏜다. 독불은 웅덩이를 남긴다', () => {
    const { s, b } = bossRoom(6, { god: true });
    expect(b.bossDef!.id).toBe('gumiho');
    const m = BOSSES.gumiho.moves[0];
    if (m.t !== 'nova') throw new Error('첫 공격이 여우구슬이 아니다');
    s.p.x = b.x;
    s.p.y = b.y + 400;
    const w = untilWarn(s, 10);
    expect(w).toMatchObject({ shape: 'circle', after: 'nova', aux: m.n, r: m.r });
    expect(w.total).toBeGreaterThanOrEqual(0.7);
    while (s.warns.length) step(s, noInput());
    const orbs = s.shots.filter((sh) => sh.on && sh.foe);
    expect(orbs.length).toBe(m.n);
    // 고르게 퍼진다: 방향이 모두 다르다
    expect(new Set(orbs.map((sh) => Math.atan2(sh.vy, sh.vx).toFixed(2))).size).toBe(m.n);
    expect(Math.hypot(orbs[0].vx, orbs[0].vy)).toBeCloseTo(m.speed, 0);
    // 다음 공격: 독불 → 웅덩이
    const m2 = BOSSES.gumiho.moves[1];
    if (m2.t !== 'barrage' || !m2.pool) throw new Error('둘째 공격이 독불이 아니다');
    untilWarn(s, 10);
    expect(s.warns.every((v) => v.after === 'pool')).toBe(true);
    while (s.warns.length) step(s, noInput());
    expect(s.pools.length).toBe(m2.n);
  });
});

describe('7지형 말의 성문 — 자폭 · 성벽 화살 · 수문장 대장', () => {
  it('화약 도깨비: 달려와 제 둘레를 예고하고 터지며 사라진다 (잡은 것으로 센다). 멀리 피하면 안 다친다', () => {
    const go = (dodge: boolean) => {
      const s = run(hall({ groups: [group(8, 6, 'bomber'), group(3, 3, 'imp', 9)] }), { level: 5 });
      const e = place(s, s.enemies[0], 0, -200);
      e.cd = 0;
      const w = untilWarn(s);
      expect(w).toMatchObject({ shape: 'circle', after: 'boom', big: true });
      expect(w.total).toBeGreaterThanOrEqual(0.7);
      expect(Math.hypot(w.x - e.x, w.y - e.y)).toBeLessThan(1);
      if (dodge) s.p.x += ENEMIES.bomber.area + 80;
      const hp = s.p.hp;
      play(s, ENEMIES.bomber.windup + 0.05);
      expect(e.dead).toBe(true);
      expect(s.kills.bomber).toBe(1);
      return hp - s.p.hp;
    };
    expect(go(false)).toBeGreaterThan(0);
    expect(go(true)).toBe(0);
  });

  it('화약 도깨비: 터지기 전에 쓰러뜨리면 터지지 않는다', () => {
    const s = run(hall({ groups: [group(8, 6, 'bomber'), group(3, 3, 'imp', 9)] }), { level: 5 });
    const e = place(s, s.enemies[0], 0, -70);
    e.cd = 0;
    untilWarn(s);
    e.hp = 1;
    const hp = s.p.hp;
    play(s, 0.2, { attack: true });
    expect(e.dead).toBe(true);
    expect(s.warns.length).toBe(0);
    play(s, 1);
    expect(s.p.hp).toBe(hp);
    expect(alive(s).length).toBe(9);
  });

  it('성벽 화살: 정해진 때마다 내 자리와 그 둘레에 떨어진다. 원숭이에게는 떨어지지 않는다', () => {
    const gate = (hero: 'horse' | 'monkey') => run(hall({ region: 7, id: '7-1' }), { hero, level: 35 });
    expect(REGION_TABLE[6]).toMatchObject({ env: 'arrow', counter: 'monkey', home: 'horse' });
    const a = ENV.arrow;
    const s = gate('horse');
    play(s, a.every - 0.1);
    expect(s.warns.length).toBe(0);
    play(s, 0.2);
    expect(s.events.find((v) => v.e === 'env')).toMatchObject({ id: 'arrow' });
    expect(s.warns.length).toBe(a.n);
    expect(s.warns.every((w) => w.shape === 'circle' && w.r === a.r && w.src === -1 && w.total >= 0.7)).toBe(true);
    expect(Math.hypot(s.warns[0].x - s.p.x, s.warns[0].y - s.p.y)).toBeLessThan(3);
    for (const w of s.warns.slice(1)) expect(Math.hypot(w.x - s.p.x, w.y - s.p.y)).toBeLessThanOrEqual(a.spread + 3);
    expect(s.warns[0].dmg).toBeCloseTo(a.dmg * mapScale(7, 1, 'normal').atk);
    // 서 있으면 맞고, 다음 차례에 또 온다
    const hp = s.p.hp;
    play(s, a.warn + 0.1);
    expect(s.p.hp).toBeLessThan(hp);
    play(s, a.every);
    expect(s.events.filter((v) => v.e === 'env').length).toBe(2);
    // 같은 때에는 늘 같은 자리 (무작위를 쓰지 않는다)
    const again = gate('horse');
    play(again, a.every + 0.1);
    const first = gate('horse');
    play(first, a.every + 0.1);
    expect(again.warns.map((w) => [w.x, w.y])).toEqual(first.warns.map((w) => [w.x, w.y]));
    const monkey = gate('monkey');
    play(monkey, a.every * 2 + 2);
    expect(monkey.warns.length).toBe(0);
    expect(monkey.p.hp).toBe(monkey.stats.hp);
    expect(monkey.events.some((v) => v.e === 'env')).toBe(true); // 화면이 '다 잡아냈어요'라고 알린다
  });

  it('수문장 대장: 화살 비가 내 쪽으로 줄지어 떨어진다 (차례로 늦게). 옆으로 비키면 안 맞는다', () => {
    const go = (side: boolean) => {
      const { s, b } = bossRoom(7, { hero: 'monkey' }); // 성벽 화살이 섞이지 않게
      expect(b.bossDef!.id).toBe('guardCaptain');
      const m = BOSSES.guardCaptain.moves[0];
      if (m.t !== 'march') throw new Error('첫 공격이 화살 비가 아니다');
      s.p.x = b.x;
      s.p.y = b.y + 380;
      untilWarn(s, 10);
      expect(s.warns.length).toBe(m.n);
      expect(s.warns.every((w) => w.shape === 'circle' && w.r === m.r && Math.abs(w.x - b.x) < 2)).toBe(true);
      for (let i = 1; i < m.n; i++) {
        expect(s.warns[i].y - s.warns[i - 1].y).toBeCloseTo(m.step, 0);
        expect(s.warns[i].t).toBeGreaterThan(s.warns[i - 1].t);
      }
      if (side) s.p.x += m.r + 40;
      const hp = s.p.hp;
      for (let i = 0; i < 240 && s.warns.length; i++) step(s, noInput());
      return hp - s.p.hp;
    };
    expect(go(false)).toBeGreaterThan(0);
    expect(go(true)).toBe(0);
  });
});

describe('4~7지형 — 보스 · 합류 대원 · 고향 보너스', () => {
  const four = [4, 5, 6, 7];

  it('보스: 저마다 다른 공격 순서(그 보스만의 공격 하나 이상), 예고 0.7초 이상, 대사 2~3줄과 쓰러질 때 한마디', () => {
    const own = { 4: 'leap', 5: 'rake', 6: 'nova', 7: 'march' } as const;
    const base = JSON.stringify(BOSSES.bigDokkaebi.moves);
    for (const r of four) {
      const b = BOSSES[regionOf(r).boss];
      expect(JSON.stringify(b.moves)).not.toBe(base);
      expect(b.moves.some((m) => m.t === own[r as 4])).toBe(true);
      expect(b.moves.length).toBeGreaterThanOrEqual(5);
      for (const m of [...b.moves, ...b.hardMoves]) expect(m.warn, `${b.name} ${m.t}`).toBeGreaterThanOrEqual(0.7);
      expect(b.hardMoves.length).toBeGreaterThan(0);
      expect(b.lines.length).toBeGreaterThanOrEqual(2);
      expect(b.lines.length).toBeLessThanOrEqual(3);
      expect(b.last.length).toBeGreaterThan(0);
      // 부하는 그 지형의 요괴다
      expect(regionOf(r).enemies).toContain(b.summon.kind);
    }
    expect(new Set(four.map((r) => JSON.stringify(BOSSES[regionOf(r).boss].moves))).size).toBe(4);
  });

  it('보스를 가만히 서서 맞아 보면: 모든 공격이 예고 뒤에 터지고 판이 멈추지 않는다 (무적)', () => {
    for (const r of four) {
      const { s, b } = bossRoom(r, { god: true, level: 30 });
      s.p.x = b.x;
      s.p.y = b.y + 320;
      let warned = 0;
      let last = 0;
      for (let i = 0; i < 60 * 45; i++) {
        step(s, noInput());
        if (s.warns.length > last) warned++;
        last = s.warns.length;
        for (const w of s.warns) expect(w.total).toBeGreaterThanOrEqual(0.5); // 부하의 작은 공격까지 포함
        s.events.length = 0;
      }
      expect(s.phase, `${r}지형`).toBe('play');
      expect(warned, `${r}지형`).toBeGreaterThan(8);
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
      // 보스가 방 밖으로 나가지 않는다
      expect(b.x).toBeGreaterThan(TILE);
      expect(b.x).toBeLessThan(15 * TILE);
      expect(b.y).toBeGreaterThan(TILE);
      expect(b.y).toBeLessThan(23 * TILE);
    }
  });

  it('합류: 4~7지형 보스를 잡으면 말 · 양 · 원숭이 · 닭이 한마디와 함께 온다', () => {
    expect(four.map((r) => joinsAt(r)!.id)).toEqual(['horse', 'sheep', 'monkey', 'rooster']);
    for (const r of four) expect(joinsAt(r)!.hello!.length).toBeGreaterThan(5);
  });

  it('환경을 막는 대원은 그 지형에 올 때 이미 함께하는 대원이다 (1~7지형)', () => {
    for (const r of REGION_TABLE.slice(0, 7)) {
      const h = heroOf(r.counter);
      expect(h.join, `${r.region}지형 ${h.name}`).toBeLessThan(r.region);
      expect(HEROES.some((x) => x.id === r.counter && !x.hidden)).toBe(true);
    }
    // 4~7지형은 환경 효과가 모두 다르다
    expect(new Set(four.map((r) => regionOf(r).env)).size).toBe(4);
  });

  it('고향 지형: 공격·방어 +10% (토끼 4 · 용 5 · 뱀 6 · 말 7)', () => {
    for (const [hero, home] of [['rabbit', 4], ['dragon', 5], ['snake', 6], ['horse', 7]] as const) {
      const l = { ...lo(hero, 'sword', 30), armorDef: 20 };
      const at = playerStats(l, home);
      const away = playerStats(l, 1);
      expect(at.home).toBe(true);
      expect(at.atk / away.atk).toBeCloseTo(HOME_BONUS, 5);
      expect(at.def / away.def).toBeCloseTo(HOME_BONUS, 5);
      expect(REGION_TABLE[home - 1].home).toBe(hero);
    }
  });
});
