import type { ZodiacId } from './game/constants';

/** SIA WORLD 최상위 (games/running/ 에서 두 단계 위) */
const worldRoot = () => new URL('../../', document.baseURI);
/** 십이지 전신 그림 (shared/images/zodiac/full) */
export const zodiacFullUrl = (id: ZodiacId) => new URL(`shared/images/zodiac/full/${id}.png`, worldRoot()).href;
/** 십이지 얼굴 그림 (shared/images/zodiac/face) */
export const zodiacFaceUrl = (id: ZodiacId) => new URL(`shared/images/zodiac/face/${id}.png`, worldRoot()).href;

/** 경주 화면 그림 이름 (public/art/<이름>.png). 장면(scenes/art.ts)과 출발 전 미리 받기(warmRaceArt)가 같이 쓴다 */
export const ART_FILES = ['track', 'sky', 'stands', 'hurdle', 'banana', 'log', 'mudShort', 'mudLong', 'boost', 'bar', 'marker', 'flag', 'dust', 'splash', 'star', 'spark'] as const;

/**
 * 경주 장면이 preload 에서 받을 그림(트랙 그림 + 나오는 캐릭터의 전신·얼굴)을 출발 전에 미리 받아 브라우저 캐시를 데운다.
 * 첫 판 느린 기기에서 장면이 늦게 떠 GO 를 늦게 보는 일을 줄인다. 실패해도 그만, 최대 waitMs 까지만 기다린다
 */
export function warmRaceArt(chars: readonly ZodiacId[], waitMs = 2500): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const urls = [...ART_FILES.map((k) => `${base}art/${k}.png`), ...[...new Set(chars)].flatMap((id) => [zodiacFullUrl(id), zodiacFaceUrl(id)])];
  const one = (src: string) =>
    new Promise<void>((done) => {
      const img = new Image();
      img.onload = img.onerror = () => done();
      img.src = src;
    });
  return Promise.race([Promise.all(urls.map(one)).then(() => undefined), new Promise<void>((r) => setTimeout(r, waitMs))]);
}
