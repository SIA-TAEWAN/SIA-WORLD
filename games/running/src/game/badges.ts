import type { SimEvent } from './sim';

/** 결과 화면 배지 (한 판에서 내가 한 일을 SimEvent 로 세어 정한다) */
export type BadgeId = 'clean' | 'quick' | 'boostAll' | 'tumbler';

export interface Badge {
  id: BadgeId;
  icon: string;
  label: string;
  /** 무엇을 해서 받았는지 (title·읽어 주기용) */
  desc: string;
}

/** 칼출발: GO 뒤 이 시간 안에 출발 (초) */
export const QUICK_START_SEC = 0.15;
/** 오뚝이: 이만큼 넘어지고도 완주 */
export const TUMBLER_FALLS = 4;

export const BADGES: Record<BadgeId, Badge> = {
  clean: { id: 'clean', icon: '✨', label: '무결점 완주', desc: '한 번도 넘어지지 않고 완주' },
  quick: { id: 'quick', icon: '⚡', label: '칼출발', desc: `GO 뒤 ${QUICK_START_SEC}초 안에 출발` },
  boostAll: { id: 'boostAll', icon: '🚀', label: '부스트 싹쓸이', desc: '부스트 발판을 모두 밟음' },
  tumbler: { id: 'tumbler', icon: '🪀', label: '오뚝이', desc: `${TUMBLER_FALLS}번 넘어지고도 완주` },
};
/** 보이는 순서 */
export const BADGE_ORDER: readonly BadgeId[] = ['clean', 'quick', 'boostAll', 'tumbler'];

/** 한 판 동안 센 것 */
export interface Tally {
  /** 출발한 시각 (GO 뒤 초). 출발 전이면 null */
  startT: number | null;
  /** 넘어지거나 미끄러진 횟수 (허들·낮은 막대·통나무·바나나) */
  falls: number;
  /** 밟은 부스트 발판 수 */
  boosts: number;
  jumps: number;
  slides: number;
  /** 진흙에 들어간 횟수 */
  muds: number;
  finished: boolean;
}

export const newTally = (): Tally => ({ startT: null, falls: 0, boosts: 0, jumps: 0, slides: 0, muds: 0, finished: false });

const FALL_EVENTS: readonly SimEvent[] = ['hurdle', 'bar', 'log', 'banana'];

/** 생긴 일 하나를 센다. t: 그 일이 생긴 걸음의 시각 (GO 뒤 초 = Runner.t) */
export function tallyEvent(tally: Tally, ev: SimEvent, t: number): void {
  if (ev === 'start') {
    if (tally.startT === null) tally.startT = t;
  } else if (FALL_EVENTS.includes(ev)) tally.falls++;
  else if (ev === 'boost') tally.boosts++;
  else if (ev === 'jump') tally.jumps++;
  else if (ev === 'slide') tally.slides++;
  else if (ev === 'mud') tally.muds++;
  else if (ev === 'finish') tally.finished = true;
}

/**
 * 받은 배지 (보이는 순서대로).
 * boostTotal: 이 판의 트랙에 놓인 부스트 발판 수 (0이면 '부스트 싹쓸이'는 없다)
 * - 무결점 완주·오뚝이는 완주해야 받는다. 칼출발·부스트 싹쓸이는 완주하지 못해도 받는다.
 */
export function badgesOf(tally: Tally, boostTotal: number): Badge[] {
  const got = new Set<BadgeId>();
  if (tally.finished && tally.falls === 0) got.add('clean');
  // 계산이 고정 간격(1/120초)이라 딱 0.15초에 누른 것이 부동소수 오차로 빠지지 않게 아주 조금 여유를 둔다
  if (tally.startT !== null && tally.startT <= QUICK_START_SEC + 1e-6) got.add('quick');
  if (boostTotal > 0 && tally.boosts >= boostTotal) got.add('boostAll');
  if (tally.finished && tally.falls >= TUMBLER_FALLS) got.add('tumbler');
  return BADGE_ORDER.filter((id) => got.has(id)).map((id) => BADGES[id]);
}
