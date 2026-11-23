/**
 * 이 게임(시아서바이벌)에서 연 추가 캐릭터 (고양이 등). 게임마다 따로, 캐릭터 고르기 화면에서 시아코인으로 연다 (071_characters.sql).
 * shared/characters.js 를 실행 중에 불러와 쓴다 (빌드에 넣지 않는다: 로비와 같은 로그인 세션).
 * 테스트 모드(?local=1)는 로그인이 없으니 api.ts 의 localOwned · localBuy (처음부터 열림, &cat=0 이면 잠김 → 버튼으로 바로 열림).
 */
import { LOCAL_MODE, localBuy, localOwned } from './api';

/** shared/games.js 의 이 게임 id */
export const GAME_ID = 'survival';

/** 열기 결과 (shared/characters.js 의 buyCharacter) */
export interface BuyResult {
  ok: boolean;
  reason?: 'owned' | 'coin' | 'login' | 'error';
  siaCoins?: number;
  price?: number;
}

interface CharactersModule {
  loadOwnedCharacters(game: string, force?: boolean): Promise<string[] | null>;
  buyCharacter(game: string, id: string): Promise<BuyResult>;
  buyMessage(r: BuyResult, id?: string): string;
}

let mod: Promise<CharactersModule> | null = null;
function shared(): Promise<CharactersModule> {
  mod ??= import(/* @vite-ignore */ new URL('shared/characters.js', new URL('../../', document.baseURI)).href) as Promise<CharactersModule>;
  mod.catch(() => (mod = null));
  return mod;
}

/** 이 게임에서 연 추가 캐릭터 id 목록. 서버를 못 읽으면 null ("연 것 없음" [] 과 다르다: 부르는 쪽이 가진 목록을 그대로 둔다) */
export async function loadOwned(force = false): Promise<string[] | null> {
  if (LOCAL_MODE) return localOwned();
  try {
    const list = await (await shared()).loadOwnedCharacters(GAME_ID, force);
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

/** 이 게임에서 캐릭터를 연다 (시아코인). 'owned' 는 이미 연 것이라 열린 것으로 다룬다 */
export async function buyChar(id: string): Promise<BuyResult> {
  if (LOCAL_MODE) return localBuy(id);
  try {
    return (await (await shared()).buyCharacter(GAME_ID, id)) ?? { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** 열기 결과 → 화면 한 줄 (shared 를 못 불러오면 같은 글을 여기서) */
export async function buyText(r: BuyResult, id: string): Promise<string> {
  if (!LOCAL_MODE) {
    try {
      return (await shared()).buyMessage(r, id);
    } catch {
      /* 아래 */
    }
  }
  if (r.ok) return LOCAL_MODE ? '열었어요! (테스트 모드)' : '열었어요!';
  if (r.reason === 'owned') return '이미 열었어요';
  if (r.reason === 'coin') return '시아코인이 모자라요';
  if (r.reason === 'login') return '로그인이 필요해요';
  return '열지 못했어요. 잠시 후 다시 시도해 주세요';
}
