import { COS45, closestOnSeg, dirOf, dist2, normAngle } from './math.ts';
import { comboEffect, specialEffect } from './skills.ts';
import type { AttackKind, Debuff, FoeTraits } from './enemies.ts';
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
/** 끝없는 탑 한 판의 최대 턴 (판이 너무 길어지지 않게) */
export const TOWER_TURNS = 120;
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
/** 순간이동 구멍 반지름 (대원 가운데가 이 안에 들어오면 짝 구멍으로) */
export const PORTAL_R = 34;
/** 가시밭: 들어갈 때 체력 (최대 체력 비율, 쓰러뜨리지는 않는다) · 안에 있는 동안 스텝마다 속도 배율 */
export const THORN_DMG = 0.04;
export const THORN_DRAG = 0.965;
/** 빨래판: 들어가는 순간 속도 배율 (급제동) */
export const BOARD_MUL = 0.35;
/** 방패가 막는 범위: 방패 방향 60° 안 (cos 60° = 0.5) */
export const COS60 = 0.5;
/** 판에 한꺼번에 있을 수 있는 요괴 수 (부르기·갈라지기 상한) */
export const MAX_FOES = 9;
/** 나쁜 효과 세기: 독 = 요괴 공격력 × 0.3 (3턴) · 느려짐 = 다음 발사 속도 × 0.7 · 약해짐 = 다음 발사 박치기 피해 × 0.6 */
export const DEBUFF = { poisonMul: 0.3, poisonTurns: 3, slowMul: 0.7, weakMul: 0.6 };
/** 불길 피해 = 요괴 공격력 × 이 값 */
export const FIRE_MUL = 0.4;

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
  /** 행동 (방패 · 부활 · 숨기 · 분열 · 회복 · 나쁜 효과 · 부르기 · 단단해짐 · 두 군데 · 불길) */
  traits?: FoeTraits;
  /** summon 행동으로 부르는 요괴 (스테이지 배율이 반영된 값, 자리는 부를 때 정한다) */
  summon?: FoeInit;
}

/** 바닥 장애물: 가시밭(지나가면 느려지고 체력 조금) · 빨래판(급제동). 네모 (왼쪽 위 x, y, 너비, 높이) */
export interface Zone {
  k: 'thorn' | 'board';
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 둥근 돌기둥 [x, y, 반지름] */
export type Pillar = [number, number, number];
/** 순간이동 구멍 한 쌍 [ax, ay, bx, by] */
export type Portal = [number, number, number, number];

/** 벽 선분 [ax, ay, bx, by] */
export type Seg = [number, number, number, number];

/** 방 모양: 테두리 + 네모 돌기둥 선분 · 둥근 돌기둥 · 가시밭/빨래판 · 순간이동 구멍 */
export interface Room {
  walls: Seg[];
  pillars?: Pillar[];
  zones?: Zone[];
  portals?: Portal[];
  /** 끝없는 탑: 이 방을 가져온 지역 (화면 바닥 그림용) */
  region?: number;
}

export interface RunConfig {
  v: 1;
  stage: string;
  /** normal = 스테이지 · tower = 끝없는 탑 (웨이브 하나 = 한 층) */
  mode: 'normal' | 'tower';
  /** 방 크기 */
  w: number;
  h: number;
  /** 방 테두리 + 네모 돌기둥 선분 */
  walls: Seg[];
  /** 둥근 돌기둥 */
  pillars?: Pillar[];
  /** 가시밭 · 빨래판 */
  zones?: Zone[];
  /** 순간이동 구멍 쌍 */
  portals?: Portal[];
  /** 쏘는 순서대로 1~4명 */
  party: HeroInit[];
  waves: FoeInit[][];
  /** 별 하나: 이 턴 안에 클리어 */
  par: number;
  maxTurns: number;
  /** 끝없는 탑: 층마다 다른 방. rooms[waveRoom[웨이브]] 가 그 층의 방 (없으면 위 walls·pillars·zones·portals 하나) */
  rooms?: Room[];
  waveRoom?: number[];
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
  /** 나쁜 효과: 독(요괴 차례마다 poison, poisonTurns 턴) · 느려짐/약해짐(남은 발사 횟수) · 얼음(건너뛸 차례 수) */
  poison: number;
  poisonTurns: number;
  slow: number;
  weak: number;
  frozen: number;
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
  /** 두 번째 area 공격 자리 (twin) */
  aim2: [number, number] | null;
  /** 독: 요괴 차례마다 이만큼 피해 (poisonTurns 턴 동안) */
  poison: number;
  poisonTurns: number;
  /** 똬리: 이 횟수만큼 요괴 차례를 건너뛴다 (숫자가 줄지 않고 공격하지 않음) */
  frozen: number;
  /** 물웅덩이에 숨었다 (박치기·콤보에 안 맞는다) · 숨기 셈 */
  hidden: boolean;
  hideT: number;
  /** 쓰러졌다가 다음 요괴 차례에 되살아난다 (revive) · 이미 한 번 되살아났다 */
  down: boolean;
  revived: boolean;
  /** 단단해진 단계 (harden) */
  hard: number;
}

/** 강철이·염라대왕 불길: 요괴 차례마다 안에 있는 대원에게 피해 */
export interface Fire {
  x: number;
  y: number;
  r: number;
  dmg: number;
  turns: number;
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
  /** 지금 안에 있는 바닥 장애물 번호 (들어갈 때 한 번만) */
  zones: number[];
  /** 순간이동해 나온 구멍 (구멍 번호 × 2 + 끝). 그 구멍을 벗어나기 전에는 다시 빨려 들지 않는다. 없으면 -1 */
  warp: number;
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
  /** 바닥에 남은 불길 */
  fires: Fire[];
  /** 지금 방 (스테이지는 cfg 의 방 하나, 끝없는 탑은 층마다 바뀐다) */
  room: Room;
}

// ---------- 이벤트 (소리·효과용) ----------

export type SimEvent =
  | { t: 'shot'; hero: number; a: number; p: number }
  | { t: 'wall'; x: number; y: number; n: number }
  | { t: 'hit'; id: number; dmg: number; x: number; y: number; weak: boolean; shield?: boolean }
  | { t: 'kill'; id: number; x: number; y: number }
  | { t: 'pick'; kind: 'heal' | 'coin'; x: number; y: number; hero: number; v: number }
  | { t: 'drop'; kind: 'heal' | 'coin'; x: number; y: number }
  | { t: 'stop'; hero: number }
  | { t: 'combo'; hero: number; kind: ComboKind; x: number; y: number; r: number; lines: [number, number, number, number][]; targets: number[] }
  | { t: 'special'; hero: number; kind: SpecialKind }
  | { t: 'dash'; hero: number }
  | { t: 'revive'; hero: number }
  | { t: 'heal'; hero: number; v: number }
  | { t: 'attack'; id: number; kind: AttackKind; x: number; y: number; area: number; hits: { hero: number; dmg: number }[]; x2?: number; y2?: number }
  | { t: 'down'; id: number; x: number; y: number }
  | { t: 'rise'; id: number; x: number; y: number }
  | { t: 'spawn'; id: number; kids: number[]; why: 'split' | 'summon' }
  | { t: 'foeHeal'; id: number; heals: { id: number; v: number }[] }
  | { t: 'hide'; id: number; hidden: boolean }
  | { t: 'debuff'; hero: number; kind: Debuff }
  | { t: 'tick'; hero: number; dmg: number; kind: 'poison' | 'fire' }
  | { t: 'skip'; hero: number }
  | { t: 'cleanse'; hero: number; heroes: number[] }
  | { t: 'thorn'; hero: number; dmg: number; x: number; y: number }
  | { t: 'board'; x: number; y: number }
  | { t: 'warp'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'fall'; hero: number }
  | { t: 'wave'; n: number }
  | { t: 'clear' }
  | { t: 'fail'; why: 'fallen' | 'turns' };

// ---------- 만들기 ----------

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** 웨이브(층) w 의 방 */
export function roomAt(cfg: RunConfig, w: number): Room {
  if (cfg.rooms && cfg.waveRoom) return cfg.rooms[cfg.waveRoom[w]];
  return { walls: cfg.walls, pillars: cfg.pillars, zones: cfg.zones, portals: cfg.portals };
}

/** 대원 i 의 시작 자리 (아래쪽에 나란히) */
const startX = (cfg: RunConfig, i: number) => (cfg.w * (i + 1)) / (cfg.party.length + 1);

export function createRun(cfg: RunConfig): RunState {
  const heroes: Hero[] = cfg.party.map((h, i) => ({
    ...clone(h),
    x: startX(cfg, i),
    y: cfg.h - 80,
    r: HERO_R,
    maxHp: h.hp,
    charge: h.charge0,
    fallen: false,
    shield: false,
    poison: 0,
    poisonTurns: 0,
    slow: 0,
    weak: 0,
    frozen: 0,
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
    fires: [],
    room: roomAt(cfg, 0),
  };
  spawnWave(s, 0);
  return s;
}

/** 요괴 하나를 판에 (설정 → 상태) */
function newFoe(s: RunState, f: FoeInit, x: number, y: number): Foe {
  return {
    ...clone(f),
    x,
    y,
    id: s.nextId++,
    maxHp: f.hp,
    left: f.cd,
    pi: 0,
    alive: true,
    aim: null,
    aim2: null,
    poison: 0,
    poisonTurns: 0,
    frozen: 0,
    hidden: false,
    hideT: 0,
    down: false,
    revived: false,
    hard: 0,
  };
}

function spawnWave(s: RunState, w: number) {
  if (w > 0 && s.cfg.mode === 'tower') {
    // 끝없는 탑: 다음 층으로 올라가면 방이 바뀐다. 대원은 체력·쓰러짐·나쁜 효과를 그대로 지닌 채 시작 자리로, 바닥에 남은 것은 사라진다
    s.room = roomAt(s.cfg, w);
    s.heroes.forEach((h, i) => {
      h.x = startX(s.cfg, i);
      h.y = s.cfg.h - 80;
    });
    s.pickups = [];
  }
  s.wave = w;
  s.foes = s.cfg.waves[w].map((f) => newFoe(s, f, f.x, f.y));
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
  let v0 = speedOf(inp.p);
  let atk = h.atk;
  // 나쁜 효과: 느려짐 · 약해짐은 이번 발사에 쓰이고 사라진다
  if (h.slow > 0) {
    h.slow--;
    v0 *= DEBUFF.slowMul;
  }
  if (h.weak > 0) {
    h.weak--;
    atk *= DEBUFF.weakMul;
  }
  s.movers = [
    {
      hero: s.cur, x: h.x, y: h.y, vx: dx * v0, vy: dy * v0, r: h.r, atk, pierce: h.type === 'pierce', touching: [], bounces: 0, stopped: false, dx, dy, v0,
      clone: false, rerun: false, roll: false, zones: [], warp: -1,
    },
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
    hitPortals(s, m, ev);
    hitZones(s, m, ev);
    hitFoes(s, m, ev);
    if (!m.clone) {
      hitPickups(s, m, ev);
      hitAllies(s, m, ev);
    }
  }
  sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
  let ns = sp - (FRIC_LIN + FRIC_K * sp) * STEP;
  if (m.zones.length && s.room.zones) for (const z of m.zones) if (s.room.zones[z].k === 'thorn') ns *= THORN_DRAG;
  if (ns <= STOP_V) stopMover(m);
  else {
    const k = ns / sp;
    m.vx *= k;
    m.vy *= k;
  }
}

/** 원을 선분 밖으로 밀어낸다. 밀었으면 [새 x, 새 y, nx, ny], 아니면 null */
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

/** 원을 둥근 기둥 밖으로 밀어낸다 */
function pushOutCircle(x: number, y: number, r: number, p: Pillar): [number, number, number, number] | null {
  const rr = r + p[2];
  const d2 = dist2(x, y, p[0], p[1]);
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? (x - p[0]) / d : 0;
  const ny = d > 1e-9 ? (y - p[1]) / d : 1;
  return [p[0] + nx * rr, p[1] + ny * rr, nx, ny];
}

function bounce(m: Mover, o: [number, number, number, number], ev: SimEvent[]) {
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

function hitWalls(s: RunState, m: Mover, ev: SimEvent[]) {
  for (const w of s.room.walls) {
    const o = pushOut(m.x, m.y, m.r, w);
    if (o) bounce(m, o, ev);
  }
  if (s.room.pillars)
    for (const p of s.room.pillars) {
      const o = pushOutCircle(m.x, m.y, m.r, p);
      if (o) bounce(m, o, ev);
    }
}

/** 순간이동 구멍: 가운데가 한쪽 구멍에 들어가면 같은 속도로 짝 구멍에서 나온다 */
function hitPortals(s: RunState, m: Mover, ev: SimEvent[]) {
  const ps = s.room.portals;
  if (!ps || !ps.length) return;
  const r2 = PORTAL_R * PORTAL_R;
  if (m.warp >= 0) {
    // 나온 구멍을 벗어나야 다시 빨려 들 수 있다
    const p = ps[m.warp >> 1];
    const ex = m.warp & 1 ? p[2] : p[0];
    const ey = m.warp & 1 ? p[3] : p[1];
    const rr = PORTAL_R + m.r;
    if (dist2(m.x, m.y, ex, ey) < rr * rr) return;
    m.warp = -1;
  }
  for (let k = 0; k < ps.length; k++) {
    const p = ps[k];
    for (let e = 0; e < 2; e++) {
      const ix = e ? p[2] : p[0];
      const iy = e ? p[3] : p[1];
      if (dist2(m.x, m.y, ix, iy) >= r2) continue;
      const ox = e ? p[0] : p[2];
      const oy = e ? p[1] : p[3];
      ev.push({ t: 'warp', x0: ix, y0: iy, x1: ox, y1: oy });
      m.x = ox + (m.x - ix);
      m.y = oy + (m.y - iy);
      m.warp = k * 2 + (e ? 0 : 1);
      m.touching = [];
      return;
    }
  }
}

const inZone = (z: Zone, x: number, y: number) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;

/** 바닥 장애물: 들어가는 순간 가시밭(체력 조금) · 빨래판(급제동). 가시밭 감속은 moveOne 마찰에서 */
function hitZones(s: RunState, m: Mover, ev: SimEvent[]) {
  const zs = s.room.zones;
  if (!zs || !zs.length) return;
  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    const at = m.zones.indexOf(i);
    if (!inZone(z, m.x, m.y)) {
      if (at >= 0) m.zones.splice(at, 1);
      continue;
    }
    if (at >= 0) continue;
    m.zones.push(i);
    if (z.k === 'board') {
      m.vx *= BOARD_MUL;
      m.vy *= BOARD_MUL;
      ev.push({ t: 'board', x: m.x, y: m.y });
    } else if (!m.clone) {
      const h = s.heroes[m.hero];
      const dmg = Math.max(1, Math.round(h.maxHp * THORN_DMG));
      const before = h.hp;
      h.hp = Math.max(1, h.hp - dmg);
      ev.push({ t: 'thorn', hero: m.hero, dmg: before - h.hp, x: m.x, y: m.y });
    }
  }
}

/** 박치기·콤보에 맞는 요괴 (살아 있고 숨지 않은) */
export const visibleFoes = (s: RunState) => s.foes.filter((f) => f.alive && !f.hidden);

function hitFoes(s: RunState, m: Mover, ev: SimEvent[]) {
  for (const f of s.foes) {
    const at = m.touching.indexOf(f.id);
    if (!f.alive || f.hidden) {
      if (at >= 0) m.touching.splice(at, 1);
      continue;
    }
    const rr = m.r + f.r;
    const d2 = dist2(m.x, m.y, f.x, f.y);
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

/** 대원이 요괴에 부딪힌 한 번 (nx, ny = 요괴 가운데에서 부딪힌 쪽 방향) */
function strike(s: RunState, m: Mover, f: Foe, nx: number, ny: number, ev: SimEvent[]) {
  let mul = 1;
  let weak = false;
  let shield = false;
  if (f.weak !== null) {
    const [wx, wy] = dirOf(f.weak);
    if (nx * wx + ny * wy >= COS45) {
      mul *= 3;
      weak = true;
      f.hard = 0; // 약점을 맞히면 단단함이 풀린다
    }
  }
  const sh = f.traits?.shield;
  if (sh && !weak) {
    const [sx, sy] = dirOf(sh.dir);
    if (nx * sx + ny * sy >= COS60) {
      mul *= sh.mul;
      shield = true;
    }
  }
  if (m.roll) mul *= 1 + 0.3 * m.bounces;
  damageFoe(s, f, m.atk * mul, ev, weak, shield);
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

/** 단단해진 만큼 받는 피해 배율 */
export const hardMul = (f: Foe) => (f.hard > 0 && f.traits?.harden ? Math.max(0.5, 1 - f.traits.harden * f.hard) : 1);

/** 요괴 피해 (정수로 반올림, 최소 1) */
export function damageFoe(s: RunState, f: Foe, raw: number, ev: SimEvent[], weak = false, shield = false) {
  if (!f.alive) return;
  const dmg = Math.max(1, Math.round(raw * hardMul(f)));
  f.hp -= dmg;
  ev.push(shield ? { t: 'hit', id: f.id, dmg, x: f.x, y: f.y, weak, shield } : { t: 'hit', id: f.id, dmg, x: f.x, y: f.y, weak });
  if (f.hp <= 0) killFoe(s, f, ev);
}

function killFoe(s: RunState, f: Foe, ev: SimEvent[]) {
  f.hp = 0;
  f.alive = false;
  f.aim = null;
  f.aim2 = null;
  if (f.traits?.revive && !f.revived) {
    // 해골 병사·저승사자: 다음 요괴 차례에 되살아난다
    f.down = true;
    ev.push({ t: 'down', id: f.id, x: f.x, y: f.y });
    return;
  }
  s.kills++;
  ev.push({ t: 'kill', id: f.id, x: f.x, y: f.y });
  if (f.drop) {
    s.pickups.push({ id: s.nextId++, kind: f.drop, x: f.x, y: f.y });
    ev.push({ t: 'drop', kind: f.drop, x: f.x, y: f.y });
  }
  if (f.traits?.split) splitFoe(s, f, ev);
}

const liveCount = (s: RunState) => s.foes.filter((f) => f.alive || f.down).length;

/** 방 안으로 (요괴 가운데) */
function clampIn(s: RunState, x: number, y: number, r: number): [number, number] {
  return [Math.max(r + 8, Math.min(s.cfg.w - r - 8, x)), Math.max(r + 8, Math.min(s.cfg.h * 0.72, y))];
}

/** 죽순 요괴: 작은 요괴로 갈라진다 (그 자리 양옆). 날아가는 대원은 지금 닿은 것으로 쳐서 바로 맞지 않는다 */
function splitFoe(s: RunState, f: Foe, ev: SimEvent[]) {
  const n = f.traits?.split ?? 0;
  const kids: number[] = [];
  const r = Math.round(f.r * 0.7);
  const base: FoeInit = {
    kind: f.kind, name: `작은 ${f.name}`, art: f.art, rank: 0, x: f.x, y: f.y, r,
    hp: Math.max(1, Math.round(f.maxHp * 0.35)), atk: Math.max(1, Math.round(f.atk * 0.6)), cd: f.cd, pattern: ['near'], area: 0, weak: null, drop: null,
  };
  for (let i = 0; i < n && liveCount(s) < MAX_FOES; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const [x, y] = clampIn(s, f.x + side * (f.r * 0.8 + 4 * i), f.y - 6 * i, r);
    const kid = newFoe(s, base, x, y);
    s.foes.push(kid);
    kids.push(kid.id);
    for (const m of s.movers) m.touching.push(kid.id);
  }
  if (kids.length) ev.push({ t: 'spawn', id: f.id, kids, why: 'split' });
}

/** 보스 부르기: 보스 양옆·앞의 빈자리에 */
function summonFoes(s: RunState, f: Foe, ev: SimEvent[]) {
  const tmpl = f.summon;
  const n = f.traits?.summon?.n ?? 0;
  if (!tmpl) return;
  const kids: number[] = [];
  const off = f.r + tmpl.r + 16;
  const spots: [number, number][] = [
    [f.x - off, f.y + f.r * 0.4],
    [f.x + off, f.y + f.r * 0.4],
    [f.x - off * 0.7, f.y + off * 0.9],
    [f.x + off * 0.7, f.y + off * 0.9],
    [f.x, f.y + off * 1.1],
    [f.x - off, f.y - f.r * 0.6],
    [f.x + off, f.y - f.r * 0.6],
  ];
  for (const [sx, sy] of spots) {
    if (kids.length >= n || liveCount(s) >= MAX_FOES) break;
    const [x, y] = clampIn(s, sx, sy, tmpl.r);
    const busy = s.foes.some((o) => (o.alive || o.down) && dist2(x, y, o.x, o.y) < (o.r + tmpl.r + 6) * (o.r + tmpl.r + 6));
    const block = (s.room.pillars ?? []).some((p) => dist2(x, y, p[0], p[1]) < (p[2] + tmpl.r) * (p[2] + tmpl.r));
    if (busy || block) continue;
    const kid = newFoe(s, tmpl, x, y);
    kid.left = tmpl.cd + 1;
    s.foes.push(kid);
    kids.push(kid.id);
  }
  if (kids.length) {
    ev.push({ t: 'spawn', id: f.id, kids, why: 'summon' });
    settleAll(s);
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

/** 멈춘 대원을 요괴·벽·기둥 밖으로 (겹쳐 멈추지 않게) */
export function settle(s: RunState, h: Hero) {
  for (let k = 0; k < 3; k++) {
    for (const f of s.foes) {
      if (!f.alive || f.hidden) continue;
      const rr = h.r + f.r;
      const d2 = dist2(h.x, h.y, f.x, f.y);
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-9 ? (h.x - f.x) / d : 0;
      const ny = d > 1e-9 ? (h.y - f.y) / d : 1;
      h.x = f.x + nx * rr;
      h.y = f.y + ny * rr;
    }
    if (s.room.pillars)
      for (const p of s.room.pillars) {
        const o = pushOutCircle(h.x, h.y, h.r, p);
        if (o) {
          h.x = o[0];
          h.y = o[1];
        }
      }
    for (const w of s.room.walls) {
      const o = pushOut(h.x, h.y, h.r, w);
      if (o) {
        h.x = o[0];
        h.y = o[1];
      }
    }
  }
}

function settleAll(s: RunState) {
  for (const h of s.heroes) if (!h.fallen) settle(s, h);
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

/** (x,y) 에서 가까운 순서의 살아 있는 대원 번호 (같으면 앞 순서) */
export function heroesByDistance(s: RunState, x: number, y: number): number[] {
  return s.heroes
    .map((h, i) => ({ h, i, d: dist2(x, y, h.x, h.y) }))
    .filter((o) => !o.h.fallen)
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((o) => o.i);
}

/** 다음 차례에 area 공격을 할 요괴는 떨어질 자리를 미리 정한다 (화면에 보인다). twin 은 가장 먼 대원 자리도 */
export function lockAims(s: RunState) {
  for (const f of s.foes) {
    if (!f.alive || f.left !== 1 || f.frozen > 0 || f.pattern[f.pi] !== 'area' || f.aim) continue;
    const order = heroesByDistance(s, f.x, f.y);
    if (!order.length) continue;
    const t = s.heroes[order[0]];
    f.aim = [t.x, t.y];
    if (f.traits?.twin && order.length > 1) {
      const u = s.heroes[order[order.length - 1]];
      f.aim2 = [u.x, u.y];
    }
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

/** 공격에 맞은 대원에게 나쁜 효과 */
function inflict(s: RunState, f: Foe, i: number, ev: SimEvent[]) {
  const kind = f.traits?.inflict;
  const h = s.heroes[i];
  if (!kind || h.hp <= 0) return;
  if (kind === 'poison') {
    h.poison = Math.max(h.poison, Math.max(1, Math.round(f.atk * DEBUFF.poisonMul)));
    h.poisonTurns = DEBUFF.poisonTurns;
  } else if (kind === 'slow') h.slow = 1;
  else if (kind === 'weak') h.weak = 1;
  else h.frozen = 1;
  ev.push({ t: 'debuff', hero: i, kind });
}

function inCircle(h: Hero, x: number, y: number, r: number) {
  const rr = r + h.r;
  return dist2(h.x, h.y, x, y) < rr * rr;
}

function foeAttack(s: RunState, f: Foe, ev: SimEvent[]) {
  const kind = f.pattern[f.pi];
  f.pi = (f.pi + 1) % f.pattern.length;
  const hits: { hero: number; dmg: number }[] = [];
  let x = f.x;
  let y = f.y;
  let second: [number, number] | null = null;
  if (kind === 'near' || kind === 'double') {
    const order = heroesByDistance(s, f.x, f.y).slice(0, kind === 'double' ? 2 : 1);
    if (order.length) {
      x = s.heroes[order[0]].x;
      y = s.heroes[order[0]].y;
      if (order.length > 1) second = [s.heroes[order[1]].x, s.heroes[order[1]].y];
    }
    for (const t of order) hits.push({ hero: t, dmg: hurtHero(s, t, f.atk) });
  } else if (kind === 'area') {
    if (!f.aim) {
      const t = nearestHero(s, f.x, f.y);
      if (t !== null) f.aim = [s.heroes[t].x, s.heroes[t].y];
    }
    if (f.aim) {
      [x, y] = f.aim;
      second = f.aim2;
      const circles: [number, number][] = second ? [f.aim, second] : [f.aim];
      s.heroes.forEach((h, i) => {
        if (h.fallen) return;
        if (circles.some(([cx, cy]) => inCircle(h, cx, cy, f.area))) hits.push({ hero: i, dmg: hurtHero(s, i, f.atk * 1.6) });
      });
      if (f.traits?.burn) for (const [cx, cy] of circles) s.fires.push({ x: cx, y: cy, r: f.area, dmg: Math.max(1, Math.round(f.atk * FIRE_MUL)), turns: f.traits.burn });
    }
  } else if (kind === 'all') {
    s.heroes.forEach((h, i) => {
      if (!h.fallen) hits.push({ hero: i, dmg: hurtHero(s, i, f.atk * 0.6) });
    });
  } else if (kind === 'heal') {
    const heals: { id: number; v: number }[] = [];
    const k = f.traits?.heal ?? 0.15;
    for (const o of s.foes) {
      if (!o.alive || o.id === f.id || o.hp >= o.maxHp) continue;
      const before = o.hp;
      o.hp = Math.min(o.maxHp, o.hp + Math.max(1, Math.round(o.maxHp * k)));
      heals.push({ id: o.id, v: o.hp - before });
    }
    ev.push({ t: 'foeHeal', id: f.id, heals });
  } else if (kind === 'summon') summonFoes(s, f, ev);
  f.aim = null;
  f.aim2 = null;
  if (kind === 'heal' || kind === 'summon') return;
  const att: Extract<SimEvent, { t: 'attack' }> = { t: 'attack', id: f.id, kind, x, y, area: kind === 'area' ? f.area : 0, hits };
  if (second) {
    att.x2 = second[0];
    att.y2 = second[1];
  }
  ev.push(att);
  for (const h of hits) inflict(s, f, h.hero, ev);
  checkFalls(s, ev);
}

function checkFalls(s: RunState, ev: SimEvent[]) {
  s.heroes.forEach((hero, i) => {
    if (hero.hp <= 0 && !hero.fallen) {
      hero.fallen = true;
      hero.poisonTurns = 0;
      s.everFell = true;
      ev.push({ t: 'fall', hero: i });
    }
  });
}

/** 웨이브에 남은 요괴 (되살아날 요괴 포함) */
export const foesLeft = (s: RunState) => s.foes.some((f) => f.alive || f.down);

/** 웨이브를 다 쓰러뜨렸으면 다음 웨이브(또는 클리어). 넘어갔으면 true */
function waveCheck(s: RunState, ev: SimEvent[]): boolean {
  if (foesLeft(s)) return false;
  s.fires = [];
  if (s.wave + 1 >= s.cfg.waves.length) {
    s.phase = 'clear';
    ev.push({ t: 'clear' });
    return true;
  }
  spawnWave(s, s.wave + 1);
  ev.push({ t: 'wave', n: s.wave });
  return true;
}

/** 요괴 차례: 되살아남 → 바닥 불길·독 → 요괴마다 (독 · 똬리 · 숫자 줄이기 · 공격) → 숨기·단단해짐 */
function enemyPhase(s: RunState, ev: SimEvent[]) {
  for (const f of s.foes) {
    if (!f.down) continue;
    f.down = false;
    f.revived = true;
    f.alive = true;
    f.hp = Math.max(1, Math.round(f.maxHp * (f.traits?.revive ?? 0.5)));
    f.left = f.cd;
    f.pi = 0;
    f.poisonTurns = 0;
    f.frozen = 0;
    f.hidden = false;
    ev.push({ t: 'rise', id: f.id, x: f.x, y: f.y });
    settleAll(s);
  }
  // 바닥 불길 · 대원 독
  for (const fire of s.fires) {
    s.heroes.forEach((h, i) => {
      if (h.fallen || !inCircle(h, fire.x, fire.y, fire.r - h.r)) return;
      const dmg = Math.min(h.hp, fire.dmg);
      h.hp -= dmg;
      ev.push({ t: 'tick', hero: i, dmg, kind: 'fire' });
    });
    fire.turns--;
  }
  s.fires = s.fires.filter((f) => f.turns > 0);
  s.heroes.forEach((h, i) => {
    if (h.fallen || h.poisonTurns <= 0) return;
    h.poisonTurns--;
    const dmg = Math.min(h.hp, h.poison);
    h.hp -= dmg;
    ev.push({ t: 'tick', hero: i, dmg, kind: 'poison' });
  });
  checkFalls(s, ev);
  if (!aliveHeroes(s).length) return;
  for (const f of s.foes.slice()) {
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
  for (const f of s.foes) {
    if (!f.alive) continue;
    if (f.traits?.harden) f.hard = Math.min(10, f.hard + 1);
    const hide = f.traits?.hide;
    if (hide) {
      f.hideT++;
      const was = f.hidden;
      f.hidden = f.hideT % (hide + 1) === hide;
      if (was !== f.hidden) {
        ev.push({ t: 'hide', id: f.id, hidden: f.hidden });
        if (!f.hidden) settleAll(s);
      }
    }
  }
}

/** 대원이 멈춘 뒤: 요괴 차례 → 다음 대원. 판이 끝나면 phase 가 clear / fail */
export function endTurn(s: RunState): SimEvent[] {
  const ev: SimEvent[] = [];
  if (s.phase !== 'settle') return ev;
  s.turn++;
  for (const h of s.heroes) if (!h.fallen) h.charge = Math.min(h.chargeMax, h.charge + 1);
  if (!waveCheck(s, ev)) {
    enemyPhase(s, ev);
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
  // 다음 대원 (쓰러진 대원은 건너뛰고, 얼은 대원은 한 차례 쉰다. 모두 얼었으면 얼음을 깨고 쏜다)
  const n = s.heroes.length;
  let pick = -1;
  for (let k = 1; k <= n; k++) {
    const c = (s.cur + k) % n;
    const h = s.heroes[c];
    if (h.fallen) continue;
    if (h.frozen > 0) {
      h.frozen--;
      ev.push({ t: 'skip', hero: c });
      continue;
    }
    pick = c;
    break;
  }
  if (pick < 0)
    for (let k = 1; k <= n; k++) {
      const c = (s.cur + k) % n;
      if (s.heroes[c].fallen) continue;
      s.heroes[c].frozen = 0;
      pick = c;
      break;
    }
  s.cur = pick;
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
  /** 끝없는 탑: 올라간 층 (다 깬 층 수). 스테이지는 0 */
  floors: number;
}

/** 끝없는 탑에서 다 깬 층 수 (스테이지는 0) */
export const floorsOf = (s: RunState) => (s.cfg.mode !== 'tower' ? 0 : s.phase === 'clear' ? s.cfg.waves.length : s.wave);

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
    floors: floorsOf(s),
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
 * 조준선 미리보기: 이번 대원이 각도 a 로 날아갈 때 첫 벽(방 테두리·네모 돌기둥·둥근 돌기둥)에 닿는 곳까지.
 * 요괴는 무시한다 (첫 벽까지만 보여 준다). 돌려주는 점 = [시작, 첫 벽에 닿을 때의 대원 가운데]
 */
export function aimPreview(s: RunState, a: number): [number, number][] {
  const h = s.heroes[s.cur];
  const [dx, dy] = dirOf(a);
  const r = h.r;
  let best = Infinity;
  for (const w of s.room.walls) {
    const t = rayCapsule(h.x, h.y, dx, dy, w, r);
    if (t !== null && t < best) best = t;
  }
  if (s.room.pillars)
    for (const p of s.room.pillars) {
      const t = rayCircle(h.x, h.y, dx, dy, p[0], p[1], p[2] + r);
      if (t !== null && t < best) best = t;
    }
  if (best === Infinity) best = 0;
  return [
    [h.x, h.y],
    [h.x + dx * best, h.y + dy * best],
  ];
}

/** 점 (x,y) 에서 방향 (dx,dy) 반직선이 원 (cx,cy,R) 에 처음 닿는 거리 (닿지 않거나 뒤쪽이면 null) */
function rayCircle(x: number, y: number, dx: number, dy: number, cx: number, cy: number, R: number): number | null {
  const fx = x - cx;
  const fy = y - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

/** 점 (x,y) 에서 방향 (dx,dy) 로 반지름 r 원이 선분에 닿는 거리 (닿지 않으면 null) */
function rayCapsule(x: number, y: number, dx: number, dy: number, w: Seg, r: number): number | null {
  let best: number | null = null;
  const take = (t: number | null) => {
    if (t !== null && t >= 0 && (best === null || t < best)) best = t;
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
  take(rayCircle(x, y, dx, dy, w[0], w[1], r));
  take(rayCircle(x, y, dx, dy, w[2], w[3], r));
  return best;
}

// ---------- 화면용 ----------

export interface Threat {
  id: number;
  kind: AttackKind;
  x: number;
  y: number;
  r: number;
  hero: number | null;
}

/** 다음 요괴 차례에 공격할 요괴들: area 는 떨어질 원(둘일 수 있다), near·double 은 노리는 대원, 그 밖은 요괴 자리 */
export function threats(s: RunState): Threat[] {
  const out: Threat[] = [];
  for (const f of s.foes) {
    if (!f.alive || f.left !== 1 || f.frozen > 0) continue;
    const kind = f.pattern[f.pi];
    if (kind === 'area') {
      if (f.aim) out.push({ id: f.id, kind, x: f.aim[0], y: f.aim[1], r: f.area, hero: null });
      if (f.aim2) out.push({ id: f.id, kind, x: f.aim2[0], y: f.aim2[1], r: f.area, hero: null });
    } else if (kind === 'near' || kind === 'double') {
      for (const t of heroesByDistance(s, f.x, f.y).slice(0, kind === 'double' ? 2 : 1)) out.push({ id: f.id, kind, x: f.x, y: f.y, r: 0, hero: t });
    } else out.push({ id: f.id, kind, x: f.x, y: f.y, r: 0, hero: null });
  }
  return out;
}
