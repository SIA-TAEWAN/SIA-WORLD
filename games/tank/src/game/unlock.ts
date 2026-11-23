import { EXTRA_TANK_IDS, TANKS, type TankChoice, type TankId } from './data';

/**
 * 추가 캐릭터(고양이 탱크 '야옹이') 잠금. 내가 고를 수 있는지는 여기 isTankOpen 한 곳에서만 판단한다.
 * 연 목록은 shared/characters.js 의 loadOwnedCharacters() (서버 my_characters) 로 채운다.
 * 서버도 방에 들어갈 때·탱크를 바꿀 때 _valid_player → _check_character 로 다시 검사한다 ('locked character').
 * 남이 고른 탱크 표시는 막지 않는다 (방 자리·게임 화면은 TANKS 를 그대로 쓴다).
 */

/** 잠긴 칸 안내 (shared/characters.js 의 LOCK_HINT 와 같은 글) */
export const LOCK_HINT = '로비에서 열 수 있어요';
/** 잠긴 탱크를 누르거나 서버가 'locked character' 로 거절했을 때 */
export const LOCKED_MSG = '고양이는 로비에서 시아코인으로 열 수 있어요';
/** 잠겨 있을 때 대신 쓰는 탱크 */
export const DEFAULT_TANK: TankId = 'tiger';

let owned = new Set<string>();
let allOpen = false;
const listeners = new Set<() => void>();

/** 시아코인으로 열어야 하는 탱크인가 */
export const needsUnlock = (id: string): boolean => (EXTRA_TANK_IDS as readonly string[]).includes(id);

/** 내가 고를 수 있는가: 12지신·'random' 은 늘, 추가 캐릭터는 연 경우만 */
export function isTankOpen(id: string): boolean {
  if (id === 'random') return true;
  if (!(id in TANKS) || id === 'zodiac') return false;
  return !needsUnlock(id) || allOpen || owned.has(id);
}

/** 잠겨 있으면 기본 탱크로 */
export const openTankOr = (id: TankChoice, fallback: TankChoice = DEFAULT_TANK): TankChoice => (isTankOpen(id) ? id : fallback);

/** 연 목록을 바꾼다 (바뀌었으면 화면에 알린다) */
export function setOwned(list: readonly string[]) {
  const next = new Set(list.filter(needsUnlock));
  const same = next.size === owned.size && [...next].every((v) => owned.has(v));
  owned = next;
  if (!same) listeners.forEach((f) => f());
}

/** 테스트 모드(?local=1): 로그인이 없으니 모두 연 것으로 (&cat=0 이면 잠긴 상태) */
export function setAllOpen(v: boolean) {
  if (allOpen === v) return;
  allOpen = v;
  listeners.forEach((f) => f());
}

/** 연 목록이 바뀌면 부른다 → 끄는 함수 */
export function onUnlockChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** 서버 오류가 잠금 때문인가 */
export const isLockedError = (msg: unknown): boolean => typeof msg === 'string' && msg.includes('locked character');

/**
 * 게임에 들어올 때 한 번 불러오고, 화면이 다시 보일 때(로비에서 사고 돌아온 경우) 다시 불러온다.
 * local: 테스트 모드면 서버를 부르지 않는다 (catParam '0' 이면 잠금)
 */
export async function initUnlock(load: (force: boolean) => Promise<string[]>, local: boolean, catParam: string | null): Promise<void> {
  if (local) {
    setAllOpen(catParam !== '0');
    return;
  }
  setOwned(await load(false));
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void load(true).then(setOwned);
    });
}
