// 십이지 밖의 추가 캐릭터 (지금은 고양이 하나).
// 카드 게임(맞고·카지노)은 12띠 = 화투 12달이라 shared/zodiac.js 의 ZODIAC(12) 만 쓴다. 여기 캐릭터는 그 밖의 게임에서만 쓴다.
// 그림은 십이지와 같은 자리: images/zodiac/face/<id>.png · images/zodiac/full/<id>.png

/**
 * 고양이: 십이지 경주에 늦어서 빠진 "13번째 대원" (늦잠 자다 금관을 비뚤게 쓰고 달려온 귀족 고양이).
 * 시아코인으로 계정마다 한 번 열면 모든 게임에서 쓴다 (071_characters.sql).
 */
export const CAT = {
  id: 'cat',
  name: '고양이',
  nick: '야옹이',
  emoji: '🐱',
  intro: '십이지 경주 날 늦잠을 자서 빠진 13번째 대원. 금관을 비뚤게 쓰고 뒤늦게 달려왔어요.',
};

/** 추가 캐릭터 목록 */
export const EXTRA_CHARACTERS = [CAT];
export const EXTRA_IDS = EXTRA_CHARACTERS.map((c) => c.id);

/** 십이지 12 + 추가 캐릭터 id (카드 게임 밖에서 고를 수 있는 전체) */
export const ALL_CHARACTER_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig', ...EXTRA_IDS];

export const isCharacterId = (id) => ALL_CHARACTER_IDS.includes(id);

/** 원형 아바타용 얼굴 그림 */
export const faceUrl = (id) => new URL(`images/zodiac/face/${isCharacterId(id) ? id : 'tiger'}.png`, import.meta.url).href;
/** 전신 그림 */
export const fullUrl = (id) => new URL(`images/zodiac/full/${isCharacterId(id) ? id : 'tiger'}.png`, import.meta.url).href;

// ---------- 시아코인으로 열기 (071_characters.sql) ----------
// 게임마다 따로 연다: 한 게임에서 열어도 다른 게임은 그 게임의 캐릭터 선택 화면에서 따로 연다.

/** 여는 값 (시아코인). SQL _character_price 와 같아야 한다 (games/survival/tests/sql.test.ts 가 대조) */
export const CHARACTER_PRICE = { cat: 100 };
export const CAT_PRICE = CHARACTER_PRICE.cat;

/** 추가 캐릭터를 고를 수 있는 게임 (shared/games.js 의 id). SQL _character_games 와 같게 */
export const CHARACTER_GAMES = ['tank', 'race', 'volleyball', 'survival', 'defense', 'charge', 'finger', 'village', 'twelve'];

/** 잠긴 캐릭터 칸의 버튼 글 */
export const unlockLabel = (id) => `시아코인 ${CHARACTER_PRICE[id] ?? ''}개로 열기`;

/** 시아코인으로 열어야 하는 캐릭터인지 */
export const needsUnlock = (id) => CHARACTER_PRICE[id] != null;

const ownedPromise = new Map();

/**
 * 이 게임에서 내가 연 추가 캐릭터 id 목록 (게임마다 한 번만 묻고 기억한다. force 면 다시 묻는다).
 * 서버를 못 읽으면(통신 실패·로그인 전) null — "연 것 없음"([])과 구분한다.
 * 게임은 null 이면 이미 가진 목록을 그대로 두고(처음이면 잠긴 것으로 본다), 서버도 시작 때 다시 검사한다.
 */
export function loadOwnedCharacters(game, force = false) {
  if (force || !ownedPromise.has(game)) {
    const p = import('./supabase.js')
      .then(({ supabase }) => supabase.rpc('my_characters', { p_game: game }))
      .then(({ data, error }) => (error || !Array.isArray(data) ? null : data.filter((id) => needsUnlock(id))))
      .catch(() => null);
    ownedPromise.set(game, p);
    // 못 읽었거나 아직 안 열었으면 다음에 다시 묻는다
    p.then((list) => { if (!list?.length && ownedPromise.get(game) === p) ownedPromise.delete(game); });
  }
  return ownedPromise.get(game);
}

/**
 * 이 게임의 구매 조건 진행 → { have, need, owned: [..] } (서버 character_progress). 못 읽으면 null.
 * 조건 값(need)은 서버가 정한다 (각 게임 마이그레이션의 _cat_progress_<game> 상수 = 게임 클라이언트 상수).
 */
export async function loadCharacterProgress(game) {
  try {
    const { supabase } = await import('./supabase.js');
    const { data, error } = await supabase.rpc('character_progress', { p_game: game });
    if (error || !data || typeof data !== 'object') return null;
    return { have: Number(data.have) || 0, need: Number(data.need) || 0, owned: Array.isArray(data.owned) ? data.owned : [] };
  } catch {
    return null;
  }
}

/** 조건을 넘었는지 */
export const progressDone = (p) => !!p && p.have >= p.need;

/** 고를 수 있는지: 십이지는 늘, 추가 캐릭터는 이 게임에서 연 경우만 (owned = loadOwnedCharacters(game) 결과) */
export const isCharacterOpen = (id, owned) => isCharacterId(id) && (!needsUnlock(id) || (owned ?? []).includes(id));

/**
 * 이 게임에서 캐릭터 열기 (각 게임의 캐릭터 선택 화면에서 부른다)
 * → { ok: true, siaCoins, price } | { ok: false, reason: 'owned' | 'coin' | 'condition' | 'login' | 'error', siaCoins?, price?, have?, need? }
 *   'condition' = 이 게임의 진행 조건을 아직 못 넘음 (서버가 그 게임 기록으로 확인)
 *   'owned' 는 이미 연 것이라 열린 것으로 다루면 된다.
 */
export async function buyCharacter(game, id) {
  try {
    const { supabase } = await import('./supabase.js');
    const { data, error } = await supabase.rpc('buy_character', { p_game: game, p_id: id });
    if (error) return { ok: false, reason: /need login|permission denied|JWT/i.test(error.message) ? 'login' : 'error' };
    if (data?.ok || data?.reason === 'owned') ownedPromise.delete(game);
    return data;
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** 구매 결과 → 화면에 띄울 한 줄 */
export function buyMessage(r, id = 'cat') {
  const price = CHARACTER_PRICE[id] ?? 0;
  if (r?.ok) return `열었어요! 남은 시아코인 ${Number(r.siaCoins ?? 0).toLocaleString('ko-KR')}개`;
  if (r?.reason === 'owned') return '이미 열었어요';
  if (r?.reason === 'condition') return `아직 열 수 없어요 (조건 ${r.have ?? 0} / ${r.need ?? '?'})`;
  if (r?.reason === 'coin') return `시아코인이 모자라요 (${Number(r.siaCoins ?? 0).toLocaleString('ko-KR')} / ${price})`;
  if (r?.reason === 'login') return '로그인이 필요해요';
  return '열지 못했어요. 잠시 후 다시 시도해 주세요';
}
