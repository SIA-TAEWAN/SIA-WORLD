import { BOSS_AT, BOSS_WARN_SEC, LIMIT, MAX_LV, RUN_SEC, SELL_RATE, SQUAD_SIZE, START_LIVES, STUN_GUARD_SEC, TICK, WAVES, WAVE_HP, WAVE_SEC } from '../data/balance';
import { BOSSES, BOSS_INDEX } from '../data/bosses';
import { TOWERS, TOWER_INDEX, type TowerLevel } from '../data/characters';
import { ENEMIES, ENEMY_INDEX } from '../data/enemies';
import { levelMods, upgradeMods } from '../data/growth';
import { stageOf, type StageDef } from '../data/stages';
import { BOSS_ACTS } from './bosses';
import { burn, placeOnRoute, spawnEnemy } from './core';
import { buildRoute, cellX, cellY } from './path';
import { starsOf, type RunReport } from './progress';
import { makeRng } from './rng';
import { EV, FX, addFx, drop, emit, makeEnemy, makeEv, makeFx, makePool, makeProj, makeTower, type Cmd, type GameConfig, type Spawn, type State } from './state';
import { ATTACKS, stepProjectile } from './towers';

/**
 * 한 판의 계산. 화면 없이 돌아가는 순수 모듈이다:
 *   createGame(설정) → [command(명령) …] → step() 을 1/60초마다 → phase 가 clear / fail 이 되면 끝.
 * 시작 전(prep)에는 step 이 아무것도 하지 않는다 (시간이 흐르지 않는다). 'start' 명령으로 3분 타이머가 돈다.
 * 받은 명령은 state.log 에 쌓이고, replay(설정, log) 는 같은 판을 그대로 다시 만든다 (테스트·밸런스·서버 검증용).
 */

const WAVE_TICKS = Math.round(WAVE_SEC / TICK);
/** 다른 요괴가 빠르게 해 줄 때의 속도 배율 (수문장 대장) · 표식이 찍힌 캐릭터의 공격 속도 배율 (저승사자) */
export const RUSH_MUL = 1.4;
export const MARK_MUL = 0.5;

/** given: 스테이지 데이터를 직접 준다 (아직 목록에 없는 스테이지를 시험할 때 — scripts/gen-stages.ts) */
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
  // 웨이브를 등장 시각 순서로 펴 둔다
  const spawns: Spawn[] = [];
  stage.waves.slice(0, WAVES).forEach((w, wi) => {
    const hpMul = stage.hp * (w.hp ?? WAVE_HP[wi] ?? 1);
    for (const g of w.groups) {
      const kind = ENEMY_INDEX[g.enemy];
      if (kind === undefined) throw new Error(`unknown enemy: ${g.enemy}`);
      // 공중 요괴는 길을 적지 않으면 공중 경로로 온다
      const fly = !!ENEMIES[kind].air;
      if (fly && g.route === undefined && sky < 0) throw new Error(`${stage.id}: ${g.enemy} needs an air route`);
      for (let k = 0; k < g.count; k++) {
        const route = g.route === 'alt' ? ground[k % ground.length] : (g.route ?? (fly ? sky : 0));
        spawns.push({ t: wi * WAVE_SEC + g.at + k * g.gap, kind, boss: -1, route, hpMul });
      }
    }
  });
  let bossId = -1;
  let bossAt = -1;
  if (stage.boss) {
    bossId = BOSS_INDEX[stage.boss.id];
    if (bossId === undefined) throw new Error(`unknown boss: ${stage.boss.id}`);
    bossAt = stage.boss.at ?? BOSS_AT;
    spawns.push({ t: bossAt, kind: -1, boss: bossId, route: stage.boss.route ?? 0, hpMul: stage.boss.hp ?? 1 });
  }
  // 같은 시각이면 적어 둔 순서 그대로 (sort 는 순서를 지킨다)
  spawns.sort((a, b) => a.t - b.t);
  const um = upgradeMods(cfg.upgrades);
  const lives = (stage.lives ?? START_LIVES) + um.lives;
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
    energy: Math.floor(stage.energy * um.energy + 1e-6),
    kills: 0,
    bonus: 0,
    wave: -1,
    spawns,
    spawnI: 0,
    bossId,
    bossAt,
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
  };
}

// ───────────────────────── 명령: 배치 · 강화 · 되팔기 · 시작 ─────────────────────────

const open = (s: State) => s.phase === 'prep' || s.phase === 'play';

/** 그 칸의 캐릭터가 지금 단계에서 쓰는 수치 (빈 칸이면 null) */
export function towerLevel(s: State, slot: number): TowerLevel | null {
  const tw = s.towers[slot];
  return tw && tw.char >= 0 ? s.lv[tw.char][tw.lv - 1] : null;
}

export function canPlace(s: State, slot: number, char: number): boolean {
  const tw = s.towers[slot];
  return open(s) && !!tw && tw.char < 0 && tw.off <= 0 && s.squad.includes(char) && s.energy >= s.cost[char];
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

/** 닭의 지원: 캐릭터마다, 자기를 사거리 안에 둔 닭 가운데 가장 큰 공격 속도 보너스를 받는다 (배치가 바뀔 때마다 다시 센다) */
function refreshHaste(s: State) {
  for (let i = 0; i < s.towers.length; i++) {
    const tw = s.towers[i];
    tw.haste = 0;
    if (tw.char < 0) continue;
    for (let j = 0; j < s.towers.length; j++) {
      const o = s.towers[j];
      if (j === i || o.char < 0) continue;
      const L = s.lv[o.char][o.lv - 1];
      if (!L.haste || L.haste <= tw.haste) continue;
      const dx = s.slotX[i] - s.slotX[j];
      const dy = s.slotY[i] - s.slotY[j];
      if (dx * dx + dy * dy <= L.range * L.range) tw.haste = L.haste;
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
      tw.face = s.slotX[slot] > cellX(4) ? -1 : 1;
      emit(s, EV.place, slot, char, s.slotX[slot], s.slotY[slot]);
      break;
    }
    case 'upgrade': {
      const cost = upgradeCost(s, slot);
      if (cost === null || s.energy < cost) return false;
      s.energy -= cost;
      tw.lv++;
      tw.spent += cost;
      emit(s, EV.upgrade, slot, tw.char, s.slotX[slot], s.slotY[slot]);
      break;
    }
    case 'sell': {
      if (!tw || tw.char < 0) return false;
      s.energy += sellValue(s, slot);
      emit(s, EV.sell, slot, tw.char, s.slotX[slot], s.slotY[slot]);
      tw.char = -1;
      tw.lv = 0;
      tw.spent = 0;
      break;
    }
    default:
      return false;
  }
  if (op !== 'start') refreshHaste(s);
  s.log.push({ tick: s.tick, op, slot, char });
  return true;
}

// ───────────────────────── 한 걸음 ─────────────────────────

export function step(s: State) {
  s.evN = 0;
  if (s.phase !== 'play') return;
  s.tick++;
  s.time = s.tick * TICK;

  // 웨이브: 30초마다 다음 웨이브 (3분 뒤로는 마지막 웨이브 그대로)
  const wave = Math.min(WAVES - 1, Math.floor((s.tick - 1) / WAVE_TICKS));
  if (wave !== s.wave) {
    s.wave = wave;
    emit(s, EV.wave, wave);
    // 돼지: 웨이브가 시작될 때마다 기운을 번다 (3단계는 엽전도)
    for (let slot = 0; slot < s.towers.length; slot++) {
      const tw = s.towers[slot];
      if (tw.char < 0) continue;
      const L = s.lv[tw.char][tw.lv - 1];
      if (!L.income) continue;
      s.energy += L.income;
      s.bonus += L.coin ?? 0;
      tw.since = 0;
      emit(s, EV.income, L.income, slot, s.slotX[slot], s.slotY[slot]);
    }
  }
  if (s.bossAt >= 0 && !s.bossWarned && s.time >= s.bossAt - BOSS_WARN_SEC) {
    s.bossWarned = true;
    emit(s, EV.bossWarn, s.bossId);
  }

  // 등장 (자리가 없으면 다음 걸음에 다시)
  while (s.spawnI < s.spawns.length && s.spawns[s.spawnI].t <= s.time + 1e-9) {
    const sp = s.spawns[s.spawnI];
    const e = spawnEnemy(s, sp.kind, sp.boss, sp.route, sp.hpMul);
    if (!e) break;
    s.spawnI++;
    if (sp.boss >= 0) emit(s, EV.bossIn, sp.boss, 0, e.x, e.y);
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
    if (e.flash > 0) e.flash -= TICK;
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
    if (ATTACKS[def.kind](s, slot, tw, L)) {
      tw.cd = L.every;
      tw.since = 0;
      emit(s, EV.fire, tw.char, slot);
    } else tw.cd = 0;
  }

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
  if (s.spawnI >= s.spawns.length && s.enemyN === 0 && s.time >= RUN_SEC) {
    s.phase = 'clear';
    emit(s, EV.clear);
  }
}

export const isOver = (s: State) => s.phase === 'clear' || s.phase === 'fail';

/** 지금 살아 있는 보스 (없으면 null) */
export function activeBoss(s: State) {
  if (s.bossId < 0 || s.bossDown) return null;
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
    stars: starsOf(cleared, s.lives, s.startLives),
    wave: s.wave + 1,
    bossDown: s.bossDown,
    towers: s.towers.reduce((n, t) => n + (t.char >= 0 ? 1 : 0), 0),
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
