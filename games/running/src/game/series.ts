import { isCharId, type ZodiacId } from './constants';
import type { RankedEntry } from './ranking';

/** 연속전(그랑프리) 순위별 점수: 1등 4 · 2등 3 · 3등 2 · 4등 1. 완주하지 못하면(미완주·실격) 0 */
export const PLACE_POINTS: readonly number[] = [4, 3, 2, 1];

/** 점수판 한 줄 */
export interface SeriesRow {
  /** 사람은 `u:사용자ID`, AI는 `ai:캐릭터` */
  k: string;
  name: string;
  char: ZodiacId;
  /** 누적 점수 */
  pts: number;
  /** 마지막 판에서 얻은 점수 (그 판에 달리지 않았으면 0) */
  add: number;
}

/** 한 방의 연속전 점수판 (방을 나가면 사라진다) */
export interface Series {
  /** 지금까지 센 판 수 */
  n: number;
  /** 이미 센 판 번호 (같은 판을 두 번 세지 않게, 최근 몇 개만) */
  done: number[];
  rows: SeriesRow[];
}

const MAX_ROWS = 24;
const MAX_DONE = 8;

export const newSeries = (): Series => ({ n: 0, done: [], rows: [] });

/** 점수판에서 쓰는 열쇠: 사람은 사용자 ID, AI는 캐릭터 */
export const seriesKey = (p: { id: string | null; char: string }): string => (p.id ? `u:${p.id}` : `ai:${p.char}`);

/** 한 판의 한 줄이 받는 점수 */
export function pointsFor(e: Pick<RankedEntry, 'place' | 'status'>): number {
  if (e.status !== 'finish') return 0;
  return PLACE_POINTS[e.place - 1] ?? 0;
}

/**
 * 한 판의 결과를 더한 새 점수판. 이미 센 판이면 받은 것을 그대로 돌려준다.
 * taken: AI가 이어 달린 사람 자리 (그 사람은 0점)
 * 줄이 가득 차면(24줄) 이번 판에 달리지 않은(방에 없는) 줄 가운데 오래된 것부터 버리고 새 줄을 넣는다.
 */
export function addRound(
  s: Series,
  round: number,
  roster: readonly { slot: number; id: string | null; name: string; char: ZodiacId }[],
  results: readonly RankedEntry[],
  taken: readonly boolean[] = [],
): Series {
  if (s.done.includes(round) || !results.length) return s;
  const rows = s.rows.map((r) => ({ ...r, add: 0 }));
  const here = new Set(roster.map(seriesKey));
  for (const p of roster) {
    const res = results.find((r) => r.slot === p.slot);
    if (!res) continue;
    const add = p.id && taken[p.slot] ? 0 : pointsFor(res);
    const k = seriesKey(p);
    const row = rows.find((r) => r.k === k);
    if (row) {
      row.name = p.name;
      row.char = p.char;
      row.pts += add;
      row.add = add;
    } else {
      if (rows.length >= MAX_ROWS) {
        const old = rows.findIndex((r) => !here.has(r.k));
        if (old < 0) continue;
        rows.splice(old, 1);
      }
      rows.push({ k, name: p.name, char: p.char, pts: add, add });
    }
  }
  return { n: s.n + 1, done: [...s.done, round].slice(-MAX_DONE), rows };
}

export interface Standing extends SeriesRow {
  /** 누적 순위 (같은 점수는 같은 순위) */
  rank: number;
}

/**
 * 누적 순위표: 점수 높은 순, 같은 점수는 같은 순위.
 * keys 를 주면 그 열쇠(지금 자리에 있는 사람·AI)의 줄만 골라 그 안에서 순위를 매긴다 (나간 사람 줄이 순위를 밀지 않게)
 */
export function standings(s: Series, keys?: Iterable<string>): Standing[] {
  const only = keys ? new Set(keys) : null;
  const sorted = (only ? s.rows.filter((r) => only.has(r.k)) : [...s.rows]).sort((a, b) => b.pts - a.pts || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return sorted.map((r) => ({ ...r, rank: 1 + sorted.filter((o) => o.pts > r.pts).length }));
}

/** 다른 기기에서 받은 점수판 검사: 정해진 모양·범위의 값만 골라 쓴다 (틀리면 null) */
export function cleanSeries(raw: unknown): Series | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = Number(o.n);
  if (!Number.isInteger(n) || n < 0 || n > 9999 || !Array.isArray(o.rows) || !Array.isArray(o.done)) return null;
  const done = (o.done as unknown[]).filter((d): d is number => typeof d === 'number' && Number.isInteger(d)).slice(-MAX_DONE);
  const rows: SeriesRow[] = [];
  for (const r of o.rows as unknown[]) {
    const e = (r ?? {}) as Record<string, unknown>;
    const k = e.k;
    const pts = Number(e.pts);
    const add = Number(e.add);
    if (typeof k !== 'string' || !/^(u|ai):[\w-]{1,64}$/.test(k) || rows.some((x) => x.k === k)) continue;
    if (typeof e.name !== 'string' || !isCharId(e.char)) continue;
    if (!Number.isInteger(pts) || pts < 0 || pts > 99999 || !Number.isInteger(add) || add < 0 || add > 4) continue;
    rows.push({ k, name: e.name.slice(0, 16), char: e.char, pts, add });
    if (rows.length >= MAX_ROWS) break;
  }
  return { n, done, rows };
}

/**
 * 받은 점수판으로 바꿀 것인가: 더 많은 판을 센 것이면 받고, 같은 판 수면 방장 것을 따른다.
 * (모두 자기 기기에서 더하지만, 어긋나면 방장 것으로 모인다)
 * unsure: 내가 끝 알림 없이 스스로 끝내 더한 판 번호 (확정이 아님). 그동안은 같은 판 수라도 그 판을 센 다른 사람 것을 받는다
 */
export function shouldAdopt(mine: Series, incoming: Series, fromHost: boolean, unsure: number | null = null): boolean {
  if (incoming.n > mine.n) return true;
  if (incoming.n !== mine.n || incoming.n <= 0) return false;
  return fromHost || (unsure !== null && incoming.done.includes(unsure));
}
