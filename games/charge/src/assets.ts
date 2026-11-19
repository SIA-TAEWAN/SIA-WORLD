import type { ZodiacId } from './data/balance';

/** SIA WORLD 최상위 (games/charge/ 에서 두 단계 위) */
const worldRoot = () => new URL('../../', document.baseURI);
/** 십이지 전신 그림 (shared/images/zodiac/full). 12종 모두 오른쪽을 본다 */
export const zodiacFullUrl = (id: ZodiacId) => new URL(`shared/images/zodiac/full/${id}.png`, worldRoot()).href;
/** 십이지 얼굴 그림 (shared/images/zodiac/face) */
export const zodiacFaceUrl = (id: ZodiacId) => new URL(`shared/images/zodiac/face/${id}.png`, worldRoot()).href;
/** 게임 그림 (public/art/<이름>.png, ASSETS.md). 요괴·보스·배경은 시아디펜스 그림을 그대로 쓴다 */
export const artUrl = (name: string) => `${import.meta.env.BASE_URL}art/${name}.png`;
