/**
 * 시아돌격대 판 시뮬레이션 (순수 함수 모음, 화면·Phaser와 무관).
 * 화면은 고정 시간 간격(STEP)으로 step() 을 부르고, 상태와 events 를 읽어 그린다.
 * 무작위가 없어서 같은 입력이면 늘 같은 결과가 나온다 (테스트·나중의 서버 검증용).
 */
import {
  BOSS_STOP,
  CLASH_DIST,
  ENEMIES,
  GATE_CAP,
  GATE_STEP_DMG,
  HORDE_WAKE,
  MAX_TROOPS,
  MOVE_SPEED,
  RANGE,
  ROAD_W,
  RUN_SPEED,
  crowdRadius,
  firePower,
  leaderOf,
  type EnemyKind,
  type LeaderDef,
} from '../data/balance';
import type { BossSpec, Op, Span, StageDef } from '../data/stages';

/** 고정 시간 간격 (초) */
export const STEP = 1 / 60;
const HALF = ROAD_W / 2;
/** 문 사이 틈 (양쪽 문 사이에 서면 아무 문도 지나지 않는다) */
const GATE_PAD = 6;

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
}

export interface Boss extends BossSpec {
  z: number;
  max: number;
  /** 다음 공격 시각 */
  next: number;
  /** 예고 중인 공격 자리 [x0, x1] (없으면 null) */
  band: [number, number] | null;
}

export type Phase = 'run' | 'boss' | 'clear' | 'fail';

export type SimEvent =
  | { type: 'gate'; gate: Gate; before: number; after: number }
  | { type: 'gateUp'; gate: Gate }
  | { type: 'kill'; horde: Horde; n: number }
  | { type: 'clash'; horde: Horde; lost: number; killed: number }
  | { type: 'bossWarn'; band: [number, number] }
  | { type: 'bossHit'; band: [number, number]; lost: number }
  | { type: 'clear' }
  | { type: 'fail' };

/** 이번 간격에 쏜 대상 (화면의 총알 연출용) */
export type ShotTarget = { kind: 'gate' | 'horde' | 'boss'; x: number; z: number } | null;

export interface RunState {
  stage: StageDef;
  leader: LeaderDef;
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
  boss: Boss;
  shot: ShotTarget;
  /** 지난 step 이후 생긴 일. 화면이 읽고 비운다 */
  events: SimEvent[];
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

/** 스테이지 데이터 → 판 상태 */
export function createRun(stage: StageDef, leaderId: string): RunState {
  const leader = leaderOf(leaderId);
  const gates: Gate[] = [];
  const hordes: Horde[] = [];
  let id = 0;
  let row = 0;
  for (const it of stage.items) {
    if (it.t === 'gates') {
      const w = ROAD_W / it.gates.length;
      it.gates.forEach((g, i) => {
        gates.push({ id: id++, row, z: it.z, x0: -HALF + i * w + GATE_PAD, x1: -HALF + (i + 1) * w - GATE_PAD, op: g.op, v: g.v, shot: 0, used: false, rail: false });
      });
      row++;
    } else if (it.t === 'rail') {
      const [x0, x1] = it.side === 'left' ? [-HALF, -GATE_PAD] : [GATE_PAD, HALF];
      for (let z = it.z0; z <= it.z1; z += it.gap) {
        gates.push({ id: id++, row: row++, z, x0, x1, op: it.gate.op, v: it.gate.v, shot: 0, used: false, rail: true });
      }
    } else {
      const [x0, x1] = spanOf(it.span);
      hordes.push({ id: id++, z: it.z, x0, x1, kind: it.kind, count: it.count, start: it.count, dmg: 0, awake: false });
    }
  }
  const troops = Math.max(1, Math.round(stage.startTroops * leader.startMul));
  return {
    stage,
    leader,
    t: 0,
    z: 0,
    x: 0,
    targetX: 0,
    troops,
    peak: troops,
    kills: 0,
    lost: 0,
    phase: 'run',
    gates,
    hordes,
    boss: { ...stage.boss, z: stage.bossZ, max: stage.boss.hp, next: 0, band: null },
    shot: null,
    events: [],
  };
}

/** 문을 지날 때 대원 수 */
export function applyOp(n: number, op: Op, v: number): number {
  switch (op) {
    case '+':
      return n + v;
    case '-':
      return n - v;
    case 'x':
      return n * v;
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

/** 손가락이 가리키는 좌우 위치 */
export function setTarget(s: RunState, x: number): void {
  s.targetX = x;
}

function setTroops(s: RunState, n: number) {
  s.troops = Math.max(0, Math.min(MAX_TROOPS, Math.floor(n)));
  s.peak = Math.max(s.peak, s.troops);
}

/** 잃는 대원 (대장 특성 반영, 최소 1) */
function lose(s: RunState, n: number): number {
  if (n <= 0) return 0;
  const k = Math.min(s.troops, Math.max(1, Math.ceil(n * s.leader.lossMul)));
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

function shootHorde(s: RunState, h: Horde, dmg: number) {
  const hp = ENEMIES[h.kind].hp;
  h.dmg += dmg * s.leader.hordeMul;
  let n = 0;
  while (h.dmg >= hp && h.count > 0) {
    h.dmg -= hp;
    h.count--;
    n++;
  }
  if (h.count <= 0) h.dmg = 0;
  if (n > 0) {
    s.kills += n;
    s.events.push({ type: 'kill', horde: h, n });
  }
}

/** 가장 가까운 사격 대상을 골라 이번 간격의 화력을 준다 */
function shoot(s: RunState, dt: number) {
  s.shot = null;
  const power = firePower(s.troops) * dt;
  if (power <= 0) return;
  const reach = s.z + RANGE * s.leader.rangeMul;
  const [c0, c1] = crowdSpan(s);
  let best: { z: number; hit: () => void; target: NonNullable<ShotTarget> } | null = null;
  for (const g of s.gates) {
    if (g.used || !isShootable(g.op) || g.z < s.z || g.z > reach) continue;
    if (s.x < g.x0 || s.x > g.x1) continue;
    if (!best || g.z < best.z) best = { z: g.z, hit: () => shootGate(s, g, power), target: { kind: 'gate', x: (g.x0 + g.x1) / 2, z: g.z } };
  }
  for (const h of s.hordes) {
    if (h.count <= 0 || h.z < s.z || h.z > reach) continue;
    if (overlap(c0, c1, h.x0, h.x1) <= 0) continue;
    if (!best || h.z < best.z) best = { z: h.z, hit: () => shootHorde(s, h, power), target: { kind: 'horde', x: Math.max(h.x0, Math.min(h.x1, s.x)), z: h.z } };
  }
  if (s.phase === 'boss' && (!best || s.boss.z < best.z)) {
    best = { z: s.boss.z, hit: () => (s.boss.hp = Math.max(0, s.boss.hp - power * s.leader.bossMul)), target: { kind: 'boss', x: 0, z: s.boss.z } };
  }
  if (best) {
    best.hit();
    s.shot = best.target;
  }
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
      setTroops(s, applyOp(before, hit.op, hit.v));
      if (s.troops < before) s.lost += before - s.troops;
      s.events.push({ type: 'gate', gate: hit, before, after: s.troops });
    }
  }

  // 요괴 무리: 가까워지면 다가온다
  for (const h of s.hordes) {
    if (h.count <= 0) continue;
    if (!h.awake && h.z - s.z < HORDE_WAKE) h.awake = true;
    if (h.awake) h.z -= ENEMIES[h.kind].speed * dt;
  }

  shoot(s, dt);

  // 부딪힘: 무리 앞쪽에 닿은 요괴 무리와 한꺼번에 맞바꾼다
  const [c0, c1] = crowdSpan(s);
  for (const h of s.hordes) {
    if (h.count <= 0 || h.z - s.z > CLASH_DIST) continue;
    if (overlap(c0, c1, h.x0, h.x1) <= 0) {
      // 비켜 갔다: 뒤로 지나간 무리는 없어진다
      if (h.z < s.z - 200) h.count = 0;
      continue;
    }
    const str = ENEMIES[h.kind].strength;
    const need = h.count * str;
    const before = h.count;
    let lost: number;
    if (s.troops * 1 > need * s.leader.lossMul) {
      lost = lose(s, need);
      h.count = 0;
    } else {
      const killed = Math.min(h.count, Math.ceil(s.troops / (str * s.leader.lossMul)));
      lost = s.troops;
      setTroops(s, 0);
      s.lost += lost;
      h.count -= killed;
    }
    s.kills += before - h.count;
    s.events.push({ type: 'clash', horde: h, lost, killed: before - h.count });
  }

  // 보스: 예고 → 공격
  if (s.phase === 'boss' && s.troops > 0 && s.boss.hp > 0) {
    const b = s.boss;
    if (!b.band && s.t >= b.next - b.warn) {
      const w = b.width / 2;
      const cx = Math.max(-HALF + w, Math.min(HALF - w, s.x));
      b.band = [cx - w, cx + w];
      s.events.push({ type: 'bossWarn', band: b.band });
    }
    if (b.band && s.t >= b.next) {
      const [a0, a1] = crowdSpan(s);
      const width = Math.max(1, a1 - a0);
      const frac = overlap(a0, a1, b.band[0], b.band[1]) / width;
      const lost = frac > 0 ? lose(s, s.troops * b.frac * frac) : 0;
      s.events.push({ type: 'bossHit', band: b.band, lost });
      b.band = null;
      b.next = s.t + b.every;
    }
  }

  if (s.troops <= 0) {
    s.phase = 'fail';
    s.events.push({ type: 'fail' });
  } else if (s.phase === 'boss' && s.boss.hp <= 0) {
    s.phase = 'clear';
    s.events.push({ type: 'clear' });
  }
}

/** 별 개수 (클리어 못 했으면 0) */
export function starsFor(s: RunState): number {
  if (s.phase !== 'clear') return 0;
  const [two, three] = s.stage.stars;
  return s.troops >= three ? 3 : s.troops >= two ? 2 : 1;
}

/** 진행도 0~1 (보스 앞 멈추는 곳까지) */
export function progressOf(s: RunState): number {
  return Math.max(0, Math.min(1, s.z / (s.boss.z - BOSS_STOP)));
}
