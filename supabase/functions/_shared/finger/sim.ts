import { COS45, closestOnSeg, dirOf, dist2, normAngle } from './math.ts';
import { comboEffect, specialEffect } from './skills.ts';
import type { AttackKind } from './enemies.ts';
import type { ComboKind, HeroId, HeroType, SpecialKind } from './heroes.ts';

/**
 * 시아핑거 판 시뮬레이션 (PRD "핵심 판"). 순수 TypeScript · 무작위 없음 · 1/60초 고정 간격.
 * 화면(games/finger)은 매 프레임 stepShot 을 한두 번 돌리며 그리고, 서버(finger-finish)는 replayRun 으로
 * 같은 조작을 처음부터 다시 돌려 결과를 계산한다. 둘이 같은 파일을 쓰므로 결과가 비트 단위로 같다.
 *
 * 한 턴: beginShot(조작) → stepShot 을 shotDone 이 될 때까지 → endTurn (요괴 차례·다음 대원).
 */

export const STEP = 1 / 60;
/** 한 번 쏜 뒤 이 스텝(6초)이 지나면 강제로 멈춘다 */
export const MAX_SHOT_STEPS = 360;
/** 한 판 최대 턴 (넘으면 실패) */
export const MAX_TURNS = 40;
/** 대원 반지름 */
export const HERO_R = 30;
/** 힘 1 → 가장 느린 속도, 힘 100 → 가장 빠른 속도 (px/초) */
export const SPEED_MIN = 800;
export const SPEED_MAX = 2100;
/** 마찰: 초당 감속 = FRIC_LIN + FRIC_K × 속도 (힘 100 ≈ 3.2초, 힘 1 ≈ 2초 뒤 멈춤) */
export const FRIC_LIN = 140;
export const FRIC_K = 0.75;
/** 이 속도 아래로 떨어지면 멈춘다 */
export const STOP_V = 25;
/** 한 서브스텝에 움직이는 최대 거리 (터널링 방지) */
const SUB_PX = 6;
const MAX_SUB = 24;
/** 회복 구슬·엽전 주머니 반지름 */
export const PICK_R = 18;
/** 조작 입력 범위 */
export const POWER_MAX = 100;

// ---------- 설정 (직렬화 가능한 값) ----------

/** 판에 들어가는 대원 하나 (레벨·강화가 반영된 값) */
export interface HeroInit {
  id: HeroId;
  type: HeroType;
  hp: number;
  atk: number;
  combo: ComboKind;
  comboTier: number;
  special: SpecialKind;
  chargeMax: number;
  charge0: number;
  healMul: number;
}

/** 판에 나오는 요괴 하나 */
export interface FoeInit {
  /** 요괴 종류(EnemyKind) 또는 보스 id */
  kind: string;
  name: string;
  art: string;
  /** 0 = 일반 · 1 = 작은 대장 · 2 = 지역 보스 */
  rank: 0 | 1 | 2;
  x: number;
  y: number;
  r: number;
  hp: number;
  atk: number;
  cd: number;
  pattern: AttackKind[];
  area: number;
  /** 약점 방향 (0.1° 단위) 또는 null */
  weak: number | null;
  drop: 'heal' | 'coin' | null;
}

/** 벽 선분 [ax, ay, bx, by] */
export type Seg = [number, number, number, number];

export interface RunConfig {
  v: 1;
  stage: string;
  mode: 'normal';
  /** 방 크기 */
  w: number;
  h: number;
  /** 방 테두리 + 돌기둥 선분 */
  walls: Seg[];
  /** 쏘는 순서대로 1~4명 */
  party: HeroInit[];
  waves: FoeInit[][];
  /** 별 하나: 이 턴 안에 클리어 */
  par: number;
  maxTurns: number;
}

/** 한 턴 조작: 각도(0.1° 단위 0~3599, 0 = 오른쪽, 900 = 아래) · 힘(1~100) · 필살기(0|1) */
export interface ShotInput {
  a: number;
  p: number;
  s: 0 | 1;
}

// ---------- 상태 ----------

export interface Hero extends HeroInit {
  x: number;
  y: number;
  r: number;
  maxHp: number;
  charge: number;
  fallen: boolean;
  /** 보호막: 다음 피해 반 (한 번) */
  shield: boolean;
}

export interface Foe extends FoeInit {
  id: number;
  maxHp: number;
  /** 다음 공격까지 남은 턴 (머리 위 숫자) */
  left: number;
  /** pattern 에서 다음 공격 순번 */
  pi: number;
  alive: boolean;
  /** area 공격이 떨어질 자리 (한 턴 전에 정해져 보인다) */
  aim: [number, number] | null;
  /** 독: 요괴 차례마다 이만큼 피해 (poisonTurns 턴 동안) */
  poison: number;
  poisonTurns: number;
  /** 똬리: 이 횟수만큼 요괴 차례를 건너뛴다 (숫자가 줄지 않고 공격하지 않음) */
  frozen: number;
}

export interface Mover {
  /** 날아가는 대원 번호 */
  hero: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  atk: number;
  pierce: boolean;
  /** 지금 닿아 있는 요괴 id (닿기 시작할 때 한 번만 때린다) */
  touching: number[];
  /** 이번 발사에서 벽에 튕긴 횟수 */
  bounces: number;
  stopped: boolean;
  /** 멈추기 직전 방향 */
  dx: number;
  dy: number;
  /** 처음 속도 */
  v0: number;
  /** 원숭이 분신 (콤보·줍기 없음, 발사가 끝나면 사라진다) */
  clone: boolean;
  /** 말 질주: 멈추면 한 번 더 달린다 */
  rerun: boolean;
  /** 돼지 굴러가기: 벽에 튕길수록 피해 커짐 */
  roll: boolean;
}

export interface Pickup {
  id: number;
  kind: 'heal' | 'coin';
  x: number;
  y: number;
}

export type Phase = 'aim' | 'shot' | 'settle' | 'clear' | 'fail';

export interface RunState {
  cfg: RunConfig;
  phase: Phase;
  /** 쓴 턴 (쏜 횟수) */
  turn: number;
  /** 이번에 쏠 대원 번호 */
  cur: number;
  heroes: Hero[];
  foes: Foe[];
  /** 지금 웨이브 (0부터) */
  wave: number;
  movers: Mover[];
  pickups: Pickup[];
  nextId: number;
  /** 이번 발사에서 지난 스텝 */
  shotSteps: number;
  /** 지금까지 돌린 스텝 전체 */
  steps: number;
  /** 주운 엽전 */
  coins: number;
  kills: number;
  /** 한 번이라도 쓰러진 대원이 있었나 (별 하나) */
  everFell: boolean;
  /** 지금까지의 조작 (서버로 보낸다) */
  log: ShotInput[];
  /** 이번 발사에서 우정 콤보를 쓴 대원 (한 발사에 아군마다 한 번) */
  comboUsed: number[];
  /** 양털 장막: 남은 요괴 차례 동안 받는 피해 반 */
  guardTurns: number;
}

// ---------- 이벤트 (소리·효과용) ----------

export type SimEvent =
  | { t: 'shot'; hero: number; a: number; p: number }
  | { t: 'wall'; x: number; y: number; n: number }
  | { t: 'hit'; id: number; dmg: number; x: number; y: number; weak: boolean }
  | { t: 'kill'; id: number; x: number; y: number }
  | { t: 'pick'; kind: 'heal' | 'coin'; x: number; y: number; hero: number; v: number }
  | { t: 'drop'; kind: 'heal' | 'coin'; x: number; y: number }
  | { t: 'stop'; hero: number }
  | { t: 'combo'; hero: number; kind: ComboKind; x: number; y: number; r: number; lines: [number, number, number, number][]; targets: number[] }
  | { t: 'special'; hero: number; kind: SpecialKind }
  | { t: 'dash'; hero: number }
  | { t: 'revive'; hero: number }
  | { t: 'heal'; hero: number; v: number }
  | { t: 'attack'; id: number; kind: AttackKind; x: number; y: number; area: number; hits: { hero: number; dmg: number }[] }
  | { t: 'fall'; hero: number }
  | { t: 'wave'; n: number }
  | { t: 'clear' }
  | { t: 'fail'; why: 'fallen' | 'turns' };

// ---------- 만들기 ----------

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createRun(cfg: RunConfig): RunState {
  const n = cfg.party.length;
  const heroes: Hero[] = cfg.party.map((h, i) => ({
    ...clone(h),
    x: (cfg.w * (i + 1)) / (n + 1),
    y: cfg.h - 80,
    r: HERO_R,
    maxHp: h.hp,
    charge: h.charge0,
    fallen: false,
    shield: false,
  }));
  const s: RunState = {
    cfg,
    phase: 'aim',
    turn: 0,
    cur: 0,
    heroes,
    foes: [],
    wave: 0,
    movers: [],
    pickups: [],
    nextId: 1,
    shotSteps: 0,
    steps: 0,
    coins: 0,
    kills: 0,
    everFell: false,
    log: [],
    comboUsed: [],
    guardTurns: 0,
  };
  spawnWave(s, 0);
  return s;
}

function spawnWave(s: RunState, w: number) {
  s.wave = w;
  s.foes = s.cfg.waves[w].map((f) => ({ ...clone(f), id: s.nextId++, maxHp: f.hp, left: f.cd, pi: 0, alive: true, aim: null, poison: 0, poisonTurns: 0, frozen: 0 }));
  for (const h of s.heroes) if (!h.fallen) settle(s, h);
  lockAims(s);
}

/** 상태 복사 (설정은 같이 쓴다) — 자동 플레이어가 수를 미리 돌려 볼 때 */
export function cloneRun(s: RunState): RunState {
  const { cfg, ...rest } = s;
  return { ...(JSON.parse(JSON.stringify(rest)) as Omit<RunState, 'cfg'>), cfg };
}

// ---------- 쏘기 ----------

/** 조작 값을 정수 범위로 (서버도 같은 값으로 다시 돌린다) */
export function normInput(i: ShotInput): ShotInput {
  const p = Math.max(1, Math.min(POWER_MAX, Math.round(Number(i.p) || 0)));
  return { a: normAngle(Number(i.a) || 0), p, s: i.s === 1 ? 1 : 0 };
}

/** 힘 → 처음 속도 */
export const speedOf = (p: number) => SPEED_MIN + ((SPEED_MAX - SPEED_MIN) * (p - 1)) / (POWER_MAX - 1);

/** 이번 차례 대원이 필살기를 쓸 수 있나 */
export const canSpecial = (s: RunState) => s.phase === 'aim' && s.heroes[s.cur].charge >= s.heroes[s.cur].chargeMax;

/** 쏜다. 조준 중이 아니면 아무것도 하지 않는다 */
export function beginShot(s: RunState, input: ShotInput): SimEvent[] {
  const ev: SimEvent[] = [];
  if (s.phase !== 'aim') return ev;
  const inp = normInput(input);
  s.log.push(inp);
  const h = s.heroes[s.cur];
  const [dx, dy] = dirOf(inp.a);
  const v0 = speedOf(inp.p);
  s.movers = [
    { hero: s.cur, x: h.x, y: h.y, vx: dx * v0, vy: dy * v0, r: h.r, atk: h.atk, pierce: h.type === 'pierce', touching: [], bounces: 0, stopped: false, dx, dy, v0, clone: false, rerun: false, roll: false },
  ];
  s.comboUsed = [];
  s.shotSteps = 0;
  s.phase = 'shot';
  ev.push({ t: 'shot', hero: s.cur, a: inp.a, p: inp.p });
  if (inp.s === 1 && h.charge >= h.chargeMax) {
    h.charge = 0;
    ev.push({ t: 'special', hero: s.cur, kind: h.special });
    specialEffect(s, s.cur, inp.a, ev);
  }
  return ev;
}

/** 날아가는 중 한 스텝 (1/60초). 이번 스텝의 이벤트를 돌려준다 */
export function stepShot(s: RunState): SimEvent[] {
  const ev: SimEvent[] = [];
  if (s.phase !== 'shot') return ev;
  s.shotSteps++;
  s.steps++;
  for (const m of s.movers) if (!m.stopped) moveOne(s, m, ev);
  if (s.shotSteps >= MAX_SHOT_STEPS) for (const m of s.movers) stopMover(m);
  const main = s.movers[0];
  if (main.stopped && main.rerun && s.shotSteps < MAX_SHOT_STEPS) {
    // 말 질주: 멈춘 방향으로 처음 속도의 70% 로 한 번 더
    main.rerun = false;
    main.stopped = false;
    main.vx = main.dx * main.v0 * 0.7;
    main.vy = main.dy * main.v0 * 0.7;
    main.touching = [];
    ev.push({ t: 'dash', hero: main.hero });
  }
  if (s.movers.every((m) => m.stopped)) {
    const m = s.movers[0];
    const h = s.heroes[m.hero];
    h.x = m.x;
    h.y = m.y;
    settle(s, h);
    s.movers = [];
    s.phase = 'settle';
    ev.push({ t: 'stop', hero: m.hero });
  }
  return ev;
}

/** 날아가던 대원이 다 멈췄나 (그다음 endTurn) */
export const shotDone = (s: RunState) => s.phase === 'settle';

function stopMover(m: Mover) {
  const sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
  if (sp > 0) {
    m.dx = m.vx / sp;
    m.dy = m.vy / sp;
  }
  m.vx = 0;
  m.vy = 0;
  m.stopped = true;
}

function moveOne(s: RunState, m: Mover, ev: SimEvent[]) {
  let sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
  const n = Math.min(MAX_SUB, Math.floor((sp * STEP) / SUB_PX) + 1);
  const dt = STEP / n;
  for (let i = 0; i < n; i++) {
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    hitWalls(s, m, ev);
    hitFoes(s, m, ev);
    if (!m.clone) {
      hitPickups(s, m, ev);
      hitAllies(s, m, ev);
    }
  }
  sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
  const ns = sp - (FRIC_LIN + FRIC_K * sp) * STEP;
  if (ns <= STOP_V) stopMover(m);
  else {
    const k = ns / sp;
    m.vx *= k;
    m.vy *= k;
  }
}

/** 원을 선분 밖으로 밀어낸다. 밀었으면 바깥 방향 [nx, ny], 아니면 null */
function pushOut(x: number, y: number, r: number, w: Seg): [number, number, number, number] | null {
  const [px, py] = closestOnSeg(x, y, w[0], w[1], w[2], w[3]);
  const d2 = dist2(x, y, px, py);
  if (d2 >= r * r) return null;
  const d = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  if (d > 1e-9) {
    nx = (x - px) / d;
    ny = (y - py) / d;
  } else {
    const sx = w[2] - w[0];
    const sy = w[3] - w[1];
    const l = Math.sqrt(sx * sx + sy * sy) || 1;
    nx = -sy / l;
    ny = sx / l;
  }
  return [px + nx * r, py + ny * r, nx, ny];
}

function hitWalls(s: RunState, m: Mover, ev: SimEvent[]) {
  for (const w of s.cfg.walls) {
    const o = pushOut(m.x, m.y, m.r, w);
    if (!o) continue;
    m.x = o[0];
    m.y = o[1];
    const vn = m.vx * o[2] + m.vy * o[3];
    if (vn < 0) {
      m.vx -= 2 * vn * o[2];
      m.vy -= 2 * vn * o[3];
      m.bounces++;
      ev.push({ t: 'wall', x: m.x - o[2] * m.r, y: m.y - o[3] * m.r, n: m.bounces });
    }
  }
}

function hitFoes(s: RunState, m: Mover, ev: SimEvent[]) {
  for (const f of s.foes) {
    if (!f.alive) continue;
    const rr = m.r + f.r;
    const d2 = dist2(m.x, m.y, f.x, f.y);
    const at = m.touching.indexOf(f.id);
    if (d2 >= rr * rr) {
      if (at >= 0) m.touching.splice(at, 1);
      continue;
    }
    const d = Math.sqrt(d2);
    const nx = d > 1e-9 ? (m.x - f.x) / d : 0;
    const ny = d > 1e-9 ? (m.y - f.y) / d : -1;
    if (at < 0) {
      m.touching.push(f.id);
      strike(s, m, f, nx, ny, ev);
    }
    if (!m.pierce && f.alive) {
      // 반사형: 요괴 겉으로 밀어내고 튕긴다
      m.x = f.x + nx * rr;
      m.y = f.y + ny * rr;
      const vn = m.vx * nx + m.vy * ny;
      if (vn < 0) {
        m.vx -= 2 * vn * nx;
        m.vy -= 2 * vn * ny;
      }
    }
  }
}

/** 대원이 요괴에 부딪힌 한 번 */
function strike(s: RunState, m: Mover, f: Foe, nx: number, ny: number, ev: SimEvent[]) {
  let mul = 1;
  let weak = false;
  if (f.weak !== null) {
    const [wx, wy] = dirOf(f.weak);
    if (nx * wx + ny * wy >= COS45) {
      mul *= 3;
      weak = true;
    }
  }
  if (m.roll) mul *= 1 + 0.3 * m.bounces;
  damageFoe(s, f, m.atk * mul, ev, weak);
}

/** 날아가는 대원이 가만히 있는 아군을 스치면 그 아군의 우정 콤보 (한 발사에 아군마다 한 번) */
function hitAllies(s: RunState, m: Mover, ev: SimEvent[]) {
  for (let j = 0; j < s.heroes.length; j++) {
    if (j === m.hero || s.comboUsed.includes(j)) continue;
    const h = s.heroes[j];
    if (h.fallen) continue;
    const rr = m.r + h.r;
    if (dist2(m.x, m.y, h.x, h.y) >= rr * rr) continue;
    s.comboUsed.push(j);
    comboEffect(s, j, ev);
  }
}

/** 요괴 피해 (정수로 반올림, 최소 1) */
export function damageFoe(s: RunState, f: Foe, raw: number, ev: SimEvent[], weak = false) {
  if (!f.alive) return;
  const dmg = Math.max(1, Math.round(raw));
  f.hp -= dmg;
  ev.push({ t: 'hit', id: f.id, dmg, x: f.x, y: f.y, weak });
  if (f.hp <= 0) killFoe(s, f, ev);
}

function killFoe(s: RunState, f: Foe, ev: SimEvent[]) {
  f.hp = 0;
  f.alive = false;
  f.aim = null;
  s.kills++;
  ev.push({ t: 'kill', id: f.id, x: f.x, y: f.y });
  if (f.drop) {
    s.pickups.push({ id: s.nextId++, kind: f.drop, x: f.x, y: f.y });
    ev.push({ t: 'drop', kind: f.drop, x: f.x, y: f.y });
  }
}

function hitPickups(s: RunState, m: Mover, ev: SimEvent[]) {
  for (let i = s.pickups.length - 1; i >= 0; i--) {
    const p = s.pickups[i];
    const rr = m.r + PICK_R;
    if (dist2(m.x, m.y, p.x, p.y) >= rr * rr) continue;
    s.pickups.splice(i, 1);
    const h = s.heroes[m.hero];
    let v = 0;
    if (p.kind === 'heal') v = healHero(h, h.maxHp * 0.25);
    else {
      v = 3;
      s.coins += v;
    }
    ev.push({ t: 'pick', kind: p.kind, x: p.x, y: p.y, hero: m.hero, v });
  }
}

/** 회복 (회복량 강화 반영, 정수). 실제로 오른 양 */
export function healHero(h: Hero, raw: number): number {
  if (h.fallen) return 0;
  const before = h.hp;
  h.hp = Math.min(h.maxHp, h.hp + Math.max(1, Math.round(raw * h.healMul)));
  return h.hp - before;
}

/** 멈춘 대원을 요괴·벽 밖으로 (겹쳐 멈추지 않게) */
export function settle(s: RunState, h: Hero) {
  for (let k = 0; k < 3; k++) {
    for (const f of s.foes) {
      if (!f.alive) continue;
      const rr = h.r + f.r;
      const d2 = dist2(h.x, h.y, f.x, f.y);
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-9 ? (h.x - f.x) / d : 0;
      const ny = d > 1e-9 ? (h.y - f.y) / d : 1;
      h.x = f.x + nx * rr;
      h.y = f.y + ny * rr;
    }
    for (const w of s.cfg.walls) {
      const o = pushOut(h.x, h.y, h.r, w);
      if (o) {
        h.x = o[0];
        h.y = o[1];
      }
    }
  }
}

// ---------- 턴 끝 · 요괴 차례 ----------

export const aliveFoes = (s: RunState) => s.foes.filter((f) => f.alive);
const aliveHeroes = (s: RunState) => s.heroes.filter((h) => !h.fallen);

/** (x,y) 에서 가장 가까운 살아 있는 대원 번호 (같으면 앞 순서). 없으면 null */
export function nearestHero(s: RunState, x: number, y: number): number | null {
  let best: number | null = null;
  let bd = 0;
  s.heroes.forEach((h, i) => {
    if (h.fallen) return;
    const d = dist2(x, y, h.x, h.y);
    if (best === null || d < bd) {
      best = i;
      bd = d;
    }
  });
  return best;
}

/** 다음 차례에 area 공격을 할 요괴는 떨어질 자리를 미리 정한다 (화면에 보인다) */
export function lockAims(s: RunState) {
  for (const f of s.foes) {
    if (!f.alive || f.left !== 1 || f.frozen > 0 || f.pattern[f.pi] !== 'area' || f.aim) continue;
    const t = nearestHero(s, f.x, f.y);
    if (t !== null) f.aim = [s.heroes[t].x, s.heroes[t].y];
  }
}

function hurtHero(s: RunState, i: number, raw: number): number {
  const h = s.heroes[i];
  let d = raw;
  if (s.guardTurns > 0) d *= 0.5;
  if (h.shield) {
    d *= 0.5;
    h.shield = false;
  }
  const dmg = Math.max(1, Math.round(d));
  h.hp = Math.max(0, h.hp - dmg);
  return dmg;
}

function foeAttack(s: RunState, f: Foe, ev: SimEvent[]) {
  const kind = f.pattern[f.pi];
  f.pi = (f.pi + 1) % f.pattern.length;
  const hits: { hero: number; dmg: number }[] = [];
  let x = f.x;
  let y = f.y;
  if (kind === 'near') {
    const t = nearestHero(s, f.x, f.y);
    if (t !== null) {
      x = s.heroes[t].x;
      y = s.heroes[t].y;
      hits.push({ hero: t, dmg: hurtHero(s, t, f.atk) });
    }
  } else if (kind === 'area') {
    if (!f.aim) {
      const t = nearestHero(s, f.x, f.y);
      if (t !== null) f.aim = [s.heroes[t].x, s.heroes[t].y];
    }
    if (f.aim) {
      [x, y] = f.aim;
      s.heroes.forEach((h, i) => {
        if (h.fallen) return;
        const rr = f.area + h.r;
        if (dist2(h.x, h.y, x, y) < rr * rr) hits.push({ hero: i, dmg: hurtHero(s, i, f.atk * 1.6) });
      });
    }
  } else {
    s.heroes.forEach((h, i) => {
      if (!h.fallen) hits.push({ hero: i, dmg: hurtHero(s, i, f.atk * 0.6) });
    });
  }
  f.aim = null;
  ev.push({ t: 'attack', id: f.id, kind, x, y, area: kind === 'area' ? f.area : 0, hits });
  for (const h of hits) {
    const hero = s.heroes[h.hero];
    if (hero.hp <= 0 && !hero.fallen) {
      hero.fallen = true;
      s.everFell = true;
      ev.push({ t: 'fall', hero: h.hero });
    }
  }
}

/** 웨이브를 다 쓰러뜨렸으면 다음 웨이브(또는 클리어). 넘어갔으면 true */
function waveCheck(s: RunState, ev: SimEvent[]): boolean {
  if (aliveFoes(s).length) return false;
  if (s.wave + 1 >= s.cfg.waves.length) {
    s.phase = 'clear';
    ev.push({ t: 'clear' });
    return true;
  }
  spawnWave(s, s.wave + 1);
  ev.push({ t: 'wave', n: s.wave });
  return true;
}

/** 대원이 멈춘 뒤: 요괴 차례 → 다음 대원. 판이 끝나면 phase 가 clear / fail */
export function endTurn(s: RunState): SimEvent[] {
  const ev: SimEvent[] = [];
  if (s.phase !== 'settle') return ev;
  s.turn++;
  for (const h of s.heroes) if (!h.fallen) h.charge = Math.min(h.chargeMax, h.charge + 1);
  if (!waveCheck(s, ev)) {
    for (const f of s.foes) {
      if (!f.alive) continue;
      if (f.poisonTurns > 0) {
        f.poisonTurns--;
        damageFoe(s, f, f.poison, ev);
        if (!f.alive) continue;
      }
      if (f.frozen > 0) {
        f.frozen--;
        continue;
      }
      f.left--;
      if (f.left > 0) continue;
      foeAttack(s, f, ev);
      f.left = f.cd;
      if (!aliveHeroes(s).length) break;
    }
    if (s.guardTurns > 0) s.guardTurns--;
    if (aliveHeroes(s).length) waveCheck(s, ev);
    lockAims(s);
  }
  if ((s.phase as Phase) === 'clear') return ev;
  if (!aliveHeroes(s).length) {
    s.phase = 'fail';
    ev.push({ t: 'fail', why: 'fallen' });
    return ev;
  }
  if (s.turn >= s.cfg.maxTurns) {
    s.phase = 'fail';
    ev.push({ t: 'fail', why: 'turns' });
    return ev;
  }
  const n = s.heroes.length;
  let c = s.cur;
  for (let k = 0; k < n; k++) {
    c = (c + 1) % n;
    if (!s.heroes[c].fallen) break;
  }
  s.cur = c;
  s.phase = 'aim';
  return ev;
}

// ---------- 한 번에 ----------

/** 한 턴을 끝까지 (쏘기 → 멈춤 → 요괴 차례) */
export function playShot(s: RunState, input: ShotInput): SimEvent[] {
  const ev = beginShot(s, input);
  while (s.phase === 'shot') ev.push(...stepShot(s));
  ev.push(...endTurn(s));
  return ev;
}

/** 별 3개: 클리어 · 정해진 턴 안 · 아무도 안 쓰러짐 */
export function starsOf(s: RunState): [boolean, boolean, boolean] {
  const c = s.phase === 'clear';
  return [c, c && s.turn <= s.cfg.par, c && !s.everFell];
}

export interface RunResult {
  cleared: boolean;
  /** 판이 끝났나 (clear 또는 fail). 조작이 모자라 중간에 멈췄으면 false */
  ended: boolean;
  stars: number;
  starFlags: [boolean, boolean, boolean];
  /** 쓴 턴 */
  turns: number;
  /** 마지막 웨이브 번호 (0부터) · 웨이브 수 */
  wave: number;
  waves: number;
  kills: number;
  /** 판 안에서 주운 엽전 */
  coins: number;
  /** 쓰러진 대원 수 */
  fallen: number;
  /** 남은 조작 (판이 끝난 뒤에 더 온 조작 수) */
  extra: number;
  steps: number;
}

export function resultOf(s: RunState, extra = 0): RunResult {
  const flags = starsOf(s);
  return {
    cleared: s.phase === 'clear',
    ended: s.phase === 'clear' || s.phase === 'fail',
    stars: flags.filter(Boolean).length,
    starFlags: flags,
    turns: s.turn,
    wave: s.wave,
    waves: s.cfg.waves.length,
    kills: s.kills,
    coins: s.coins,
    fallen: s.heroes.filter((h) => h.fallen).length,
    extra,
    steps: s.steps,
  };
}

/** 조작 목록으로 판을 처음부터 끝까지 다시 돌린다 (서버 finger-finish 가 쓴다) */
export function replayRun(cfg: RunConfig, inputs: ShotInput[]): RunResult {
  const s = createRun(cfg);
  let i = 0;
  for (; i < inputs.length && s.phase === 'aim'; i++) playShot(s, inputs[i]);
  return resultOf(s, inputs.length - i);
}

// ---------- 조준선 ----------

/**
 * 조준선 미리보기: 이번 대원이 각도 a 로 날아갈 때 첫 벽(방 테두리·돌기둥)에 닿는 곳까지.
 * 요괴는 무시한다 (첫 벽까지만 보여 준다). 돌려주는 점 = [시작, 첫 벽에 닿을 때의 대원 가운데]
 */
export function aimPreview(s: RunState, a: number): [number, number][] {
  const h = s.heroes[s.cur];
  const [dx, dy] = dirOf(a);
  const r = h.r;
  let best = Infinity;
  for (const w of s.cfg.walls) {
    const t = rayCapsule(h.x, h.y, dx, dy, w, r);
    if (t !== null && t < best) best = t;
  }
  if (best === Infinity) best = 0;
  return [
    [h.x, h.y],
    [h.x + dx * best, h.y + dy * best],
  ];
}

/** 점 (x,y) 에서 방향 (dx,dy) 로 반지름 r 원이 선분에 닿는 거리 (닿지 않으면 null) */
function rayCapsule(x: number, y: number, dx: number, dy: number, w: Seg, r: number): number | null {
  let best: number | null = null;
  const take = (t: number) => {
    if (t >= 0 && (best === null || t < best)) best = t;
  };
  // 선분 몸통 (양쪽 평행선)
  const sx = w[2] - w[0];
  const sy = w[3] - w[1];
  const len = Math.sqrt(sx * sx + sy * sy);
  if (len > 0) {
    const nx = -sy / len;
    const ny = sx / len;
    const denom = dx * nx + dy * ny;
    if (denom !== 0) {
      for (const side of [1, -1]) {
        const ox = w[0] + nx * r * side;
        const oy = w[1] + ny * r * side;
        const t = ((ox - x) * nx + (oy - y) * ny) / denom;
        const px = x + dx * t - ox;
        const py = y + dy * t - oy;
        const u = (px * sx + py * sy) / (len * len);
        if (u >= 0 && u <= 1) take(t);
      }
    }
  }
  // 양 끝 원
  for (const [cx, cy] of [
    [w[0], w[1]],
    [w[2], w[3]],
  ]) {
    const fx = x - cx;
    const fy = y - cy;
    const b = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - r * r;
    const disc = b * b - c;
    if (disc >= 0) take(-b - Math.sqrt(disc));
  }
  return best;
}

// ---------- 화면용 ----------

/** 다음 요괴 차례에 공격할 요괴들: area 는 떨어질 원, near 는 노리는 대원 */
export function threats(s: RunState): { id: number; kind: AttackKind; x: number; y: number; r: number; hero: number | null }[] {
  const out: { id: number; kind: AttackKind; x: number; y: number; r: number; hero: number | null }[] = [];
  for (const f of s.foes) {
    if (!f.alive || f.left !== 1 || f.frozen > 0) continue;
    const kind = f.pattern[f.pi];
    if (kind === 'area' && f.aim) out.push({ id: f.id, kind, x: f.aim[0], y: f.aim[1], r: f.area, hero: null });
    else if (kind === 'near') {
      const t = nearestHero(s, f.x, f.y);
      out.push({ id: f.id, kind, x: f.x, y: f.y, r: 0, hero: t });
    } else if (kind === 'all') out.push({ id: f.id, kind, x: f.x, y: f.y, r: 0, hero: null });
  }
  return out;
}
