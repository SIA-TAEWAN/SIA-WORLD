import type { HeroId } from './data/heroes';

/** SIA WORLD 최상위 (games/twelve/ 에서 두 단계 위) */
const worldRoot = () => new URL('../../', document.baseURI);
/** 십이지 전신 그림 (shared/images/zodiac/full). 12종 모두 오른쪽을 본다. 고양이는 아직 그림이 없다 → 호출하는 쪽이 글자 그림으로 */
export const heroFullUrl = (id: HeroId) => new URL(`shared/images/zodiac/full/${id}.png`, worldRoot()).href;
/** 십이지 얼굴 그림 (shared/images/zodiac/face) */
export const heroFaceUrl = (id: HeroId) => new URL(`shared/images/zodiac/face/${id}.png`, worldRoot()).href;
/** 그림 판본 (vite.config.ts 의 artVersion — 배포 커밋 해시). 서비스 워커가 옛 그림을 그대로 내주지 않게 주소 뒤에 붙인다 */
const ART_VER: string = import.meta.env.VITE_ART_VER ?? 'dev';
/** 게임 그림 (public/art/<이름>.png?v=<판본>, ASSETS.md). 요괴·보스·바닥은 시아디펜스 그림을 그대로 쓴다 */
export const artUrl = (name: string) => `${import.meta.env.BASE_URL}art/${name}.png?v=${ART_VER}`;
