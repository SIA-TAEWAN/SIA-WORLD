import { BOSS_AT, BOSS_WARN_SEC, LIMIT, MAX_LV, RUN_SEC, SELL_RATE, SQUAD_SIZE, START_LIVES, STUN_GUARD_SEC, TICK, WAVES, WAVE_HP, WAVE_SEC } from '../data/balance';
import { BOSSES, BOSS_INDEX } from '../data/bosses';
import { TOWERS, TOWER_INDEX, type TowerLevel } from '../data/characters';
import { ENDLESS_ID, ENDLESS_MAX_SEC, endlessBoss, endlessWave } from '../data/endless';
import { ENEMIES, ENEMY_INDEX } from '../data/enemies';
import { levelMods, upgradeMods } from '../data/growth';
import { stageOf, type StageDef, type WaveDef } from '../data/stages';
import { BOSS_ACTS } from './bosses';
import { FLASH_REST, burn, placeOnRoute, spawnEnemy } from './core';
import { buildRoute, cellX, cellY } from './path';
import { featsOf, type Feats } from './feats';
import { LIMITS, starsOf, type RunReport } from './progress';
import { makeRng } from './rng';
import { EV, FX, addFx, drop, emit, makeEnemy, makeEv, makeFx, makePool, makeProj, makeStats, makeTower, type Cmd, type GameConfig, type Spawn, type State } from './state';
import { AIM_CHOICES } from './core';
import { ATTACKS, aimMode, canAim, stepProjectile } from './towers';

/**
 * 한 판의 계산. 화면 없이 돌아가는 순수 모듈이다:
 *   createGame(설정) → [command(명령) …] → step() 을 1/60초마다 → phase 가 clear / fail 이 되면 끝.
 * 시작 전(prep)에는 step 이 아무것도 하지 않는다 (시간이 흐르지 않는다). 'start' 명령으로 3분 타이머가 돈다.
 * 받은 명령은 state.log 에 쌓이고, replay(설정, log) 는 같은 판을 그대로 다시 만든다 (테스트·밸런스·서버 검증용).
 */

const WAVE_TICKS = Math.round(WAVE_SEC / TICK);
/** 끝없는 모드: 보스가 나오는 웨이브에서, 웨이브가 시작되고 이만큼 뒤에 보스가 나온다 (초) */
export const ENDLESS_BOSS_SEC = 6;
/** 다른 요괴가 빠르게 해 줄 때의 속도 배율 (수문장 대장) · 표식이 찍힌 캐릭터의 공격 속도 배율 (저승사자) */
export const RUSH_MUL = 1.4;
export const MARK_MUL = 0.5;
/**
 * 조준 바꾸기는 명령이 이만큼 쌓이기 전까지만 받는다: 명령 수 상한(cmds_max)을 넘은 판은 서버가 받지 않으므로,
 * 조준을 아무리 눌러도 배치·강화·되팔기에 쓸 자리가 남게 한다
 */
export const AIM_CMDS_MAX = LIMITS.cmds_max - 600;

/** given: 스테이지 데이터를 직접 준다 (아직 목록에 없는 스테이지를 시험할 때 — scripts/gen-stages.ts) */
/** 웨이브 하나의 무리를 등장 예정으로 편다 (wi 번째 웨이브: wi × 30초부터) */
function addWave(out: Spawn[], stageId: string, w: WaveDef, wi: number, hpMul: number, ground: number[], sky: number) {
  for (const g of w.groups) {
    const kind = ENEMY_INDEX[g.enemy];
    if (kind === undefined) throw new Error(`unknown enemy: ${g.enemy}`);
    // 공중 요괴는 길을 적지 않으면 공중 경로로 온다
    const fly = !!ENEMIES[kind].air;
    if (fly && g.route === undefined && sky < 0) throw new Error(`${stageId}: ${g.enemy} needs an air route`);
    for (let k = 0; k < g.count; k++) {
      const route = g.route === 'alt' ? ground[k % ground.length] : (g.route ?? (fly ? sky : 0));
      out.push({ t: wi * WAVE_SEC + g.at + k * g.gap, kind, boss: -1, route, hpMul });
    }
  }
}

export function createGame(cfg: GameConfig, given?: StageDef): State {
  const stage = given ?? stageOf(cfg.stage);
  if (!stage) throw new Error(`unknown stage: ${cfg.stage}`);
  const routes = stage.routes.map(buildRoute);
  const ground = routes.map((r, i) => (r.air ? -1 : i)).filter((i) => i >= 0);
  const sky = routes.findIndex((r) => r.air);
  const squad: number[] = [];
  for (const id of cfg.squad) {
    const i = TOWER_INDEX[id];
    if (i !== undefined && !squad.includes(i) && squad.length < SQUAD_SIZE) squad.push(i);
  }
  // 웨이브를 등장 시각 순서로 펴 둔다 (끝없는 모드는 웨이브가 시작될 때마다 그 웨이브만 편다 — step)
  const spawns: Spawn[] = [];
  // 오늘의 고개의 조건 (없으면 1: × 1 은 값을 바꾸지 않는다)
  const hpMod = cfg.mods?.hp ?? 1;
  const energyMod = cfg.mods?.energy ?? 1;
  stage.waves.slice(0, WAVES).forEach((w, wi) => addWave(spawns, stage.id, w, wi, stage.hp * (w.hp ?? WAVE_HP[wi] ?? 1) * hpMod, ground, sky));
  let bossId = -1;
  let bossAt = -1;
  if (stage.boss) {
    bossId = BOSS_INDEX[stage.boss.id];
    if (bossId === undefined) throw new Error(`unknown boss: ${stage.boss.id}`);
    bossAt = stage.boss.at ?? BOSS_AT;
    spawns.push({ t: bossAt, kind: -1, boss: bossId, route: stage.boss.route ?? 0, hpMul: (stage.boss.hp ?? 1) * hpMod });
  }
  // 같은 시각이면 적어 둔 순서 그대로 (sort 는 순서를 지킨다)
  spawns.sort((a, b) => a.t - b.t);
  const um = upgradeMods(cfg.upgrades);
  const lives = cfg.startLives !== undefined && cfg.startLives >= 1 ? Math.floor(cfg.startLives) : (stage.lives ?? START_LIVES) + um.lives;
  // 캐릭터 수치에 영구 레벨의 배율을 곱해 둔다 (공격력 +4%/레벨, 4레벨 사거리, 8레벨 비용, 12레벨 공격 간격)
  const mods = TOWERS.map((t) => levelMods(cfg.levels?.[t.id] ?? 1));
  const lv = TOWERS.map((t, i) =>
    t.levels.map((L) => ({
      ...L,
      dmg: L.dmg * mods[i].dmg,
      range: L.range * mods[i].range,
      every: L.every * mods[i].every,
      // 지속 피해도 공격력과 함께 오른다
      ...(L.poison ? { poison: L.poison * mods[i].dmg } : {}),
      ...(L.burn ? { burn: L.burn * mods[i].dmg } : {}),
      // 돼지는 공격력 대신 버는 기운이 오른다
      ...(L.income ? { income: Math.round(L.income * mods[i].dmg) } : {}),
    })),
  );
  const price = (i: number, v: number) => Math.max(1, Math.round(v * mods[i].cost));
  return {
    cfg, stage, routes, ground,
    lv,
    cost: TOWERS.map((t, i) => price(i, t.cost)),
    up: TOWERS.map((t, i) => [price(i, t.up[0]), price(i, t.up[1])] as [number, number]),
    sellRate: SELL_RATE + um.sell,
    gain: um.gain,
    slotX: stage.slots.map((c) => cellX(c[0])),
    slotY: stage.slots.map((c) => cellY(c[1])),
    squad,
    rng: makeRng(cfg.seed),
    phase: 'prep',
    tick: 0,
    time: 0,
    lives,
    startLives: lives,
    energy: Math.floor(stage.energy * um.energy * energyMod + 1e-6),
    kills: 0,
    bonus: 0,
    endless: stage.id === ENDLESS_ID,
    seenE: 0,
    seenB: 0,
    wave: -1,
    spawns,
    spawnI: 0,
    bossId,
    bossAt,
    bossNext: bossId,
    bossWarned: false,
    bossDown: false,
    enemies: Array.from({ length: LIMIT.enemies }, makeEnemy),
    enemyHi: 0,
    enemyN: 0,
    uid: 0,
    towers: stage.slots.map(makeTower),
    projectiles: makePool(LIMIT.projectiles, makeProj),
    fx: makePool(LIMIT.fx, makeFx),
    events: Array.from({ length: LIMIT.events }, makeEv),
    evN: 0,
    log: [],
    stats: makeStats(TOWERS.length),
    src: -1,
    srcBoost: 0,
    srcBoostBy: -1,
  };
}

// ───────────────────────── 명령: 배치 · 강화 · 되팔기 · 시작 ─────────────────────────

const open = (s: State) => s.phase === 'prep' || s.phase === 'play';

/** 그 칸의 캐릭터가 지금 단계에서 쓰는 수치 (빈 칸이면 null) */
export function towerLevel(s: State, slot: number): TowerLevel | null {
  const tw = s.towers[slot];
  return tw && tw.char >= 0 ? s.lv[tw.char][tw.lv - 1] : null;
}

/**
 * 명령 자리가 남았나: 명령 수(cmds_max)를 넘긴 판은 서버가 받지 않으므로(bad result) 그 앞에서 더 받지 않는다.
 * 조준 바꾸기는 그보다 일찍(AIM_CMDS_MAX) 막힌다. 준비(prep) 동안에는 시작 명령이 들어갈 한 자리를 남긴다
 */
export const cmdRoom = (s: State) => s.log.length < LIMITS.cmds_max - (s.phase === 'prep' ? 1 : 0);
/** 배치 자리가 남았나: 배치 횟수 상한(placed_max)도 서버와 같다 */
export const placeRoom = (s: State) => cmdRoom(s) && placedCount(s) < LIMITS.placed_max;

export function canPlace(s: State, slot: number, char: number): boolean {
  const tw = s.towers[slot];
  return open(s) && !!tw && tw.char < 0 && tw.off <= 0 && s.squad.includes(char) && s.energy >= s.cost[char] && placeRoom(s);
}

/** 다음 단계로 올리는 비용 (빈 칸이거나 이미 3단계면 null) */
export function upgradeCost(s: State, slot: number): number | null {
  const tw = s.towers[slot];
  if (!tw || tw.char < 0 || tw.lv >= MAX_LV) return null;
  return s.up[tw.char][tw.lv - 1];
}

/** 되팔면 돌려받는 기운: 쓴 기운의 70%. 시작 전(prep)에는 전부 돌려받는다 (처음 배치를 고쳐 놓을 수 있게) */
export function sellValue(s: State, slot: number): number {
  const tw = s.towers[slot];
  if (!tw || tw.char < 0) return 0;
  // (0.7 을 곱한 값이 62.999… 가 되어 1 모자라지 않게 아주 조금 더한 뒤 내림)
  return s.phase === 'prep' ? tw.spent : Math.floor(tw.spent * s.sellRate + 1e-6);
}

/** 조준을 그 방식으로 바꿀 수 있나: 과녁을 골라 공격하는 캐릭터이고, 지금과 다른 방식이고, 명령 자리가 남아 있을 때 */
export function canSetAim(s: State, slot: number, aim: number): boolean {
  const tw = s.towers[slot];
  return open(s) && !!tw && canAim(tw.char) && AIM_CHOICES.includes(aim) && aimMode(tw) !== aim && s.log.length < AIM_CMDS_MAX;
}

/** 닭의 지원: 캐릭터마다, 자기를 사거리 안에 둔 닭 가운데 가장 큰 공격 속도 보너스를 받는다 (배치가 바뀔 때마다 다시 센다) */
function refreshHaste(s: State) {
  for (let i = 0; i < s.towers.length; i++) {
    const tw = s.towers[i];
    tw.haste = 0;
    tw.hasteBy = -1;
    if (tw.char < 0) continue;
    for (let j = 0; j < s.towers.length; j++) {
      const o = s.towers[j];
      if (j === i || o.char < 0) continue;
      const L = s.lv[o.char][o.lv - 1];
      if (!L.haste || L.haste <= tw.haste) continue;
      const dx = s.slotX[i] - s.slotX[j];
      const dy = s.slotY[i] - s.slotY[j];
      if (dx * dx + dy * dy <= L.range * L.range) {
        tw.haste = L.haste;
        tw.hasteBy = o.char;
      }
    }
  }
}

/**
 * 명령 하나를 지금 적용한다. 할 수 없는 명령이면 false (아무것도 바뀌지 않는다).
 * 생긴 일은 events 에 새로 담긴다 (앞 걸음의 것은 지워진다).
 */
export function command(s: State, op: Cmd['op'], slot = -1, char = -1): boolean {
  s.evN = 0;
  if (!open(s)) return false;
  const tw = s.towers[slot];
  switch (op) {
    case 'start':
      if (s.phase !== 'prep') return false;
      s.phase = 'play';
      emit(s, EV.start);
      break;
    case 'place': {
      if (!canPlace(s, slot, char)) return false;
      const cost = s.cost[char];
      s.energy -= cost;
      tw.char = char;
      tw.lv = 1;
      tw.cd = 0.25;
      tw.spent = cost;
      tw.since = 9;
      tw.mark = 0;
      tw.aim = -1;
      tw.face = s.slotX[slot] > cellX(4) ? -1 : 1;
      emit(s, EV.place, slot, char, s.slotX[slot], s.slotY[slot]);
      break;
    }
    case 'upgrade': {
      const cost = upgradeCost(s, slot);
      if (cost === null || s.energy < cost || !cmdRoom(s)) return false;
      s.energy -= cost;
      tw.lv++;
      tw.spent += cost;
      emit(s, EV.upgrade, slot, tw.char, s.slotX[slot], s.slotY[slot]);
      break;
    }
    case 'sell': {
      if (!tw || tw.char < 0 || !cmdRoom(s)) return false;
      s.energy += sellValue(s, slot);
      emit(s, EV.sell, slot, tw.char, s.slotX[slot], s.slotY[slot]);
      tw.char = -1;
      tw.lv = 0;
      tw.spent = 0;
      tw.aim = -1;
      break;
    }
    // 조준 바꾸기: char = 방식 (AIM 의 first · strong · weak · last). 다음 공격부터 그 방식으로 과녁을 고른다
    case 'aim':
      if (!canSetAim(s, slot, char)) return false;
      tw.aim = char;
      break;
    default:
      return false;
  }
  if (op !== 'start' && op !== 'aim') refreshHaste(s);
  s.log.push({ tick: s.tick, op, slot, char });
  return true;
}

// ───────────────────────── 한 걸음 ─────────────────────────

export function step(s: State) {
  s.evN = 0;
  if (s.phase !== 'play') return;
  s.tick++;
  s.time = s.tick * TICK;

  // 웨이브: 30초마다 다음 웨이브 (3분 뒤로는 마지막 웨이브 그대로). 웨이브 k 는 판 시간 30k초(걸음 1800k)에 시작한다:
  // 그래서 지금 웨이브 = ⌊판 시간 ÷ 30⌋ — 서버가 보고된 판 시간(초, 내림)으로 도달 웨이브를 세는 것과 같은 기준이다 (첫 웨이브는 첫 걸음에)
  // 끝없는 모드: 웨이브가 끝없이 이어지고, 시작될 때마다 그 웨이브의 요괴를 만든다 (웨이브 번호로 정해진다)
  const wave = s.endless ? Math.floor(s.tick / WAVE_TICKS) : Math.min(WAVES - 1, Math.floor(s.tick / WAVE_TICKS));
  if (wave !== s.wave) {
    s.wave = wave;
    emit(s, EV.wave, wave);
    if (s.endless) {
      const w = endlessWave(wave);
      const add: Spawn[] = [];
      addWave(add, s.stage.id, w, wave, s.stage.hp * (w.hp ?? 1), s.ground, s.routes.findIndex((r) => r.air));
      const b = endlessBoss(wave);
      if (b) {
        add.push({ t: wave * WAVE_SEC + ENDLESS_BOSS_SEC, kind: -1, boss: b.boss, route: s.ground[0], hpMul: b.hp });
        // 이 보스의 등장 경고 (BOSS_WARN_SEC 초 전)
        s.bossAt = wave * WAVE_SEC + ENDLESS_BOSS_SEC;
        s.bossNext = b.boss;
        s.bossWarned = false;
      }
      add.sort((x, y) => x.t - y.t);
      for (const sp of add) s.spawns.push(sp);
    }
    // 돼지: 웨이브가 시작될 때마다 기운을 번다 (3단계는 엽전도)
    for (let slot = 0; slot < s.towers.length; slot++) {
      const tw = s.towers[slot];
      if (tw.char < 0) continue;
      const L = s.lv[tw.char][tw.lv - 1];
      if (!L.income) continue;
      s.energy += L.income;
      s.stats.energy[tw.char] += L.income;
      s.bonus += L.coin ?? 0;
      tw.since = 0;
      emit(s, EV.income, L.income, slot, s.slotX[slot], s.slotY[slot]);
    }
  }
  if (s.bossAt >= 0 && !s.bossWarned && s.time >= s.bossAt - BOSS_WARN_SEC) {
    s.bossWarned = true;
    emit(s, EV.bossWarn, s.bossNext);
  }

  // 등장 (자리가 없으면 다음 걸음에 다시)
  while (s.spawnI < s.spawns.length && s.spawns[s.spawnI].t <= s.time + 1e-9) {
    const sp = s.spawns[s.spawnI];
    const e = spawnEnemy(s, sp.kind, sp.boss, sp.route, sp.hpMul);
    if (!e) break;
    s.spawnI++;
    // 도감: 이 판에서 만난 요괴·보스
    if (sp.boss >= 0) {
      s.seenB |= 1 << sp.boss;
      // (끝없는 모드는 보스가 여러 번 나온다: 나올 때마다 그 보스가 '지금의 보스'다)
      s.bossId = sp.boss;
      s.bossDown = false;
      emit(s, EV.bossIn, sp.boss, 0, e.x, e.y);
    } else s.seenE |= 1 << sp.kind;
  }

  // 감지: 은신 요괴를 찾아내는 캐릭터의 사거리 안에 있으면 잠깐 드러난다 (0.1초마다 살핀다)
  if (s.tick % 6 === 0) {
    for (let slot = 0; slot < s.towers.length; slot++) {
      const tw = s.towers[slot];
      if (tw.char < 0 || tw.off > 0) continue;
      const L = s.lv[tw.char][tw.lv - 1];
      if (!L.detect) continue;
      const r2 = L.range * L.range;
      for (let i = 0; i < s.enemyHi; i++) {
        const e = s.enemies[i];
        if (!e.alive || !e.stealth) continue;
        const dx = e.x - s.slotX[slot];
        const dy = e.y - s.slotY[slot];
        if (dx * dx + dy * dy <= r2) e.seen = 0.3;
      }
    }
  }

  // 요괴: 길을 따라 걷는다. 출구에 닿으면 생명이 준다
  for (let i = 0; i < s.enemyHi; i++) {
    const e = s.enemies[i];
    if (!e.alive) continue;
    e.t += TICK;
    if (e.flash > FLASH_REST) e.flash -= TICK;
    if (e.boss >= 0) BOSS_ACTS[BOSSES[e.boss].act]?.(s, e, BOSSES[e.boss]);
    // 사라져 있거나 쓰러져 있는 동안에는 아무 일도 없다
    if (e.gone > 0) continue;
    if (e.down > 0) {
      e.down -= TICK;
      continue;
    }
    // 주기 특성 (숨었다 나왔다 · 무적이 됐다 풀렸다)
    if (e.boss < 0 && e.look < 0) {
      const cycle = ENEMIES[e.kind].cycle;
      if (cycle) {
        e.cyc -= TICK;
        if (e.cyc <= 0) {
          e.on = !e.on;
          e.cyc = e.on ? cycle.on : cycle.off;
        }
      }
    }
    if (e.seen > 0) e.seen -= TICK;
    // 독·불 (그동안에는 회복하지 못한다) / 회복
    if (e.dotT > 0) {
      e.dotT -= TICK;
      burn(s, e, e.dot * TICK);
      if (!e.alive || e.down > 0) continue;
    } else if (e.regen > 0 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.regen * TICK);
    if (e.slowT > 0) {
      e.slowT -= TICK;
      if (e.slowBy >= 0) s.stats.slow[e.slowBy] += TICK;
      if (e.slowT <= 0) {
        e.slow = 1;
        e.vuln = 0;
      }
    }
    if (e.rush > 0) e.rush -= TICK;
    if (e.stun > 0) {
      e.stun -= TICK;
      if (e.stun <= 0) e.guard = STUN_GUARD_SEC;
      continue;
    }
    if (e.guard > 0) e.guard -= TICK;
    e.d += e.speed * e.mul * (e.slowT > 0 ? e.slow : 1) * (e.rush > 0 ? RUSH_MUL : 1) * TICK;
    const len = s.routes[e.route].len;
    if (e.d < len) {
      placeOnRoute(s, e);
      continue;
    }
    e.d = len;
    placeOnRoute(s, e);
    e.alive = false;
    s.enemyN--;
    s.lives = Math.max(0, s.lives - e.leak);
    addFx(s, FX.leak, e.x, e.y, 60, 0.5);
    emit(s, EV.leak, e.leak, e.boss, e.x, e.y);
    if (s.lives <= 0) {
      s.phase = 'fail';
      emit(s, EV.fail);
      return;
    }
  }
  while (s.enemyHi > 0 && !s.enemies[s.enemyHi - 1].alive) s.enemyHi--;

  // 캐릭터: 공격 간격이 찼고 사거리 안에 요괴가 있으면 공격
  for (let slot = 0; slot < s.towers.length; slot++) {
    const tw = s.towers[slot];
    // 보스가 멈추거나 태운 칸: 그동안 공격하지 못한다 (빈 칸이면 놓을 수 없다)
    if (tw.off > 0) tw.off -= TICK;
    if (tw.char < 0) continue;
    tw.since += TICK;
    if (tw.mark > 0) tw.mark -= TICK;
    if (tw.off > 0) continue;
    tw.cd -= TICK * (1 + tw.haste) * (tw.mark > 0 ? MARK_MUL : 1);
    if (tw.cd > 0) continue;
    const def = TOWERS[tw.char];
    const L = s.lv[tw.char][tw.lv - 1];
    // 활약상: 이 공격이 주는 피해는 이 캐릭터의 것 (닭이 빠르게 해 준 몫은 닭에게도 적는다)
    s.src = tw.char;
    s.srcBoost = tw.haste;
    s.srcBoostBy = tw.hasteBy;
    if (ATTACKS[def.kind](s, slot, tw, L)) {
      tw.cd = L.every;
      tw.since = 0;
      emit(s, EV.fire, tw.char, slot);
    } else tw.cd = 0;
  }
  s.src = -1;
  s.srcBoost = 0;

  // 투사체 · 이펙트
  const pr = s.projectiles;
  for (let i = pr.n - 1; i >= 0; i--) if (stepProjectile(s, i, TICK)) drop(pr, i);
  const fx = s.fx;
  for (let i = fx.n - 1; i >= 0; i--) {
    fx.items[i].life -= TICK;
    if (fx.items[i].life <= 0) drop(fx, i);
  }

  // 끝: 나올 요괴가 다 나왔고 길 위에 아무도 없으면 클리어 (3분 뒤에도 남은 요괴·보스가 없어질 때까지 계속된다)
  // (3분이 되기 전에 다 잡았어도 3분까지는 기다린다: 클리어한 판은 늘 180초 이상이다 — 서버 검증의 기준)
  if (!s.endless && s.spawnI >= s.spawns.length && s.enemyN === 0 && s.time >= RUN_SEC) {
    s.phase = 'clear';
    emit(s, EV.clear);
  }
  // 끝없는 모드에는 클리어가 없다. 시간 상한(웨이브 120)에 닿으면 거기서 끝난다
  if (s.endless && s.time >= ENDLESS_MAX_SEC - 1) {
    s.phase = 'fail';
    emit(s, EV.fail);
  }
}

export const isOver = (s: State) => s.phase === 'clear' || s.phase === 'fail';

/** 지금 살아 있는 보스 (없으면 null) */
export function activeBoss(s: State) {
  // 끝없는 모드는 보스가 둘 함께 있을 수 있다: 하나가 쓰러져(bossDown) 남은 보스의 체력 바도 보여 준다
  if (s.bossId < 0 || (s.bossDown && !s.endless)) return null;
  for (let i = 0; i < s.enemyHi; i++) if (s.enemies[i].alive && s.enemies[i].boss >= 0) return s.enemies[i];
  return null;
}

/** 아직 나오지 않은 요괴 수 (보스 포함) */
export const pendingSpawns = (s: State) => s.spawns.length - s.spawnI;

// ───────────────────────── 결과 · 다시 돌려 보기 ─────────────────────────

export interface RunSummary extends Omit<RunReport, 'run'> {
  stars: 0 | 1 | 2 | 3;
  /** 도달한 웨이브 (1~6, 시작 전이면 0) */
  wave: number;
  bossDown: boolean;
  /** 배치해 둔 캐릭터 수 */
  towers: number;
  /** 끝없는 모드인가 */
  endless: boolean;
  /** 활약상: 캐릭터별 피해·처치·지원 기여와 오늘의 일꾼 (결과 화면용. 서버에는 올리지 않는다) */
  feats: Feats;
}

/** 명령 기록에서 센 값 (서버의 싼 정합성 검사용): 배치한 횟수 */
export const placedCount = (s: State) => s.log.reduce((n, c) => n + (c.op === 'place' ? 1 : 0), 0);

export function summarize(s: State): RunSummary {
  const cleared = s.phase === 'clear';
  return {
    stage: s.stage.id,
    cleared,
    lives: s.lives,
    startLives: s.startLives,
    time: Math.floor(s.time),
    kills: s.kills,
    placed: placedCount(s),
    cmds: s.log.length,
    bonus: s.bonus,
    codex: {
      enemies: ENEMIES.filter((_, i) => s.seenE & (1 << i)).map((e) => e.id),
      bosses: BOSSES.filter((_, i) => s.seenB & (1 << i)).map((b) => b.id),
    },
    stars: starsOf(cleared, s.lives, s.startLives),
    wave: s.wave + 1,
    bossDown: s.bossDown,
    endless: s.endless,
    towers: s.towers.reduce((n, t) => n + (t.char >= 0 ? 1 : 0), 0),
    feats: featsOf(s),
  };
}

/**
 * 같은 설정과 명령 목록으로 판을 처음부터 다시 돌린다. 명령은 적힌 걸음(tick)에 적용된다.
 * 끝까지(클리어·실패) 또는 명령이 다 떨어진 뒤 maxSec 까지 돌린 상태를 돌려준다.
 */
export function replay(cfg: GameConfig, log: readonly Cmd[], maxSec = 900): State {
  const s = createGame(cfg);
  let i = 0;
  const maxTick = Math.round(maxSec / TICK);
  for (;;) {
    while (i < log.length && log[i].tick <= s.tick) {
      command(s, log[i].op, log[i].slot, log[i].char);
      i++;
    }
    if (s.phase !== 'play' || s.tick >= maxTick) break;
    step(s);
  }
  return s;
}
