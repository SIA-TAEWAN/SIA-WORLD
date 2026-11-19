import { describe, expect, it } from 'vitest';
import { PLAYER, RUN_SEC, TICK } from '../src/data/balance';
import { BOSSES, BOSS_INDEX } from '../src/data/bosses';
import { CHARACTERS } from '../src/data/characters';
import { ENEMIES, ENEMY_INDEX } from '../src/data/enemies';
import { MAPS, MAP_INDEX } from '../src/data/maps';
import { presetUpgrades } from '../src/data/upgrades';
import { WEAPONS, WEAPON_INDEX } from '../src/data/weapons';
import { PATTERNS } from '../src/game/bosses';
import { hurtEnemy, killEnemy, spawnBoss } from '../src/game/core';
import { MOVES } from '../src/game/enemies';
import { addWeapon } from '../src/game/levelup';
import { normalPolicy, simulate } from '../src/game/policy';
import { validRun } from '../src/game/progress';
import { activeBoss, createRun, makeInput, startWeapon, step, summarize } from '../src/game/sim';
import { EV, MODE, PROJ, ZONE, type Enemy, type State } from '../src/game/state';
import { CELL_MAX, EDGE, blocked, cellObstacles, eachObstacle, pushOut, OUT } from '../src/game/terrain';
import { advance, disarm, emptyRun, live, move, put } from './helpers';

const mapOf = (id: string) => MAPS[MAP_INDEX[id]];
/** 가까운 장애물 하나 (없으면 오류) */
function someObstacle(s: State, minR = 0) {
  let found: { x: number; y: number; r: number } | null = null;
  eachObstacle(s.map.terrain, s.terrainSeed, 0, 0, 1500, 1500, (x, y, r) => {
    if (!found && r >= minR) found = { x, y, r };
  });
  if (!found) throw new Error('장애물이 없다');
  return found as { x: number; y: number; r: number };
}

describe('지형', () => {
  it('들판에는 장애물이 없고, 나머지 세 맵에는 서로 다른 장애물이 있다', () => {
    expect(MAPS.map((m) => m.terrain.kind)).toEqual(['none', 'scatter', 'walls', 'pools']);
    const buf = new Float32Array(CELL_MAX * 3);
    for (const m of MAPS) {
      let n = 0;
      for (let cy = -10; cy < 10; cy++) for (let cx = -10; cx < 10; cx++) n += cellObstacles(m.terrain, 7, cx, cy, buf);
      if (m.id === 'field') expect(n).toBe(0);
      else expect(n).toBeGreaterThan(80);
    }
  });

  it('같은 시드면 같은 자리, 시드가 다르면 다른 자리', () => {
    const t = mapOf('bamboo').terrain;
    const a = new Float32Array(CELL_MAX * 3);
    const b = new Float32Array(CELL_MAX * 3);
    let same = 0;
    let diff = 0;
    for (let c = 0; c < 200; c++) {
      const n1 = cellObstacles(t, 11, c, 3, a);
      const n2 = cellObstacles(t, 11, c, 3, b);
      expect(n1).toBe(n2);
      expect(Array.from(a.slice(0, n1 * 3))).toEqual(Array.from(b.slice(0, n2 * 3)));
      const n3 = cellObstacles(t, 12, c, 3, b);
      if (n1 === n3 && a[0] === b[0]) same++;
      else diff++;
    }
    expect(diff).toBeGreaterThan(same);
    // 판마다 시드가 다르다
    expect(createRun({ seed: 1, char: 'rat', map: 'bamboo' }).terrainSeed).not.toBe(createRun({ seed: 2, char: 'rat', map: 'bamboo' }).terrainSeed);
  });

  it('장애물은 칸 가장자리에서 떨어져 있고(자기 칸만 보면 된다), 시작 자리 둘레는 비어 있다', () => {
    const buf = new Float32Array(CELL_MAX * 3);
    for (const m of MAPS.filter((x) => x.terrain.kind !== 'none')) {
      const C = m.terrain.cell;
      for (let cy = -12; cy < 12; cy++) {
        for (let cx = -12; cx < 12; cx++) {
          const n = cellObstacles(m.terrain, 99, cx, cy, buf);
          for (let i = 0; i < n; i++) {
            const [x, y, r] = [buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]];
            expect(x - r).toBeGreaterThanOrEqual(cx * C + EDGE - 0.01);
            expect(x + r).toBeLessThanOrEqual((cx + 1) * C - EDGE + 0.01);
            expect(y - r).toBeGreaterThanOrEqual(cy * C + EDGE - 0.01);
            expect(y + r).toBeLessThanOrEqual((cy + 1) * C - EDGE + 0.01);
            expect(Math.hypot(x, y) - r).toBeGreaterThanOrEqual(220 - 0.01);
          }
        }
      }
      expect(blocked(m.terrain, 99, 0, 0, PLAYER.r)).toBe(false);
      // 일반 요괴의 반지름은 가장자리 여유보다 작다
      for (const e of ENEMIES) expect(e.r).toBeLessThan(EDGE);
    }
  });

  it('내 캐릭터는 장애물을 지나갈 수 없다 (정면으로 가면 멈추고, 비스듬히 가면 미끄러져 돌아간다)', () => {
    for (const id of ['bamboo', 'palace', 'underworld']) {
      const s = disarm(emptyRun({ map: id, seed: 5 }));
      const o = someObstacle(s);
      // 장애물 왼쪽에서 정면으로
      s.player.x = o.x - o.r - 80;
      s.player.y = o.y;
      let inside = false;
      let slowed = false;
      let px = s.player.x;
      advance(s, 2, {
        input: move(1, 0),
        each: () => {
          if (blocked(s.map.terrain, s.terrainSeed, s.player.x, s.player.y, PLAYER.r - 1)) inside = true;
          // 막힌 동안에는 제 속도로 나아가지 못한다
          if (s.player.x - px < (PLAYER.speed * TICK) / 2) slowed = true;
          px = s.player.x;
        },
      });
      expect(inside).toBe(false);
      expect(slowed).toBe(true);
      expect(Math.hypot(s.player.x - o.x, s.player.y - o.y)).toBeGreaterThanOrEqual(o.r + PLAYER.r - 0.5);
      // 조금 비껴서 가면 돌아서 지나간다
      s.player.x = o.x - o.r - 80;
      s.player.y = o.y + o.r * 0.6;
      advance(s, 3, { input: move(1, 0.05) });
      expect(s.player.x).toBeGreaterThan(o.x + o.r);
    }
    expect(pushOut(mapOf('field').terrain, 1, 50, 50, 16)).toBe(false);
    expect([OUT.x, OUT.y]).toEqual([50, 50]);
  });

  it('요괴는 장애물을 끼고 돌아서 내게 온다 (담 뒤에서 출발해도 막혀 서 있지 않는다)', () => {
    for (const id of ['bamboo', 'palace', 'underworld']) {
      const s = disarm(emptyRun({ map: id, seed: 9 }));
      const o = someObstacle(s, 20);
      s.player.x = o.x - o.r - 140;
      s.player.y = o.y;
      const e = put(s, 'imp', o.x + o.r + 160, o.y);
      let touched = false;
      advance(s, 14, {
        immortal: true,
        each: () => {
          if (blocked(s.map.terrain, s.terrainSeed, e.x, e.y, e.r - 1.5)) touched = true;
        },
      });
      expect(touched).toBe(false);
      expect(Math.hypot(e.x - s.player.x, e.y - s.player.y)).toBeLessThan(60);
    }
  });

  it('원혼은 물길을 통과해 곧장 오고, 보스도 장애물에 막히지 않는다', () => {
    const s = disarm(emptyRun({ map: 'underworld', seed: 9 }));
    const o = someObstacle(s, 40);
    s.player.x = o.x - o.r - 120;
    s.player.y = o.y;
    const ghost = put(s, 'spirit', o.x + o.r + 120, o.y);
    const walker = put(s, 'wisp', o.x + o.r + 160, o.y + 1);
    let inside = false;
    let walkerY = 0;
    advance(s, 2.5, {
      immortal: true,
      each: () => {
        if (Math.hypot(ghost.x - o.x, ghost.y - o.y) < o.r * 0.6) inside = true;
        walkerY = Math.max(walkerY, Math.abs(walker.y - o.y));
      },
    });
    expect(inside).toBe(true);
    expect(Math.abs(ghost.y - o.y)).toBeLessThan(8);
    expect(walkerY).toBeGreaterThan(15); // 도깨비불은 돌아간다
  });
});

describe('맵 전용 요괴 4종', () => {
  it('움직임 7종이 등록돼 있고 요괴 9종이 모두 준비됐다', () => {
    expect(ENEMIES.filter((e) => e.ready).map((e) => e.id)).toEqual(['imp', 'wisp', 'club', 'water', 'fox', 'bamboo', 'guard', 'skeleton', 'spirit']);
    for (const e of ENEMIES) expect(MOVES[e.move], e.id).toBeTypeOf('function');
  });

  it('죽순 요괴: 숨어 있는 동안 맞지도 때리지도 않다가, 가까이 가면 튀어나와 빠르게 쫓아온다', () => {
    const s = disarm(emptyRun({ map: 'bamboo' }));
    const e = put(s, 'bamboo', 400, 0);
    advance(s, 1);
    expect([e.x, e.y, e.hidden, e.sub]).toEqual([400, 0, true, 0]);
    hurtEnemy(s, e, 9999, -1);
    expect(e.hp).toBe(e.maxHp);
    // 숨은 요괴 위에 서 있어도 피해가 없다 (깨어나기 전 한 걸음)
    const t = disarm(emptyRun({ map: 'bamboo' }));
    put(t, 'bamboo', 5, 0);
    step(t, makeInput());
    expect(t.player.hp).toBe(100);
    // 가까이 가면 깨어난다
    s.player.x = 400 - 140;
    advance(s, 0.2, { immortal: true });
    expect(e.sub).toBe(1);
    expect(e.hidden).toBe(true);
    advance(s, 0.4, { immortal: true });
    expect([e.sub, e.hidden]).toEqual([2, false]);
    const x0 = e.x;
    advance(s, 0.5, { immortal: true });
    expect(x0 - e.x).toBeGreaterThan(60);
    hurtEnemy(s, e, 5, -1);
    expect(e.hp).toBeLessThan(e.maxHp);
  });

  it('죽순 요괴는 화면 밖이 아니라 내 근처 바닥에 숨어서 나타난다', () => {
    const s = createRun({ seed: 3, char: 'rat', map: 'bamboo', startAt: 93 });
    s.weapons.length = 0;
    advance(s, 20, { immortal: true });
    const list = live(s.enemies).filter((e) => e.kind === ENEMY_INDEX.bamboo && e.sub === 0);
    expect(list.length).toBeGreaterThan(2);
    for (const e of list) {
      expect(blocked(s.map.terrain, s.terrainSeed, e.x, e.y, 0)).toBe(false);
      expect(e.hidden).toBe(true);
    }
  });

  it('수문장 요괴: 단단하고, 한 줄로 늘어서서 같은 방향으로 밀고 들어온다', () => {
    const s = createRun({ seed: 3, char: 'rat', map: 'palace', startAt: 95 });
    s.weapons.length = 0;
    s.map = { ...s.map, bosses: [], swarms: [], spawns: s.map.spawns.filter((r) => r.enemy === 'guard').map((r) => ({ ...r, rate0: 0.5, rate1: 0.5 })) };
    s.spawnAcc = new Float64Array(s.map.spawns.length);
    s.spawnKind = Int32Array.from(s.map.spawns, () => ENEMY_INDEX.guard);
    advance(s, 2.02, { immortal: true });
    const row = live(s.enemies);
    expect(row.length).toBe(6);
    // 모두 같은 쪽을 보고 있다
    for (const e of row) expect(e.ax * row[0].ax + e.ay * row[0].ay).toBeGreaterThan(0.99);
    const span = (v: number[]) => Math.max(...v) - Math.min(...v);
    // 한 줄: 한쪽 좌표는 거의 같고, 다른 쪽으로 나란히 늘어서 있다
    expect(Math.min(span(row.map((e) => e.x)), span(row.map((e) => e.y)))).toBeLessThan(12);
    expect(Math.max(span(row.map((e) => e.x)), span(row.map((e) => e.y)))).toBeGreaterThan(200);
    expect(row[0].maxHp).toBeGreaterThan(put(s, 'imp', 900, 900).maxHp * 5);
  });

  it('수문장 요괴는 방향을 천천히만 튼다 (옆으로 비키면 지나쳐 간다)', () => {
    const s = disarm(emptyRun({ map: 'field' }));
    const e = put(s, 'guard', 300, 0);
    step(s, makeInput());
    expect(e.ax).toBeCloseTo(-1, 2);
    // 내가 위로 순간이동해도 한 걸음에는 조금만 돈다
    s.player.y = -300;
    s.player.x = 300;
    advance(s, 0.5, { immortal: true });
    expect(e.ax).toBeLessThan(-0.9);
    advance(s, 4, { immortal: true });
    expect(e.ay).toBeLessThan(-0.5);
  });

  it('해골 병사: 쓰러뜨려도 잠시 뒤 한 번 되살아나고, 두 번째에야 처치된다', () => {
    const s = disarm(emptyRun({ map: 'underworld' }));
    const e = put(s, 'skeleton', 300, 0);
    const maxHp = e.maxHp;
    hurtEnemy(s, e, 9999, -1);
    expect([e.dead, e.hidden, e.sub, s.kills, s.pickups.n]).toEqual([false, true, 1, 0, 0]);
    hurtEnemy(s, e, 9999, -1); // 쓰러져 있는 동안은 맞지 않는다
    const x = e.x;
    advance(s, 2.4, { immortal: true });
    expect([e.x, e.hidden]).toEqual([x, true]);
    advance(s, 0.2, { immortal: true });
    expect([e.hidden, e.sub]).toEqual([false, 2]);
    expect(e.hp).toBeCloseTo(maxHp * 0.6, 6);
    advance(s, 0.5, { immortal: true });
    expect(e.x).toBeLessThan(x);
    hurtEnemy(s, e, 9999, -1);
    expect([e.dead, s.kills, s.pickups.n]).toEqual([true, 1, 1]);
    // 부적으로도 한 번은 되살아난다. 흔적 없이 치우는 것(drops=false)은 바로 사라진다
    const a = put(s, 'skeleton', 500, 0);
    killEnemy(s, a, true);
    expect(a.dead).toBe(false);
    killEnemy(s, a, false);
    expect(a.dead).toBe(true);
  });

  it('원혼: 빠르고 약하다', () => {
    const s = disarm(emptyRun({ map: 'underworld' }));
    const g = put(s, 'spirit', 600, -600);
    const k = put(s, 'skeleton', 600, 600);
    expect(g.speed).toBeGreaterThan(k.speed * 1.7);
    expect(g.maxHp).toBeLessThan(k.maxHp);
  });
});

describe('보스 9종 (대나무 숲 · 달빛 궁궐 · 황천길)', () => {
  interface Seen {
    hidden: boolean;
    maxStep: number;
    /** 새로 깔린 범위 공격 (깔린 순서대로) */
    zones: { kind: number; r: number; x: number; y: number; tick: number; slow: number }[];
    /** 종류별로 바닥에 남은 가장 긴 시간 */
    linger: Record<number, number>;
    orbs: number;
    clones: Enemy[];
    guard: number;
    pats: Set<number>;
    summoned: Record<string, number>;
  }
  /** 보스 하나만 놓고 sec 초 지켜본다 (나는 죽지 않는다) */
  function watchBoss(id: string, sec = 26, seed = 4) {
    const def = BOSSES[BOSS_INDEX[id]];
    const s = disarm(emptyRun({ map: def.map, char: 'ox', seed }));
    const b = spawnBoss(s, BOSS_INDEX[id], 0, -380)!;
    const seen: Seen = { hidden: false, maxStep: 0, zones: [], linger: {}, orbs: 0, clones: [], guard: 1, pats: new Set(), summoned: {} };
    let px = b.x;
    let py = b.y;
    advance(s, sec, {
      immortal: true,
      each: (st) => {
        seen.hidden ||= b.hidden;
        seen.maxStep = Math.max(seen.maxStep, Math.hypot(b.x - px, b.y - py));
        px = b.x;
        py = b.y;
        seen.guard = Math.min(seen.guard, b.guard);
        seen.pats.add(b.pat);
        for (const z of live(st.zones)) {
          if (z.owner !== 1) continue;
          // 방금 깔린 것: 미리 보여 주는 시간이 한 걸음만 줄어 있다
          if (z.delay > 0 && z.windup - z.delay < TICK * 1.5) seen.zones.push({ kind: z.kind, r: z.r, x: z.x, y: z.y, tick: z.tick, slow: z.slow });
          else if (z.delay <= 0) seen.linger[z.kind] = Math.max(seen.linger[z.kind] ?? 0, z.maxLife);
        }
        seen.orbs = Math.max(seen.orbs, live(st.projectiles).filter((pr) => pr.mode === MODE.enemy && pr.kind === PROJ.orb).length);
        for (const e of live(st.enemies)) {
          if (e.look >= 0 && !seen.clones.includes(e)) seen.clones.push(e);
        }
      },
    });
    for (const e of live(s.enemies)) if (e.boss < 0 && e.look < 0) seen.summoned[ENEMIES[e.kind].id] = (seen.summoned[ENEMIES[e.kind].id] ?? 0) + 1;
    return { s, b, seen, def };
  }

  it('보스 12종이 모두 준비됐고, 패턴 종류가 모두 등록돼 있다', () => {
    expect(BOSSES.every((b) => b.ready)).toBe(true);
    for (const b of BOSSES) {
      expect(b.patterns.length, b.id).toBeGreaterThan(2);
      for (const p of b.patterns) expect(PATTERNS[p.kind], `${b.id}:${p.kind}`).toBeTypeOf('function');
    }
    // 보스마다 고유한 패턴 조합이다
    expect(new Set(BOSSES.map((b) => JSON.stringify(b.patterns))).size).toBe(12);
  });

  it('장산범: 숨었다가(맞지 않는다) 내 옆에 나타나 빠르게 덮친다', () => {
    const { s, b, seen } = watchBoss('jangsanbeom');
    expect(seen.hidden).toBe(true);
    expect(seen.maxStep).toBeGreaterThan(100); // 숨었다가 다른 자리에 나타남
    // 숨은 동안에는 맞지 않는다
    const t = disarm(emptyRun({ map: 'bamboo', char: 'ox' }));
    const j = spawnBoss(t, BOSS_INDEX.jangsanbeom, 0, -300)!;
    j.pat = 1;
    advance(t, 0.5, { immortal: true });
    expect(j.hidden).toBe(true);
    hurtEnemy(t, j, 500, -1);
    expect(j.hp).toBe(j.maxHp);
    addWeapon(t, WEAPON_INDEX.bell, 5);
    j.x = t.player.x + 30;
    j.y = t.player.y;
    advance(t, 0.5, { immortal: true });
    expect(j.hp).toBe(j.maxHp);
    // 나타난 직후에는 내게서 r(250) 떨어진 자리
    let appeared = -1;
    advance(t, 1.5, {
      immortal: true,
      each: () => {
        if (appeared < 0 && !j.hidden) appeared = Math.hypot(j.x - t.player.x, j.y - t.player.y);
      },
    });
    expect(appeared).toBeGreaterThan(200);
    expect(appeared).toBeLessThan(270);
    expect(b.dead).toBe(false);
    expect(s.phase).toBe('play');
  });

  it('왕지네: 독 지대의 줄로 길을 막고, 독은 바닥에 남아 계속 아프다', () => {
    const { seen } = watchBoss('centipede');
    const poison = seen.zones.filter((z) => z.kind === ZONE.poison);
    expect(poison.length).toBeGreaterThanOrEqual(7 + 5);
    expect(poison.every((z) => z.tick > 0)).toBe(true);
    expect(seen.linger[ZONE.poison]).toBeGreaterThanOrEqual(3.5);
    // 줄: 한 번에 깔린 7개가 한 직선 위에 있다
    const w = disarm(emptyRun({ map: 'bamboo', char: 'ox' }));
    const cb = spawnBoss(w, BOSS_INDEX.centipede, 0, -500)!;
    cb.pat = 1;
    step(w, makeInput());
    const wall = live(w.zones).map((z) => ({ x: z.x, y: z.y, r: z.r }));
    expect(wall.length).toBe(7);
    const [a, c] = [wall[0], wall[6]];
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    expect(len).toBeGreaterThan(450);
    for (const z of wall) expect(Math.abs((c.x - a.x) * (a.y - z.y) - (a.x - z.x) * (c.y - a.y)) / len).toBeLessThan(1);
    // 남은 독 위에 서 있으면 계속 피해를 입는다
    const t = disarm(emptyRun({ map: 'bamboo', char: 'ox' }));
    const boss = spawnBoss(t, BOSS_INDEX.centipede, 0, -900)!;
    boss.pat = 3;
    boss.speed = 0;
    t.player.hp = t.stats.maxHp = 100000;
    advance(t, 1.3);
    const afterBurst = t.player.hp;
    expect(afterBurst).toBeLessThan(100000);
    advance(t, 2.5);
    expect(afterBurst - t.player.hp).toBeGreaterThanOrEqual(8 * 2 - 1);
  });

  it('구미호: 분신을 만들고 여우구슬을 사방으로 쏟아낸다', () => {
    const { seen, b } = watchBoss('gumiho');
    expect(seen.orbs).toBeGreaterThanOrEqual(12);
    expect(seen.clones.length).toBeGreaterThanOrEqual(3);
    for (const c of seen.clones) {
      expect(c.look).toBe(BOSS_INDEX.gumiho);
      expect(c.boss).toBe(-1); // 분신은 보스가 아니다 (체력 바·보물상자 없음)
      expect(c.maxHp).toBeCloseTo(b.maxHp * 0.03, 3);
    }
    // 구슬에 맞으면 피해를 입는다
    const t = disarm(emptyRun({ map: 'bamboo', char: 'ox' }));
    const g = spawnBoss(t, BOSS_INDEX.gumiho, 0, -200)!;
    g.pat = 1;
    g.speed = 0;
    g.dmg = 0;
    t.player.hp = t.stats.maxHp = 100000;
    let hit = false;
    advance(t, 4, { each: (st) => (hit ||= st.player.hp < 100000) });
    expect(live(t.projectiles).some((p) => p.kind === PROJ.orb) || hit).toBe(true);
  });

  it('수문장 대장: 방패를 든 돌진(받는 피해 감소)과 수문장 요괴 소환', () => {
    const { seen } = watchBoss('guardCaptain');
    expect(seen.guard).toBeCloseTo(0.3, 6);
    expect(seen.maxStep).toBeGreaterThan(8);
    expect(seen.summoned.guard).toBeGreaterThanOrEqual(4);
    const t = disarm(emptyRun({ map: 'palace', char: 'ox' }));
    const c = spawnBoss(t, BOSS_INDEX.guardCaptain, 0, -300)!;
    c.pat = 1;
    advance(t, 0.3, { immortal: true });
    hurtEnemy(t, c, 100, -1);
    expect(c.maxHp - c.hp).toBeCloseTo(30, 6);
    // 돌진이 끝나면 방패를 내린다
    advance(t, 2, { immortal: true });
    expect(c.guard).toBe(1);
  });

  it('야광귀: 내 옆으로 순간이동하고, 맞으면 잠시 이동 속도가 줄어든다', () => {
    const { seen } = watchBoss('yagwanggwi');
    expect(seen.maxStep).toBeGreaterThan(150);
    expect(seen.zones.some((z) => z.slow > 0)).toBe(true);
    const t = disarm(emptyRun({ map: 'field', char: 'ox' }));
    const y = spawnBoss(t, BOSS_INDEX.yagwanggwi, 0, -500)!;
    y.pat = 1;
    y.dmg = 0;
    t.player.hp = t.stats.maxHp = 100000;
    advance(t, 0.95);
    expect(t.player.hp).toBeLessThan(100000);
    expect(t.player.slow).toBeGreaterThan(100);
    const x = t.player.x;
    y.hp = 0;
    killEnemy(t, y, false);
    t.zones.n = 0;
    advance(t, 1, { input: move(1, 0) });
    expect(t.player.x - x).toBeCloseTo(PLAYER.speed * 0.5, 0);
    advance(t, 2, { input: move(1, 0) });
    const x2 = t.player.x;
    advance(t, 1, { input: move(1, 0) });
    expect(t.player.x - x2).toBeCloseTo(PLAYER.speed, 0);
  });

  it('이무기: 지나갈 길을 미리 보여 준 뒤 화면을 가로질러 돌진하고, 물기둥을 세운다', () => {
    const { seen } = watchBoss('imugi');
    expect(seen.maxStep).toBeGreaterThan(400); // 화면 밖으로 옮겨 감
    const w = disarm(emptyRun({ map: 'palace', char: 'ox' }));
    const ib = spawnBoss(w, BOSS_INDEX.imugi, 0, -300)!;
    ib.pat = 1;
    step(w, makeInput());
    const lane = live(w.zones).map((z) => ({ x: z.x, y: z.y, r: z.r }));
    expect(lane.length).toBe(8);
    expect(Math.hypot(ib.x, ib.y)).toBeGreaterThan(500); // 화면 밖에서 온다
    const xs = new Set(lane.map((z) => Math.round(z.x)));
    const ys = new Set(lane.map((z) => Math.round(z.y)));
    expect(Math.min(xs.size, ys.size)).toBe(1);
    expect(Math.max(xs.size, ys.size)).toBe(8);
    const span = xs.size === 1 ? Math.max(...lane.map((z) => z.y)) - Math.min(...lane.map((z) => z.y)) : Math.max(...lane.map((z) => z.x)) - Math.min(...lane.map((z) => z.x));
    expect(span).toBeGreaterThan(850);
    expect(seen.zones.filter((z) => z.kind === ZONE.water).length).toBeGreaterThanOrEqual(7);
    // 돌진 속도
    const t = disarm(emptyRun({ map: 'palace', char: 'ox' }));
    const m = spawnBoss(t, BOSS_INDEX.imugi, 0, -300)!;
    m.pat = 1;
    let fast = 0;
    let px = m.x;
    let py = m.y;
    advance(t, 2.3, {
      immortal: true,
      each: () => {
        const d = Math.hypot(m.x - px, m.y - py);
        if (d < 100) fast = Math.max(fast, d);
        px = m.x;
        py = m.y;
      },
    });
    expect(fast).toBeCloseTo(1150 / 60, 1);
  });

  it('저승사자: 내 자리에 표식을 여러 번 찍고, 표식은 잠시 뒤 폭발한다', () => {
    const { seen } = watchBoss('reaper');
    const marks = seen.zones.filter((z) => z.r === 105 || z.r === 120);
    expect(marks.length).toBeGreaterThanOrEqual(5);
    const t = disarm(emptyRun({ map: 'field', char: 'ox' }));
    const r = spawnBoss(t, BOSS_INDEX.reaper, 0, -700)!;
    r.pat = 1;
    r.speed = 0;
    step(t, makeInput());
    expect(live(t.zones)[0]).toMatchObject({ x: 0, y: 0, r: 105 });
    // 표식에서 벗어나면 맞지 않는다
    advance(t, 1.2, { input: move(1, 0) });
    expect(t.player.hp).toBe(110);
  });

  it('강철이: 내 쪽으로 불을 뿜고, 불이 지나간 자리에 불길 지대가 남는다', () => {
    const { seen } = watchBoss('gangcheori');
    const fire = seen.zones.filter((z) => z.kind === ZONE.fire);
    expect(fire.length).toBeGreaterThanOrEqual(14);
    expect(seen.linger[ZONE.fire]).toBe(5);
    const t = disarm(emptyRun({ map: 'field', char: 'ox' }));
    const g = spawnBoss(t, BOSS_INDEX.gangcheori, 0, -400)!;
    g.pat = 1;
    g.speed = 0;
    step(t, makeInput());
    const line = live(t.zones);
    expect(line.length).toBe(7);
    // 보스에서 내 쪽(아래)으로 곧게
    expect(line.every((z) => Math.abs(z.x) < 0.001)).toBe(true);
    expect(line.map((z) => Math.round(z.y))).toEqual([-320, -240, -160, -80, 0, 80, 160]);
    t.player.hp = t.stats.maxHp = 100000;
    advance(t, 1.5);
    const h = t.player.hp;
    advance(t, 2);
    expect(h - t.player.hp).toBeGreaterThanOrEqual(9 * 2);
  });

  it('염라대왕: 넓은 판결 장판, 해골 병사와 저승사자 소환, 시간이 갈수록 단단해짐', () => {
    const { seen, def } = watchBoss('yeomra', 30);
    const zs = seen.zones;
    expect(zs.filter((z) => z.r === def.patterns[1].r).length).toBeGreaterThanOrEqual(4);
    expect(def.patterns[1].r).toBeGreaterThan(150); // 넓은 판결 장판
    expect(zs.some((z) => z.r === def.patterns[4].r)).toBe(true);
    expect(seen.summoned.skeleton).toBeGreaterThanOrEqual(def.patterns[2].count!);
    expect(seen.clones.filter((c) => c.look === BOSS_INDEX.reaper).length).toBeGreaterThanOrEqual(2);
    expect(def.harden).toBeTruthy();
  });

  it('맵마다 보스 셋의 체력은 맵 배율만큼 는다', () => {
    for (const m of MAPS) {
      const s = emptyRun({ map: m.id });
      const b = spawnBoss(s, BOSS_INDEX[m.bosses[0].id], 0, -500)!;
      expect(b.maxHp).toBeCloseTo(BOSSES[BOSS_INDEX[m.bosses[0].id]].hp * m.power.boss, 3);
    }
  });
});

describe('나머지 캐릭터 6종의 무기', () => {
  const armed = (id: string, lv = 1) => {
    const s = disarm(emptyRun());
    addWeapon(s, WEAPON_INDEX[id], lv);
    return s;
  };

  it('캐릭터 12종이 모두 자기 무기로 시작한다', () => {
    for (const c of CHARACTERS) {
      expect(WEAPONS[startWeapon(c.id)].id).toBe(c.weapon);
      expect(createRun({ seed: 1, char: c.id, map: 'field' }).weapons[0].def).toBe(WEAPON_INDEX[c.weapon]);
    }
  });

  it('고유 특성이 모두 능력치에 반영된다 (PRD 4장)', () => {
    const st = (id: (typeof CHARACTERS)[number]['id']) => createRun({ seed: 1, char: id, map: 'field' }).stats;
    expect(st('horse').taken).toBeCloseTo(0.95, 6);
    expect(st('sheep').regen).toBeGreaterThan(0);
    expect(st('monkey').cooldown).toBeCloseTo(0.92, 6);
    expect(st('rooster').projSpeed).toBeCloseTo(1.1, 6);
    expect(st('dog').pickup).toBeCloseTo(72 * 1.2, 6);
    expect(st('pig').coin).toBeCloseTo(1.1, 6);
    // 말: 받는 피해 -5% (20 → 19)
    const s = disarm(emptyRun({ char: 'horse' }));
    put(s, 'imp', 10, 0).dmg = 20;
    step(s, makeInput());
    expect(s.player.hp).toBe(81);
    // 양: 체력이 조금씩 돌아온다
    const sh = disarm(emptyRun({ char: 'sheep' }));
    sh.player.hp = 50;
    advance(sh, 8);
    expect(sh.player.hp).toBeCloseTo(52, 1);
  });

  it('말발굽: 내가 지나간 자리마다 충격파가 터진다', () => {
    const s = armed('hoof');
    const near = put(s, 'club', 60, 0);
    const far = put(s, 'club', 300, 0);
    near.speed = far.speed = 0;
    advance(s, 0.5, { immortal: true });
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(far.hp).toBe(far.maxHp);
    const hp = far.hp;
    // 그쪽으로 달려가면 그 자리에서 터진다
    advance(s, 1.5, { immortal: true, input: move(1, 0) });
    expect(far.hp).toBeLessThan(hp);
    // 충격파 하나는 한 번만 때린다
    const t = armed('hoof');
    const e = put(t, 'club', 50, 0);
    e.speed = 0;
    advance(t, 0.68, { immortal: true });
    expect(e.maxHp - e.hp).toBeCloseTo(6.4, 6);
  });

  it('양털 구름: 구름 속의 적은 피해를 입고 느려진다', () => {
    const s = armed('wool');
    const e = put(s, 'imp', 250, 0);
    const free = put(s, 'imp', -700, 0);
    e.hp = e.maxHp = free.hp = free.maxHp = 1e6;
    advance(s, 3, { immortal: true });
    expect(e.hp).toBeLessThan(1e6);
    // 같은 시간 동안 구름 속 요괴가 덜 다가왔다
    expect(250 - e.x).toBeLessThan((free.x + 700) * 0.8);
    expect(live(s.zones).some((z) => z.kind === ZONE.cloud) || e.slow >= 0).toBe(true);
  });

  it('여의봉: 겨눈 쪽 곧은 길 위의 적을 모두 꿰뚫고, 길 밖의 적은 맞지 않는다', () => {
    const s = armed('staff');
    const a = put(s, 'club', 100, 0);
    const b = put(s, 'club', 220, 10);
    const side = put(s, 'club', 120, 90);
    const behind = put(s, 'club', -120, 0);
    for (const e of [a, b, side, behind]) e.speed = 0;
    advance(s, 0.5, { immortal: true });
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(side.hp).toBe(side.maxHp);
    expect(behind.hp).toBe(behind.maxHp);
  });

  it('깃털: 사방으로 고르게 한꺼번에 쏜다 (닭의 특성으로 더 빠르다)', () => {
    const s = armed('feather');
    advance(s, 0.4);
    const fs = live(s.projectiles);
    expect(fs.length).toBe(5);
    const angles = fs.map((p) => Math.atan2(p.vy, p.vx)).sort((x, y) => x - y);
    for (let i = 1; i < 5; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo((Math.PI * 2) / 5, 5);
    const speed = Math.hypot(fs[0].vx, fs[0].vy);
    const r = disarm(emptyRun({ char: 'rooster' }));
    addWeapon(r, WEAPON_INDEX.feather, 1);
    advance(r, 0.4);
    expect(Math.hypot(live(r.projectiles)[0].vx, live(r.projectiles)[0].vy)).toBeCloseTo(speed * 1.1, 3);
  });

  it('동료 강아지: 곁에 있다가 가까운 적을 쫓아가 물고, 레벨이 오르면 마릿수가 는다', () => {
    const s = armed('puppy');
    advance(s, 1);
    const pups = () => live(s.projectiles).filter((p) => p.mode === MODE.minion);
    expect(pups().length).toBe(1);
    expect(Math.hypot(pups()[0].x, pups()[0].y)).toBeLessThan(80);
    const e = put(s, 'club', 200, 0);
    e.speed = 0;
    advance(s, 2, { immortal: true });
    expect(e.hp).toBeLessThan(e.maxHp);
    expect(Math.hypot(pups()[0].x - e.x, pups()[0].y - e.y)).toBeLessThan(40);
    // 오래 지나도 사라지지 않고, 레벨 5면 세 마리
    s.weapons[0].lv = 5;
    advance(s, 30, { immortal: true });
    expect(pups().length).toBe(3);
    // 내가 멀리 가면 따라온다
    s.player.x += 2000;
    advance(s, 0.5, { immortal: true });
    for (const p of pups()) expect(Math.hypot(p.x - s.player.x, p.y - s.player.y)).toBeLessThan(120);
  });

  it('복돼지 돌진: 겨눈 쪽으로 내달리며 닿는 적을 모두 친다', () => {
    const s = armed('piggy');
    const a = put(s, 'club', 120, 0);
    const b = put(s, 'club', 260, 0);
    const up = put(s, 'club', 0, -300);
    for (const e of [a, b, up]) e.speed = 0;
    advance(s, 1, { immortal: true });
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(up.hp).toBe(up.maxHp);
  });
});

describe('맵 4종: 4분 구성이 끝까지 돈다', () => {
  for (const m of MAPS) {
    it(`${m.name}: 등장 표의 요괴가 모두 나오고, 보스 셋이 1:20·2:40·4:00에 나오고, 최종 보스를 잡으면 클리어`, () => {
      const s = createRun({ seed: 21, char: 'ox', map: m.id, numbers: false });
      s.weapons.length = 0;
      const seen = new Set<string>();
      const bossAt: Record<string, number> = {};
      let swarms = 0;
      advance(s, RUN_SEC + 4, {
        immortal: true,
        each: (st) => {
          for (let i = 0; i < st.evN; i++) {
            const ev = st.events[i];
            if (ev.t === EV.bossSpawn) bossAt[BOSSES[ev.a].id] = Math.round(st.time);
            if (ev.t === EV.swarm) swarms++;
          }
          if (st.tick % 30 === 0) {
            for (let i = 0; i < st.enemies.n; i++) if (st.enemies.items[i].boss < 0 && st.enemies.items[i].look < 0) seen.add(ENEMIES[st.enemies.items[i].kind].id);
            // 요괴가 상한까지 쌓이지 않게 가끔 치운다 (보스는 둔다)
            if (st.normals > 200) for (let i = 0; i < st.enemies.n; i++) if (st.enemies.items[i].boss < 0) killEnemy(st, st.enemies.items[i], false);
          }
        },
      });
      const want = new Set([...m.spawns.map((r) => r.enemy), ...m.swarms.map((r) => r.enemy)]);
      for (const id of want) expect(seen.has(id), `${m.id}:${id}`).toBe(true);
      expect(bossAt).toEqual(Object.fromEntries(m.bosses.map((b) => [b.id, b.at])));
      expect(swarms).toBe(m.swarms.length);
      expect(s.phase).toBe('play');
      const final = activeBoss(s)!;
      expect(BOSSES[final.boss].id).toBe(m.bosses[2].id);
      final.hidden = false;
      final.guard = 1;
      hurtEnemy(s, final, 1e12, -1);
      expect(s.phase).toBe('clear');
      const r = summarize(s);
      expect(r).toMatchObject({ map: m.id, cleared: true, time: RUN_SEC });
      expect(r.codex.bosses).toEqual(m.bosses.map((b) => b.id));
      // 엽전 배율: 같은 닢이라도 뒤 맵일수록 더 받는다
      expect(m.coinMul).toBe([1, 1.5, 2, 2.5][MAP_INDEX[m.id]]);
    }, 120000);

    it(`${m.name}: '보통 실력' 정책으로 한 판이 끝까지 돌고, 결과가 서버 상한 안이다`, () => {
      const r = simulate({ seed: 31, char: 'tiger', map: m.id, upgrades: presetUpgrades(22) }, normalPolicy(3));
      expect(['over', 'clear']).toContain(r.state.phase);
      expect(r.time).toBeGreaterThan(40);
      expect(r.kills).toBeGreaterThan(20);
      expect(validRun(r)).toBe(true);
      // 내 캐릭터는 한 번도 장애물 안에 들어가지 않았다 (끝난 자리로 확인)
      expect(blocked(r.state.map.terrain, r.state.terrainSeed, r.state.player.x, r.state.player.y, PLAYER.r - 1)).toBe(false);
    }, 120000);
  }

  it('뒤 맵일수록 요괴가 강하다 (체력·속도)', () => {
    for (let i = 1; i < MAPS.length; i++) {
      expect(MAPS[i].power.hp).toBeGreaterThan(MAPS[i - 1].power.hp);
      expect(MAPS[i].power.speed).toBeGreaterThan(MAPS[i - 1].power.speed);
      expect(MAPS[i].coinMul).toBeGreaterThan(MAPS[i - 1].coinMul);
    }
    const hp = (id: string) => put(emptyRun({ map: id }), 'imp', 500, 0).maxHp;
    expect(hp('underworld')).toBeCloseTo(hp('field') * 2, 6);
  });
});
