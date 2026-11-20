import type { HeroId } from './sim';

/** SIA WORLD 최상위 (games/finger/ 에서 두 단계 위) */
const worldRoot = () => new URL('../../', document.baseURI);
/** 십이지 얼굴 그림 (shared/images/zodiac/face) — 파티 줄 구슬 안에 넣는다 */
export const zodiacFaceUrl = (id: HeroId) => new URL(`shared/images/zodiac/face/${id}.png`, worldRoot()).href;
/** 십이지 전신 그림 (shared/images/zodiac/full) — 판 위 대원 */
export const zodiacFullUrl = (id: HeroId) => new URL(`shared/images/zodiac/full/${id}.png`, worldRoot()).href;
/** 게임 그림 (public/art/<이름>.png, ASSETS.md). 요괴·보스·바닥은 시아디펜스·시아돌격대 그림을 그대로 쓴다 */
export const artUrl = (name: string) => `${import.meta.env.BASE_URL}art/${name}.png`;
/** 로비 카드 그림 (shared/images/card-finger.png, 있는 그림 합성) — 전용 메인 그림이 없을 때 메인 화면에 쓴다 */
export const cardUrl = () => new URL('shared/images/card-finger.png', worldRoot()).href;
