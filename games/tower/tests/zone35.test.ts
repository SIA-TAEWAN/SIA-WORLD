/**
 * 3차 (21~50층): 새 적 AI · 정예 기술 · 보스 셋의 기술 · 새 퍼즐 넷 · 보스층 전설 구슬 (현무 30층 · 주작 50층).
 * 빈 시험 방(arena)에서 하나씩, 전설 구슬은 실제 층(generateFloor)에서.
 */
import { describe, expect, it } from 'vitest';
import { T, TILE, generateFloor } from '../src/game/floorgen';
import { newData } from '../src/game/progress';
import { BODY_UP, createRun, interactTarget, noInput, step, tileOf, type Enemy, type RunState } from '../src/game/sim';
import { arena, foe, press, wait } from './arena';

const steps = (s: RunState, n: number, inp = noInput()) => {
  for (let i = 0; i < n; i++) step(s, inp);
};
const until = (s: RunState, ok: () => boolean, sec = 5) => {
  for (let i = 0; i < sec * 60 && !ok(); i++) step(s, noInput());
  return ok();
};
const boss = (floor: number, id: string, dx = 60) => {
  const s = arena({ floor, level: floor });
  const b = foe(s, id, dx, 0, false);
  s.boss = b;
  b.cd = 0;
  return { s, b };
};
const hittableNow = (s: RunState, e: Enemy) => {
  // 바로 옆에서 칼을 휘둘러 체력이 주는지
  const hp = e.hp;
  s.p.x = e.x - 16;
  s.p.y = e.y + BODY_UP;
  s.p.face = 2;
  steps(s, 30, { ...noInput(), attack: true });
  return e.hp < hp;
};

describe('3~5구역 일반 적 · 정예', () => {
  it('푸른 도깨비불: 캐릭터 자리를 원으로 예고하고, 그 자리로 순간이동해 터진다', () => {
    const s = arena({ floor: 23 });
    const e = foe(s, 'wisp', 70, 0, false);
    e.cd = 0;
    steps(s, 2);
    expect(e.state).toBe('blinkWind');
    expect(e.tele?.kind).toBe('circle');
    expect(Math.hypot(e.tele!.x - s.p.x, e.tele!.y - (s.p.y - BODY_UP))).toBeLessThanOrEqual(11);
    const hp = s.p.hp;
    expect(until(s, () => e.state === 'strike', 2)).toBe(true);
    expect(s.p.hp).toBeLessThan(hp);
    expect(Math.hypot(e.x - s.p.x, e.y - (s.p.y - BODY_UP))).toBeLessThan(14);
  });

  it('방패연 요괴: 선으로 예고하고 한 발 (거리를 두고 돈다)', () => {
    const s = arena({ floor: 31 });
    const e = foe(s, 'kite', 64, 0, false);
    e.cd = 0;
    steps(s, 2);
    expect(e.state).toBe('windup');
    expect(e.tele?.kind).toBe('line');
    steps(s, 40);
    expect(s.projs.some((q) => q.from === 'e' && q.kind === 'dart')).toBe(true);
  });

  it('횃불 도깨비: 던진 불씨가 예고한 자리에 떨어지고, 그 자리에 잠깐 불바닥이 남아 화상을 입힌다', () => {
    const s = arena({ floor: 41 });
    const e = foe(s, 'torchimp', 70, 0, false);
    e.cd = 0;
    expect(until(s, () => s.strikes.length > 0, 2)).toBe(true);
    const k = s.strikes[0];
    expect(Math.hypot(k.x - s.p.x, k.y - (s.p.y - BODY_UP))).toBeLessThan(1);
    const hp = s.p.hp;
    e.wake = 999;
    expect(until(s, () => !s.strikes.length, 2)).toBe(true);
    expect(s.p.hp).toBeLessThan(hp);
    expect(s.hazards.length).toBe(1);
    expect(s.p.burn).toBeGreaterThan(0);
    // 불바닥 위에 서 있으면 화상이 계속된다 (체력은 1 아래로 내려가지 않는다)
    wait(s, 1.5);
    expect(s.p.burn).toBeGreaterThan(0);
    wait(s, 4);
    expect(s.hazards.length).toBe(0);
  });

  it('정예 셋: 서리 해태 얼음 부채꼴 5발 · 불화살 화차 7발 · 금계 장수는 예고한 자리로 뛰어내린다', () => {
    for (const [id, floor, n] of [['haetae', 29, 5], ['hwacha', 49, 7]] as const) {
      const s = arena({ floor });
      const e = foe(s, id, 90, 0, false);
      e.fanCd = 0;
      steps(s, 2);
      expect(e.state, id).toBe('fanWind');
      steps(s, 50);
      expect(s.projs.filter((q) => q.from === 'e').length, id).toBe(n);
    }
    const s = arena({ floor: 39 });
    const g = foe(s, 'geumgye', 80, 0, false);
    g.leapCd = 0;
    g.fanCd = 99;
    steps(s, 2);
    expect(g.state).toBe('leapWind');
    expect(g.tele?.kind).toBe('circle');
    const hp = s.p.hp;
    expect(until(s, () => g.state === 'strike', 3)).toBe(true);
    expect(s.p.hp).toBeLessThan(hp);
    expect(Math.hypot(g.x - s.p.x, g.y - (s.p.y - BODY_UP))).toBeLessThan(12);
  });
});

describe('보스: 동장군 (30층)', () => {
  it('고드름 비: 캐릭터 둘레에 원 여럿, 떨어지면 맞는다 · 발밑 서리는 둔화 바닥을 남긴다', () => {
    const { s, b } = boss(30, 'winterGeneral');
    b.pattern = 1;
    steps(s, 2);
    expect(s.strikes.length).toBe(5);
    expect(s.strikes.some((k) => Math.hypot(k.x - s.p.x, k.y - (s.p.y - BODY_UP)) < 1)).toBe(true);
    const hp = s.p.hp;
    expect(until(s, () => !s.strikes.length, 2)).toBe(true);
    expect(s.p.hp).toBeLessThan(hp);
    const t = boss(30, 'winterGeneral', 80);
    t.b.pattern = 3;
    steps(t.s, 2);
    expect(t.b.state).toBe('frostWind');
    wait(t.s, 1.0);
    expect(t.s.hazards.some((h) => h.kind === 'frost')).toBe(true);
    expect(t.s.p.slow).toBeGreaterThan(0);
  });

  it('체력 절반: 얼음 갑옷(맞지 않음) + 얼음 수정 셋 — 수정을 모두 깨면 갑옷이 깨져 멍해지고 성난다', () => {
    const { s, b } = boss(30, 'winterGeneral');
    b.hp = Math.floor(b.max * 0.49);
    steps(s, 2);
    expect(b.guard).toBe('ice');
    const crystals = s.enemies.filter((e) => e.def.id === 'icecrystal');
    expect(crystals).toHaveLength(3);
    expect(crystals.every((c) => c.summoned)).toBe(true);
    expect(hittableNow(s, b)).toBe(false);
    // 갑옷 중에도 고드름 비
    expect(until(s, () => s.strikes.length > 0, 4)).toBe(true);
    // 수정은 칼로 깨지고 경험치·엽전이 없다
    const coins = s.data.coins;
    const exp = s.data.exp;
    for (const c of crystals) {
      s.p.inv = 99;
      while (c.alive) hittableNow(s, c);
    }
    expect(s.data.coins).toBe(coins);
    expect(s.data.exp).toBe(exp);
    steps(s, 2);
    expect(b.guard).toBeNull();
    expect(b.state).toBe('stun');
    expect(b.rage).toBe(true);
    expect(hittableNow(s, b)).toBe(true);
  });
});

describe('보스: 영등할미 (40층)', () => {
  it('바람 부채질: 넓은 선 예고 → 맞으면 멀리 밀려난다', () => {
    const { s, b } = boss(40, 'yeongdeung', -60);
    b.pattern = 0;
    steps(s, 2);
    expect(b.state).toBe('gustWind');
    expect(b.tele?.kind).toBe('line');
    b.wake = 0;
    const x = s.p.x;
    const hp = s.p.hp;
    expect(until(s, () => b.state === 'strike', 2)).toBe(true);
    expect(s.p.hp).toBeLessThan(hp);
    expect(s.p.x - x).toBeGreaterThan(40);
  });

  it('회오리는 캐릭터 쪽으로 휘어 오고, 내리꽂기는 하늘에서 맞지 않다가 예고한 자리로 내려온다', () => {
    const { s, b } = boss(40, 'yeongdeung', 70);
    b.pattern = 1;
    expect(until(s, () => s.projs.some((q) => q.kind === 'whirl'), 2)).toBe(true);
    const w = s.projs.find((q) => q.kind === 'whirl')!;
    expect(w.home).toBeGreaterThan(0);
    const t = boss(40, 'yeongdeung', 70);
    t.b.pattern = 3;
    steps(t.s, 2);
    expect(t.b.state).toBe('diveUp');
    expect(t.b.guard).toBe('air');
    expect(hittableNow(t.s, t.b)).toBe(false);
    expect(until(t.s, () => t.b.state === 'diveWind', 2)).toBe(true);
    expect(t.b.tele?.kind).toBe('circle');
    expect(until(t.s, () => t.b.guard === null, 2)).toBe(true);
    expect(Math.hypot(t.b.x - t.b.to!.x, t.b.y - t.b.to!.y)).toBeLessThan(3);
  });

  it('체력 절반: 샛바람이 불어 가만히 있어도 밀리고, 몇 초마다 방향이 바뀐다', () => {
    const { s, b } = boss(40, 'yeongdeung', 90);
    b.hp = Math.floor(b.max * 0.49);
    steps(s, 2);
    expect(s.wind).not.toBeNull();
    b.wake = 999;
    const dirs = new Set<string>();
    let moved = 0;
    for (let i = 0; i < 60 * 13; i++) {
      const x = s.p.x;
      const y = s.p.y;
      step(s, noInput());
      moved += Math.hypot(s.p.x - x, s.p.y - y);
      dirs.add(`${s.wind!.dx},${s.wind!.dy}`);
      // 벽에 붙지 않게 가운데로 돌려놓는다
      if (i % 60 === 0) {
        s.p.x = 9 * TILE + 8;
        s.p.y = 7 * TILE + 8;
      }
    }
    expect(moved).toBeGreaterThan(100);
    expect(dirs.size).toBeGreaterThanOrEqual(2);
  });
});

describe('보스: 불가사리 (50층)', () => {
  it('땅울림은 쇠붙이를 떨어뜨리고, 쇠 먹기는 쇠붙이를 삼켜 체력을 채운다 (먼저 부수면 못 먹는다)', () => {
    const { s, b } = boss(50, 'bulgasari', 80);
    b.pattern = 1;
    s.p.inv = 999;
    expect(until(s, () => s.enemies.filter((e) => e.def.id === 'iron' && e.alive).length === 2, 3)).toBe(true);
    b.hp = Math.floor(b.max * 0.8);
    const hp = b.hp;
    b.pattern = 3;
    b.state = 'move';
    b.cd = 0;
    expect(until(s, () => b.state === 'eat', 2)).toBe(true);
    expect(until(s, () => b.hp > hp, 6)).toBe(true);
    expect(s.enemies.filter((e) => e.def.id === 'iron' && e.alive).length).toBe(1);
    // 쇠붙이가 없으면 먹으러 가지 않는다
    for (const e of s.enemies) if (e.def.id === 'iron') e.alive = false;
    b.pattern = 3;
    b.state = 'move';
    b.cd = 0;
    steps(s, 2);
    expect(b.state).not.toBe('eat');
  });

  it('쇠가시: 여러 갈래 선으로 예고하고 사방으로 · 성나면 지나간 자리에 불바닥', () => {
    const { s, b } = boss(50, 'bulgasari', 90);
    b.pattern = 0;
    steps(s, 2);
    expect(b.state).toBe('spikeWind');
    expect(b.tele).toMatchObject({ kind: 'cross', n: 8 });
    expect(until(s, () => s.projs.filter((q) => q.kind === 'spike').length === 8, 2)).toBe(true);
    const t = boss(50, 'bulgasari', 120);
    t.b.hp = Math.floor(t.b.max * 0.49);
    t.s.p.inv = 999;
    wait(t.s, 3);
    expect(t.b.rage).toBe(true);
    expect(t.s.hazards.some((h) => h.kind === 'ember')).toBe(true);
  });
});

describe('3~5구역 퍼즐', () => {
  const row = (y: number, rows: Record<number, string>) => rows[y] ?? '...................';
  const grid = (rows: Record<number, string>) => Array.from({ length: 13 }, (_, y) => row(y, rows));
  const at = (s: RunState, tx: number, ty: number, face: number) => {
    s.p.x = tx * TILE + 8;
    s.p.y = ty * TILE + 11;
    s.p.face = face;
  };

  it('찬물: 토끼 얼음 칼날이 지나가면 얼어서 걸을 수 있다 (다른 투사체로는 얼지 않는다)', () => {
    const s = arena({ floor: 24, orb: 'rabbit', grid: grid({ 6: '....iiii...........' }) });
    s.locked.clear();
    at(s, 4, 7, 2);
    press(s, 'skill', 40);
    for (let x = 5; x <= 8; x++) expect(tileOf(s, x, 7)).toBe(T.ICE);
    const r = arena({ floor: 24, orb: 'rat', grid: grid({ 6: '....iiii...........' }) });
    r.locked.clear();
    at(r, 4, 7, 2);
    press(r, 'skill', 40);
    expect(tileOf(r, 5, 7)).toBe(T.COLD_WATER);
  });

  it('풍경: 닭 깃털 부채꼴로 셋을 한꺼번에 울리면 철문이 열리고, 하나씩은 소리가 잦아든다', () => {
    const g = grid({ 0: '.........g.........', 1: '........bbb........' });
    const s = arena({ floor: 34, orb: 'rooster', grid: g });
    s.locked.clear();
    at(s, 10, 7, 3);
    press(s, 'skill', 60);
    expect(tileOf(s, 10, 1)).toBe(T.FLOOR);
    const r = arena({ floor: 34, orb: 'rat', grid: g });
    r.locked.clear();
    at(r, 10, 7, 3);
    press(r, 'skill', 30);
    expect(tileOf(r, 10, 2)).toBe(T.BELL_ON);
    wait(r, 1);
    expect(tileOf(r, 10, 2)).toBe(T.BELL);
    expect(tileOf(r, 10, 1)).toBe(T.GATE);
  });

  it('징: 개 음파는 징을 꿰뚫으며 모두 울려 철문을 열고, 쥐 참격은 첫 징에서 멈춘다', () => {
    const g = grid({ 0: '.........g.........', 6: '....j..j..j........' });
    const s = arena({ floor: 44, orb: 'dog', grid: g });
    s.locked.clear();
    at(s, 2, 7, 2);
    press(s, 'skill', 60);
    expect(tileOf(s, 10, 1)).toBe(T.FLOOR);
    const r = arena({ floor: 44, orb: 'rat', grid: g });
    r.locked.clear();
    at(r, 2, 7, 2);
    press(r, 'skill', 20);
    expect(tileOf(r, 5, 7)).toBe(T.GONG_ON);
    expect(tileOf(r, 8, 7)).toBe(T.GONG);
    wait(r, 1);
    expect(tileOf(r, 10, 1)).toBe(T.GATE);
  });

  it('둥근 바위: 호랑이 맹호 강타로 밀면 굴러가 구덩이를 메운다 (칼·영체 팔로는 밀리지 않는다)', () => {
    const g = grid({ 6: '.....u.....x.......' });
    const s = arena({ floor: 48, orb: 'tiger', grid: g });
    s.locked.clear();
    at(s, 5, 7, 2);
    press(s, 'skill', 40);
    expect(tileOf(s, 6, 7)).toBe(T.FLOOR);
    expect(tileOf(s, 12, 7)).toBe(T.RUBBLE);
    const r = arena({ floor: 48, orb: 'ox', grid: g });
    r.locked.clear();
    at(r, 5, 7, 2);
    press(r, 'skill', 40);
    steps(r, 30, { ...noInput(), attack: true });
    expect(tileOf(r, 6, 7)).toBe(T.BOULDER);
    expect(tileOf(r, 12, 7)).toBe(T.PIT);
  });
});

describe('보스층 전설 구슬 (현무 30층 · 주작 50층)', () => {
  const killBoss = (s: RunState) => {
    const b = s.enemies.find((e) => e.def.boss)!;
    s.p.x = b.x - 18;
    s.p.y = b.y + BODY_UP;
    s.p.face = 2;
    steps(s, 2);
    expect(s.locked.size).toBe(1);
    // 동장군은 체력 절반에 갑옷을 두르므로 2단계를 지난 것으로
    b.phase = 2;
    b.hp = 1;
    for (let i = 0; i < 120 && b.alive; i++) {
      s.p.x = b.x - 18;
      s.p.y = b.y + BODY_UP;
      s.p.face = 2;
      step(s, { ...noInput(), attack: true });
    }
    expect(b.alive).toBe(false);
  };
  for (const [floor, orb] of [[30, 'turtle'], [50, 'phoenix']] as const) {
    it(`${floor}층: 보스를 쓰러뜨리면 받침대가 솟아오르고, ${orb} 구슬을 받아야 계단이 나타나 층을 깬다`, () => {
      const d = { ...newData(9), level: floor, best: floor - 1, checkpoint: floor - 9, floor };
      const s = createRun(generateFloor(d.seed, floor), d, { god: true });
      const ped = s.map.objs.find((o) => o.kind === 'pedestal')!;
      expect(ped.hidden).toBe(true);
      expect(tileOf(s, ped.x, ped.y)).toBe(T.FLOOR);
      const evs: string[] = [];
      killBoss(s);
      for (const e of s.events.splice(0)) evs.push(e.t);
      expect(evs).toContain('legend');
      expect(tileOf(s, ped.x, ped.y)).toBe(T.PEDESTAL);
      expect(s.legendWait).toBe(true);
      expect(s.stairsShown).toBe(false);
      wait(s, 4);
      expect(s.over).toBeNull();
      // 받침대 앞에서 받는다
      s.p.x = ped.x * TILE + 8;
      s.p.y = (ped.y + 1) * TILE + 10;
      expect(interactTarget(s)?.kind).toBe('pedestal');
      step(s, { ...noInput(), interact: true });
      const got = s.events.find((e) => e.t === 'orb');
      expect(got).toMatchObject({ t: 'orb', id: orb, gain: 'new' });
      expect(s.data.orbs[orb]).toBe(1);
      expect(s.stairsShown).toBe(true);
      wait(s, 3);
      expect(s.over).toBe('clear');
      // 첫 보스 조각도 (한 번만)
      expect(s.data.got).toContain(`${floor}:boss`);
    });

    it(`${floor}층을 다시 오를 때 (이미 ${orb} 구슬이 있다): 빈 받침대, 보스를 쓰러뜨리면 바로 층을 깬다`, () => {
      const d = { ...newData(9), level: floor, best: floor, checkpoint: floor - 9, floor, orbs: { [orb]: 1 } };
      const s = createRun(generateFloor(d.seed, floor), d, { god: true });
      const ped = s.map.objs.find((o) => o.kind === 'pedestal')!;
      killBoss(s);
      expect(tileOf(s, ped.x, ped.y)).toBe(T.PEDESTAL_EMPTY);
      expect(s.legendWait).toBe(false);
      wait(s, 3);
      expect(s.over).toBe('clear');
      expect(s.data.orbs[orb]).toBe(1);
    });
  }
});

describe('둥근 바위 되돌리기', () => {
  it('구덩이가 남은 채 바위가 엉뚱한 곳에 박히면, 방에 다시 들어올 때 처음 자리로 돌아온다', async () => {
    const { ROOM_W, ROOM_H } = await import('../src/game/floorgen');
    let done = false;
    for (let seed = 1; seed <= 200 && !done; seed++) {
      for (const f of [48, 49]) {
        const m = generateFloor(seed, f);
        const r = m.rooms.find((x) => x.tpl.startsWith('puzzle-boulder'));
        if (!r) continue;
        const d = newData(seed);
        Object.assign(d, { level: f, best: f - 1, floor: f, equipped: 'tiger' });
        d.orbs.tiger = 1;
        const s = createRun(m, d);
        const cells: [number, number][] = [];
        for (let y = r.y0; y < r.y0 + ROOM_H; y++) for (let x = r.x0; x < r.x0 + ROOM_W; x++) cells.push([x, y]);
        const orig = cells.filter(([x, y]) => tileOf(s, x, y) === T.BOULDER);
        const free = cells.filter(([x, y]) => tileOf(s, x, y) === T.FLOOR);
        expect(orig.length).toBeGreaterThan(0);
        // 잘못 쳐서 바위가 모서리에 박혔다
        const [ox, oy] = orig[0];
        const [wx, wy] = free[0];
        s.tiles[oy * m.w + ox] = T.FLOOR;
        s.tiles[wy * m.w + wx] = T.BOULDER;
        // 다른 방에 있다가 다시 들어온다
        s.room = -1;
        const [px, py] = free[Math.floor(free.length / 2)];
        s.p.x = px * TILE + 8;
        s.p.y = py * TILE + 12;
        step(s, noInput());
        expect(s.room).toBe(r.id);
        expect(tileOf(s, ox, oy)).toBe(T.BOULDER);
        expect(tileOf(s, wx, wy)).toBe(T.FLOOR);
        done = true;
        break;
      }
    }
    expect(done).toBe(true);
  });
});
