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
/** 구매 조건: 이 게임을 이만큼 한 뒤에 열 수 있다. 072 의 _cat_progress_<게임> 의 need 와 같게 (tests/unlock.test.ts 가 대조) */
export const CAT_NEED = 30;
/** AI 대전이 전적·판 수에 들어가는 하루 한도 (서버 ai_match 의 하루 판 수와 같게) */
export const AI_PER_DAY = 30;
/** 사람끼리 대전도 같은 상대와는 하루 이만큼까지만 기록된다 (서버 036 의 pair_per_day 와 같게) */
export const PVP_PER_DAY = 30;
/** 잠긴 동안 보이는 남은 조건 글. have 를 모르면(아직 못 읽음) 지금 값 없이. AI전·같은 상대와의 대전은 하루 30판까지만 센다 */
export const condText = (have?: number | null, need = CAT_NEED): string =>
  `시아배구 ${need}판(${AI_PER_DAY === PVP_PER_DAY ? `AI전·같은 상대와의 대전은 하루 ${AI_PER_DAY}판까지 셈` : `AI전은 하루 ${AI_PER_DAY}판, 같은 상대와의 대전은 하루 ${PVP_PER_DAY}판까지 셈`})을 하면 열 수 있어요${have == null ? '' : ` · 지금 ${have}판`}`;
/** 하루 한도로 기록되지 않은 판의 꼬리 글: 고양이가 잠겨 있을 때만 (열었으면 판 수는 상관없다) */
export const limitCatTail = (catLocked = !isCharOpen('cat')): string => (catLocked ? ' · 고양이 판 수에도 들어가지 않아요' : '');
/** 서버가 'locked character' 로 거절했을 때 */
export const LOCKED_MSG = `고양이는 캐릭터 고르기 화면에서 시아코인 ${CAT_PRICE}개로 열 수 있어요`;

let owned = new Set<string>();
let allOpen = false;
let local = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((f) => f());

/** 구매 조건 진행 (서버 character_progress). null = 아직 못 읽음 */
export interface Progress {
  have: number;
  need: number;
}
let progress: Progress | null = null;
export const getProgress = (): Progress | null => progress;
/** 조건을 넘었는가 (모르면 false) */
export const progressDone = (p: Progress | null = progress): boolean => !!p && p.have >= p.need;
/** 진행을 바꾼다 (null = 못 읽음 → 그대로 둔다) */
export function setProgress(p: Progress | null) {
  if (!p) return;
  const next = { have: Math.max(0, Math.floor(Number(p.have) || 0)), need: Math.max(1, Math.floor(Number(p.need) || CAT_NEED)) };
  if (progress && progress.have === next.have && progress.need === next.need) return;
  progress = next;
  tell();
}
export type ProgressLoader = (game: string) => Promise<{ have: number; need: number; owned?: string[] } | null>;
let progLoader: ProgressLoader | null = null;

/** 잠긴 동안 진행을 다시 읽는다 (선택 화면을 열 때·화면이 다시 보일 때. 판을 하고 돌아오면 숫자가 늘어 있다) */
export async function refreshProgress(): Promise<void> {
  if (local || !progLoader || !hasLocked()) return;
  const p = await progLoader(GAME_ID);
  if (!p) return;
  setProgress(p);
  if (Array.isArray(p.owned)) setOwned(p.owned);
}

/** 시아코인으로 열어야 하는 캐릭터인가 */
export const needsUnlock = (id: string): boolean => (EXTRA_IDS as readonly string[]).includes(id);
/** 아직 안 연 추가 캐릭터가 있는가 */
const hasLocked = (): boolean => !allOpen && (EXTRA_IDS as readonly string[]).some((id) => !owned.has(id));

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
 * 게임에 들어올 때 한 번 불러온다 (처음에 못 읽으면 잠긴 것으로 시작). 잠겨 있으면 구매 조건 진행도 읽는다.
 * 화면이 다시 보일 때(다른 기기·탭에서 연 경우) 다시 불러온다.
 * isLocal: 테스트 모드면 서버를 부르지 않는다. catParam: 없음 = 열림, '0' = 잠김 + 조건 통과(열기 버튼), 'cond' = 잠김 + 조건 미달(지금 12판)
 */
export async function initUnlock(load: OwnedLoader, isLocal: boolean, catParam: string | null, loadProgress?: ProgressLoader): Promise<void> {
  local = isLocal;
  if (isLocal) {
    setAllOpen(catParam !== '0' && catParam !== 'cond');
    setProgress({ have: catParam === 'cond' ? 12 : CAT_NEED, need: CAT_NEED });
    return;
  }
  loader = load;
  progLoader = loadProgress ?? null;
  setOwned((await load(GAME_ID, false)) ?? []);
  await refreshProgress();
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      void load(GAME_ID, true).then(setOwned);
      void refreshProgress();
    });
}

/** shared/characters.js 의 buyCharacter 결과 */
export interface BuyResult {
  ok: boolean;
  reason?: string;
  siaCoins?: number;
  price?: number;
  /** reason 'condition': 지금 진행과 조건 */
  have?: number;
  need?: number;
}
export type Buyer = (game: string, id: string) => Promise<BuyResult>;

/**
 * 이 게임에서 고양이 열기. 성공(또는 이미 연 것)이면 목록을 다시 불러와 잠금을 푼다.
 * 테스트 모드는 서버 없이 바로 연다. → { opened, result, local }
 */
export async function unlockCat(buy: Buyer): Promise<{ opened: boolean; result: BuyResult; local?: boolean }> {
  if (local) {
    if (!progressDone()) return { opened: false, result: { ok: false, reason: 'condition', ...progress }, local: true };
    setAllOpen(true);
    return { opened: true, result: { ok: true, siaCoins: 0, price: CAT_PRICE }, local: true };
  }
  const result = await buy(GAME_ID, 'cat');
  const opened = result.ok || result.reason === 'owned';
  // 조건 미달: 서버가 알려 준 진행으로 글을 고친다
  if (result.reason === 'condition' && result.have != null && result.need != null) setProgress({ have: result.have, need: result.need });
  if (opened) {
    const list = loader ? await loader(GAME_ID, true) : null;
    // 다시 읽기에 실패해도 산 것은 확실하므로 연 것으로
    setOwned([...new Set([...(list ?? [...owned]), 'cat'])]);
  }
  return { opened, result };
}
