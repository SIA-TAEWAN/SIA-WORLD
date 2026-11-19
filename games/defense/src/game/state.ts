import { LIMIT, type ZodiacId } from '../data/balance';
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
  squad: ZodiacId[];
}

/** prep 시작 전(시간이 흐르지 않는다) · play 진행 중 · clear 클리어 · fail 실패 */
export type Phase = 'prep' | 'play' | 'clear' | 'fail';

/**
 * 플레이어의 명령: "언제(tick) 어느 칸에(slot) 무엇을(char)". 판의 입력은 이것뿐이다.
 * tick = 그 명령을 내린 순간의 걸음 수 (시작 전에는 0). char 는 place 일 때만 쓴다 (data/characters.ts 의 TOWERS 번호).
 */
export interface Cmd {
  tick: number;
  op: 'start' | 'place' | 'upgrade' | 'sell';
  slot: number;
  char: number;
}

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
  /** 요괴 종류 (ENEMIES 번호). 보스면 -1 */
  kind: number;
  /** 보스 번호 (BOSSES). 일반 요괴면 -1 */
  boss: number;
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
}

export const PROJ = { shuriken: 0, cake: 1 } as const;

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
  dmg: number;
  splash: number;
  /** 던진 뒤 흐른 시간 · 날아가는 시간 (던지는 투사체) */
  t: number;
  dur: number;
}

export const FX = { pulse: 0, slash: 1, burst: 2, pop: 3, leak: 4 } as const;

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
  /** 배치 칸의 가운데 (px) */
  slotX: number[];
  slotY: number[];
  /** 데려간 캐릭터 (TOWERS 번호) */
  squad: number[];
  rng: Rng;
  phase: Phase;
  /** 시작한 뒤의 걸음 수 · 시간 (초) */
  tick: number;
  time: number;
  lives: number;
  startLives: number;
  energy: number;
  kills: number;
  /** 지금 웨이브 (0~5, 시작 전에는 -1) */
  wave: number;
  spawns: Spawn[];
  spawnI: number;
  /** 보스 스테이지: 보스 번호와 등장 시각 (없으면 -1) · 경고를 냈나 · 보스를 잡았나 */
  bossId: number;
  bossAt: number;
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
}

export const makeEnemy = (): Enemy => ({
  alive: false, uid: 0, kind: 0, boss: -1, route: 0, d: 0, seg: 0, x: 0, y: 0, dx: 1, dy: 0, hp: 0, maxHp: 1, speed: 0, mul: 1, r: 0,
  bounty: 0, leak: 1, air: false, stun: 0, guard: 0, flash: 0, t: 0, a: 0, b: 0, c: 0,
});
export const makeTower = (): Tower => ({ char: -1, lv: 0, cd: 0, spent: 0, since: 9, face: 1 });
export const makeProj = (): Proj => ({ kind: 0, x: 0, y: 0, sx: 0, sy: 0, target: -1, uid: 0, tx: 0, ty: 0, speed: 0, dmg: 0, splash: 0, t: 0, dur: 0 });
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
