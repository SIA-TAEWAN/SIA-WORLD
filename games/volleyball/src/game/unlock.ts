import { EXTRA_IDS, isCharId, type ZodiacId } from './constants';

/**
 * 추가 캐릭터(고양이) 잠금. 내가 고를 수 있는지는 여기 isCharOpen 한 곳에서만 판단한다.
 * 고양이는 게임마다 따로, 이 게임의 캐릭터 고르기 화면에서 시아코인으로 연다 (071_characters.sql 의 buy_character).
 * 연 목록은 shared/characters.js 의 loadOwnedCharacters(게임) (서버 my_characters) 로 채운다.
 * 서버도 시작·기록 때 _check_character(user, character, 게임) 로 다시 검사한다 ('locked character').
 * 남이 고른 캐릭터 표시에는 쓰지 않는다.
 */

/** 잠겨 있을 때 대신 쓰는 캐릭터 */
export const DEFAULT_CHAR: ZodiacId = 'tiger';

/** 내가 고를 수 있는가: 십이지는 늘, 추가 캐릭터는 이 게임에서 연 경우만 */
export function isCharOpen(id: string): boolean {
  if (!isCharId(id)) return false;
  return !needsUnlock(id) || allOpen || owned.has(id);
}

/** 잠겨 있으면 기본 캐릭터로 */
export const openOr = (id: ZodiacId, fallback: ZodiacId = DEFAULT_CHAR): ZodiacId => (isCharOpen(id) ? id : fallback);

/** 이 게임의 id (shared/games.js · SQL _character_games). 고양이는 게임마다 따로 연다 */
export const GAME_ID = 'volleyball';
/** 고양이를 여는 값 (시아코인). shared/characters.js 의 CHARACTER_PRICE.cat · SQL _character_price('cat') 와 같게 */
export const CAT_PRICE = 100;
/** 잠긴 칸의 버튼 글 (shared/characters.js 의 unlockLabel('cat') 과 같은 글) */
export const UNLOCK_LABEL = `시아코인 ${CAT_PRICE}개로 열기`;
/** 한 번 더 누르라는 확인 글 (4초) */
export const UNLOCK_CONFIRM = `${CAT_PRICE}코인을 쓸까요? 한 번 더 누르기`;
export const UNLOCK_CONFIRM_MS = 4000;
/** 서버가 'locked character' 로 거절했을 때 */
export const LOCKED_MSG = `고양이는 캐릭터 고르기 화면에서 시아코인 ${CAT_PRICE}개로 열 수 있어요`;

let owned = new Set<string>();
let allOpen = false;
let local = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((f) => f());

/** 시아코인으로 열어야 하는 캐릭터인가 */
export const needsUnlock = (id: string): boolean => (EXTRA_IDS as readonly string[]).includes(id);

/**
 * 연 목록을 바꾼다 (바뀌었으면 화면에 알린다).
 * null = 서버를 못 읽음 → 가진 목록을 그대로 둔다 (통신이 잠깐 끊겨 연 고양이가 잠기지 않게)
 */
export function setOwned(list: readonly string[] | null) {
  if (!list) return;
  const next = new Set(list.filter(needsUnlock));
  const same = next.size === owned.size && [...next].every((v) => owned.has(v));
  owned = next;
  if (!same) tell();
}

/** 테스트 모드(?local=1): 로그인이 없으니 모두 연 것으로 (&cat=0 이면 잠긴 상태) */
export function setAllOpen(v: boolean) {
  if (allOpen === v) return;
  allOpen = v;
  tell();
}

/** 연 목록이 바뀌면 부른다 → 끄는 함수 */
export function onUnlockChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** 서버 오류가 잠금 때문인가 */
export const isLockedError = (msg: unknown): boolean => typeof msg === 'string' && msg.includes('locked character');

export type OwnedLoader = (game: string, force: boolean) => Promise<string[] | null>;
let loader: OwnedLoader | null = null;

/**
 * 게임에 들어올 때 한 번 불러온다 (처음에 못 읽으면 잠긴 것으로 시작).
 * 화면이 다시 보일 때(다른 기기·탭에서 연 경우) 다시 불러온다.
 * isLocal: 테스트 모드면 서버를 부르지 않는다 (catParam '0' 이면 잠금)
 */
export async function initUnlock(load: OwnedLoader, isLocal: boolean, catParam: string | null): Promise<void> {
  local = isLocal;
  if (isLocal) {
    setAllOpen(catParam !== '0');
    return;
  }
  loader = load;
  setOwned((await load(GAME_ID, false)) ?? []);
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void load(GAME_ID, true).then(setOwned);
    });
}

/** shared/characters.js 의 buyCharacter 결과 */
export interface BuyResult {
  ok: boolean;
  reason?: string;
  siaCoins?: number;
  price?: number;
}
export type Buyer = (game: string, id: string) => Promise<BuyResult>;

/**
 * 이 게임에서 고양이 열기. 성공(또는 이미 연 것)이면 목록을 다시 불러와 잠금을 푼다.
 * 테스트 모드는 서버 없이 바로 연다. → { opened, result, local }
 */
export async function unlockCat(buy: Buyer): Promise<{ opened: boolean; result: BuyResult; local?: boolean }> {
  if (local) {
    setAllOpen(true);
    return { opened: true, result: { ok: true, siaCoins: 0, price: CAT_PRICE }, local: true };
  }
  const result = await buy(GAME_ID, 'cat');
  const opened = result.ok || result.reason === 'owned';
  if (opened) {
    const list = loader ? await loader(GAME_ID, true) : null;
    // 다시 읽기에 실패해도 산 것은 확실하므로 연 것으로
    setOwned([...new Set([...(list ?? [...owned]), 'cat'])]);
  }
  return { opened, result };
}
