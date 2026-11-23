import type { CharId } from './data/balance';

/** SIA WORLD 최상위 (games/defense/ 에서 두 단계 위) */
const worldRoot = () => new URL('../../', document.baseURI);
/** 캐릭터 전신 그림 (shared/images/zodiac/full). 십이지 12종은 오른쪽을 보고, 고양이는 거의 정면 (뒤집어도 어색하지 않다) */
export const zodiacFullUrl = (id: CharId) => new URL(`shared/images/zodiac/full/${id}.png`, worldRoot()).href;
/** 캐릭터 얼굴 그림 (shared/images/zodiac/face, 십이지 12 + 고양이) */
export const zodiacFaceUrl = (id: CharId) => new URL(`shared/images/zodiac/face/${id}.png`, worldRoot()).href;
/** 게임 그림 (public/art/<이름>.png, ASSETS.md) */
export const artUrl = (name: string) => `${import.meta.env.BASE_URL}art/${name}.png`;
