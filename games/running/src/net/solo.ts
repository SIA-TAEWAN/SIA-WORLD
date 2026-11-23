import type { ZodiacId } from '../game/constants';
import { dailyRoomKey, dailyTrackSeed } from '../game/daily';
import { aiName, lineup, type SeatRole } from '../game/lineup';
import { GO_GAP_MS, GoTooSoonError, serverNow, type GoInfo, type RaceApi, type SubmitResult } from './api';

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
}

/** 'too soon' 으로 거절된 뒤 다시 묻기까지 기다릴 시간 (ms). lastGoAt: 마지막으로 GO 를 받은 시각 (모르면 0) */
export function tooSoonWait(lastGoAt: number, now: number): number {
  const left = lastGoAt ? lastGoAt + GO_GAP_MS - now : GO_GAP_MS;
  // 남은 시간을 모르거나(새로 열었음) 계산이 어긋나면 4초를 통째로 기다린다 (짧은 간격으로 계속 두드리지 않게)
  return (left > 0 && left <= GO_GAP_MS ? left : GO_GAP_MS) + 300;
}

/** 명단 만들기 (지금은 고스트 없음: 나 + AI 3명. 3단계에서 오늘 1위의 고스트가 들어온다) */
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

  /** 한 판을 연다: GO 시각 + 그날 트랙 + 명단. 취소되면 null */
  async start(char: ZodiacId, day: string, cancelled: () => boolean = () => false, rand: () => number = Math.random): Promise<SoloStart | null> {
    const g = await this.go(cancelled);
    if (!g) return null;
    return {
      key: this.key,
      round: g.round,
      seed: dailyTrackSeed(day),
      readyAt: g.readyAt,
      goAt: g.goAt,
      day,
      roster: soloRoster(this.me, char, Math.floor(rand() * 0x7fffffff)),
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
 * 예전 초대 링크(?room=코드)로 들어왔는가: 그렇다면 ?room 을 뺀 주소를, 아니면 null (순수 함수).
 * 방 경기는 없어졌으므로 토스트 한 줄 뒤 첫 화면으로 간다.
 */
export function dropRoomParam(href: string): string | null {
  const u = new URL(href);
  if (!u.searchParams.has('room')) return null;
  u.searchParams.delete('room');
  return u.toString();
}
