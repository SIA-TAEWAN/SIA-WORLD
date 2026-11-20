/**
 * 손맛: 튕김 소리 높이 · 진동. 화면 쪽에서만 쓴다 (판 결과와는 상관없다).
 */

/** 한 발사 안에서 n 번째(1부터) 튕김·타격의 음 높이: 5음 음계로 한 음씩 올라가고 두 옥타브에서 멈춘다 */
const SCALE = [0, 2, 4, 7, 9];
export const CHAIN_MAX = 2 * SCALE.length;
export function chainRate(n: number): number {
  const k = Math.max(0, Math.min(CHAIN_MAX, Math.floor(n) - 1));
  const semis = 12 * Math.floor(k / SCALE.length) + SCALE[k % SCALE.length];
  return 2 ** (semis / 12);
}

interface VibrateHost {
  vibrate?: (pattern: number | number[]) => boolean;
  userActivation?: { hasBeenActive: boolean };
}

/** 진동 사이 최소 간격 (ms) */
export const BUZZ_GAP = 110;

/**
 * 짧은 진동. navigator.vibrate 가 있을 때만 (아이폰 사파리는 없다 → 아무 일도 없음), 너무 자주 울리지 않게 간격 제한.
 * 화면을 한 번도 누르지 않았으면 부르지 않는다 (크롬이 막으며 경고를 찍는다).
 */
export function makeBuzzer(host: VibrateHost | undefined = typeof navigator !== 'undefined' ? (navigator as VibrateHost) : undefined, now: () => number = () => Date.now()) {
  let last = -1e9;
  return (ms: number): boolean => {
    if (!host || typeof host.vibrate !== 'function') return false;
    if (host.userActivation && !host.userActivation.hasBeenActive) return false;
    const t = now();
    if (t - last < BUZZ_GAP) return false;
    last = t;
    try {
      return host.vibrate(Math.max(1, Math.min(60, Math.round(ms)))) !== false;
    } catch {
      return false;
    }
  };
}
