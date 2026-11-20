import { HERO_IDS, HEROES, STAGES, isHeroId, stageOf, type HeroId } from '../sim';
import { REGIONS } from '../data/regions';

/**
 * 기록 (1~3단계: 이 기기에만 저장). 4단계에서 서버 저장(finger_profiles · finger_stages)으로 옮긴다.
 * 지역 열기·대원 합류 규칙은 돌격대와 같다.
 */

export interface FingerProfile {
  /** 스테이지 id → 딴 별 (0 = 아직 못 깸) */
  stages: Record<string, number>;
  /** 마지막 파티 (쏘는 순서) */
  party: HeroId[];
}

export const emptyProfile = (): FingerProfile => ({ stages: {}, party: [] });

const KEY = (user: string) => `siafinger:profile:${user}`;

export function loadProfile(user: string): FingerProfile {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(user)) ?? 'null') as Partial<FingerProfile> | null;
    if (!raw || typeof raw !== 'object') return emptyProfile();
    const stages: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.stages ?? {})) if (stageOf(k)) stages[k] = Math.max(0, Math.min(3, Math.floor(Number(v) || 0)));
    const party = Array.isArray(raw.party) ? raw.party.filter(isHeroId).slice(0, 4) : [];
    return { stages, party: [...new Set(party)] };
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(user: string, p: FingerProfile) {
  try {
    localStorage.setItem(KEY(user), JSON.stringify(p));
  } catch {
    /* 저장 공간 없음: 이번 판만 */
  }
}

export const cleared = (p: FingerProfile, id: string) => (p.stages[id] ?? 0) > 0;
export const totalStars = (p: FingerProfile) => Object.values(p.stages).reduce((a, b) => a + b, 0);
export const regionStarsOf = (p: FingerProfile, r: number) => STAGES.filter((s) => s.region === r).reduce((a, s) => a + (p.stages[s.id] ?? 0), 0);

/** 지역 r 을 여는 데 필요한 별 (+ 앞 지역 5번째 스테이지 클리어). 돌격대와 같다 */
export const regionStars = (region: number) => (region <= 1 ? 0 : (region - 1) * 9);

export function regionOpen(p: FingerProfile, r: number): boolean {
  if (r <= 1) return true;
  if (r > REGIONS) return false;
  return cleared(p, `${r - 1}-5`) && totalStars(p) >= regionStars(r);
}

export function stageOpen(p: FingerProfile, id: string): boolean {
  const st = stageOf(id);
  if (!st || !regionOpen(p, st.region)) return false;
  return st.no === 1 || cleared(p, `${st.region}-${st.no - 1}`);
}

/** 합류한 대원: 처음 3종 + 합류 지역의 5번째 스테이지를 깬 대원 */
export function heroesOf(p: FingerProfile): HeroId[] {
  return HERO_IDS.filter((id) => HEROES[id].unlockRegion === 0 || cleared(p, `${HEROES[id].unlockRegion}-5`));
}

/** 판에 들고 갈 파티: 마지막 파티 중 합류한 대원만, 비었으면 합류한 대원 앞에서 4명 */
export function partyOf(p: FingerProfile): HeroId[] {
  const open = heroesOf(p);
  const party = p.party.filter((id) => open.includes(id));
  return party.length ? party : open.slice(0, 4);
}
