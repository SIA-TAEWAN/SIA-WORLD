/**
 * 한 판의 계산. 고정 걸음(1/60초)으로 step(state, input) 을 부르면 상태가 한 걸음 나아간다.
 * Phaser·DOM·Math.random 을 쓰지 않는다 (같은 시드·같은 조작이면 언제나 같은 결과).
 * 화면은 이 상태를 그리기만 하고, 화면 없이도 수천 판을 돌려 밸런스를 볼 수 있다 (game/policy.ts).
 */
import { BOSS_WARN_SEC, DEV_LEVEL_PER_SEC, LIMIT, PLAYER, RUN_SEC, TICK, TICKS_PER_SEC, xpNeed } from '../data/balance';
import { BOSSES, BOSS_INDEX } from '../data/bosses';
import { CHARACTER_BY_ID } from '../data/characters';
import { ENEMIES, ENEMY_INDEX } from '../data/enemies';
import { ITEM, ITEMS } from '../data/items';
import { MAPS, MAP_INDEX } from '../data/maps';
import { PASSIVES } from '../data/passives';
import { UPGRADES, type UpgradeLevels } from '../data/upgrades';
import { FALLBACK_WEAPON, WEAPONS, WEAPON_INDEX } from '../data/weapons';
import {
  addFx, collect, edgePoint, emit, nearestEnemy, gainCoins, gainXp, healPlayer, hurtEnemy, hurtPlayer, killEnemy, makePool, makeStats, rand, recalcStats,
  spawnBoss, spawnEnemy, sweep,
} from './core';
import { updateEnemies } from './enemies';
import { Grid } from './grid';
import { addWeapon, applyCard, checkLevelUp, drawCards, openChest, pickCard } from './levelup';
import { EV, FX, MODE, type Enemy, type Input, type RunConfig, type State } from './state';
import { OUT, blocked, pushOut } from './terrain';
import { updateWeapons, weaponReady } from './weapons';

export const makeInput = (): Input => ({ mx: 0, my: 0, pick: -1, reroll: false });

/** 이 캐릭터가 들고 시작하는 무기 번호 (아직 만들지 않은 무기면 표창으로 대신한다) */
export function startWeapon(charId: RunConfig['char']): number {
  const def = WEAPONS[WEAPON_INDEX[CHARACTER_BY_ID[charId].weapon]];
  return def && weaponReady(def) ? WEAPON_INDEX[def.id] : WEAPON_INDEX[FALLBACK_WEAPON];
}

/** 새 판을 만든다 */
export function createRun(cfg: RunConfig): State {
  const map = MAPS[MAP_INDEX[cfg.map] ?? 0];
  const char = CHARACTER_BY_ID[cfg.char] ?? CHARACTER_BY_ID.rat;
  const upgrades: UpgradeLevels = {};
  for (const u of UPGRADES) upgrades[u.id] = Math.max(0, Math.min(u.max, Math.floor(cfg.upgrades?.[u.id] ?? 0)));
  const s: State = {
    cfg: { ...cfg, numbers: cfg.numbers ?? true },
    map,
    char,
    upgrades,
    rng: cfg.seed >>> 0,
    terrainSeed: (Math.imul(cfg.seed >>> 0, 2654435761) >>> 0) % 1000003,
    tick: 0,
    time: 0,
    phase: 'play',
    player: { x: 0, y: 0, hp: 0, fx: 1, fy: 0, inv: 0, moving: false, revives: 0, slow: 0 },
    stats: makeStats(),
    level: 1,
    xp: 0,
    xpNext: xpNeed(1),
    kills: 0,
    bossKills: 0,
    coins: 0,
    cakes: 0,
    rerolls: 0,
    weapons: [],
    passives: [],
    enemies: makePool<Enemy>(LIMIT.enemyPool, () => ({
      uid: 0, kind: 0, boss: -1, x: 0, y: 0, hp: 0, maxHp: 0, r: 0, speed: 0, dmg: 0, xp: 0, flash: 0, t: 0, dead: false, cd: 0,
      pat: 0, patT: 0, sub: 0, ax: 0, ay: 0, slow: 0, hidden: false, guard: 1, look: -1, side: 0, sideT: 0, hitAt: new Int32Array(8),
    })),
    projectiles: makePool(LIMIT.projectiles, () => ({
      kind: 0, mode: 0, slot: 0, weapon: -1, x: 0, y: 0, vx: 0, vy: 0, r: 0, dmg: 0, life: 0, pierce: 0,
      sx: 0, sy: 0, tx: 0, ty: 0, t: 0, dur: 0, a: 0, b: 0, c: 0, every: 0, hit: new Int32Array(8), hitN: 0, dead: false,
    })),
    zones: makePool(LIMIT.zones, () => ({ kind: 0, owner: 0, slot: 0, weapon: -1, x: 0, y: 0, r: 0, delay: 0, windup: 0, life: 0, maxLife: 0, every: 1, next: 0, dmg: 0, tick: 0, slow: 0, dead: false })),
    pickups: makePool(LIMIT.pickups, () => ({ kind: 0, x: 0, y: 0, value: 0, magnet: false, dead: false })),
    fx: makePool(LIMIT.fx, () => ({ kind: 0, x: 0, y: 0, r: 0, a: 0, b: 0, life: 0, maxLife: 0, dead: false })),
    nums: makePool(LIMIT.nums, () => ({ x: 0, y: 0, v: 0, kind: 0, life: 0, dead: false })),
    grid: new Grid(LIMIT.enemyPool),
    hits: new Int32Array(LIMIT.enemyPool),
    nextUid: 1,
    normals: 0,
    spawnAcc: new Float64Array(map.spawns.length),
    spawnKind: Int32Array.from(map.spawns, (r) => ENEMY_INDEX[r.enemy] ?? 0),
    swarmKind: Int32Array.from(map.swarms, (r) => ENEMY_INDEX[r.enemy] ?? 0),
    bossKind: Int32Array.from(map.bosses, (r) => BOSS_INDEX[r.id] ?? 0),
    swarmNext: 0,
    bossNext: 0,
    bossWarned: false,
    finalUid: -1,
    cards: [0, 1, 2].map(() => ({ type: 0, def: 0, lv: 0, isNew: false })),
    cardN: 0,
    events: Array.from({ length: 48 }, () => ({ t: 0, a: 0, b: 0 })),
    evN: 0,
    killEv: false,
    dmgByWeapon: new Float64Array(WEAPONS.length),
    dmgTaken: 0,
    seenEnemy: new Uint8Array(ENEMIES.length),
    seenBoss: new Uint8Array(BOSSES.length),
    gotWeapon: new Uint8Array(WEAPONS.length),
    gotPassive: new Uint8Array(PASSIVES.length),
  };
  const sum = recalcStats(s);
  s.player.hp = s.stats.maxHp;
  s.player.revives = Math.round(sum.revive);
  s.rerolls = Math.round(sum.reroll);
  addWeapon(s, startWeapon(char.id));
  if (cfg.startAt && cfg.startAt > 0) fastForward(s, cfg.startAt);
  return s;
}

/** 개발용: sec 초 시점으로 건너뛴다. 그때까지 올랐을 법한 레벨을 무작위 카드로 채운다 */
function fastForward(s: State, sec: number) {
  s.tick = Math.round(sec * TICKS_PER_SEC);
  s.time = s.tick * TICK;
  while (s.swarmNext < s.map.swarms.length && s.map.swarms[s.swarmNext].at < sec) s.swarmNext++;
  while (s.bossNext < s.map.bosses.length && s.map.bosses[s.bossNext].at < sec) s.bossNext++;
  const levels = Math.floor(sec * DEV_LEVEL_PER_SEC);
  for (let i = 0; i < levels; i++) {
    s.level++;
    drawCards(s);
    const c = s.cards[Math.floor(rand(s) * s.cardN)];
    applyCard(s, c.type, c.def, c.lv);
  }
  s.xpNext = xpNeed(s.level);
  s.player.hp = s.stats.maxHp;
  s.evN = 0;
}

const PT = { x: 0, y: 0 };

/**
 * 요괴 종류에 맞는 자리에 나타나게 한다 (data/enemies.ts 의 spawn):
 *   edge 화면 밖 둘레 한 마리 · near 내 근처 바닥에 숨어서 · row 화면 밖에 한 줄로 늘어서서
 */
function spawnByKind(s: State, kind: number) {
  const def = ENEMIES[kind];
  const p = s.player;
  if (def.spawn === 'near') {
    // 내 둘레 300~520 거리의 바닥 (장애물 위는 피한다)
    for (let tries = 0; tries < 4; tries++) {
      const a = rand(s) * Math.PI * 2;
      const d = 300 + rand(s) * 220;
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (tries < 3 && blocked(s.map.terrain, s.terrainSeed, x, y, def.r)) continue;
      spawnEnemy(s, kind, x, y);
      return;
    }
    return;
  }
  if (def.spawn === 'row') {
    // 한쪽 변에 나란히 서서 같은 방향으로 밀고 들어온다
    const side = Math.floor(rand(s) * 4);
    edgePoint(s, PT, side);
    const n = Math.round(def.extra?.row ?? 5);
    const gap = def.r * 2.3;
    const horizontal = side < 2;
    const dx = p.x - PT.x;
    const dy = p.y - PT.y;
    const d = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < n; i++) {
      if (s.enemies.n >= LIMIT.enemyPool - 6) break;
      const o = (i - (n - 1) / 2) * gap;
      const e = spawnEnemy(s, kind, PT.x + (horizontal ? o : 0), PT.y + (horizontal ? 0 : o));
      if (!e) break;
      e.ax = dx / d;
      e.ay = dy / d;
      // 줄에서의 내 자리 (나아가는 방향에 수직으로 얼마나 옆인가): 이만큼 옆을 겨눠서 줄이 흐트러지지 않는다
      e.patT = (horizontal ? o : 0) * -e.ay + (horizontal ? 0 : o) * e.ax;
    }
    return;
  }
  edgePoint(s, PT);
  spawnEnemy(s, kind, PT.x, PT.y);
}

// ───────────────────────── 출현: 등장 표 · 떼 · 보스 ─────────────────────────
function updateSpawns(s: State) {
  const map = s.map;
  const t = s.time;
  for (let i = 0; i < map.spawns.length; i++) {
    const row = map.spawns[i];
    if (t < row.from || t >= row.to) continue;
    const k = row.to - row.from > 10000 ? 0 : (t - row.from) / (row.to - row.from);
    s.spawnAcc[i] += (row.rate0 + (row.rate1 - row.rate0) * k) * map.power.count * TICK;
    while (s.spawnAcc[i] >= 1) {
      s.spawnAcc[i]--;
      if (s.normals >= LIMIT.enemies) continue;
      spawnByKind(s, s.spawnKind[i]);
    }
  }
  // 떼로 몰려오는 이벤트
  while (s.swarmNext < map.swarms.length && t >= map.swarms[s.swarmNext].at) {
    const sw = map.swarms[s.swarmNext];
    const kind = s.swarmKind[s.swarmNext++];
    const side = sw.shape === 'side' ? Math.floor(rand(s) * 4) : -1;
    const n = Math.round(sw.count * map.power.count);
    const special = ENEMIES[kind].spawn === 'near' || ENEMIES[kind].spawn === 'row';
    for (let i = 0; i < n; i++) {
      // 풀에 보스가 들어올 자리는 남겨 둔다
      if (s.enemies.n >= LIMIT.enemyPool - 6) break;
      if (special) {
        // 숨어 있는 요괴·줄지어 오는 요괴는 제 방식대로 (줄은 한 번에 여러 마리)
        spawnByKind(s, kind);
        if (ENEMIES[kind].spawn === 'row') i += Math.round(ENEMIES[kind].extra?.row ?? 5) - 1;
        continue;
      }
      edgePoint(s, PT, side);
      spawnEnemy(s, kind, PT.x, PT.y);
    }
    emit(s, EV.swarm, kind);
  }
  // 보스: 등장 3초 전에 경고, 시각이 되면 등장. 마지막 보스가 최종 보스
  if (s.bossNext < map.bosses.length) {
    const b = map.bosses[s.bossNext];
    if (!s.bossWarned && t >= b.at - BOSS_WARN_SEC) {
      s.bossWarned = true;
      emit(s, EV.bossWarn, s.bossKind[s.bossNext]);
    }
    if (t >= b.at) {
      edgePoint(s, PT, 0);
      const e = spawnBoss(s, s.bossKind[s.bossNext], PT.x, PT.y + 200);
      if (e) {
        if (s.bossNext === map.bosses.length - 1) s.finalUid = e.uid;
        s.bossNext++;
        s.bossWarned = false;
      }
    }
  }
}

// ───────────────────────── 투사체 ─────────────────────────
function updateProjectiles(s: State) {
  const list = s.projectiles.items;
  const enemies = s.enemies.items;
  const p = s.player;
  const n = s.projectiles.n;
  for (let i = 0; i < n; i++) {
    const pr = list[i];
    if (pr.dead) continue;
    pr.life -= TICK;
    if (pr.mode === MODE.line) {
      pr.x += pr.vx * TICK;
      pr.y += pr.vy * TICK;
      const m = collect(s, pr.x, pr.y, pr.r);
      for (let k = 0; k < m && !pr.dead; k++) {
        const e = enemies[s.hits[k]];
        let seen = false;
        for (let h = 0; h < pr.hitN && h < pr.hit.length; h++) if (pr.hit[h] === e.uid) seen = true;
        if (seen) continue;
        pr.hit[pr.hitN++ % pr.hit.length] = e.uid;
        hurtEnemy(s, e, pr.dmg, pr.weapon);
        if (pr.pierce-- <= 0) pr.dead = true;
      }
    } else if (pr.mode === MODE.lob) {
      pr.t += TICK / pr.dur;
      if (pr.t >= 1) {
        // 떨어진 자리가 터진다
        pr.dead = true;
        const m = collect(s, pr.tx, pr.ty, pr.b);
        for (let k = 0; k < m; k++) hurtEnemy(s, enemies[s.hits[k]], pr.dmg, pr.weapon);
        addFx(s, FX.burst, pr.tx, pr.ty, pr.b, 0, 0, 0.3);
      } else {
        pr.x = pr.sx + (pr.tx - pr.sx) * pr.t;
        pr.y = pr.sy + (pr.ty - pr.sy) * pr.t;
      }
    } else if (pr.mode === MODE.orbit) {
      pr.a += pr.c * TICK;
      pr.x = p.x + Math.cos(pr.a) * pr.b;
      pr.y = p.y + Math.sin(pr.a) * pr.b;
      const m = collect(s, pr.x, pr.y, pr.r);
      for (let k = 0; k < m; k++) {
        const e = enemies[s.hits[k]];
        if (s.tick - e.hitAt[pr.slot] < pr.every) continue;
        e.hitAt[pr.slot] = s.tick;
        hurtEnemy(s, e, pr.dmg, pr.weapon);
      }
    } else if (pr.mode === MODE.minion) {
      // 동료 강아지: 가까운 적을 쫓아가 문다. 내게서 너무 멀어지면 돌아온다
      pr.life = 1e9;
      let tx = p.x + Math.cos(pr.a) * 46;
      let ty = p.y + Math.sin(pr.a) * 46;
      const away = Math.hypot(pr.x - p.x, pr.y - p.y);
      if (away > 700) {
        pr.x = tx;
        pr.y = ty;
      }
      const ti = away < 420 ? nearestEnemy(s, pr.x, pr.y, 300) : -1;
      if (ti >= 0) {
        tx = enemies[ti].x;
        ty = enemies[ti].y;
      }
      const dx = tx - pr.x;
      const dy = ty - pr.y;
      const d = Math.hypot(dx, dy);
      if (d > 3) {
        const v = Math.min(d, pr.c * TICK);
        pr.x += (dx / d) * v;
        pr.y += (dy / d) * v;
        pr.vx = dx;
      }
      // 무는 간격은 강아지마다 따로 센다 (t: 다음에 물 수 있을 때까지 남은 걸음)
      if (pr.t > 0) pr.t--;
      else {
        const m = collect(s, pr.x, pr.y, pr.r);
        for (let k = 0; k < m; k++) hurtEnemy(s, enemies[s.hits[k]], pr.dmg, pr.weapon);
        if (m > 0) pr.t = pr.every;
      }
    } else {
      // 적이 쏜 것: 내게 닿으면 피해
      pr.x += pr.vx * TICK;
      pr.y += pr.vy * TICK;
      const dx = p.x - pr.x;
      const dy = p.y - pr.y;
      const rr = pr.r + PLAYER.r * 0.8;
      if (dx * dx + dy * dy < rr * rr) {
        hurtPlayer(s, pr.dmg);
        pr.dead = true;
      }
    }
    if (pr.life <= 0) pr.dead = true;
  }
}

// ───────────────────────── 지대 (독 지대 · 보스의 범위 공격) ─────────────────────────
function updateZones(s: State) {
  const list = s.zones.items;
  const enemies = s.enemies.items;
  const p = s.player;
  for (let i = 0; i < s.zones.n; i++) {
    const z = list[i];
    if (z.dead) continue;
    if (z.owner === 1) {
      if (z.delay > 0) {
        z.delay -= TICK;
        if (z.delay <= 0) {
          // 미리 보여 준 범위가 터진다
          const dx = p.x - z.x;
          const dy = p.y - z.y;
          const rr = z.r + PLAYER.r * 0.5;
          if (dx * dx + dy * dy < rr * rr && hurtPlayer(s, z.dmg) && z.slow > 0) p.slow = z.slow;
          addFx(s, FX.shock, z.x, z.y, z.r, 0, 0, 0.3);
          emit(s, EV.boom);
          z.maxLife = z.life;
          z.next = z.every;
        }
        continue;
      }
      z.life -= TICK;
      if (z.life <= 0) z.dead = true;
      else if (z.tick > 0 && --z.next <= 0) {
        // 바닥에 남은 불길·독: 그 안에 있으면 간격마다 피해
        z.next = z.every;
        const dx = p.x - z.x;
        const dy = p.y - z.y;
        if (dx * dx + dy * dy < z.r * z.r) hurtPlayer(s, z.tick);
      }
      continue;
    }
    z.life -= TICK;
    if (z.life <= 0) {
      z.dead = true;
      continue;
    }
    if (--z.next > 0) continue;
    z.next = z.every;
    const m = collect(s, z.x, z.y, z.r);
    for (let k = 0; k < m; k++) {
      const e = enemies[s.hits[k]];
      if (z.slow > 0 && e.boss < 0) e.slow = z.slow;
      hurtEnemy(s, e, z.dmg, z.weapon);
    }
  }
}

// ───────────────────────── 아이템 ─────────────────────────
/** 부적: 화면에 보이는 일반 요괴를 모두 물리친다 */
function useTalisman(s: State) {
  const p = s.player;
  const list = s.enemies.items;
  for (let i = 0; i < s.enemies.n; i++) {
    const e = list[i];
    if (e.dead || e.boss >= 0) continue;
    if (Math.abs(e.x - p.x) > 420 || Math.abs(e.y - p.y) > 800) continue;
    killEnemy(s, e, true);
  }
  addFx(s, FX.shock, p.x, p.y, 520, 0, 0, 0.45);
}

function collectItem(s: State, kind: number, value: number) {
  switch (kind) {
    case ITEM.gemS:
    case ITEM.gemM:
    case ITEM.gemL:
      gainXp(s, value);
      break;
    case ITEM.coin:
      gainCoins(s, value);
      break;
    case ITEM.cake:
      s.cakes++;
      healPlayer(s, ITEMS.cakeHeal);
      break;
    case ITEM.pouch:
      // 복주머니: 바닥의 구슬·엽전을 모두 끌어당긴다
      for (let i = 0; i < s.pickups.n; i++) if (s.pickups.items[i].kind <= ITEM.coin) s.pickups.items[i].magnet = true;
      break;
    case ITEM.talisman:
      useTalisman(s);
      break;
    case ITEM.chest:
      openChest(s);
      break;
  }
  emit(s, EV.pick, kind);
}

function updatePickups(s: State) {
  const p = s.player;
  const list = s.pickups.items;
  const reach = s.stats.pickup * s.stats.pickup;
  const touch = PLAYER.r + ITEMS.touch;
  const step = PLAYER.magnetSpeed * TICK;
  for (let i = 0; i < s.pickups.n; i++) {
    const it = list[i];
    if (it.dead) continue;
    const dx = p.x - it.x;
    const dy = p.y - it.y;
    const d2 = dx * dx + dy * dy;
    if (!it.magnet) {
      if (d2 > reach) continue;
      it.magnet = true;
    }
    const d = Math.sqrt(d2);
    if (d <= touch + step) {
      it.dead = true;
      collectItem(s, it.kind, it.value);
      continue;
    }
    it.x += (dx / d) * step;
    it.y += (dy / d) * step;
  }
}

function tickLife<T extends { life: number; dead: boolean }>(list: T[], n: number) {
  for (let i = 0; i < n; i++) {
    list[i].life -= TICK;
    if (list[i].life <= 0) list[i].dead = true;
  }
}

/** 부활: 체력을 절반 채우고 둘레의 일반 요괴를 날려 버린다 */
function revive(s: State) {
  const p = s.player;
  p.revives--;
  p.hp = Math.round(s.stats.maxHp * 0.5);
  p.inv = Math.round(PLAYER.reviveInvSec * TICKS_PER_SEC);
  const r2 = PLAYER.reviveBlastR * PLAYER.reviveBlastR;
  const list = s.enemies.items;
  for (let i = 0; i < s.enemies.n; i++) {
    const e = list[i];
    if (e.dead || e.boss >= 0) continue;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    if (dx * dx + dy * dy < r2) killEnemy(s, e, true);
  }
  sweep(s.enemies);
  addFx(s, FX.shock, p.x, p.y, PLAYER.reviveBlastR, 0, 0, 0.45);
  emit(s, EV.revive);
}

// ───────────────────────── 한 걸음 ─────────────────────────
export function step(s: State, input: Input) {
  s.evN = 0;
  s.killEv = false;
  if (s.phase === 'levelup') {
    // 레벨업 중에는 게임이 멈추고 카드 고르기만 받는다
    if (input.reroll && s.rerolls > 0) {
      s.rerolls--;
      drawCards(s);
    } else if (input.pick >= 0) pickCard(s, input.pick);
    return;
  }
  if (s.phase !== 'play') return;
  s.tick++;
  s.time = s.tick * TICK;

  // 이동 (조작은 이동뿐이다)
  const p = s.player;
  let mx = input.mx;
  let my = input.my;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  p.moving = len > 0.01;
  if (p.slow > 0) p.slow--;
  if (p.moving) {
    // 야광귀에게 맞으면 잠시 절반 빠르기
    const speed = s.stats.speed * (p.slow > 0 ? 0.5 : 1);
    p.x += mx * speed * TICK;
    p.y += my * speed * TICK;
    // 지형: 대나무·담·물길은 지나갈 수 없다 (비스듬히 닿으면 미끄러지듯 돌아간다)
    if (pushOut(s.map.terrain, s.terrainSeed, p.x, p.y, PLAYER.r)) {
      p.x = OUT.x;
      p.y = OUT.y;
    }
    p.fx = mx / Math.min(1, len);
    p.fy = my / Math.min(1, len);
  }
  if (p.inv > 0) p.inv--;
  if (s.stats.regen > 0 && p.hp < s.stats.maxHp) p.hp = Math.min(s.stats.maxHp, p.hp + s.stats.regen * TICK);

  updateSpawns(s);
  s.grid.build(s.enemies.items, s.enemies.n, p.x, p.y);
  updateEnemies(s);
  updateWeapons(s);
  updateProjectiles(s);
  updateZones(s);
  updatePickups(s);
  tickLife(s.fx.items, s.fx.n);
  tickLife(s.nums.items, s.nums.n);

  // 죽은 것을 풀로 돌려보낸다
  sweep(s.enemies);
  sweep(s.projectiles);
  sweep(s.zones);
  sweep(s.pickups);
  sweep(s.fx);
  sweep(s.nums);
  let normals = 0;
  for (let i = 0; i < s.enemies.n; i++) if (s.enemies.items[i].boss < 0) normals++;
  s.normals = normals;

  if (s.phase !== 'play') return; // 최종 보스를 물리쳐 끝났다
  if (p.hp <= 0) {
    if (p.revives > 0) revive(s);
    else {
      p.hp = 0;
      s.phase = 'over';
      emit(s, EV.over);
      return;
    }
  }
  checkLevelUp(s);
}

/** 지금 살아 있는 보스 (없으면 null). 여럿이면 가장 늦게 나온 것 */
export function activeBoss(s: State): Enemy | null {
  let best: Enemy | null = null;
  for (let i = 0; i < s.enemies.n; i++) {
    const e = s.enemies.items[i];
    if (e.boss >= 0 && !e.dead && (!best || e.uid > best.uid)) best = e;
  }
  return best;
}

/** 판 결과 (4단계에서 이 모양 그대로 저장한다: survival_runs) */
export interface RunSummary {
  map: string;
  character: string;
  /** 생존 시간 (초, 최대 600) */
  time: number;
  kills: number;
  level: number;
  /** 주운 엽전 (포기·게임 오버여도 지급) */
  coins: number;
  cleared: boolean;
  bossKills: number;
  cakes: number;
  /** 도감: 이번 판에 만난 요괴·보스, 얻은 무기·패시브의 id */
  codex: Codex;
}

export interface Codex {
  enemies: string[];
  bosses: string[];
  weapons: string[];
  passives: string[];
}

const marked = <T extends { id: string }>(flags: Uint8Array, defs: readonly T[]) => defs.filter((_, i) => flags[i] === 1).map((d) => d.id);

export function summarize(s: State): RunSummary {
  return {
    map: s.map.id,
    character: s.char.id,
    time: Math.min(RUN_SEC, Math.floor(s.time)),
    kills: s.kills,
    level: s.level,
    coins: Math.floor(s.coins),
    cleared: s.phase === 'clear',
    bossKills: s.bossKills,
    cakes: s.cakes,
    codex: {
      enemies: marked(s.seenEnemy, ENEMIES),
      bosses: marked(s.seenBoss, BOSSES),
      weapons: marked(s.gotWeapon, WEAPONS),
      passives: marked(s.gotPassive, PASSIVES),
    },
  };
}
