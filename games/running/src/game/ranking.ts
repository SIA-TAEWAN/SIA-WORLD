import { TIER_MOON_MS, TIER_STAR_MS, TIER_SUN_MS } from './constants';

export type ResultStatus = 'finish' | 'dnf' | 'foul';

export interface RaceEntry {
  /** 자리 번호 (0~3) */
  slot: number;
  status: ResultStatus;
  /** 도착 기록 (ms). 미완주·실격은 null */
  timeMs: number | null;
  /** 달린 거리 (m) */
  x: number;
}

export interface RankedEntry extends RaceEntry {
  place: number;
}

const GROUP: Record<ResultStatus, number> = { finish: 0, dnf: 1, foul: 2 };

/**
 * 순위: 도착한 사람은 기록 빠른 순 → 미완주는 남은 거리가 짧은 순 → 실격은 맨 아래.
 * 같은 값이면 자리 번호 순 (모든 기기가 같은 순위를 보도록).
 */
export function rankResults(entries: readonly RaceEntry[]): RankedEntry[] {
  return [...entries]
    .sort((a, b) => {
      if (a.status !== b.status) return GROUP[a.status] - GROUP[b.status];
      if (a.status === 'finish') return (a.timeMs ?? 0) - (b.timeMs ?? 0) || a.slot - b.slot;
      if (a.status === 'dnf') return b.x - a.x || a.slot - b.slot;
      return a.slot - b.slot;
    })
    .map((e, i) => ({ ...e, place: i + 1 }));
}

/** 경기 중 지금 순위 (1부터): 도착한 사람 → 앞선 사람 → 실격 */
export function livePlace(entries: readonly RaceEntry[], slot: number): number {
  return rankResults(entries).find((e) => e.slot === slot)?.place ?? entries.length;
}

export type Tier = 'gold' | 'silver' | 'bronze' | 'white';

/** 등급: 해(20.5초 이내) · 달(22초 이내) · 별(25초 이내) · 구름 */
export function tierOf(ms: number): Tier {
  if (ms <= TIER_SUN_MS) return 'gold';
  if (ms <= TIER_MOON_MS) return 'silver';
  if (ms <= TIER_STAR_MS) return 'bronze';
  return 'white';
}

/** 기록 표시: 0.01초 단위 (버림) → "20.34" */
export function formatTime(ms: number): string {
  const cs = Math.floor(Math.max(0, ms) / 10);
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}
