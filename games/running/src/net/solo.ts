import type { ZodiacId } from '../game/constants';
import { dailyRoomKey, dailyTrack, dailyTrackSeed } from '../game/daily';
import { aiName, lineup, type SeatRole } from '../game/lineup';
import { acceptGhost, ghostName, type Ghost } from '../game/ghost';
import { GO_GAP_MS, GoTooSoonError, serverNow, type GoInfo, type GhostTop, type RaceApi, type SubmitResult } from './api';

/**
 * 오늘의 도전 한 판 (2026-11-23: 방 경기를 없애고 혼자 + AI 로만 달린다. 실시간 채널 없음).
 * - 방 키: 'daily' + 8자 (서버 083 의 race_daily_submit 이 `^daily[a-z0-9]{4,19}$` 인 방에서 혼자 달린 판만 받는다).
 *   한 번 연 화면(탭)에서는 같은 키를 쓰고, 판 번호는 서버 race_go 가 매긴다.
 * - GO 시각은 race_go 로 받는다. 같은 사람이 4초 안에 다시 부르면 'too soon' → 남은 시간만큼 기다렸다 다시.
 * - 기록: race_submit → (서버가 받았으면) race_daily_submit. 기존 재시도 규칙(api.dailySubmit) 그대로.
 */

/** 출전 명단 한 줄 */
export interface RosterEntry {
  slot: number;
  /** 나면 사용자 ID, AI·고스트면 null */
  id: string | null;
  name: string;
  char: ZodiacId;
  role: SeatRole;
}

/** 한 판의 시작 정보 (모두 서버 시각 ms) */
export interface SoloStart {
  /** 방 키 (race_go · race_submit · race_daily_submit 에 같이 보낸다) */
  key: string;
  round: number;
  /** 트랙 시드 = 그날의 시드 (모두 같은 트랙) */
  seed: number;
  readyAt: number;
  goAt: number;
  /** 오늘의 도전 날짜 'YYYY-MM-DD' */
  day: string;
  roster: RosterEntry[];
  /** 같이 달리는 1위 고스트 (재생 확인을 마친 것). 없으면 null → AI 3명 */
  ghost?: GhostRun | null;
}

/** 이번 판의 고스트: 확인한 기록 + 그 사람 정보 (race_ghost_top) */
export interface GhostRun {
  ghost: Ghost;
  nickname: string;
  /** 그날 순위 (1위 것이 없으면 다른 순위) */
  dayPlace: number;
  /** 그 사람의 역대 최고 기록 순위 (race_ranking 의 place, 없으면 null) */
  place: number | null;
  /** 내 기록의 고스트인가 (내가 1위) */
  me: boolean;
}

/** race_ghost_top 의 답을 확인한 고스트로: 형식·날짜·재생 기록(±10ms)이 맞지 않으면 null (→ AI 3명) */
export function ghostRunOf(top: GhostTop | null, day: string): GhostRun | null {
  if (!top) return null;
  const ghost = acceptGhost(top.ghost, day, dailyTrack(day));
  if (!ghost) return null;
  return { ghost, nickname: top.nickname, dayPlace: top.dayPlace, place: top.place, me: top.me };
}

/** 고스트를 기다리는 최대 시간: 못 받으면 기다리지 않고 AI 3명으로 */
export const GHOST_WAIT_MS = 2000;

/** 그날 1위 고스트 읽기 + 확인. 시간 안에 못 받거나 실패하면 null */
export function loadGhostRun(api: RaceApi, day: string, timeoutMs = GHOST_WAIT_MS): Promise<GhostRun | null> {
  const read = api
    .ghostTop(day)
    .then((top) => ghostRunOf(top, day))
    .catch(() => null);
  return Promise.race([read, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
}

/** 'too soon' 으로 거절된 뒤 다시 묻기까지 기다릴 시간 (ms). lastGoAt: 마지막으로 GO 를 받은 시각 (모르면 0) */
export function tooSoonWait(lastGoAt: number, now: number): number {
  const left = lastGoAt ? lastGoAt + GO_GAP_MS - now : GO_GAP_MS;
  // 남은 시간을 모르거나(새로 열었음) 계산이 어긋나면 4초를 통째로 기다린다 (짧은 간격으로 계속 두드리지 않게)
  return (left > 0 && left <= GO_GAP_MS ? left : GO_GAP_MS) + 300;
}

/** 명단 만들기: 고스트가 있으면 나 + 고스트 + AI 2명, 없으면 나 + AI 3명 */
export function soloRoster(me: { id: string; name: string }, char: ZodiacId, seed: number, ghost: { char: ZodiacId; name: string } | null = null): RosterEntry[] {
  return lineup(char, ghost?.char ?? null, seed).map((s) => ({
    slot: s.slot,
    id: s.role === 'me' ? me.id : null,
    name: s.role === 'me' ? me.name : s.role === 'ghost' ? (ghost?.name ?? '') : aiName(s.char),
    char: s.char,
    role: s.role,
  }));
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 이 화면(탭)에서 여는 오늘의 도전 판들 */
export class SoloSession {
  readonly key: string;
  /** 마지막으로 서버에서 GO 를 받은 시각 (서버 시각 ms, 없으면 0) */
  private lastGoAt = 0;
  private synced = false;

  constructor(
    private api: RaceApi,
    readonly me: { id: string; name: string },
    rand: () => number = Math.random,
    private sleep: (ms: number) => Promise<void> = sleepMs,
  ) {
    this.key = dailyRoomKey(rand);
  }

  /**
   * 서버에서 GO 시각을 받는다. 'too soon' 이면 남은 시간만 기다렸다 다시 (몇 번까지).
   * 기다리는 사이 취소되면(cancelled) null. 끝내 못 받으면 예외.
   */
  async go(cancelled: () => boolean = () => false): Promise<GoInfo | null> {
    if (!this.synced) {
      this.synced = true;
      await this.api.syncClock().catch(() => undefined);
    }
    let lastErr: unknown = null;
    for (let i = 0; i < 4; i++) {
      if (cancelled()) return null;
      try {
        const g = await this.api.go(this.key);
        this.lastGoAt = serverNow();
        return cancelled() ? null : g;
      } catch (e) {
        lastErr = e;
        // 'too soon' 은 남은 시간만큼, 다른 실패는 1초 쉬고 다시
        await this.sleep(e instanceof GoTooSoonError ? tooSoonWait(this.lastGoAt, serverNow()) : 1000);
      }
    }
    throw lastErr ?? new Error('go failed');
  }

  /**
   * 한 판을 연다: GO 시각 + 그날 트랙 + 명단. 취소되면 null.
   * ghost: 같이 달릴 고스트 (부르는 쪽이 시간 제한을 건다). race_go 는 고스트를 받은 **뒤에** 부른다 —
   * 함께 기다리면 느린 통신에서 화면이 뜰 때 이미 GO 가 지나 있었다 (GO 는 race_go 를 부른 때부터 lead_ms 뒤).
   */
  async start(
    char: ZodiacId,
    day: string,
    cancelled: () => boolean = () => false,
    rand: () => number = Math.random,
    ghost: Promise<GhostRun | null> = Promise.resolve(null),
  ): Promise<SoloStart | null> {
    const gr = await ghost.catch(() => null);
    if (cancelled()) return null;
    const g = await this.go(cancelled);
    if (!g) return null;
    const run = gr && gr.ghost.day === day ? gr : null;
    return {
      key: this.key,
      round: g.round,
      seed: dailyTrackSeed(day),
      readyAt: g.readyAt,
      goAt: g.goAt,
      day,
      roster: soloRoster(this.me, char, Math.floor(rand() * 0x7fffffff), run ? { char: run.ghost.char, name: ghostName(run.dayPlace, run.nickname) } : null),
      ghost: run,
    };
  }
}

/** 완주 기록 올리기: race_submit → 서버가 받았으면 race_daily_submit (그날 기록). dailySaved 는 들어간 날짜 또는 null */
export function submitRun(api: RaceApi, key: string, round: number, ms: number, char: ZodiacId, day: string | null): { record: Promise<SubmitResult>; dailySaved: Promise<string | null> | null } {
  const record = api.submit(key, round, ms, char);
  // 서버가 받은 완주 기록만 오늘의 도전에 넣는다 (083_race_daily.sql 이 race_runs 를 읽는다)
  const dailySaved = day ? record.then((rec) => (rec.saved ? api.dailySubmit(key, round, day) : null)).catch(() => null) : null;
  return { record, dailySaved };
}

/**
 * 고스트 올리기: 오늘의 도전 기록이 들어간 판(daily 가 그 날짜)만 race_ghost_submit. 실패해도 조용히, 한 번 더 해 본다.
 * 테스트 모드(local)는 서버 없이 기기에 그날 내 최고 고스트를 둔다.
 * → 올렸으면 true
 */
export async function submitGhost(api: RaceApi, key: string, round: number, ghost: Ghost, daily: Promise<string | null> | null, wait = 1500): Promise<boolean> {
  const day = api.kind === 'local' ? ghost.day : await (daily ?? Promise.resolve(null)).catch(() => null);
  if (day !== ghost.day) return false;
  for (let i = 0; i < 2; i++) {
    if (i > 0 && wait > 0) await new Promise((r) => setTimeout(r, wait));
    const r = await api.ghostSubmit(key, round, ghost).catch(() => 'retry' as const);
    if (r !== 'retry') return r === 'ok';
  }
  return false;
}

/**
 * 예전 초대 링크(?room=코드)로 들어왔는가: 그렇다면 ?room 을 뺀 주소를, 아니면 null (순수 함수).
 * 방 경기는 없어졌으므로 토스트 한 줄 뒤 첫 화면으로 간다.
 */
export function dropRoomParam(href: string): string | null {
  const u = new URL(href);
  if (!u.searchParams.has('room')) return null;
  u.searchParams.delete('room');
  return u.toString();
}
