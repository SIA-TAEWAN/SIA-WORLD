/**
 * 온라인 동기화 계산 (순수 모듈: 통신·화면·시계를 직접 쓰지 않는다).
 *
 * - 방장(왼쪽) 기기가 공·득점·점수를 정한다. 방장은 스냅샷(공·점수·자기 캐릭터)을 초당 약 20번 보낸다.
 * - 각자 자기 캐릭터의 위치와 조작을 보낸다. 받은 쪽은 보낸 틱부터 지금 틱까지 같은 조작으로 이어 움직여 본다 (extrapolatePlayer).
 * - 상대(오른쪽) 기기도 같은 계산(sim)을 돌려 공과 자기 타격을 미리 보여 준다.
 *   스냅샷이 오면 그 틱부터 지금 틱까지 자기 조작 기록으로 다시 계산해서(repredict) 맞추고,
 *   화면에 보이던 자리와의 차이는 작으면 조금씩 줄이고(carryOffset → decayOffset) 크면 바로 맞춘다.
 * - 이탈: 상대 소식이 끊기면 '기다리는 중', 10초가 지나면 남은 사람 승리 (linkState).
 */
import { GROUND_Y, PLAYER_MAX_X, PLAYER_MIN_X, POINT_PAUSE_TICKS, RALLY_MAX_STAGE, WIN_SCORE } from './constants';
import { step, stepPlayerOnly, type BallState, type Input, type Phase, type PlayerState, type Side, type SimState } from './sim';

/** 틱 3번에 한 번 스냅샷 (초당 20회), 틱 2번에 한 번 위치 (초당 30회) */
export const SNAP_EVERY = 3;
export const POS_EVERY = 2;
/** 받은 위치를 이어 움직여 보는 한도 (틱). 이보다 오래된 소식은 마지막 자리에 멈춰 있다고 본다 */
export const EXTRAPOLATE_MAX = 15;
/** 다시 계산하는 한도 (틱). 스냅샷이 이보다 오래됐으면 그 틱으로 시계를 맞춘다 */
export const REPREDICT_MAX = 40;
/** 화면 차이가 이보다 크면 부드럽게 줄이지 않고 바로 맞춘다 (px) */
export const SNAP_DIST = 70;
/** 화면 차이를 틱마다 이만큼 남긴다 (0.8 → 약 0.2초에 사라진다) */
export const OFFSET_KEEP = 0.8;
/** 상대 소식이 이만큼 끊기면 '기다리는 중' (ms) */
export const LINK_WAIT_MS = 2000;
/** 상대 소식이 이만큼 끊기면 이탈 처리 (ms): 남은 사람 승리 */
export const LINK_LOST_MS = 10000;

/** 자기 캐릭터 소식 (pos 메시지) */
export interface PlayerPacket {
  /** 보낸 쪽이 이만큼 계산한 뒤의 상태 */
  tick: number;
  p: PlayerState;
  in: Input;
}

/** 방장이 보내는 스냅샷 (snap 메시지) */
export interface Snapshot {
  /** 방장이 이만큼 계산한 뒤의 상태 */
  tick: number;
  ball: BallState;
  /** 방장(왼쪽) 캐릭터와 조작 */
  p: PlayerState;
  in: Input;
  phase: Phase;
  score: [number, number];
  server: Side;
  rallyTicks: number;
  stage: number;
  pause: number;
  scorer: Side | -1;
  winner: Side | -1;
  /** 지금까지 캐릭터가 공을 친 횟수 [왼쪽, 오른쪽] (상대 기기가 놓친 타격 소리를 채우려고) */
  hits: [number, number];
}

export interface Pos {
  x: number;
  y: number;
}

const copyInput = (i: Readonly<Input>): Input => ({ left: !!i.left, right: !!i.right, jump: !!i.jump });
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 받은 캐릭터 값을 믿을 수 있는 범위로 (코트 밖·이상한 값 막기) */
export function cleanPlayer(p: Readonly<PlayerState>, side: Side): PlayerState {
  const y = Math.min(GROUND_Y, Math.max(GROUND_Y - 200, num(p?.y, GROUND_Y)));
  return {
    x: Math.min(PLAYER_MAX_X[side], Math.max(PLAYER_MIN_X[side], num(p?.x, PLAYER_MIN_X[side]))),
    y,
    vx: Math.max(-5, Math.min(5, num(p?.vx))),
    vy: y >= GROUND_Y ? 0 : Math.max(-14, Math.min(30, num(p?.vy))),
    ground: y >= GROUND_Y,
  };
}

/** 받은 캐릭터 소식을 지금 틱까지 이어 움직인다: 같은 조작을 계속 누르고 있다고 보고 계산한다 */
export function extrapolatePlayer(pkt: Readonly<PlayerPacket>, side: Side, toTick: number): PlayerState {
  const p = cleanPlayer(pkt.p, side);
  const input: Input = { left: !!pkt.in?.left, right: !!pkt.in?.right, jump: !!pkt.in?.jump };
  const n = Math.max(0, Math.min(EXTRAPOLATE_MAX, toTick - pkt.tick));
  for (let i = 0; i < n; i++) stepPlayerOnly(p, side, input);
  // 너무 오래된 소식이면 그 자리에 멈춘다 (계속 걸어가지 않게)
  if (toTick - pkt.tick > EXTRAPOLATE_MAX) p.vx = 0;
  return p;
}

/** 방장: 지금 상태로 스냅샷을 만든다 */
export function makeSnapshot(s: Readonly<SimState>, input: Readonly<Input>, hits: readonly [number, number]): Snapshot {
  return {
    tick: s.tick, ball: { ...s.ball }, p: { ...s.players[0] }, in: copyInput(input), phase: s.phase, score: [s.score[0], s.score[1]], server: s.server,
    rallyTicks: s.rallyTicks, stage: s.stage, pause: s.pause, scorer: s.scorer, winner: s.winner, hits: [hits[0], hits[1]],
  };
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const playerOk = (p: unknown) => isObj(p) && fin(p.x) && fin(p.y) && fin(p.vx) && fin(p.vy);
/** 틱으로 쓸 수 있는 수: 0 이상, 한 경기(30분)를 넘지 않는 유한한 수 */
const tickOk = (v: unknown): v is number => fin(v) && v >= 0 && v <= 60 * 60 * 40;

/** 받은 캐릭터 소식(pos)이 쓸 만한 모양인가 */
export function validPacket(v: unknown): v is PlayerPacket {
  return isObj(v) && tickOk(v.tick) && playerOk(v.p) && isObj(v.in);
}

/** 받은 스냅샷이 쓸 만한 모양·범위인가 (이상한 값은 버린다) */
export function validSnapshot(v: unknown): v is Snapshot {
  if (!isObj(v)) return false;
  const s = v as unknown as Snapshot;
  const score01 = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= WIN_SCORE;
  return (
    tickOk(s.tick) && isObj(s.ball) && fin(s.ball.x) && fin(s.ball.y) && fin(s.ball.vx) && fin(s.ball.vy) && playerOk(s.p) && isObj(s.in) &&
    (s.phase === 'play' || s.phase === 'point' || s.phase === 'over') &&
    Array.isArray(s.score) && s.score.length === 2 && score01(s.score[0]) && score01(s.score[1]) &&
    (s.server === 0 || s.server === 1) && tickOk(s.rallyTicks) &&
    Number.isInteger(s.stage) && s.stage >= 0 && s.stage <= RALLY_MAX_STAGE && fin(s.pause) && s.pause >= 0 && s.pause <= POINT_PAUSE_TICKS &&
    (s.scorer === -1 || s.scorer === 0 || s.scorer === 1) && (s.winner === -1 || s.winner === 0 || s.winner === 1) &&
    // 승자가 있으면 그쪽이 3점이고 경기가 끝난 상태여야 한다
    (s.winner === -1 ? s.phase !== 'over' : s.phase === 'over' && s.score[s.winner] === WIN_SCORE) &&
    Array.isArray(s.hits) && s.hits.length === 2 && fin(s.hits[0]) && fin(s.hits[1])
  );
}

/** 자기 조작 기록 한 칸: 그 틱을 계산하기 전의 내 캐릭터와 그 틱에 누른 조작 */
export interface OwnFrame {
  p: PlayerState;
  in: Input;
}

/**
 * 상대(오른쪽) 기기: 스냅샷(방장의 tick 시점)에서 시작해 지금 틱(toTick)까지 다시 계산한다.
 * - 공·점수·방장 캐릭터는 스냅샷 값, 내 캐릭터는 그 틱의 내 기록 (없으면 fallback).
 * - 그 뒤 틱들은 내 조작 기록과 방장의 마지막 조작으로 계산한다.
 * own: 틱 → 내 기록. 돌려준 상태의 tick 은 toTick (스냅샷이 더 최신이면 스냅샷 틱).
 */
export function repredict(snap: Readonly<Snapshot>, own: ReadonlyMap<number, OwnFrame>, mine: Readonly<PlayerState>, toTick: number): SimState {
  const first = own.get(snap.tick);
  const s: SimState = {
    tick: snap.tick,
    phase: snap.phase,
    ball: { ...snap.ball },
    players: [cleanPlayer(snap.p, 0), { ...(first?.p ?? mine) }],
    score: [snap.score[0], snap.score[1]],
    server: snap.server,
    rallyTicks: snap.rallyTicks,
    stage: snap.stage,
    pause: snap.pause,
    scorer: snap.scorer,
    winner: snap.winner,
  };
  const hostIn = copyInput(snap.in);
  let lastIn: Input = first?.in ?? { left: false, right: false, jump: false };
  for (let t = snap.tick; t < toTick && s.phase !== 'over'; t++) {
    const f = own.get(t);
    if (f) lastIn = f.in;
    step(s, [hostIn, lastIn]);
  }
  return s;
}

/**
 * 화면에 보이던 자리(shown)와 새로 계산한 자리(next)의 차이를 넘겨받는다.
 * 작으면 그 차이를 들고 있다가 조금씩 줄이고(부드럽게 끌어당김), SNAP_DIST 보다 크면 0 (바로 맞춤).
 */
export function carryOffset(shown: Readonly<Pos>, next: Readonly<Pos>, snapDist = SNAP_DIST): Pos {
  const x = shown.x - next.x;
  const y = shown.y - next.y;
  if (Math.hypot(x, y) > snapDist) return { x: 0, y: 0 };
  return { x, y };
}

/** 한 틱이 지날 때마다 차이를 줄인다 (아주 작아지면 0) */
export function decayOffset(o: Readonly<Pos>, keep = OFFSET_KEEP): Pos {
  const x = o.x * keep;
  const y = o.y * keep;
  return Math.abs(x) < 0.05 && Math.abs(y) < 0.05 ? { x: 0, y: 0 } : { x, y };
}

/** 스냅샷끼리 비교해서 화면에 알릴 일을 찾는다 (상대 기기는 점수·서브·가속·끝을 방장 값으로만 알린다) */
export function snapshotEvents(prev: Readonly<Snapshot> | null, next: Readonly<Snapshot>) {
  const out: ({ t: 'point'; side: Side; x: number } | { t: 'serve'; side: Side } | { t: 'speedup'; stage: number } | { t: 'over'; winner: Side })[] = [];
  const p = prev ?? { score: [0, 0], phase: 'play' as Phase, rallyTicks: next.rallyTicks, stage: 0, winner: -1 };
  for (const side of [0, 1] as const) if (next.score[side] > p.score[side]) out.push({ t: 'point', side, x: next.ball.x });
  if (next.stage > p.stage) out.push({ t: 'speedup', stage: next.stage });
  if (next.phase === 'play' && (p.phase === 'point' || next.rallyTicks < p.rallyTicks)) out.push({ t: 'serve', side: next.server });
  if (next.winner !== -1 && p.winner === -1) out.push({ t: 'over', winner: next.winner });
  return out;
}

/** 상대와의 연결 상태 */
export interface Link {
  /** ok 정상 · waiting 소식이 끊겨 기다리는 중 · lost 10초가 지남 (남은 사람 승리) */
  state: 'ok' | 'waiting' | 'lost';
  /** 이탈 처리까지 남은 시간 (초, 올림) */
  leftSec: number;
}

/** 마지막으로 상대 소식을 들은 시각과 지금 시각으로 연결 상태를 정한다 */
export function linkState(nowMs: number, lastHeardMs: number, waitMs = LINK_WAIT_MS, lostMs = LINK_LOST_MS): Link {
  const quiet = Math.max(0, nowMs - lastHeardMs);
  if (quiet >= lostMs) return { state: 'lost', leftSec: 0 };
  if (quiet >= waitMs) return { state: 'waiting', leftSec: Math.ceil((lostMs - quiet) / 1000) };
  return { state: 'ok', leftSec: Math.ceil((lostMs - quiet) / 1000) };
}
