import type { RunMode } from '../data/balance';
import { worldSurvivalRanking } from './world';

/** 랭킹 한 줄 (shared/ranking-dialog.js 의 getSurvivalRanking 이 주는 모양에서 쓰는 것만) */
export interface RankRow {
  key: string;
  nickname: string;
  time: number;
  kills: number;
  /** 최종 보스를 잡았나 (4분·헬 모드. 무한 모드에는 없다) */
  cleared?: boolean;
  place: number;
}

/**
 * 내 바로 위 사람과의 차이.
 *   first: 내가 1등 · time: 생존 시간 차이(초) · clear: 생존 시간이 같고 위 사람만 클리어 · kills: 시간·클리어가 같아 처치 수 차이
 *   · tie: 모두 같다 (먼저 달성한 쪽이 위). 랭킹의 순서와 같다: 생존 시간 → 클리어 → 처치 수
 *   above: 견준 사람의 순위 · out: 내가 상위 목록 밖이라 목록의 마지막 사람(100등)과 견줬다
 */
export type RankGap =
  | { kind: 'first'; place: 1 }
  | { kind: 'time' | 'kills'; place: number; name: string; amount: number; above: number; out: boolean }
  | { kind: 'clear' | 'tie'; place: number; name: string; above: number; out: boolean };

/** rows: 순위 순 상위 목록, mine: 내 줄 (목록 밖이어도 된다). 알 수 없으면 null */
export function rankGap(rows: readonly RankRow[], mine: RankRow | null): RankGap | null {
  if (!mine || !Number.isFinite(mine.place) || mine.place < 1) return null;
  if (mine.place === 1) return { kind: 'first', place: 1 };
  // 내 바로 위: 나보다 순위가 높은 줄 가운데 가장 가까운 사람 (내가 목록 밖이면 목록의 마지막 사람)
  let above: RankRow | null = null;
  for (const r of rows) if (r.key !== mine.key && r.place < mine.place && (!above || r.place > above.place)) above = r;
  if (!above) return null;
  const base = { place: mine.place, name: above.nickname, above: above.place, out: !rows.some((r) => r.key === mine.key) };
  const sec = Math.floor(above.time) - Math.floor(mine.time);
  if (sec > 0) return { kind: 'time', ...base, amount: sec };
  // 시간이 같으면 클리어한 쪽이 위: 처치 수를 아무리 올려도 클리어 없이는 못 넘는다
  if (sec === 0 && above.cleared === true && mine.cleared !== true) return { kind: 'clear', ...base };
  const kills = above.kills - mine.kills;
  if (sec === 0 && kills > 0 && !!above.cleared === !!mine.cleared) return { kind: 'kills', ...base, amount: kills };
  return { kind: 'tie', ...base };
}

/** 이 맵·모드 랭킹에서 내 위 한 명과의 차이. 기록이 없거나 못 읽으면 null (던지지 않는다) */
export async function loadRankGap(map: string, meId: string, mode: RunMode = 'normal'): Promise<RankGap | null> {
  try {
    if (!meId) return null;
    const r = await worldSurvivalRanking(map, meId, mode);
    return r ? rankGap(r.rows, r.mine) : null;
  } catch {
    return null;
  }
}
