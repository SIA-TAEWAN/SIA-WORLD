/**
 * 계정에서 연 추가 캐릭터 (고양이 등, SIA WORLD 로비에서 시아코인으로 연다. 071_characters.sql).
 * shared/characters.js 의 loadOwnedCharacters 를 실행 중에 불러와 쓴다 (빌드에 넣지 않는다: 로비와 같은 로그인 세션).
 * 테스트 모드(?local=1)는 로그인이 없으니 api.ts 의 localOwned (모두 열림, &cat=0 이면 잠김).
 */
import { LOCAL_MODE, localOwned } from './api';

interface CharactersModule {
  loadOwnedCharacters(force?: boolean): Promise<string[]>;
}

let mod: Promise<CharactersModule> | null = null;

/** 연 추가 캐릭터 id 목록. 못 읽으면 [] (잠긴 것으로 본다. 서버도 판 시작 때 다시 검사한다) */
export async function loadOwned(force = false): Promise<string[]> {
  if (LOCAL_MODE) return localOwned();
  try {
    mod ??= import(/* @vite-ignore */ new URL('shared/characters.js', new URL('../../', document.baseURI)).href) as Promise<CharactersModule>;
    const list = await (await mod).loadOwnedCharacters(force);
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    mod = null;
    return [];
  }
}
