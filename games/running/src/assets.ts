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
 * 첫 판 느린 기기에서 장면이 늦게 떠 GO 를 늦게 보는 일을 줄인다. 실패해도 그만, 최대 waitMs 까지만 기다린다 (처음부터 잰다).
 * chars 는 바로 받기 시작하고, more(고스트를 받은 뒤 정해지는 AI·고스트 캐릭터)는 정해지는 대로 더한다
 */
export function warmRaceArt(chars: readonly ZodiacId[], more: Promise<readonly ZodiacId[]> | null = null, waitMs = 2500): Promise<void> {
  const base = import.meta.env.BASE_URL;
  const started = new Set<ZodiacId>();
  const one = (src: string) =>
    new Promise<void>((done) => {
      const img = new Image();
      img.onload = img.onerror = () => done();
      img.src = src;
    });
  const charUrls = (ids: readonly ZodiacId[]) =>
    ids.filter((id) => !started.has(id) && (started.add(id), true)).flatMap((id) => [zodiacFullUrl(id), zodiacFaceUrl(id)]);
  const first = Promise.all([...ART_FILES.map((k) => `${base}art/${k}.png`), ...charUrls(chars)].map(one));
  const later = more ? more.then((ids) => Promise.all(charUrls(ids).map(one))).catch(() => undefined) : null;
  return Promise.race([Promise.all([first, later]).then(() => undefined), new Promise<void>((r) => setTimeout(r, waitMs))]);
}
