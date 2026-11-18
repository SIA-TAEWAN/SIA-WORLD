import type { ZodiacId } from './data/balance';

/** SIA WORLD 최상위 (games/survival/ 에서 두 단계 위) */
const worldRoot = () => new URL('../../', document.baseURI);
/** 십이지 전신 그림 (shared/images/zodiac/full). 12종 모두 오른쪽을 본다 */
export const zodiacFullUrl = (id: ZodiacId) => new URL(`shared/images/zodiac/full/${id}.png`, worldRoot()).href;
/** 십이지 얼굴 그림 (shared/images/zodiac/face) */
export const zodiacFaceUrl = (id: ZodiacId) => new URL(`shared/images/zodiac/face/${id}.png`, worldRoot()).href;
