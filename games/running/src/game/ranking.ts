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

/**
 * 등급: 역대 최고 기록 순위(서버 race_ranking 뷰의 place)로 정한다. 1위 해 · 2위 달 · 3위 별 — 각각 한 명뿐.
 * 4위부터와 순위 없음(기록 없음·못 읽음)은 구름. shared/ranking-dialog.js 의 raceTierOfPlace 와 같은 기준
 */
export function tierOfPlace(place: number | null | undefined): Tier {
  if (place === 1) return 'gold';
  if (place === 2) return 'silver';
  if (place === 3) return 'bronze';
  return 'white';
}

/** 기록 표시: 0.01초 단위 (버림) → "20.34" */
export function formatTime(ms: number): string {
  const cs = Math.floor(Math.max(0, ms) / 10);
  return `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, '0')}`;
}
