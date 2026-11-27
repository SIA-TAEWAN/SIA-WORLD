// 내 진행 (M3: 이 기기에만 저장 · M5 에서 서버로 옮긴다).
// cleared = 아케이드에서 처음으로 깬 가장 높은 스테이지 번호. 기체 해금 · 스테이지 연습 · 모드 열림이 여기서 나온다.
import { SHIPS, SHIP_ORDER, type ShipId } from '../data/ships';
import type { Difficulty } from './sim';

export interface Progress {
  cleared: number;
  /** 아케이드 전체 클리어 (보스 러시가 열린다) */
  allClear: boolean;
  catOwned: boolean;
  best: Record<Difficulty, number>;
  practice: Record<number, number>;
  /** 보스 러시 전체 클리어 최단 시간 (초, 0 = 없음) · 끝없는 모드 최장 시간 (초) */
  rushBest: number;
  endlessBest: number;
  ship: ShipId;
  difficulty: Difficulty;
}

export const LAST_STAGE = 12;
const KEY = 'ace:progress';

export function emptyProgress(): Progress {
  return { cleared: 0, allClear: false, catOwned: false, best: { easy: 0, normal: 0, hard: 0 }, practice: {}, rushBest: 0, endlessBest: 0, ship: 'dragon', difficulty: 'normal' };
}

export function loadProgress(): Progress {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') return { ...emptyProgress(), ...v, best: { ...emptyProgress().best, ...(v.best ?? {}) } };
  } catch { /* 처음부터 */ }
  return emptyProgress();
}

export function saveProgress(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 저장 못 해도 이번 판은 그대로 */ }
}

/** 이 기체를 탈 수 있는가 */
export function shipOpen(p: Progress, id: ShipId, all = false) {
  const u = SHIPS[id].unlock;
  // 고양이호는 관리자 · 시험 판이어도 산 뒤에만 (서버 _check_character 가 관리자도 막는다)
  if (u === 'buy') return p.catOwned;
  return all || p.cleared >= u;
}

/** 스테이지 n 을 처음 깼을 때 새로 열리는 기체 */
export function unlockedBy(n: number): ShipId | null {
  return SHIP_ORDER.find(id => SHIPS[id].unlock === n) ?? null;
}

/** 아케이드 스테이지 n 클리어 기록. 처음 깼으면 새로 열린 기체를 돌려준다 */
export function recordClear(p: Progress, n: number): ShipId | null {
  if (n <= p.cleared) return null;
  p.cleared = n;
  if (n >= LAST_STAGE) p.allClear = true;
  return unlockedBy(n);
}

export const MODES = {
  practice: (p: Progress) => p.cleared >= 1,
  bossRush: (p: Progress) => p.allClear,
  endless: (p: Progress) => p.cleared >= 6,
};
