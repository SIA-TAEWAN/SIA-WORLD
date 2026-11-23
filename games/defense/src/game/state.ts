import { LIMIT, type CharId } from '../data/balance';
import type { TowerLevel } from '../data/characters';
import type { Upgrades } from '../data/growth';
import type { StageDef } from '../data/stages';
import type { Route } from './path';
import type { Rng } from './rng';

/**
 * 한 판의 상태. 계산(sim.ts)은 이 상태만 읽고 쓰며 화면·시계·Math.random 을 쓰지 않는다:
 * 같은 설정(GameConfig) + 같은 명령 목록(Cmd[]) 이면 어느 기기에서나 같은 결과가 나온다.
 * 요괴·투사체·이펙트는 미리 만들어 둔 칸을 돌려 쓴다 (걸음마다 새 객체를 만들지 않는다).
 */

export interface GameConfig {
  seed: number;
  /** 스테이지 id (예: '1-3') */
  stage: string;
  /** 데려간 캐릭터 (최대 5종). 배치 메뉴·숫자키 1~5 의 순서 */
  squad: CharId[];
  /** 판 밖 성장: 캐릭터 영구 레벨(없으면 1) · 공통 강화 (PRD 7장) */
  levels?: Partial<Record<CharId, number>>;
  upgrades?: Upgrades;
  /** 시작 생명: 판 시작 때 서버가 적어 둔 값 (별의 기준. 없으면 스테이지 값 + 공통 강화) */
  startLives?: number;
  /**
   * 오늘의 고개(game/daily.ts)의 조건: 요괴 체력 · 시작 기운 배율. 없으면 1 (보통 판은 적지 않는다 — 결과가 예전과 같다).
   * 체력 배율은 웨이브 요괴와 스테이지 보스에 곱한다 (보스가 불러내는 졸개는 그대로)
   */
  mods?: { hp?: number; energy?: number };
}

/** prep 시작 전(시간이 흐르지 않는다) · play 진행 중 · clear 클리어 · fail 실패 */
export type Phase = 'prep' | 'play' | 'clear' | 'fail';

/**
 * 플레이어의 명령: "언제(tick) 어느 칸에(slot) 무엇을(char)". 판의 입력은 이것뿐이다.
 * tick = 그 명령을 내린 순간의 걸음 수 (시작 전에는 0). char 는 place 일 때만 쓴다 (data/characters.ts 의 TOWERS 번호).
 */
export interface Cmd {
  tick: number;
  op: 'start' | 'place' | 'upgrade' | 'sell' | 'aim';
  slot: number;
  /** place: 캐릭터 번호 · aim: 조준 방식 (core.ts 의 AIM: first · strong · weak · last) */
  char: number;
}

/**
 * 활약상 (결과 화면용. 판의 진행에는 쓰이지 않는다 — 적기만 하고 계산이 읽지 않는다). 모두 캐릭터 번호(TOWERS)별 합계:
 * dmg 준 피해 · kills 처치 수 · stun 요괴를 멈춘 시간(초) · slow 요괴를 느리게 한 시간(초)
 * boost 올려 준 피해 (닭: 빨라진 만큼 더 준 피해 · 양: 느려진 동안 더 들어간 피해) · energy 벌어 준 기운 (돼지)
 */
export interface RunStats {
  dmg: number[];
  kills: number[];
  stun: number[];
  slow: number[];
  boost: number[];
  energy: number[];
}
export const makeStats = (n: number): RunStats => {
  const z = () => new Array<number>(n).fill(0);
  return { dmg: z(), kills: z(), stun: z(), slow: z(), boost: z(), energy: z() };
};

/** 걸음마다 생긴 일 (소리·연출용). a·b·x·y 의 뜻은 종류마다 다르다 */
export const EV = {
  /** 판 시작 */
  start: 0,
  /** 웨이브 시작: a = 웨이브 번호(0~5) */
  wave: 1,
  /** 배치·강화·되팔기: a = 칸, b = 캐릭터 번호 */
  place: 2,
  upgrade: 3,
  sell: 4,
  /** 공격: a = 캐릭터 번호, b = 칸 */
  fire: 5,
  /** 요괴 처치: a = 요괴 종류, x·y = 자리 */
  kill: 6,
  /** 요괴가 출구에 닿음: a = 줄어든 생명 */
  leak: 7,
  /** 보스 경고·등장·처치·특수 행동: a = 보스 번호 (bossAct 의 b = 행동 단계) */
  bossWarn: 8,
  bossIn: 9,
  bossDown: 10,
  bossAct: 11,
  clear: 12,
  fail: 13,
  /** 돼지가 기운을 벌었다: a = 기운, b = 칸 */
  income: 14,
} as const;

export interface Ev {
  t: number;
  a: number;
  b: number;
  x: number;
  y: number;
}

export interface Enemy {
  alive: boolean;
  /** 판 안에서 겹치지 않는 번호 (투사체가 과녁을 기억할 때) */
  uid: number;
  /** 요괴 종류 (ENEMIES 번호) */
  kind: number;
  /** 보스 번호 (BOSSES). 일반 요괴면 -1 */
  boss: number;
  /** 보스의 분신·마디: 이 보스의 그림으로 그린다 (아니면 -1) */
  look: number;
  route: number;
  /** 길을 따라 온 거리 · 지금 구간 */
  d: number;
  seg: number;
  x: number;
  y: number;
  /** 진행 방향 */
  dx: number;
  dy: number;
  hp: number;
  maxHp: number;
  speed: number;
  /** 속도 배율 (보스의 돌진 등 특수 행동이 바꾼다) */
  mul: number;
  r: number;
  bounty: number;
  leak: number;
  air: boolean;
  /** 멈춤이 남은 시간 · 멈춤이 다시 먹히기까지 남은 시간 */
  stun: number;
  guard: number;
  /** 감속: 남은 시간과 속도 배율 · 그동안 더 받는 피해 비율 */
  slowT: number;
  slow: number;
  vuln: number;
  /** 독·불: 남은 시간과 초당 피해 */
  dotT: number;
  dot: number;
  /** 활약상용: 독·불을 건 캐릭터 · 느리게 한 캐릭터 · 피해를 더 받게 한 캐릭터 (TOWERS 번호, 없으면 -1) */
  dotBy: number;
  slowBy: number;
  vulnBy: number;
  /** 다른 요괴가 빠르게 해 주는 시간 (수문장 대장) */
  rush: number;
  /** 회복: 초당 최대 체력 비율 */
  regen: number;
  /** 받는 피해가 줄어드는 비율 (0 = 그대로, 1 = 무적) · 정면 방패 배율 (1 = 없음) */
  armor: number;
  shield: number;
  /** 주기 특성(은신·무적)의 시계와 지금 켜져 있나 */
  cyc: number;
  on: boolean;
  stealth: boolean;
  ghost: boolean;
  /** 감지되어 드러나 있는 시간 */
  seen: number;
  /** 되살아날 수 있는 횟수 · 쓰러져 있는 시간 (그동안 노릴 수 없다) */
  revive: number;
  down: number;
  /** 사라져 있는 시간 (보스의 특수 행동: 노릴 수도 맞힐 수도 없다) */
  gone: number;
  /** 맞아서 번쩍이는 시간 (그리기용) */
  flash: number;
  /** 나온 뒤 흐른 시간 */
  t: number;
  /** 특수 행동이 쓰는 값 (보스마다 뜻이 다르다) */
  a: number;
  b: number;
  c: number;
}

export interface Tower {
  /** 캐릭터 번호 (TOWERS). 빈 칸이면 -1 */
  char: number;
  /** 강화 단계 1~3 */
  lv: number;
  /** 다음 공격까지 남은 시간 */
  cd: number;
  /** 지금까지 쓴 기운 (되팔기 환급 계산) */
  spent: number;
  /** 마지막으로 공격한 뒤 흐른 시간 · 그때 겨눈 쪽 (그리기용) */
  since: number;
  face: number;
  /** 둘레의 닭이 올려 주는 공격 속도 (0.2 = +20%) · 올려 주는 캐릭터 (활약상용, 없으면 -1) */
  haste: number;
  hasteBy: number;
  /** 플레이어가 고른 조준 방식 (AIM 의 first · strong · weak · last). -1 = 캐릭터의 기본값 그대로 */
  aim: number;
  /** 쓸 수 없는 시간 (보스가 멈추거나 칸을 태웠다. 빈 칸이면 그동안 놓을 수 없다) */
  off: number;
  /** 공격이 느려진 시간 (저승사자의 표식) */
  mark: number;
}

/** 투사체 그림 (scenes/art.ts 의 PROJ_KEYS 순서) */
export const PROJ = { shuriken: 0, cake: 1, venom: 2, arrow: 3, stone: 4, feather: 5, puppy: 6 } as const;

export interface Proj {
  kind: number;
  x: number;
  y: number;
  /** 출발 자리 (포물선 그리기용) */
  sx: number;
  sy: number;
  /** 과녁: 쫓아가는 투사체는 요괴(칸 번호 + uid), 던지는 투사체는 떨어질 자리 */
  target: number;
  uid: number;
  tx: number;
  ty: number;
  speed: number;
  /** 던진 캐릭터와 그때의 강화 단계 (맞았을 때의 효과를 s.lv[char][lv] 에서 읽는다) */
  char: number;
  lv: number;
  /** 던진 뒤 흐른 시간 · 날아가는 시간 (던지는 투사체) */
  t: number;
  dur: number;
  /** 활약상용: 던질 때 받고 있던 공격 속도 보너스와 그것을 준 캐릭터 */
  boost: number;
  boostBy: number;
}

export const FX = { pulse: 0, slash: 1, burst: 2, pop: 3, leak: 4, beam: 5, cloud: 6, zap: 7, puff: 8 } as const;

export interface Fx {
  kind: number;
  x: number;
  y: number;
  r: number;
  /** 각도 등 */
  a: number;
  life: number;
  maxLife: number;
}

/** 돌려 쓰는 묶음: items[0..n) 이 살아 있는 것 (지울 때는 마지막 것과 자리를 바꾼다) */
export interface Pool<T> {
  items: T[];
  n: number;
}

export function makePool<T>(size: number, make: () => T): Pool<T> {
  return { items: Array.from({ length: size }, make), n: 0 };
}

/** 한 칸을 꺼낸다 (가득 찼으면 null) */
export function take<T>(p: Pool<T>): T | null {
  return p.n < p.items.length ? p.items[p.n++] : null;
}

/** i 번째를 지운다 (마지막 것이 그 자리로 온다) */
export function drop<T>(p: Pool<T>, i: number) {
  const last = --p.n;
  if (i !== last) {
    const t = p.items[i];
    p.items[i] = p.items[last];
    p.items[last] = t;
  }
}

/** 등장 예정 하나 (판을 만들 때 스테이지의 웨이브를 시각 순으로 펴 둔다) */
export interface Spawn {
  /** 등장 시각 (초) */
  t: number;
  /** 요괴 종류. 보스면 -1 */
  kind: number;
  boss: number;
  route: number;
  hpMul: number;
}

export interface State {
  cfg: GameConfig;
  stage: StageDef;
  routes: Route[];
  /** 땅 위 길의 번호들 (보스의 분신·소환이 쓴다) */
  ground: number[];
  /** 배치 칸의 가운데 (px) */
  slotX: number[];
  slotY: number[];
  /** 데려간 캐릭터 (TOWERS 번호) */
  squad: number[];
  /**
   * 이 판에서 쓰는 캐릭터 수치: 데이터(TOWERS)에 영구 레벨의 배율을 곱해 둔 것. lv[캐릭터 번호][강화 단계 - 1]
   * cost[캐릭터 번호] = 배치 비용, up[캐릭터 번호] = 2·3단계로 올리는 비용
   */
  lv: TowerLevel[][];
  cost: number[];
  up: [number, number][];
  /** 되팔기 환급 비율 · 처치 기운 배율 (공통 강화) */
  sellRate: number;
  gain: number;
  rng: Rng;
  phase: Phase;
  /** 시작한 뒤의 걸음 수 · 시간 (초) */
  tick: number;
  time: number;
  lives: number;
  startLives: number;
  energy: number;
  kills: number;
  /** 3단계 돼지가 벌어 준 엽전 */
  bonus: number;
  /** 끝없는 모드인가 (웨이브를 그때그때 만들고, 클리어가 없다) */
  endless: boolean;
  /** 이 판에서 만난 요괴·보스 (도감용. 비트 = ENEMIES · BOSSES 번호) */
  seenE: number;
  seenB: number;
  /** 지금 웨이브 (0~5, 시작 전에는 -1) */
  wave: number;
  spawns: Spawn[];
  spawnI: number;
  /** 보스 스테이지: 보스 번호와 등장 시각 (없으면 -1) · 경고를 냈나 · 보스를 잡았나
   *  (끝없는 모드: bossAt · bossNext 는 다음에 나올 보스의 등장 시각과 번호 — 웨이브가 시작될 때 정해진다) */
  bossId: number;
  bossAt: number;
  bossNext: number;
  bossWarned: boolean;
  bossDown: boolean;
  /** 요괴: 칸이 고정이다 (0..enemyHi 까지 훑고 alive 인 것만). enemyN = 살아 있는 수 */
  enemies: Enemy[];
  enemyHi: number;
  enemyN: number;
  uid: number;
  /** 배치 칸마다 하나 (빈 칸은 char = -1) */
  towers: Tower[];
  projectiles: Pool<Proj>;
  fx: Pool<Fx>;
  /** 이번 걸음(또는 방금 내린 명령)에 생긴 일: events[0..evN) */
  events: Ev[];
  evN: number;
  /** 지금까지 받은 명령 (다시 돌려 보기·서버 검증용) */
  log: Cmd[];
  /** 활약상 집계 · 지금 피해를 주고 있는 캐릭터(없으면 -1)와 그 캐릭터가 받는 공격 속도 보너스 */
  stats: RunStats;
  src: number;
  srcBoost: number;
  srcBoostBy: number;
}

export const makeEnemy = (): Enemy => ({
  alive: false, uid: 0, kind: 0, boss: -1, look: -1, route: 0, d: 0, seg: 0, x: 0, y: 0, dx: 1, dy: 0, hp: 0, maxHp: 1, speed: 0, mul: 1, r: 0,
  bounty: 0, leak: 1, air: false, stun: 0, guard: 0, slowT: 0, slow: 1, vuln: 0, dotT: 0, dot: 0, dotBy: -1, slowBy: -1, vulnBy: -1, rush: 0, regen: 0, armor: 0, shield: 1,
  cyc: 0, on: false, stealth: false, ghost: false, seen: 0, revive: 0, down: 0, gone: 0, flash: 0, t: 0, a: 0, b: 0, c: 0,
});
export const makeTower = (): Tower => ({ char: -1, lv: 0, cd: 0, spent: 0, since: 9, face: 1, haste: 0, hasteBy: -1, aim: -1, off: 0, mark: 0 });
export const makeProj = (): Proj => ({ kind: 0, x: 0, y: 0, sx: 0, sy: 0, target: -1, uid: 0, tx: 0, ty: 0, speed: 0, char: 0, lv: 0, t: 0, dur: 0, boost: 0, boostBy: -1 });
export const makeFx = (): Fx => ({ kind: 0, x: 0, y: 0, r: 0, a: 0, life: 0, maxLife: 1 });
export const makeEv = (): Ev => ({ t: 0, a: 0, b: 0, x: 0, y: 0 });

/** 생긴 일을 적는다 (한 걸음에 너무 많으면 넘치는 것은 버린다 — 화면은 상태를 보고 판정을 다시 확인한다) */
export function emit(s: State, t: number, a = 0, b = 0, x = 0, y = 0) {
  if (s.evN >= LIMIT.events) return;
  const e = s.events[s.evN++];
  e.t = t;
  e.a = a;
  e.b = b;
  e.x = x;
  e.y = y;
}

export function addFx(s: State, kind: number, x: number, y: number, r: number, life: number, a = 0) {
  const f = take(s.fx);
  if (!f) return;
  f.kind = kind;
  f.x = x;
  f.y = y;
  f.r = r;
  f.a = a;
  f.life = f.maxLife = life;
}
