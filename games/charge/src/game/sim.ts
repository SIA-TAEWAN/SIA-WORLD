/**
 * 시아돌격대 판 시뮬레이션 (순수 함수 모음, 화면·Phaser와 무관).
 * 화면은 고정 시간 간격(STEP)으로 step() 을 부르고, 상태와 events 를 읽어 그린다.
 * 무작위가 없어서 같은 입력이면 늘 같은 결과가 나온다 (테스트·밸런스 확인용).
 */
import {
  BOSS_STOP,
  CLASH_DIST,
  CRATE_HP,
  ENEMIES,
  GATE_CAP,
  GATE_STEP_DMG,
  HORDE_WAKE,
  MAX_TROOPS,
  METER,
  MOVE_SPEED,
  OBSTACLES,
  POWER_MUL,
  RANGE,
  ROAD_W,
  RUN_SPEED,
  crowdRadius,
  firePower,
  leaderOf,
  type CrateReward,
  type EnemyKind,
  type LeaderDef,
  type ObstacleKind,
} from '../data/balance';
import { NO_MODS, type RunMods } from '../data/growth';
import { ENDLESS_ID, ENDLESS_SEG, endlessSegment, type BossSpec, type Item, type Op, type Span, type StageDef } from '../data/stages';

/** 고정 시간 간격 (초) */
export const STEP = 1 / 60;
const HALF = ROAD_W / 2;
/** 문 사이 틈 (양쪽 문 사이에 서면 아무 문도 지나지 않는다) */
const GATE_PAD = 6;
/** 상자 폭의 절반 */
export const CRATE_HALF = 46;
/** 통나무가 길을 한 번 가로지르는 시간 */
const LOG_PERIOD = 3.2;

export interface Gate {
  id: number;
  /** 같은 줄의 문끼리 같은 번호. 한 줄에서 하나만 통과한다 */
  row: number;
  z: number;
  x0: number;
  x1: number;
  op: Op;
  v: number;
  /** 쌓인 총 피해 (GATE_STEP_DMG 마다 숫자 1) */
  shot: number;
  /** 지나갔거나(이 줄을 이미 통과) 못 쓰게 된 문 */
  used: boolean;
  /** 길게 이어진 작은 문 줄에 속한 문 */
  rail: boolean;
}

export interface Horde {
  id: number;
  z: number;
  x0: number;
  x1: number;
  kind: EnemyKind;
  count: number;
  start: number;
  /** 쌓인 피해 (한 마리 체력만큼 모이면 한 마리 쓰러짐) */
  dmg: number;
  awake: boolean;
  /** 숨어 있다가 나왔는가 (숨는 요괴만 false 로 시작) */
  shown: boolean;
  /** 되살아나기를 이미 썼는가 */
  revived: boolean;
  /** 멀리서 쏘기·문 낮추기에 쓰는 시간 누적 */
  acc: number;
}

export interface Obstacle {
  id: number;
  z: number;
  kind: ObstacleKind;
  x: number;
  done: boolean;
}

export interface Crate {
  id: number;
  z: number;
  x: number;
  hp: number;
  reward: CrateReward;
  broken: boolean;
}

export interface Boss extends BossSpec {
  z: number;
  max: number;
  /** 다음 공격 시각 */
  next: number;
  /** 예고 중인 공격 자리 [x0, x1] 들 (없으면 빈 목록) */
  bands: [number, number][];
  /** 공격 횟수 */
  hits: number;
  /** 싸움을 시작한 시각 */
  since: number;
}

export type Phase = 'run' | 'boss' | 'clear' | 'fail';

export type SimEvent =
  | { type: 'gate'; gate: Gate; before: number; after: number }
  | { type: 'gateUp'; gate: Gate }
  | { type: 'gateDown'; gate: Gate }
  | { type: 'kill'; horde: Horde; n: number }
  | { type: 'emerge'; horde: Horde }
  | { type: 'revive'; horde: Horde }
  | { type: 'clash'; horde: Horde; lost: number; killed: number }
  | { type: 'fire'; horde: Horde; lost: number }
  | { type: 'obstacle'; obstacle: Obstacle; lost: number }
  | { type: 'crate'; crate: Crate }
  | { type: 'bossWarn'; bands: [number, number][] }
  | { type: 'bossHit'; bands: [number, number][]; lost: number }
  | { type: 'burn'; lost: number }
  | { type: 'summon'; horde: Horde }
  | { type: 'bossDown'; boss: Boss }
  /** 고양이 "아홉 목숨": 모두 쓰러졌다가 troops 명으로 다시 일어났다 */
  | { type: 'lives'; troops: number }
  | { type: 'clear' }
  | { type: 'fail' };

/** 이번 간격에 쏜 대상 (화면의 총알 연출용) */
export type ShotTarget = { kind: 'gate' | 'horde' | 'boss' | 'crate'; x: number; z: number } | null;

export interface RunState {
  stage: StageDef;
  endless: boolean;
  leader: LeaderDef;
  mods: RunMods;
  t: number;
  /** 무리 앞쪽 위치 */
  z: number;
  x: number;
  targetX: number;
  troops: number;
  peak: number;
  kills: number;
  lost: number;
  phase: Phase;
  gates: Gate[];
  hordes: Horde[];
  obstacles: Obstacle[];
  crates: Crate[];
  boss: Boss;
  /** 쓰러뜨린 보스 수 (끝없는 모드) */
  bosses: number;
  /** 끝없는 모드에서 지금 구간 번호 */
  segment: number;
  /** 상자에서 얻은 엽전 */
  crateCoins: number;
  /** 화력 강화가 끝나는 시각 */
  powerUntil: number;
  /** 이 시각까지 쏘지 못한다 (야광귀) */
  stunUntil: number;
  /** 남아 있는 불길 (강철이) */
  burns: { band: [number, number]; until: number }[];
  /** 남은 "다시 일어나기" 횟수 (고양이) */
  lives: number;
  shot: ShotTarget;
  /** 지난 step 이후 생긴 일. 화면이 읽고 비운다 */
  events: SimEvent[];
  nextId: number;
  nextRow: number;
}

function spanOf(span: Span): [number, number] {
  switch (span) {
    case 'left':
      return [-HALF, 0];
    case 'right':
      return [0, HALF];
    case 'center':
      return [-HALF / 2, HALF / 2];
    default:
      return [-HALF, HALF];
  }
}

function newHorde(s: RunState, z: number, kind: EnemyKind, count: number, span: Span): Horde {
  const [x0, x1] = spanOf(span);
  const hidden = !!ENEMIES[kind].hidden;
  return { id: s.nextId++, z, x0, x1, kind, count, start: count, dmg: 0, awake: false, shown: !hidden, revived: false, acc: 0 };
}

/** 길 물건 목록을 판 상태에 넣는다 */
function addItems(s: RunState, items: Item[]) {
  for (const it of items) {
    if (it.t === 'gates') {
      const w = ROAD_W / it.gates.length;
      const row = s.nextRow++;
      it.gates.forEach((g, i) => {
        s.gates.push({ id: s.nextId++, row, z: it.z, x0: -HALF + i * w + GATE_PAD, x1: -HALF + (i + 1) * w - GATE_PAD, op: g.op, v: g.v, shot: 0, used: false, rail: false });
      });
    } else if (it.t === 'rail') {
      const [x0, x1] = it.side === 'left' ? [-HALF, -GATE_PAD] : [GATE_PAD, HALF];
      for (let z = it.z0; z <= it.z1; z += it.gap) {
        s.gates.push({ id: s.nextId++, row: s.nextRow++, z, x0, x1, op: it.gate.op, v: it.gate.v, shot: 0, used: false, rail: true });
      }
    } else if (it.t === 'horde') {
      s.hordes.push(newHorde(s, it.z, it.kind, it.count, it.span));
    } else if (it.t === 'obstacle') {
      s.obstacles.push({ id: s.nextId++, z: it.z, kind: it.kind, x: it.x, done: false });
    } else {
      s.crates.push({ id: s.nextId++, z: it.z, x: it.x, hp: CRATE_HP, reward: it.reward, broken: false });
    }
  }
}

const bossOf = (spec: BossSpec, z: number): Boss => ({ ...spec, z, max: spec.hp, next: 0, bands: [], hits: 0, since: 0 });

/** 스테이지 데이터 → 판 상태 */
export function createRun(stage: StageDef, leaderId: string, mods: RunMods = NO_MODS): RunState {
  const leader = leaderOf(leaderId);
  const troops = Math.max(1, Math.round(stage.startTroops * leader.startMul) + mods.startAdd);
  const s: RunState = {
    stage,
    endless: stage.id === ENDLESS_ID,
    leader,
    mods,
    t: 0,
    z: 0,
    x: 0,
    targetX: 0,
    troops,
    peak: troops,
    kills: 0,
    lost: 0,
    phase: 'run',
    gates: [],
    hordes: [],
    obstacles: [],
    crates: [],
    boss: bossOf(stage.boss, stage.bossZ),
    bosses: 0,
    segment: 0,
    crateCoins: 0,
    powerUntil: -1,
    stunUntil: -1,
    burns: [],
    lives: leader.lives,
    shot: null,
    events: [],
    nextId: 0,
    nextRow: 0,
  };
  addItems(s, stage.items);
  return s;
}

/** 문을 지날 때 대원 수 */
export function applyOp(n: number, op: Op, v: number, timesMul = 1): number {
  switch (op) {
    case '+':
      return n + v;
    case '-':
      return n - v;
    case 'x':
      return Math.floor(n * v * timesMul);
    case '/':
      return Math.floor(n / v);
  }
}

/** 좋은 문(파랑)인가: + 와 × 는 좋고 - 와 ÷ 는 나쁘다 */
export const isGood = (op: Op) => op === '+' || op === 'x';
/** 총으로 숫자를 올릴 수 있는 문 */
export const isShootable = (op: Op) => op === '+' || op === '-';

/** 지금 무리가 차지하는 좌우 폭 [왼쪽, 오른쪽] */
export function crowdSpan(s: RunState): [number, number] {
  const r = crowdRadius(s.troops);
  return [s.x - r, s.x + r];
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** 무리 가운데가 갈 수 있는 좌우 끝 (무리가 길 밖으로 나가지 않게) */
export function xLimit(troops: number): number {
  return Math.max(0, HALF - Math.min(crowdRadius(troops), HALF - 24));
}

/** 통나무의 지금 좌우 위치 (길 끝에서 끝으로 오간다) */
export function logX(t: number, id: number): number {
  const p = ((t / LOG_PERIOD + id * 0.37) % 2 + 2) % 2;
  const f = p < 1 ? p : 2 - p;
  return -HALF + 70 + f * (ROAD_W - 140);
}

/** 장애물의 지금 좌우 위치 */
export const obstacleX = (s: RunState, o: Obstacle) => (o.kind === 'log' ? logX(s.t, o.id) : o.x);

/** 손가락이 가리키는 좌우 위치 */
export function setTarget(s: RunState, x: number): void {
  s.targetX = x;
}

function setTroops(s: RunState, n: number) {
  s.troops = Math.max(0, Math.min(MAX_TROOPS, Math.floor(n)));
  s.peak = Math.max(s.peak, s.troops);
}

/** 잃는 대원 (대장 특성 반영, 최소 1) */
function lose(s: RunState, n: number, mul = 1): number {
  if (n <= 0 || s.troops <= 0) return 0;
  const k = Math.min(s.troops, Math.max(1, Math.ceil(n * s.leader.lossMul * mul)));
  setTroops(s, s.troops - k);
  s.lost += k;
  return k;
}

function shootGate(s: RunState, g: Gate, dmg: number) {
  g.shot += dmg * s.leader.gateMul;
  while (g.shot >= GATE_STEP_DMG) {
    g.shot -= GATE_STEP_DMG;
    if (g.op === '+') {
      if (g.v >= GATE_CAP) {
        g.shot = 0;
        break;
      }
      g.v++;
    } else if (g.op === '-') {
      g.v--;
      if (g.v <= 0) {
        g.op = '+';
        g.v = 1;
      }
    }
    s.events.push({ type: 'gateUp', gate: g });
  }
}

function killHorde(s: RunState, h: Horde, n: number) {
  if (n <= 0) return;
  s.kills += n;
  s.events.push({ type: 'kill', horde: h, n });
  const rv = ENEMIES[h.kind].revive;
  if (h.count <= 0 && rv && !h.revived) {
    h.revived = true;
    h.count = Math.max(1, Math.round(h.start * rv));
    h.dmg = 0;
    s.events.push({ type: 'revive', horde: h });
  }
}

function shootHorde(s: RunState, h: Horde, dmg: number) {
  const def = ENEMIES[h.kind];
  let d = dmg * s.leader.hordeMul;
  if (def.shield && Math.abs(s.x - (h.x0 + h.x1) / 2) < def.shield.reach) d *= def.shield.mul;
  h.dmg += d;
  let n = 0;
  while (h.dmg >= def.hp && h.count > 0) {
    h.dmg -= def.hp;
    h.count--;
    n++;
  }
  if (h.count <= 0) h.dmg = 0;
  killHorde(s, h, n);
}

function shootBoss(s: RunState, dmg: number) {
  const b = s.boss;
  let d = dmg * s.leader.bossMul * s.mods.bossMul;
  const tr = b.traits;
  if (tr?.harden) d *= Math.max(0.4, 1 - (s.t - b.since) / 100);
  if (tr?.shield && Math.abs(s.x) < 100) d *= tr.shield;
  b.hp = Math.max(0, b.hp - d);
}

function openCrate(s: RunState, c: Crate) {
  c.broken = true;
  const rw = c.reward;
  const mul = s.leader.crateMul;
  if (rw.kind === 'troops') setTroops(s, s.troops + Math.round(rw.v * mul));
  else if (rw.kind === 'coins') s.crateCoins += Math.round(rw.v * mul);
  else s.powerUntil = Math.max(s.powerUntil, s.t) + rw.sec * mul;
  s.events.push({ type: 'crate', crate: c });
}

/** 지금 화력 (초당) */
export function powerOf(s: RunState): number {
  if (s.t < s.stunUntil) return 0;
  return firePower(s.troops) * s.mods.dmgMul * (s.t < s.powerUntil ? POWER_MUL : 1);
}

/** 가장 가까운 사격 대상을 골라 이번 간격의 화력을 준다 */
function shoot(s: RunState, dt: number) {
  s.shot = null;
  const power = powerOf(s) * dt;
  if (power <= 0) return;
  const reach = s.z + RANGE * s.leader.rangeMul * s.mods.rangeMul;
  const [c0, c1] = crowdSpan(s);
  let best: { z: number; hit: () => void; target: NonNullable<ShotTarget> } | null = null;
  const consider = (z: number, hit: () => void, target: NonNullable<ShotTarget>) => {
    if (z < s.z || z > reach) return;
    if (!best || z < best.z) best = { z, hit, target };
  };
  for (const g of s.gates) {
    if (g.used || !isShootable(g.op) || s.x < g.x0 || s.x > g.x1) continue;
    consider(g.z, () => shootGate(s, g, power), { kind: 'gate', x: (g.x0 + g.x1) / 2, z: g.z });
  }
  for (const h of s.hordes) {
    if (h.count <= 0 || !h.shown || overlap(c0, c1, h.x0, h.x1) <= 0) continue;
    consider(h.z, () => shootHorde(s, h, power), { kind: 'horde', x: Math.max(h.x0, Math.min(h.x1, s.x)), z: h.z });
  }
  for (const c of s.crates) {
    if (c.broken || overlap(c0, c1, c.x - CRATE_HALF, c.x + CRATE_HALF) <= 0) continue;
    consider(c.z, () => {
      c.hp -= power;
      if (c.hp <= 0) openCrate(s, c);
    }, { kind: 'crate', x: c.x, z: c.z });
  }
  if (s.phase === 'boss') consider(s.boss.z, () => shootBoss(s, power), { kind: 'boss', x: 0, z: s.boss.z });
  const b = best as { hit: () => void; target: NonNullable<ShotTarget> } | null;
  if (b) {
    b.hit();
    s.shot = b.target;
  }
}

/** 보스를 쓰러뜨렸다: 스테이지는 클리어, 끝없는 모드는 다음 구간으로 */
function bossDown(s: RunState) {
  s.bosses++;
  s.events.push({ type: 'bossDown', boss: s.boss });
  s.burns = [];
  if (!s.endless) {
    s.phase = 'clear';
    s.events.push({ type: 'clear' });
    return;
  }
  // 지난 구간의 물건은 버리고 다음 구간을 붙인다
  s.gates = s.gates.filter((g) => !g.used && g.z > s.z);
  s.hordes = s.hordes.filter((h) => h.count > 0 && h.z > s.z - 200);
  s.obstacles = [];
  s.crates = [];
  s.segment++;
  const seg = endlessSegment(s.segment);
  addItems(s, seg.items);
  s.boss = bossOf(seg.boss, seg.bossZ);
  s.phase = 'run';
}

/** 보스 공격 자리: 무리 쪽 하나 (double 이면 반대쪽에 하나 더) */
function bossBands(s: RunState): [number, number][] {
  const b = s.boss;
  const w = b.width / 2;
  const clamp = (c: number) => Math.max(-HALF + w, Math.min(HALF - w, c));
  const cx = clamp(s.x);
  const bands: [number, number][] = [[cx - w, cx + w]];
  if (b.traits?.double) {
    const ox = clamp(s.x >= 0 ? s.x - b.width - 40 : s.x + b.width + 40);
    if (Math.abs(ox - cx) >= b.width) bands.push([ox - w, ox + w]);
  }
  return bands;
}

/** 고정 간격 한 번 진행 */
export function step(s: RunState, dt = STEP): void {
  if (s.phase === 'clear' || s.phase === 'fail') return;
  s.t += dt;

  // 좌우 이동 (무리가 길 밖으로 나가지 않게)
  const lim = xLimit(s.troops);
  const tx = Math.max(-lim, Math.min(lim, s.targetX));
  const maxMove = MOVE_SPEED * s.leader.moveMul * dt;
  s.x += Math.max(-maxMove, Math.min(maxMove, tx - s.x));
  s.x = Math.max(-lim, Math.min(lim, s.x));

  // 앞으로 달리기 (보스 앞에서 멈춘다)
  const prevZ = s.z;
  if (s.phase === 'run') {
    s.z += RUN_SPEED * dt;
    if (s.z >= s.boss.z - BOSS_STOP) {
      s.z = s.boss.z - BOSS_STOP;
      s.phase = 'boss';
      s.boss.since = s.t;
      s.boss.next = s.t + s.boss.warn + 0.8;
    }
  }

  // 문 통과: 이번 간격에 지나간 줄마다, 무리 가운데가 서 있는 문 하나만
  for (const g of s.gates) {
    if (g.used || g.z <= prevZ || g.z > s.z) continue;
    const rowGates = s.gates.filter((o) => o.row === g.row);
    for (const o of rowGates) o.used = true;
    const hit = rowGates.find((o) => s.x >= o.x0 && s.x <= o.x1);
    if (hit) {
      const before = s.troops;
      setTroops(s, applyOp(before, hit.op, hit.v, s.leader.timesMul));
      if (s.troops < before) s.lost += before - s.troops;
      s.events.push({ type: 'gate', gate: hit, before, after: s.troops });
    }
  }

  const [c0, c1] = crowdSpan(s);
  const width = Math.max(1, c1 - c0);

  // 장애물: 무리 앞쪽이 지나갈 때 겹친 만큼 잃는다
  for (const o of s.obstacles) {
    if (o.done || o.z <= prevZ || o.z > s.z) continue;
    o.done = true;
    const def = OBSTACLES[o.kind];
    const x = obstacleX(s, o);
    const frac = overlap(c0, c1, x - def.half, x + def.half) / width;
    const lost = frac > 0 ? lose(s, s.troops * frac * def.harm) : 0;
    s.events.push({ type: 'obstacle', obstacle: o, lost });
  }

  // 상자: 부수지 못하고 지나치면 그대로 지나간다
  for (const c of s.crates) if (!c.broken && c.z < s.z - 60) c.broken = true;

  // 요괴 무리: 가까워지면 다가오고, 숨은 요괴는 튀어나오고, 멀리서 쏘는 요괴는 쏜다
  for (const h of s.hordes) {
    if (h.count <= 0) continue;
    const def = ENEMIES[h.kind];
    const dist = h.z - s.z;
    if (!h.awake && dist < HORDE_WAKE) h.awake = true;
    if (!h.shown && def.hidden && dist < def.hidden) {
      h.shown = true;
      s.events.push({ type: 'emerge', horde: h });
    }
    if (!h.awake) continue;
    if (h.shown) h.z -= def.speed * dt;
    h.acc += dt;
    if (def.ranged && h.shown && dist < def.ranged.reach && dist > CLASH_DIST && h.acc >= 1) {
      h.acc -= 1;
      const lost = lose(s, h.count * def.ranged.rate);
      s.events.push({ type: 'fire', horde: h, lost });
    }
    if (def.drain && h.acc >= 1) {
      h.acc -= 1;
      const g = s.gates.filter((o) => !o.used && o.z > s.z && o.z < h.z && isGood(o.op) && o.v > 1).sort((a, b) => a.z - b.z)[0];
      if (g) {
        g.v--;
        s.events.push({ type: 'gateDown', gate: g });
      }
    }
    if (!def.ranged && !def.drain) h.acc = 0;
  }

  shoot(s, dt);

  // 부딪힘: 무리 앞쪽에 닿은 요괴 무리와 한꺼번에 맞바꾼다
  for (const h of s.hordes) {
    if (h.count <= 0 || h.z - s.z > CLASH_DIST) continue;
    if (!h.shown) {
      h.shown = true;
      s.events.push({ type: 'emerge', horde: h });
    }
    if (overlap(c0, c1, h.x0, h.x1) <= 0) {
      // 비켜 갔다: 뒤로 지나간 무리는 없어진다
      if (h.z < s.z - 200) h.count = 0;
      continue;
    }
    const str = ENEMIES[h.kind].strength;
    const mul = s.leader.lossMul * s.leader.clashMul;
    const need = h.count * str;
    const before = h.count;
    let lost: number;
    if (s.troops > need * mul) {
      lost = lose(s, need, s.leader.clashMul);
      h.count = 0;
    } else {
      const killed = Math.min(h.count, Math.ceil(s.troops / (str * mul)));
      lost = s.troops;
      setTroops(s, 0);
      s.lost += lost;
      h.count -= killed;
    }
    s.kills += before - h.count;
    s.events.push({ type: 'clash', horde: h, lost, killed: before - h.count });
  }

  // 남은 불길 (강철이): 그 자리에 서 있으면 초마다 15%
  if (s.burns.length) {
    s.burns = s.burns.filter((b) => b.until > s.t);
    for (const b of s.burns) {
      const frac = overlap(c0, c1, b.band[0], b.band[1]) / width;
      if (frac > 0) {
        const lost = lose(s, s.troops * frac * 0.15 * dt, s.leader.bossLossMul);
        if (lost > 0) s.events.push({ type: 'burn', lost });
      }
    }
  }

  // 보스: 예고 → 공격 (+ 불러내기)
  if (s.phase === 'boss' && s.troops > 0 && s.boss.hp > 0) {
    const b = s.boss;
    if (!b.bands.length && s.t >= b.next - b.warn - s.leader.warnAdd) {
      b.bands = bossBands(s);
      s.events.push({ type: 'bossWarn', bands: b.bands });
    }
    if (b.bands.length && s.t >= b.next) {
      const [a0, a1] = crowdSpan(s);
      const w = Math.max(1, a1 - a0);
      const frac = Math.min(1, b.bands.reduce((acc, bd) => acc + overlap(a0, a1, bd[0], bd[1]), 0) / w);
      const lost = frac > 0 ? lose(s, s.troops * b.frac * frac, s.leader.bossLossMul) : 0;
      if (lost > 0 && b.traits?.freeze) s.stunUntil = s.t + b.traits.freeze;
      if (b.traits?.burn) for (const bd of b.bands) s.burns.push({ band: bd, until: s.t + b.traits.burn });
      s.events.push({ type: 'bossHit', bands: b.bands, lost });
      b.bands = [];
      b.hits++;
      b.next = s.t + b.every;
      const sm = b.traits?.summon;
      if (sm && b.hits % sm.every === 0) {
        const h = newHorde(s, b.z - 120, sm.kind, sm.count, 'full');
        h.awake = true;
        s.hordes.push(h);
        s.events.push({ type: 'summon', horde: h });
      }
    }
  }

  if (s.troops <= 0 && s.lives > 0) {
    // 고양이 "아홉 목숨": 한 번, 이번 판 최대 대원의 일부로 다시 일어난다
    s.lives--;
    setTroops(s, Math.max(s.leader.livesMin, Math.round(s.peak * s.leader.livesFrac)));
    s.events.push({ type: 'lives', troops: s.troops });
  }
  if (s.troops <= 0) {
    s.phase = 'fail';
    s.events.push({ type: 'fail' });
  } else if (s.phase === 'boss' && s.boss.hp <= 0) {
    bossDown(s);
  }
}

/** 별 개수 (클리어 못 했으면 0) */
export function starsFor(s: RunState): number {
  if (s.phase !== 'clear') return 0;
  return starsOf(s.stage, s.troops);
}

export function starsOf(stage: StageDef, troops: number): number {
  const [two, three] = stage.stars;
  return troops >= three ? 3 : troops >= two ? 2 : 1;
}

/** 진행도 0~1 (보스 앞 멈추는 곳까지. 끝없는 모드는 지금 구간 안에서) */
export function progressOf(s: RunState): number {
  const z0 = s.endless ? s.segment * ENDLESS_SEG : 0;
  return Math.max(0, Math.min(1, (s.z - z0) / Math.max(1, s.boss.z - BOSS_STOP - z0)));
}

/** 끝없는 모드: 달린 거리 (m) */
export const metersOf = (s: RunState) => Math.floor(s.z / METER);
