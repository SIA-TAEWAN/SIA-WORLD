import { describe, expect, it } from 'vitest';
import { ENV, MP_REGEN, TILE } from '../src/data/balance';
import { BOSSES } from '../src/data/bosses';
import { BOSS_GIFT, FX, bossGift } from '../src/data/economy';
import { ENEMIES } from '../src/data/enemies';
import { HOME_BONUS, playerStats } from '../src/data/growth';
import { HEROES, ZODIAC_IDS, heroOf, joinsAt } from '../src/data/heroes';
import { mapsOf } from '../src/data/maps';
import { REGIONS_READY, REGION_TABLE, regionOf } from '../src/data/regions';
import { applyReport, emptyProfile, heroesOf, joinText, type RunReport } from '../src/game/progress';
import { createRun, noInput, playerSlow, sightOf, step, type RunState } from '../src/game/sim';
import { alive, arena, group, lo, place, play, run } from './helpers';

/**
 * 8~12지형 (6단계 나머지): 지형마다 새 요괴 행동 하나 · 보스 고유 공격 · 환경 효과와 막는 대원 · 10~12지형 보스의 선물.
 * 4~7지형의 것은 tests/regions2.test.ts 에 있다. 전투 규칙은 준비된 지형 수(REGIONS_READY)와 상관없이 본다.
 */
const hall = (over: Parameters<typeof arena>[0] = {}) =>
  arena({ rows: ['################', ...Array.from({ length: 22 }, () => '#..............#'), '################'], start: [8, 20], ...over });
/** 가운데 줄들이 물·불바닥인 방 */
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
const foeShots = (s: RunState) => s.shots.filter((x) => x.on && x.foe);

describe('8지형 양의 뜰 — 느려지게 하기 · 졸음 꽃가루 · 야광귀', () => {
  it('가위 귀신: 꽃가루에 맞으면 한동안 느려진다. 구르면 맞지 않는다', () => {
    const go = (dodge: boolean) => {
      const s = run(hall({ groups: [group(8, 6, 'sleeper')] }), { level: 10 });
      const e = place(s, s.enemies[0], 0, -300);
      e.cd = 0;
      expect(ENEMIES.sleeper.ai).toBe('hex');
      for (let i = 0; i < 120 && !foeShots(s).length; i++) step(s, noInput());
      const sh = foeShots(s)[0];
      expect(sh.slowDur).toBe(ENEMIES.sleeper.slow!.dur);
      if (dodge) s.p.x += 200;
      play(s, 1.2);
      return s;
    };
    const hit = go(false);
    expect(hit.p.hp).toBeLessThan(hit.stats.hp);
    expect(hit.p.slowT).toBeGreaterThan(0);
    expect(playerSlow(hit)).toBe(ENEMIES.sleeper.slow!.mul);
    // 느려진 동안에는 걷는 거리가 줄어든다
    hit.enemies[0].cd = 99;
    const y0 = hit.p.y;
    play(hit, 0.5, { my: 1 });
    expect(hit.p.y - y0).toBeCloseTo(hit.stats.speed * 0.5 * ENEMIES.sleeper.slow!.mul, -1);
    play(hit, ENEMIES.sleeper.slow!.dur);
    expect(playerSlow(hit)).toBe(1);
    const miss = go(true);
    expect(miss.p.hp).toBe(miss.stats.hp);
    expect(miss.p.slowT).toBeLessThanOrEqual(0);
  });

  it('졸음 꽃가루: 가만히 서 있으면 졸음이 쌓여 느려진다. 걸으면 깨고 구르면 바로 깬다. 호랑이는 졸지 않는다', () => {
    const z = ENV.sleep;
    const yard = (hero: 'sheep' | 'tiger' = 'sheep') => run(hall({ region: 8, id: '8-1' }), { hero, level: 40 });
    expect(REGION_TABLE[7]).toMatchObject({ env: 'sleep', counter: 'tiger', home: 'sheep' });
    const s = yard();
    play(s, z.after - 0.1);
    expect(s.env.acc).toBe(0);
    expect(playerSlow(s)).toBe(1);
    play(s, 0.2);
    expect(s.events.find((v) => v.e === 'env')).toMatchObject({ id: 'sleep' });
    play(s, z.full);
    expect(s.env.acc).toBeCloseTo(1, 5);
    expect(playerSlow(s)).toBeCloseTo(z.slow);
    // 걸으면 서서히 깬다
    play(s, z.wake / 2, { mx: 1 });
    expect(playerSlow(s)).toBeGreaterThan(z.slow + 0.1);
    expect(playerSlow(s)).toBeLessThan(1);
    play(s, z.wake, { mx: -1 });
    expect(playerSlow(s)).toBe(1);
    // 구르면 바로 깬다
    play(s, z.after + z.full + 0.1);
    expect(s.env.acc).toBe(1);
    play(s, 0.1, { roll: true });
    expect(s.env.acc).toBe(0);
    // 막는 대원 · 다른 지형
    const tiger = yard('tiger');
    play(tiger, z.after + z.full);
    expect(playerSlow(tiger)).toBe(1);
    const other = run(hall({ region: 7, id: '7-1' }), { hero: 'monkey' });
    play(other, z.after + z.full);
    expect(playerSlow(other)).toBe(1);
    const ward = createRun(hall({ region: 8, id: '8-1' }), 'normal', { ...lo('rat'), fx: ['ward'] });
    play(ward, z.after + z.full + 0.1);
    expect(playerSlow(ward)).toBeCloseTo(1 - (1 - z.slow) * FX.ward.env);
  });

  it('야광귀: 제 둘레를 친 뒤 도깨비불을 돌려 가며 쏜다 (한꺼번에 여러 갈래, 방향이 조금씩 돈다)', () => {
    const { s, b } = bossRoom(8, { god: true, hero: 'tiger' });
    expect(b.bossDef!.id).toBe('yagwanggwi');
    const m = BOSSES.yagwanggwi.moves[0];
    if (m.t !== 'spiral') throw new Error('첫 공격이 소용돌이가 아니다');
    s.p.x = b.x;
    s.p.y = b.y + 330;
    untilWarn(s, 10);
    expect(s.warns.length).toBe(m.n + 1);
    expect(s.warns[0]).toMatchObject({ shape: 'circle', r: m.r });
    expect(s.warns[0].total).toBeGreaterThanOrEqual(0.7);
    play(s, m.warn + 0.05);
    expect(foeShots(s).length).toBe(m.arms);
    const first = foeShots(s).map((x) => Math.atan2(x.vy, x.vx));
    play(s, m.gap);
    expect(foeShots(s).length).toBe(m.arms * 2);
    const next = Math.atan2(foeShots(s)[m.arms].vy, foeShots(s)[m.arms].vx);
    expect(Math.abs(next - first[0])).toBeCloseTo(Math.abs(m.turn), 1);
    play(s, m.n * m.gap);
    expect(s.warns.filter((w) => w.after === 'nova').length).toBe(0);
  });
});

describe('9지형 원숭이의 누각 — 튕기는 탄 · 미끄러운 마루 · 이무기', () => {
  it('잔나비 요괴: 밤송이가 벽에 맞고 튕겨 돌아온다 (정해진 횟수만)', () => {
    const s = run(arena({ groups: [group(8, 6, 'acorn')] }), { level: 10 });
    const e = place(s, s.enemies[0], 0, -300);
    e.cd = 0;
    expect(ENEMIES.acorn.ai).toBe('bounce');
    for (let i = 0; i < 120 && !foeShots(s).length; i++) step(s, noInput());
    const sh = foeShots(s)[0];
    expect(sh.bounce).toBe(ENEMIES.acorn.bounce);
    e.cd = 99;
    // 대원이 비켜서면 아래 벽에 맞고 위로 되튄다
    s.p.x += 200;
    expect(sh.vy).toBeGreaterThan(0);
    let bounced = 0;
    let vy = sh.vy;
    for (let i = 0; i < 400 && sh.on; i++) {
      step(s, noInput());
      if (Math.sign(sh.vy) !== Math.sign(vy)) bounced++;
      vy = sh.vy;
    }
    expect(bounced).toBe(ENEMIES.acorn.bounce);
    expect(sh.on).toBe(false);
    // 보통 요괴의 불은 튕기지 않는다
    const f = run(hall({ groups: [group(8, 6, 'fox')] }), { level: 10 });
    place(f, f.enemies[0], 0, -300).cd = 0;
    for (let i = 0; i < 120 && !foeShots(f).length; i++) step(f, noInput());
    expect(foeShots(f)[0].bounce).toBe(0);
  });

  it('미끄러운 마루: 멈추면 가던 쪽으로 미끄러진다. 토끼는 미끄러지지 않는다', () => {
    const slide = (region: number, hero: 'monkey' | 'rabbit') => {
      const s = run(hall({ region, id: `${region}-1` as '9-1', start: [3, 12] }), { hero, level: 45 });
      play(s, 0.5, { mx: 1 });
      const x0 = s.p.x;
      play(s, 2);
      return s.p.x - x0;
    };
    expect(REGION_TABLE[8]).toMatchObject({ env: 'slip', counter: 'rabbit', home: 'monkey' });
    const d = slide(9, 'monkey');
    expect(d).toBeGreaterThan(60);
    expect(d).toBeLessThan(130);
    expect(slide(9, 'rabbit')).toBe(0);
    expect(slide(8, 'monkey')).toBe(0);
    // 벽을 뚫고 미끄러지지 않는다
    const s = run(hall({ region: 9, id: '9-1', start: [13, 12] }), { hero: 'monkey' });
    play(s, 0.6, { mx: 1 });
    play(s, 2);
    expect(s.p.x).toBeLessThan(15 * TILE);
  });

  it('이무기: 물결이 가로줄로 차례차례 밀려온다. 줄 사이에 서면 안 맞는다', () => {
    const go = (shift: number) => {
      const { s, b } = bossRoom(9, { hero: 'rabbit' });
      expect(b.bossDef!.id).toBe('imugi');
      const m = BOSSES.imugi.moves[0];
      if (m.t !== 'wave') throw new Error('첫 공격이 물결이 아니다');
      s.p.x = b.x;
      s.p.y = b.y + 400;
      untilWarn(s, 10);
      // 셋째 줄 위에 (또는 줄 사이에) 선다 — 보스는 예고하는 동안 움직이지 않는다
      s.p.y = b.y + b.r + 50 + m.step * 2 + shift;
      expect(s.warns.length).toBe(m.n);
      expect(s.warns.every((w) => w.shape === 'line' && w.len === m.len && w.total >= 0.7)).toBe(true);
      for (let i = 1; i < m.n; i++) expect(s.warns[i].t).toBeGreaterThan(s.warns[i - 1].t);
      expect(m.step - m.w).toBeGreaterThan(60); // 줄 사이에 설 자리
      const hp = s.p.hp;
      for (let i = 0; i < 300 && s.warns.length; i++) step(s, noInput());
      return hp - s.p.hp;
    };
    expect(go(0)).toBeGreaterThan(0);
    expect(go(BOSSES.imugi.moves[0].t === 'wave' ? BOSSES.imugi.moves[0].step / 2 : 0)).toBe(0);
  });
});

describe('10지형 닭의 새벽길 — 날뛰기 · 새벽빛 · 저승사자', () => {
  it('야차: 체력이 절반 아래로 내려가면 날뛴다 (더 빠르게, 더 세게, 더 자주)', () => {
    const go = (hurt: boolean) => {
      const s = run(hall({ groups: [group(8, 6, 'yaksha')] }), { level: 10, god: true });
      const e = place(s, s.enemies[0], 0, -400);
      if (hurt) e.hp = e.maxHp * 0.4;
      e.cd = 9;
      const y0 = e.y;
      play(s, 1);
      const walked = e.y - y0;
      place(s, e, 0, -60).cd = 0;
      const w = untilWarn(s);
      return { walked, dmg: w.dmg, cd: e.cd };
    };
    expect(ENEMIES.yaksha.ai).toBe('rage');
    const g = ENEMIES.yaksha.rage!;
    const calm = go(false);
    const mad = go(true);
    expect(mad.walked / calm.walked).toBeCloseTo(g.speed, 1);
    expect(mad.dmg / calm.dmg).toBeCloseTo(g.atk, 5);
    expect(mad.cd / calm.cd).toBeCloseTo(g.cd, 5);
  });

  it('새벽빛: 정해진 때마다 눈이 부셔 먼 요괴를 조준하지 못한다 (미리 알린다). 양은 눈이 부시지 않는다', () => {
    const g = ENV.glare;
    const road = (hero: 'rooster' | 'sheep') => run(hall({ region: 10, id: '10-1', groups: [group(8, 6, 'imp')] }), { hero, weapon: 'bow', level: 50 });
    expect(REGION_TABLE[9]).toMatchObject({ env: 'glare', counter: 'sheep', home: 'rooster' });
    const s = road('rooster');
    s.enemies[0].cd = 999;
    place(s, s.enemies[0], 0, -(g.see + 120));
    expect(sightOf(s)).toBe(Infinity);
    play(s, g.every - g.warn + 0.05);
    expect(s.events.find((v) => v.e === 'env')).toMatchObject({ id: 'glare' });
    expect(sightOf(s)).toBe(Infinity);
    play(s, g.warn + 0.05);
    expect(s.env.blind).toBe(true);
    expect(sightOf(s)).toBe(g.see);
    // 눈이 부신 동안에는 먼 요괴 쪽으로 돌아서지 않는다
    s.enemies[0].y = s.p.y - (g.see + 120);
    s.enemies[0].x = s.p.x;
    s.p.fx = 1;
    s.p.fy = 0;
    step(s, { ...noInput(), attack: true });
    expect(s.p.fx).toBe(1);
    play(s, g.dur);
    expect(s.env.blind).toBe(false);
    expect(sightOf(s)).toBe(Infinity);
    const sheep = road('sheep');
    play(sheep, g.every + 0.2);
    expect(sightOf(sheep)).toBe(Infinity);
    expect(g.warn).toBeGreaterThanOrEqual(0.7);
  });

  it('저승사자: 낫을 돌려 둘레를 조각조각 차례로 벤다 (대원 쪽부터, 모두 합치면 한 바퀴)', () => {
    const { s, b } = bossRoom(10, { hero: 'sheep' });
    expect(b.bossDef!.id).toBe('reaper');
    const m = BOSSES.reaper.moves[0];
    if (m.t !== 'sweep') throw new Error('첫 공격이 돌려 베기가 아니다');
    s.p.x = b.x;
    s.p.y = b.y + 200;
    untilWarn(s, 10);
    expect(s.warns.length).toBe(m.n);
    expect(s.warns.every((w) => w.shape === 'arc' && w.r === m.r && w.total >= 0.7)).toBe(true);
    expect(s.warns.reduce((a, w) => a + w.half * 2, 0)).toBeCloseTo(Math.PI * 2);
    for (let i = 1; i < m.n; i++) expect(s.warns[i].t - s.warns[i - 1].t).toBeCloseTo(m.gap);
    // 첫 조각이 대원 쪽이다: 서 있으면 맞는다
    const hp = s.p.hp;
    play(s, m.warn + 0.05);
    expect(s.p.hp).toBeLessThan(hp);
    // 멀리 있으면 안 맞는다
    const far = bossRoom(10, { hero: 'sheep' });
    far.s.p.x = far.b.x;
    far.s.p.y = far.b.y + m.r + 60;
    untilWarn(far.s, 10);
    const hp2 = far.s.p.hp;
    for (let i = 0; i < 300 && far.s.warns.length; i++) {
      far.s.p.y = Math.max(far.s.p.y, far.b.y + m.r + 60);
      step(far.s, noInput());
      if (far.b.busy <= 0) break;
    }
    expect(far.s.p.hp).toBe(hp2);
  });
});

describe('11지형 개의 삼도천 — 불러내기 · 찬 강바람 · 강철이', () => {
  it('뱃사공 망령: 작은 망자를 불러낸다 (한꺼번에 max 마리까지). 쓰러뜨리면 망자도 사라지고, 망자는 처치 수에 넣지 않는다', () => {
    const s = run(hall({ groups: [group(8, 6, 'ferryman'), group(3, 3, 'imp', 9)] }), { level: 30, god: true });
    const c = ENEMIES.ferryman.call!;
    expect(ENEMIES.ferryman.ai).toBe('call');
    const e = place(s, s.enemies[0], 0, -330);
    e.cd = 0;
    const total = s.total;
    const w = untilWarn(s);
    expect(w).toMatchObject({ after: 'call', dmg: 0 });
    play(s, ENEMIES.ferryman.windup + 0.05);
    const minis = () => s.enemies.filter((o) => o.owner === e.id && !o.dead);
    expect(minis().length).toBe(c.n);
    expect(minis().every((o) => o.summoned && o.kind === c.kind && o.exp === 0 && o.coin === 0 && o.maxHp < e.maxHp)).toBe(true);
    expect(s.p.hp).toBe(s.stats.hp); // 불러내는 원은 다치지 않는다
    // 더 불러도 max 를 넘지 않는다
    play(s, ENEMIES.ferryman.cd * 2 + 2);
    expect(minis().length).toBeLessThanOrEqual(c.max);
    // 망령을 쓰러뜨리면 망자도 함께 사라진다
    const killed = s.killed;
    e.hp = 1;
    place(s, e, 0, -60);
    for (let i = 0; i < 240 && !e.dead; i++) step(s, { ...noInput(), attack: true });
    expect(e.dead).toBe(true);
    expect(minis().length).toBe(0);
    expect(s.killed).toBe(killed + 1);
    expect(s.kills.ferryman).toBe(1);
    expect(s.kills.skeleton ?? 0).toBe(0);
    expect(s.total).toBe(total);
  });

  it('뱃사공 망령은 모두 times 번까지만 불러낸다', () => {
    const s = run(hall({ groups: [group(8, 6, 'ferryman')] }), { level: 30, god: true });
    const c = ENEMIES.ferryman.call!;
    const e = place(s, s.enemies[0], 0, -330);
    let born = 0;
    let seen = s.enemies.length;
    for (let i = 0; i < 60 * 90; i++) {
      // 불러낸 것은 바로 치운다 (자리가 비어야 또 부른다)
      for (const o of s.enemies) if (o.owner === e.id && !o.dead) (o.dead = true), (o.hp = 0);
      place(s, e, 0, -330);
      step(s, noInput());
      if (s.enemies.length > seen) (born += s.enemies.length - seen), (seen = s.enemies.length);
      s.events.length = 0;
    }
    expect(born).toBe(c.n * c.times);
  });

  it('찬 강바람: 마력이 느리게 찬다. 용은 그대로 찬다', () => {
    const gain = (region: number, hero: 'dog' | 'dragon') => {
      const s = run(hall({ region, id: `${region}-1` as '11-1' }), { hero, level: 55 });
      s.p.mp = 0;
      play(s, 2);
      return s.p.mp / s.stats.mp;
    };
    expect(REGION_TABLE[10]).toMatchObject({ env: 'cold', counter: 'dragon', home: 'dog' });
    expect(gain(11, 'dog')).toBeCloseTo(MP_REGEN * 2 * ENV.cold.regen, 3);
    expect(gain(11, 'dragon')).toBeCloseTo(MP_REGEN * 2, 3);
    expect(gain(10, 'dog')).toBeCloseTo(MP_REGEN * 2, 3);
    expect(ENV.cold.regen).toBeLessThan(1);
  });

  it('강철이: 불숨이 지나간 줄에 불길이 남는다. 불길 위에 서 있으면 계속 다치고 시간이 지나면 꺼진다', () => {
    const { s, b } = bossRoom(11, { hero: 'dragon', level: 60 });
    expect(b.bossDef!.id).toBe('gangcheori');
    const m = BOSSES.gangcheori.moves[0];
    if (m.t !== 'scorch') throw new Error('첫 공격이 불숨이 아니다');
    s.p.x = b.x;
    s.p.y = b.y + 300;
    const w = untilWarn(s, 10);
    expect(w).toMatchObject({ shape: 'line', after: 'trail', len: m.len, aux: m.pool.dur });
    expect(w.total).toBeGreaterThanOrEqual(0.7);
    // 옆으로 비키면 안 맞고, 줄에는 불길이 남는다
    s.p.x += m.w + 40;
    const hp = s.p.hp;
    play(s, m.warn + 0.05);
    expect(s.p.hp).toBe(hp);
    expect(s.pools.length).toBeGreaterThan(3);
    expect(s.pools.every((z) => z.fire && Math.abs(z.x - b.x) < 2 && z.y > b.y)).toBe(true);
    // 불길로 들어가면 다친다
    b.cd = 99;
    b.busy = 99;
    s.p.x = s.pools[2].x;
    s.p.y = s.pools[2].y;
    play(s, 1.1);
    expect(s.p.hp).toBeLessThan(hp);
    play(s, m.pool.dur);
    expect(s.pools.length).toBe(0);
  });
});

describe('12지형 돼지의 염라전 — 불길 남기기 · 불바닥 · 염라대왕', () => {
  it('화차: 돌진한 줄에 불길이 남는다', () => {
    const s = run(hall({ groups: [group(8, 6, 'firecart')] }), { level: 20 });
    const e = place(s, s.enemies[0], 0, -280);
    e.cd = 0;
    const t = ENEMIES.firecart.trail!;
    expect(ENEMIES.firecart.ai).toBe('blaze');
    const w = untilWarn(s);
    expect(w).toMatchObject({ shape: 'line', after: 'dash', aux: t.dur, r: t.r });
    expect(w.total).toBeGreaterThanOrEqual(0.5);
    s.p.x += 120;
    const y0 = e.y;
    play(s, ENEMIES.firecart.windup + 0.05);
    expect(e.y).toBeGreaterThan(y0 + 200); // 돌진했다
    expect(s.pools.length).toBeGreaterThan(2);
    expect(s.pools.every((z) => z.fire && z.r === t.r)).toBe(true);
    expect(s.p.hp).toBe(s.stats.hp);
    // 보통 돌진 요괴(도깨비불)는 불길을 남기지 않는다
    const f = run(hall({ groups: [group(8, 6, 'wisp')] }), { level: 20 });
    place(f, f.enemies[0], 0, -280).cd = 0;
    untilWarn(f);
    f.p.x += 120;
    play(f, ENEMIES.wisp.windup + 0.05);
    expect(f.pools.length).toBe(0);
  });

  it('불길: 불바닥을 밟으면 바로 데고, 벗어난 뒤에도 조금 더 덴다. 개는 데지 않는다', () => {
    const f = ENV.fire;
    expect(REGION_TABLE[11]).toMatchObject({ env: 'fire', counter: 'dog', home: 'pig' });
    const s = run(bog(12), { hero: 'pig', level: 60 });
    const tick = Math.round(s.stats.hp * f.pct);
    play(s, f.first + 0.05);
    expect(s.stats.hp - s.p.hp).toBe(tick);
    play(s, f.tick * 2);
    expect(s.stats.hp - s.p.hp).toBe(tick * 3);
    // 마른 땅으로 나와도 linger 번 더 덴다
    s.p.y = 3.5 * TILE;
    const hp = s.p.hp;
    play(s, f.tick * (f.linger + 3));
    expect(hp - s.p.hp).toBe(tick * f.linger);
    const dog = run(bog(12), { hero: 'dog', level: 60 });
    play(dog, 3);
    expect(dog.p.hp).toBe(dog.stats.hp);
    // 다른 지형의 물은 데지 않는다
    const other = run(bog(11), { hero: 'dog', level: 60 });
    play(other, 3);
    expect(other.p.hp).toBe(other.stats.hp);
    // 불바닥으로도 쓰러진다
    const weak = run(bog(12), { hero: 'pig', level: 60 });
    weak.p.hp = 1;
    play(weak, f.first + 0.1);
    expect(weak.phase).toBe('dead');
  });

  it('염라대왕: 대원 둘레를 에워싼 뒤 가운데를 친다. 가운데에서 기다렸다가 밖으로 나가면 안 맞는다', () => {
    const go = (plan: 'stay' | 'ring' | 'dodge') => {
      const { s, b } = bossRoom(12, { hero: 'dog', level: 62 });
      expect(b.bossDef!.id).toBe('yeomra');
      const m = BOSSES.yeomra.moves[0];
      if (m.t !== 'cage') throw new Error('첫 공격이 에워싸기가 아니다');
      s.p.x = b.x;
      s.p.y = b.y + 420;
      untilWarn(s, 10);
      expect(s.warns.length).toBe(m.n + 1);
      const ring = s.warns.slice(0, m.n);
      const mid = s.warns[m.n];
      expect(ring.every((w) => w.shape === 'circle' && w.r === m.r && Math.abs(Math.hypot(w.x - s.p.x, w.y - s.p.y) - m.d) < 1 && w.total >= 0.7)).toBe(true);
      expect(Math.hypot(mid.x - s.p.x, mid.y - s.p.y)).toBeLessThan(1);
      expect(mid.t - ring[0].t).toBeCloseTo(m.gap);
      const hp = s.p.hp;
      if (plan === 'ring') (s.p.x = ring[0].x), (s.p.y = ring[0].y);
      play(s, m.warn + 0.03);
      // 둘레가 터진 뒤 가운데가 터지기 전에 밖으로 나간다
      if (plan === 'dodge') s.p.y += m.d + 40;
      play(s, m.gap + 0.05);
      return hp - s.p.hp;
    };
    expect(go('stay')).toBeGreaterThan(0);
    expect(go('ring')).toBeGreaterThan(0);
    expect(go('dodge')).toBe(0);
  });
});

describe('8~12지형 — 보스 · 합류 대원 · 보스의 선물 · 고향 보너스', () => {
  const five = [8, 9, 10, 11, 12];

  it('보스: 저마다 다른 공격 순서(그 보스만의 공격 하나 이상), 예고 0.7초 이상, 대사 2~3줄과 쓰러질 때 한마디', () => {
    const own = { 8: 'spiral', 9: 'wave', 10: 'sweep', 11: 'scorch', 12: 'cage' } as const;
    const base = JSON.stringify(BOSSES.bigDokkaebi.moves);
    for (const r of five) {
      const b = BOSSES[regionOf(r).boss];
      expect(JSON.stringify(b.moves)).not.toBe(base);
      expect(b.moves[0].t).toBe(own[r as 8]);
      expect(b.moves.length).toBeGreaterThanOrEqual(5);
      for (const m of [...b.moves, ...b.hardMoves]) expect(m.warn, `${b.name} ${m.t}`).toBeGreaterThanOrEqual(0.7);
      expect(b.hardMoves.length).toBeGreaterThan(0);
      expect(b.lines.length).toBeGreaterThanOrEqual(2);
      expect(b.lines.length).toBeLessThanOrEqual(3);
      expect(b.last.length).toBeGreaterThan(0);
      expect(regionOf(r).enemies).toContain(b.summon.kind);
    }
    // 그 보스만의 공격은 앞 지형 보스에게 없다 (12지형 염라대왕은 앞 보스들의 공격을 섞어 쓴다)
    for (const r of five) {
      for (let q = 1; q < r; q++) expect(BOSSES[regionOf(q).boss].moves.some((m) => m.t === own[r as 8]), `${q}지형 보스`).toBe(false);
    }
    // 뒤로 갈수록 단단하다
    const hp = five.map((r) => BOSSES[regionOf(r).boss].hp);
    expect([...hp].sort((a, b) => a - b)).toEqual(hp);
  });

  it('보스를 가만히 서서 맞아 보면: 모든 공격이 예고 뒤에 터지고 판이 멈추지 않는다 (무적, 보통·어려움)', () => {
    for (const r of five) {
      for (const mode of ['normal', 'hard'] as const) {
        const { s, b } = bossRoom(r, { god: true, level: 50, mode });
        s.p.x = b.x;
        s.p.y = b.y + 320;
        let warned = 0;
        let last = 0;
        for (let i = 0; i < 60 * 50; i++) {
          step(s, noInput());
          if (s.warns.length > last) warned++;
          last = s.warns.length;
          for (const w of s.warns) if (w.shape !== 'none') expect(w.total, `${r}지형 ${w.shape}`).toBeGreaterThanOrEqual(0.5);
          s.events.length = 0;
        }
        expect(s.phase, `${r}지형`).toBe('play');
        expect(warned, `${r}지형`).toBeGreaterThan(8);
        expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
        expect(Number.isFinite(s.p.x) && Number.isFinite(s.p.y)).toBe(true);
        expect(b.x).toBeGreaterThan(TILE);
        expect(b.x).toBeLessThan(15 * TILE);
        expect(b.y).toBeGreaterThan(TILE);
        expect(b.y).toBeLessThan(23 * TILE);
        // 날아다니는 것·불길이 끝없이 쌓이지 않는다
        expect(s.shots.length).toBeLessThan(200);
        expect(s.pools.length).toBeLessThan(120);
      }
    }
  });

  it('새 요괴 다섯: 무리로 만나도 판이 멈추지 않고, 예고 없이 큰 피해를 주지 않는다', () => {
    for (const kind of ['sleeper', 'acorn', 'yaksha', 'ferryman', 'firecart'] as const) {
      const s = run(hall({ groups: [group(8, 8, kind, 5), group(5, 5, kind, 3, kind)] }), { level: 30, god: true });
      for (const e of s.enemies) e.awake = true;
      for (let i = 0; i < 60 * 30; i++) {
        step(s, noInput());
        s.events.length = 0;
      }
      expect(s.phase).toBe('play');
      expect(alive(s).length).toBeGreaterThanOrEqual(9);
      for (const e of s.enemies) expect(Number.isFinite(e.x) && Number.isFinite(e.y), kind).toBe(true);
      expect(s.enemies.length).toBeLessThan(9 + 9 * 8);
    }
  });

  it('합류: 8지형 보스에서 개, 9지형 보스에서 돼지 — 열두 대원이 다 모인다. 10~12지형 보스는 합류가 없다', () => {
    expect(joinsAt(8)!.id).toBe('dog');
    expect(joinsAt(9)!.id).toBe('pig');
    for (const r of [8, 9]) expect(joinsAt(r)!.hello!.length).toBeGreaterThan(5);
    for (const r of [10, 11, 12]) expect(joinsAt(r)).toBeNull();
    const p = emptyProfile();
    for (let r = 1; r <= 9; r++) p.maps.normal[`${r}-8`] = { stars: 0, clears: 1, best: 100 };
    expect([...heroesOf(p)].sort()).toEqual([...ZODIAC_IDS].sort());
    // 합류하는 대원에게는 모두 한마디가 있다
    for (const h of HEROES) if (h.join > 0) expect(h.hello, h.name).toBeTruthy();
  });

  it('보스의 선물: 10~12지형 보스를 처음 잡으면 합류 대신 강화석 꾸러미 (모드마다 한 번)', () => {
    expect(Object.keys(BOSS_GIFT).map(Number)).toEqual([10, 11, 12]);
    for (let r = 1; r <= 9; r++) expect(bossGift(r)).toBe(0);
    expect(BOSS_GIFT[12]).toBeGreaterThan(BOSS_GIFT[10]);
    for (const r of [10, 11, 12]) {
      expect(joinText(r)).toContain(`${BOSS_GIFT[r]}개`);
      if (r > REGIONS_READY) continue;
      const p = emptyProfile();
      const report: RunReport = { run: '', map: `${r}-8`, mode: 'normal', hero: 'rat', time: 200, cleared: true, kills: {}, elites: 0, boss: true, chest: false, deaths: 0 };
      const a = applyReport(p, report, 5);
      expect(a.first).toBe(true);
      expect(a.joined).toBeNull();
      expect(a.gift).toBe(BOSS_GIFT[r]);
      expect(a.stones).toBeGreaterThan(a.gift); // 보스가 늘 주는 강화석도 함께
      expect(p.stones).toBe(a.stones);
      const b = applyReport(p, report, 6);
      expect(b.gift).toBe(0);
      expect(p.stones).toBe(a.stones + b.stones);
    }
    // 합류하는 지형의 보스는 선물이 없다
    const p = emptyProfile();
    const r1 = applyReport(p, { run: '', map: '1-8', mode: 'normal', hero: 'rat', time: 200, cleared: true, kills: {}, elites: 0, boss: true, chest: false, deaths: 0 }, 5);
    expect(r1.joined).toBe('rabbit');
    expect(r1.gift).toBe(0);
  });

  it('환경을 막는 대원은 그 지형에 올 때 이미 함께하는 대원이다 (12지형 모두) · 환경 효과는 지형마다 다르다', () => {
    for (const r of REGION_TABLE) {
      const h = heroOf(r.counter);
      expect(h.join, `${r.region}지형 ${h.name}`).toBeLessThan(r.region);
      expect(h.hidden).toBeFalsy();
    }
    expect(new Set(REGION_TABLE.map((r) => r.env)).size).toBe(12);
    expect(new Set(REGION_TABLE.map((r) => r.boss)).size).toBe(12);
  });

  it('고향 지형: 공격·방어 +10% (양 8 · 원숭이 9 · 닭 10 · 개 11 · 돼지 12)', () => {
    for (const [hero, home] of [['sheep', 8], ['monkey', 9], ['rooster', 10], ['dog', 11], ['pig', 12]] as const) {
      const l = { ...lo(hero, 'sword', 50), armorDef: 20 };
      const at = playerStats(l, home);
      const away = playerStats(l, 1);
      expect(at.home).toBe(true);
      expect(at.atk / away.atk).toBeCloseTo(HOME_BONUS, 5);
      expect(at.def / away.def).toBeCloseTo(HOME_BONUS, 5);
      expect(REGION_TABLE[home - 1].home).toBe(hero);
    }
  });

  it('맵: 지형마다 새 요괴가 2번 맵부터 나오고, 삼도천(11)에는 물이 · 염라전(12)에는 불바닥이 깔린다', () => {
    const fresh = { 8: ['sleeper', 'hex'], 9: ['acorn', 'bounce'], 10: ['yaksha', 'rage'], 11: ['ferryman', 'call'], 12: ['firecart', 'blaze'] } as const;
    const slow = (r: number) => mapsOf(r).reduce((a, m) => a + m.rows.join('').split('~').length - 1, 0);
    for (const r of five) {
      const [kind, ai] = fresh[r as 8];
      expect(ENEMIES[kind].ai).toBe(ai);
      expect(REGION_TABLE[r - 1].enemies[1]).toBe(kind);
      expect(new Set(REGION_TABLE[r - 1].enemies.map((k) => ENEMIES[k].art)).size).toBe(REGION_TABLE[r - 1].enemies.length);
      if (r > REGIONS_READY) continue;
      const list = mapsOf(r);
      const has = (m: (typeof list)[number]) => m.groups.some((g) => g.list.some(([k]) => k === kind));
      expect(has(list[0])).toBe(false);
      for (const m of list.slice(1)) expect(has(m), m.id).toBe(true);
      // 정예로는 나오지 않는다
      expect(list.some((m) => m.groups.some((g) => g.elite === kind))).toBe(false);
      expect(new Set(list.map((m) => m.name)).size).toBe(8);
      expect(list[7].name).toContain(BOSSES[regionOf(r).boss].name);
    }
    if (REGIONS_READY >= 12) {
      expect(slow(11)).toBeGreaterThan(slow(1) * 3);
      expect(slow(12)).toBeGreaterThan(slow(1) * 1.5);
    }
  });
});

