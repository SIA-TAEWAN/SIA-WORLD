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

/** 여는 값 (시아코인). SQL _character_price 와 같아야 한다 (games/survival/tests/sql.test.ts 가 대조) */
export const CHARACTER_PRICE = { cat: 300 };
export const CAT_PRICE = CHARACTER_PRICE.cat;

/** 잠긴 캐릭터 안내 (각 게임 선택 화면) */
export const LOCK_HINT = '로비에서 열 수 있어요';

/** 시아코인으로 열어야 하는 캐릭터인지 */
export const needsUnlock = (id) => CHARACTER_PRICE[id] != null;

let ownedPromise = null;

/**
 * 내가 연 추가 캐릭터 id 목록 (한 페이지에서 한 번만 묻고 기억한다. force 면 다시 묻는다).
 * 로그인 전이거나 서버를 못 읽으면 [] (잠긴 것으로 본다. 서버도 시작 때 다시 검사한다)
 */
export function loadOwnedCharacters(force = false) {
  if (force || !ownedPromise) {
    ownedPromise = import('./supabase.js')
      .then(({ supabase }) => supabase.rpc('my_characters'))
      .then(({ data, error }) => (error || !Array.isArray(data) ? [] : data.filter((id) => needsUnlock(id))))
      .catch(() => []);
    // 실패했으면 다음에 다시 묻는다
    ownedPromise.then((list) => { if (!list.length) ownedPromise = null; });
  }
  return ownedPromise;
}

/** 고를 수 있는지: 십이지는 늘, 추가 캐릭터는 연 경우만 */
export const isCharacterOpen = (id, owned) => isCharacterId(id) && (!needsUnlock(id) || (owned ?? []).includes(id));

/**
 * 캐릭터 열기 → { ok: true, siaCoins } | { ok: false, reason: 'owned' | 'coin' | 'login' | 'error', siaCoins?, price? }
 */
export async function buyCharacter(id) {
  try {
    const { supabase } = await import('./supabase.js');
    const { data, error } = await supabase.rpc('buy_character', { p_id: id });
    if (error) return { ok: false, reason: /need login/.test(error.message) ? 'login' : 'error' };
    if (data?.ok || data?.reason === 'owned') ownedPromise = null;
    return data;
  } catch {
    return { ok: false, reason: 'error' };
  }
}
