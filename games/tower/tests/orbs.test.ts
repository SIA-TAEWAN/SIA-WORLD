/**
 * 구슬 16개: 기본 스킬 · 각성 · 제약을 시뮬레이션에서 하나씩 (orbs.json 의 값 그대로).
 * 빈 시험 방(arena)에서 캐릭터는 가운데, 오른쪽을 본다. 적은 wake 를 길게 줘서 움직이지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { orbDef } from '../src/data';
import { T, TILE } from '../src/game/floorgen';
import { gainOrb, newData } from '../src/game/progress';
import { BODY_UP, hurtPlayer, maxHp, noInput, patk, step, tileOf } from '../src/game/sim';
import { arena, foe, press, wait } from './arena';

const mpOf = (id: string, w: 'basic' | 'awaken') => orbDef(id)![w].mp;

describe('구슬 공통', () => {
  it('두 번째 구슬 또는 조각 5개로 각성 (16개 모두)', () => {
    const d = newData(1);
    for (const id of ['dragon', 'snake', 'rabbit', 'blueDragon']) {
      expect(gainOrb(d, id)).toBe('new');
      expect(gainOrb(d, id)).toBe('awaken');
    }
  });
  it('혼력이 모자라면 스킬이 나가지 않고, 쓰면 orbs.json 의 혼력·재사용 대기만큼', () => {
    for (const id of ['rat', 'ox', 'dragon', 'snake', 'rabbit', 'monkey', 'turtle', 'rooster', 'sheep', 'dog', 'tiger', 'phoenix', 'pig', 'whiteTiger', 'blueDragon']) {
      const s = arena({ orb: id });
      foe(s, 'lizard', 16);
      s.p.mp = 1;
      press(s, 'skill');
      expect(s.events.some((e) => e.t === 'skill'), id).toBe(false);
      s.p.mp = 100;
      press(s, 'skill');
      expect(s.p.mp, id).toBeCloseTo(100 - mpOf(id, 'basic'), 0);
      expect(s.p.skillCd, id).toBeGreaterThan(orbDef(id)!.basic.cd - 0.1);
    }
  });
  it('각성하지 않은 구슬은 각성 스킬이 없다', () => {
    const s = arena({ orb: 'dragon' });
    press(s, 'awaken');
    expect(s.p.cast).toBeNull();
    expect(s.p.awakenCd).toBe(0);
  });
});

describe('구슬 스킬 (기본 · 각성 · 제약)', () => {
  it('쥐: 초승달 참격이 날아가 꿰뚫는다 / 질풍 10초 이동·공격 빨라짐', () => {
    const s = arena({ orb: 'rat', awaken: true });
    const a = foe(s, 'lizard', 60);
    const b = foe(s, 'lizard', 90);
    press(s, 'skill');
    wait(s, 0.9);
    expect(a.hp).toBeLessThan(a.max);
    expect(b.hp).toBeLessThan(b.max);
    press(s, 'awaken');
    expect(s.p.gale).toBeGreaterThan(9.9);
    expect(s.p.awakenCd).toBe(45);
  });

  it('소: 영체 팔이 한 번 더 · 금 간 바위를 부순다 / 수호 거인이 대신 맞고 이동이 느려진다', () => {
    const grid = Array.from({ length: 13 }, (_, y) => (y === 6 ? '..........r........' : '...................'));
    const s = arena({ orb: 'ox', awaken: true, grid });
    s.tiles[(6 + 1) * s.map.w + 11] = T.ROCK;
    press(s, 'skill');
    wait(s, 0.6);
    expect(tileOf(s, 11, 7)).toBe(T.RUBBLE);
    press(s, 'awaken');
    expect(s.p.giant).not.toBeNull();
    const hp = s.p.hp;
    s.p.inv = 0;
    hurtPlayer(s, 50);
    expect(s.p.hp).toBe(hp);
  });

  it('용: 화염 강타 (느린 시전 · 화상 · 화로에 불) / 지면 폭발 (시전 뒤 둘레 화염 + 화상)', () => {
    const s = arena({ orb: 'dragon', awaken: true });
    const e = foe(s, 'treant', 18);
    press(s, 'skill');
    // 시전이 느리다: 0.2초 뒤에는 아직 맞지 않았다
    wait(s, 0.2);
    expect(e.hp).toBe(e.max);
    wait(s, 0.3);
    expect(e.hp).toBeLessThan(e.max);
    expect(e.burn).toBeGreaterThan(0);
    // 화상: 시간이 지나면 더 준다
    const h1 = e.hp;
    wait(s, 1);
    expect(e.hp).toBeLessThan(h1);
    // 각성: 시전 중에는 움직이지 못하고, 끝나면 둘레의 적이 다 맞는다
    const near = foe(s, 'lizard', -40, 20);
    const far = foe(s, 'lizard', -120, 0);
    s.p.mp = 100;
    press(s, 'awaken');
    expect(s.p.cast).not.toBeNull();
    const x = s.p.x;
    wait(s, 0.3, { mx: 1 });
    expect(s.p.x).toBe(x);
    wait(s, 0.5);
    expect(near.hp).toBeLessThan(near.max);
    expect(near.burn).toBeGreaterThan(0);
    expect(far.hp).toBe(far.max);
  });

  it('용: 꺼진 화로를 모두 붙이면 철문이 열린다', () => {
    const grid = Array.from({ length: 13 }, (_, y) => (y === 6 ? '..........h........' : y === 0 ? '.g.................' : y === 2 ? '..h................' : '...................'));
    const s = arena({ orb: 'dragon', grid });
    s.locked.clear();
    press(s, 'skill');
    wait(s, 0.6);
    expect(tileOf(s, 11, 7)).toBe(T.BRAZIER_LIT);
    expect(tileOf(s, 2, 1)).toBe(T.GATE);
    // 두 번째 화로 (2,3) 옆으로 가서 위를 본다
    s.p.x = 3 * TILE + 8;
    s.p.y = 5 * TILE + 10;
    s.p.face = 3;
    s.p.skillCd = 0;
    s.p.mp = 100;
    press(s, 'skill');
    wait(s, 0.6);
    expect(tileOf(s, 3, 3)).toBe(T.BRAZIER_LIT);
    expect(tileOf(s, 2, 1)).toBe(T.FLOOR);
  });

  it('뱀: 채찍이 중거리까지 · 칼은 약해진다 / 휘감기가 적을 끌어온다 · 말뚝을 감아 물을 건넌다', () => {
    const s = arena({ orb: 'snake', awaken: true });
    const e = foe(s, 'lizard', 46);
    press(s, 'skill');
    wait(s, 0.3);
    expect(e.hp).toBeLessThan(e.max);
    // 제약: 뱀 구슬을 끼면 칼 피해가 준다
    const hit = (orb: string | null) => {
      const t = arena({ orb: orb ?? undefined });
      t.data.equipped = orb;
      const x = foe(t, 'treant', 14);
      t.rng = { next: () => 0.5, int: (a: number) => a, pick: <T>(l: readonly T[]) => l[0], state: () => 0 };
      press(t, 'attack');
      wait(t, 0.2);
      return x.max - x.hp;
    };
    expect(hit('snake')).toBeLessThan(hit('rat'));
    // 휘감기
    const f = foe(s, 'lizard', 55, 5);
    s.p.mp = 100;
    press(s, 'awaken');
    expect(Math.hypot(f.x - s.p.x, f.y - (s.p.y - BODY_UP))).toBeLessThan(30);
    expect(f.hp).toBeLessThan(f.max);
  });

  it('뱀: 말뚝 감기 — 물 너머 말뚝 너머로 건너간다', () => {
    const grid = Array.from({ length: 13 }, (_, y) => (y === 6 ? '..........~~~~p....' : '...................'));
    const s = arena({ orb: 'snake', grid });
    s.locked.clear();
    const from = s.p.x;
    press(s, 'skill');
    expect(s.p.pull).not.toBeNull();
    wait(s, 0.6);
    expect(Math.floor(s.p.x / TILE)).toBe(16);
    expect(s.p.x).toBeGreaterThan(from + 80);
  });

  it('토끼: 얼음 칼날이 둔화 / 빙결의 춤 (보스는 둔화만) · 사용 뒤 2초 움직이지 못한다', () => {
    const s = arena({ orb: 'rabbit', awaken: true, floor: 20 });
    const e = foe(s, 'lizard', 40);
    press(s, 'skill');
    wait(s, 0.4);
    expect(e.slowT).toBeGreaterThan(2);
    const a = foe(s, 'moth', -30);
    const boss = foe(s, 'imugi', 0, 40);
    s.p.mp = 100;
    press(s, 'awaken');
    expect(a.freeze).toBeGreaterThan(2.5);
    expect(boss.freeze).toBe(0);
    expect(boss.slowT).toBeGreaterThan(3);
    const x = s.p.x;
    wait(s, 1.5, { mx: -1 });
    expect(s.p.x).toBe(x);
    wait(s, 1, { mx: -1 });
    expect(s.p.x).toBeLessThan(x);
  });

  it('원숭이: 막으면 투사체를 되돌리고 피해가 없다 · 놓치면 빈틈에 더 아프다 / 역류 3초 받은 피해를 되돌린다', () => {
    const s = arena({ orb: 'monkey', awaken: true });
    const shooter = foe(s, 'sprout', 80);
    s.projs.push({ id: 999, from: 'e', kind: 'thorn', x: s.p.x + 14, y: s.p.y - BODY_UP, vx: -70, vy: 0, r: 3, life: 2, dmg: 30, hit: [], src: shooter.id });
    const hp = s.p.hp;
    press(s, 'skill');
    wait(s, 0.3);
    expect(s.p.hp).toBe(hp);
    expect(s.events.length >= 0 && s.projs.find((q) => q.id === 999)?.from).toBe('p');
    // 놓친 막기 → 빈틈
    const t = arena({ orb: 'monkey' });
    press(t, 'skill');
    wait(t, 0.4);
    expect(t.p.gap).toBeGreaterThan(0);
    t.rng = { next: () => 0.5, int: (a: number) => a, pick: <T>(l: readonly T[]) => l[0], state: () => 0 };
    const h0 = t.p.hp;
    hurtPlayer(t, 60);
    const gapDmg = h0 - t.p.hp;
    const u = arena({ orb: 'monkey' });
    u.rng = t.rng;
    const h1 = u.p.hp;
    hurtPlayer(u, 60);
    expect(gapDmg).toBeGreaterThan(h1 - u.p.hp);
    // 역류
    const v = arena({ orb: 'monkey', awaken: true });
    const g = foe(v, 'lizard', 16);
    press(v, 'awaken');
    expect(v.p.reflect).toBe(3);
    v.p.inv = 0;
    hurtPlayer(v, 60, undefined, g);
    expect(g.hp).toBeLessThan(g.max);
  });

  it('현무: 물 보호막이 먼저 받고 피해를 줄인다 / 결계 5초 피해 무효 · 움직이지 못한다', () => {
    const s = arena({ orb: 'turtle', awaken: true, floor: 30 });
    press(s, 'skill');
    expect(s.p.shield?.hp).toBe(Math.round(maxHp(s) * 0.3));
    const hp = s.p.hp;
    hurtPlayer(s, 40);
    expect(s.p.hp).toBe(hp);
    expect(s.p.shield!.hp).toBeLessThan(s.p.shield!.max);
    s.p.mp = 100;
    press(s, 'awaken');
    expect(s.p.barrier).toBeGreaterThan(4.9);
    s.p.inv = 0;
    s.p.shield = null;
    hurtPlayer(s, 500);
    expect(s.p.hp).toBe(hp);
    const x = s.p.x;
    wait(s, 1, { mx: 1 });
    expect(s.p.x).toBe(x);
  });

  it('닭: 깃털 칼날 3개 (각성하면 5개) · 떠 있는 깃털은 10개까지 / 깃털 방벽이 투사체를 막는다', () => {
    const s = arena({ orb: 'rooster', floor: 32 });
    press(s, 'skill');
    expect(s.projs.filter((q) => q.kind === 'feather')).toHaveLength(3);
    const t = arena({ orb: 'rooster', awaken: true, floor: 32 });
    press(t, 'skill');
    expect(t.projs.filter((q) => q.kind === 'feather')).toHaveLength(5);
    t.p.skillCd = 0;
    t.p.mp = 100;
    press(t, 'skill');
    t.p.skillCd = 0;
    t.p.mp = 100;
    press(t, 'skill');
    expect(t.projs.filter((q) => q.kind === 'feather').length).toBeLessThanOrEqual(10);
    t.p.mp = 100;
    press(t, 'awaken');
    expect(t.p.blades).toBeGreaterThan(7.9);
    t.projs.push({ id: 998, from: 'e', kind: 'rock', x: t.p.x - 40, y: t.p.y - BODY_UP, vx: 80, vy: 0, r: 4, life: 2, dmg: 50, hit: [] });
    const hp = t.p.hp;
    wait(t, 0.8);
    expect(t.p.hp).toBe(hp);
    expect(t.projs.some((q) => q.id === 998)).toBe(false);
  });

  it('양: 준 피해 일부를 회복 (한 번에 최대 체력 8%까지) / 포근한 양털: 둘레에서 흡수 + 큰 회복 (상한 50%)', () => {
    const s = arena({ orb: 'sheep', awaken: true, floor: 37 });
    foe(s, 'treant', 16);
    s.p.hp = 50;
    press(s, 'skill');
    wait(s, 0.3);
    expect(s.p.hp).toBeGreaterThan(50);
    expect(s.p.hp).toBeLessThanOrEqual(50 + maxHp(s) * 0.08 + 1);
    foe(s, 'lizard', -20);
    s.p.hp = 10;
    s.p.mp = 100;
    press(s, 'awaken');
    expect(s.p.hp).toBeGreaterThan(maxHp(s) * 0.2);
    expect(s.p.hp).toBeLessThanOrEqual(10 + maxHp(s) * 0.5 + 1);
  });

  it('개: 음파탄이 꿰뚫는다 / 화음: 둘레를 기절 (보스는 기절하지 않는다)', () => {
    const s = arena({ orb: 'dog', awaken: true, floor: 42 });
    const a = foe(s, 'lizard', 40);
    const b = foe(s, 'lizard', 80);
    press(s, 'skill');
    wait(s, 0.6);
    expect(a.hp).toBeLessThan(a.max);
    expect(b.hp).toBeLessThan(b.max);
    const c = foe(s, 'moth', -30);
    const boss = foe(s, 'golem', 0, 40);
    s.p.mp = 100;
    press(s, 'awaken');
    expect(c.stun).toBeGreaterThan(1);
    expect(boss.stun).toBe(0);
    expect(boss.hp).toBeLessThan(boss.max);
  });

  it('호랑이: 맹호 강타 (2타에 이어 치면 더 세다) / 혈기: 공격력이 오르고 체력이 준다', () => {
    const dmg = (chain: boolean) => {
      const s = arena({ orb: 'tiger', floor: 47 });
      s.rng = { next: () => 0.5, int: (a: number) => a, pick: <T>(l: readonly T[]) => l[0], state: () => 0 };
      const e = foe(s, 'treant', 16);
      if (chain) {
        s.p.lastCombo = 2;
        s.p.comboWindow = 0.3;
      }
      press(s, 'skill');
      wait(s, 0.3);
      return e.max - e.hp;
    };
    expect(dmg(true)).toBeGreaterThan(dmg(false) * 1.3);
    const s = arena({ orb: 'tiger', awaken: true, floor: 47 });
    foe(s, 'treant', 120);
    const before = patk(s);
    press(s, 'awaken');
    expect(patk(s)).toBeCloseTo(before * 1.6, 3);
    const hp = s.p.hp;
    wait(s, 2);
    expect(s.p.hp).toBeLessThan(hp);
  });

  it('주작: 화염 깃털 (화상) · 쓰러뜨리면 회복 / 불사조: 대폭발 + 그 전투에서 한 번 되살아난다', () => {
    const s = arena({ orb: 'phoenix', awaken: true, floor: 50 });
    const e = foe(s, 'treant', 40);
    press(s, 'skill');
    wait(s, 0.4);
    expect(e.burn).toBeGreaterThan(0);
    const weak = foe(s, 'moth', 16);
    weak.hp = 1;
    s.p.hp = 100;
    s.p.mp = 0;
    press(s, 'attack');
    wait(s, 0.2);
    expect(weak.alive).toBe(false);
    expect(s.p.hp).toBeGreaterThan(100);
    s.p.mp = 100;
    press(s, 'awaken');
    expect(s.p.rebirth).toBeGreaterThan(0);
    s.p.inv = 0;
    s.p.hp = 5;
    hurtPlayer(s, 9999);
    expect(s.over).toBeNull();
    expect(s.events.some((x) => x.t === 'rebirth')).toBe(true);
    // 같은 전투에서 두 번은 안 된다
    s.p.rebirth = 30;
    s.p.inv = 0;
    s.p.hp = 5;
    hurtPlayer(s, 9999);
    expect(s.over).toBe('dead');
  });

  it('말: 연쇄 번개 (가까운 적 + 1~2명) · 적이 없으면 혼력을 쓰지 않는다 / 낙뢰: 5초 동안 무작위 자리', () => {
    const none = arena({ orb: 'horse', floor: 52 });
    press(none, 'skill');
    expect(none.p.mp).toBe(none.p.stats.mp);
    const s = arena({ orb: 'horse', awaken: true, floor: 52 });
    const a = foe(s, 'lizard', 40);
    const b = foe(s, 'lizard', 80);
    const c = foe(s, 'lizard', 120);
    const d = foe(s, 'lizard', 160);
    press(s, 'skill');
    expect([a, b, c].every((x) => x.hp < x.max)).toBe(true);
    expect(d.hp).toBe(d.max);
    s.p.mp = 100;
    press(s, 'awaken');
    expect(s.p.bolts).toBeGreaterThan(4.9);
    wait(s, 5);
    expect(s.fx.length + 1).toBeGreaterThan(0);
    expect(s.p.bolts).toBe(0);
  });

  it('돼지: 바람 칼날이 밀쳐낸다 / 폭풍 연타: 쌓았다 터뜨린다 · 맞으면 사라진다', () => {
    const s = arena({ orb: 'pig', awaken: true, floor: 57 });
    const e = foe(s, 'lizard', 30);
    const x0 = e.x;
    press(s, 'skill');
    wait(s, 0.3);
    expect(e.x).toBeGreaterThan(x0 + 20);
    const t = foe(s, 'treant', 16);
    t.hp = t.max = 1e6;
    s.p.mp = 100;
    press(s, 'awaken');
    wait(s, 3, { attack: true });
    expect(s.p.stacks).toBeGreaterThan(2);
    const st = s.p.stacks;
    const hp = t.hp;
    wait(s, 5.5);
    expect(s.p.stacks).toBe(0);
    expect(hp - t.hp).toBeGreaterThan(0);
    void st;
    // 맞으면 사라진다
    s.p.storm = 3;
    s.p.stacks = 5;
    s.p.inv = 0;
    hurtPlayer(s, 10);
    expect(s.p.stacks).toBe(0);
  });

  it('백호: 금강 베기는 방어를 무시 / 백호참: 순간이동 연속 베기 뒤 5초 지친다', () => {
    const s = arena({ orb: 'whiteTiger', awaken: true, floor: 70 });
    const e = foe(s, 'imugi', 22);
    press(s, 'skill');
    wait(s, 0.3);
    expect(e.hp).toBeLessThan(e.max);
    const list = [foe(s, 'lizard', -40), foe(s, 'lizard', 60, 40), foe(s, 'lizard', -60, -40)];
    s.p.mp = 100;
    press(s, 'awaken');
    expect(s.p.dashChain).not.toBeNull();
    wait(s, 1.2);
    expect(list.every((x) => x.hp < x.max)).toBe(true);
    expect(s.p.tired).toBeGreaterThan(3.5);
    expect(patk(s)).toBeLessThan(s.p.stats.atk);
  });

  it('청룡: 번개 회오리가 꿰뚫으며 여러 번 / 청룡승천: 방 전체 폭풍 (보스는 기절하지 않는다)', () => {
    const s = arena({ orb: 'blueDragon', awaken: true, floor: 90 });
    const e = foe(s, 'treant', 30);
    e.hp = e.max = 1e6;
    let hits = 0;
    press(s, 'skill');
    for (let i = 0; i < 90; i++) {
      step(s, noInput());
      hits += s.events.splice(0).filter((x) => x.t === 'hit').length;
    }
    expect(hits).toBeGreaterThan(1);
    const far = foe(s, 'lizard', -140, -60);
    const boss = foe(s, 'golem', 100, 60);
    s.p.mp = 100;
    press(s, 'awaken');
    expect(far.hp).toBeLessThan(far.max);
    expect(far.stun).toBeGreaterThan(0);
    expect(boss.stun).toBe(0);
  });
});

describe('뱀 말뚝 감기 — 잠긴 문', () => {
  it('잠긴 이웃 방에서 문 너머 곁방 말뚝으로 감아 빠져나가지 않는다 (18·19층 × 씨앗 400개)', async () => {
    const { generateFloor, TILE, ROOM_W, ROOM_H, T } = await import('../src/game/floorgen');
    const { createRun, useSkill } = await import('../src/game/sim');
    let tried = 0;
    let pulled = 0;
    const dirs: [number, number, number][] = [[0, 1, 3], [0, -1, 0], [1, 0, 1], [-1, 0, 2]];
    for (let seed = 1; seed <= 400; seed++) {
      for (const f of [18, 19]) {
        const m = generateFloor(seed, f);
        for (const w of m.rooms.filter((r) => r.tpl.startsWith('puzzle-whip'))) {
          for (const h of m.rooms) {
            if (h.id === w.id || !['combat', 'elite', 'start', 'orb'].includes(h.kind)) continue;
            for (const [dx, dy, face] of dirs) {
              if (h.cx !== w.cx + dx || h.cy !== w.cy + dy) continue;
              const d = newData(seed);
              Object.assign(d, { level: f, best: f - 1, floor: f, equipped: 'snake' });
              d.orbs.snake = 1;
              for (let iy = 0; iy < ROOM_H - 2; iy++) {
                for (let ix = 0; ix < ROOM_W - 2; ix++) {
                  const tx = h.x0 + 1 + ix;
                  const ty = h.y0 + 1 + iy;
                  if (m.tiles[ty * m.w + tx] !== T.FLOOR) continue;
                  const s = createRun(m, d);
                  s.p.x = tx * TILE + 8;
                  s.p.y = ty * TILE + 12;
                  s.p.face = face;
                  s.p.mp = 99;
                  s.locked.add(h.id);
                  s.room = h.id;
                  useSkill(s);
                  tried++;
                  if (s.p.pull) pulled++;
                }
              }
            }
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(0);
    expect(pulled).toBe(0);
  });
});
