import { DT, END_AFTER_GO, isCharId, type ZodiacId } from './constants';
import { isDailyDay } from './daily';
import { newRunner, stepRunner, type Press, type Runner, type SimEvent } from './sim';
import type { Obstacle } from './track';

/**
 * 1위 고스트 (2026-11-23, 3단계): 오늘의 도전 한 판에서 내가 누른 버튼을 걸음 번호로 적어 두었다가 그대로 다시 달린다.
 * 달리기 계산(sim.ts)은 고정 걸음(1/120초)이라 같은 트랙에서 같은 걸음에 같은 버튼을 누르면 늘 같은 기록이 나온다.
 * 서버(095_race_ghost.sql)는 다시 달려 볼 수 없으므로, 받는 기기가 다시 달려 보고 기록이 맞을 때만 쓴다.
 * 여기는 순수 함수만 둔다 (화면·통신 없음).
 */

/** 버튼 종류: 0 출발 · 1 점프 · 2 슬라이딩 */
export type GhostKind = 0 | 1 | 2;

export interface Ghost {
  v: 1;
  /** 오늘의 도전 날짜 'YYYY-MM-DD' (그날 트랙) */
  day: string;
  /** 기록을 세울 때 쓴 캐릭터 */
  char: ZodiacId;
  /** 도착 기록 (ms) */
  ms: number;
  /** [걸음 번호(GO 뒤 첫 걸음 = 1), 버튼 종류] — 걸음 번호 오름차순, 실제로 무언가 바뀐 누름만 */
  presses: [number, GhostKind][];
}

/** 한 고스트에 적을 수 있는 누름 수 (서버도 같은 값으로 막는다) */
export const GHOST_MAX_PRESSES = 200;
/** 다시 달린 기록이 이만큼(ms)보다 더 어긋나면 쓰지 않는다 */
export const GHOST_TOLERANCE_MS = 10;
/** 걸음 번호의 끝: GO 뒤 90초 */
export const GHOST_MAX_STEP = Math.ceil(END_AFTER_GO / DT);

/** 한 걸음에서 생긴 일로 본 '실제로 들어간 누름' (아무것도 안 바뀐 누름은 null) */
export function pressKindOf(events: readonly SimEvent[]): GhostKind | null {
  if (events.includes('start')) return 0;
  if (events.includes('jump')) return 1;
  if (events.includes('slide')) return 2;
  return null;
}

/** 다시 달릴 때 그 걸음에 누를 버튼 */
export function pressOf(kind: GhostKind): Press {
  return kind === 2 ? 'slide' : kind === 1 ? 'jump' : true;
}

/** 한 판 동안 내가 누른 것을 적는다 (RaceGame 이 걸음마다 부른다) */
export class GhostRecorder {
  readonly presses: [number, GhostKind][] = [];
  /** 200개를 넘겼으면 이 판은 고스트로 남기지 않는다 */
  overflow = false;

  /** step: GO 뒤 걸음 번호 (첫 걸음 = 1). 같은 걸음에 두 번 오면 처음 것만 */
  recordPress(step: number, kind: GhostKind) {
    const last = this.presses[this.presses.length - 1];
    if (last && last[0] >= step) return;
    if (this.presses.length >= GHOST_MAX_PRESSES) {
      this.overflow = true;
      return;
    }
    this.presses.push([step, kind]);
  }

  /** 완주했을 때의 고스트 (넘쳤으면 null) */
  build(day: string, char: ZodiacId, ms: number): Ghost | null {
    if (this.overflow || !this.presses.length) return null;
    return { v: 1, day, char, ms, presses: this.presses.map(([s, k]) => [s, k]) };
  }
}

/** 형식 검사: 이상하면 null, 맞으면 깨끗하게 다시 만든 고스트 */
export function parseGhost(raw: unknown): Ghost | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  if (g.v !== 1 || !isDailyDay(g.day) || !isCharId(g.char)) return null;
  const ms = g.ms;
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms <= 0 || ms > END_AFTER_GO * 1000) return null;
  const list = g.presses;
  if (!Array.isArray(list) || list.length === 0 || list.length > GHOST_MAX_PRESSES) return null;
  const presses: [number, GhostKind][] = [];
  let prev = 0;
  for (const p of list) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [step, kind] = p as unknown[];
    if (typeof step !== 'number' || !Number.isInteger(step) || step <= prev || step > GHOST_MAX_STEP) return null;
    if (kind !== 0 && kind !== 1 && kind !== 2) return null;
    presses.push([step, kind]);
    prev = step;
  }
  return { v: 1, day: g.day, char: g.char, ms, presses };
}

/** 경기 중 고스트 자리의 버튼 (걸음 번호를 받아 그 걸음에 누를 것을 준다) */
export class GhostPlayer {
  private i = 0;
  constructor(readonly ghost: Ghost) {}
  /** step: GO 뒤 걸음 번호 (첫 걸음 = 1). 걸음 번호 순으로 불러야 한다 */
  press(step: number): Press {
    const ps = this.ghost.presses;
    while (this.i < ps.length && ps[this.i][0] < step) this.i++;
    if (this.i < ps.length && ps[this.i][0] === step) return pressOf(ps[this.i++][1]);
    return false;
  }
}

/**
 * 고스트를 처음부터 끝까지 다시 달린다 (newRunner + stepRunner, 걸음마다).
 * → 다 달린 주자 (도착 못 했으면 finishMs 가 null)
 */
export function replayGhost(ghost: Ghost, obs: readonly Obstacle[]): Runner {
  const r = newRunner();
  const player = new GhostPlayer(ghost);
  for (let step = 1; step <= GHOST_MAX_STEP && r.finishMs === null; step++) {
    stepRunner(r, obs, player.press(step));
    r.events.length = 0;
  }
  return r;
}

/**
 * 받은 고스트를 쓸지 정한다: 형식 → 날짜가 오늘 트랙과 같은가 → 다시 달린 기록이 ms 와 ±10ms 안인가.
 * 하나라도 아니면 null (그러면 AI 3명).
 */
export function acceptGhost(raw: unknown, day: string, obs: readonly Obstacle[]): Ghost | null {
  const g = parseGhost(raw);
  if (!g || g.day !== day) return null;
  const fin = replayGhost(g, obs).finishMs;
  if (fin === null || Math.abs(fin - g.ms) > GHOST_TOLERANCE_MS) return null;
  return g;
}

/** 고스트 이름표: "👻 1위 닉네임" (1위 것이 없어 다른 순위 것을 쓰면 그 순위) */
export function ghostName(dayPlace: number, nickname: string): string {
  return `👻 ${dayPlace > 0 ? dayPlace : 1}위 ${nickname}`;
}

/** '와' / '과': 마지막 글자에 받침이 있으면 '과' ('1위와', '내 1위 기록과') */
function withJosa(word: string): '와' | '과' {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 !== 0 ? '과' : '와';
}

/**
 * 결과 문구: 고스트와 내 기록의 차이. who: '1위' · '3위' · '내 1위 기록'.
 * 차이는 화면에 보이는 0.01초 단위 기록끼리 센다 (30.57 과 30.58 이면 0.01초. 보이는 기록이 같으면 '…와 똑같아요')
 */
export function ghostDiffText(myMs: number, ghostMs: number, who: string, fmt: (ms: number) => string): string {
  const d = (Math.floor(ghostMs / 10) - Math.floor(myMs / 10)) * 10;
  if (d > 0) return `${who}보다 ${fmt(d)}초 빨랐어요! 🎉`;
  if (d === 0) return `${who}${withJosa(who)} 똑같아요!`;
  return `${who}까지 ${fmt(-d)}초`;
}
