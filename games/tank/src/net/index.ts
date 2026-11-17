import type { Backend } from './backend';
import { createLocalBackend } from './local';
import { worldSupabase } from './world';

let backend: Backend | null | undefined;

const params = new URLSearchParams(location.search);

/** 주소의 ?local=1 이면 탭끼리 통신하는 테스트 모드 (로그인 없이) */
export const LOCAL_MODE = params.get('local') === '1';

export async function getBackend(): Promise<Backend | null> {
  if (backend !== undefined) return backend;
  if (LOCAL_MODE) backend = createLocalBackend(() => ({ id: clientId(), name: playerName }));
  else {
    try {
      // SIA WORLD 공통 클라이언트(로그인 세션 포함)를 쓴다
      const { createSupabaseBackend } = await import('./supabase');
      backend = createSupabaseBackend(await worldSupabase());
    } catch {
      return null; // 다음에 다시 시도
    }
  }
  return backend;
}

/** 대기실 코드: ?l=코드, 없으면 기본 대기실 */
export function lobbyCode(): string {
  const raw = params.get('l') ?? 'main';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'main';
}

export function lobbyLink(code: string): string {
  const u = new URL(location.href);
  u.search = '';
  if (code !== 'main') u.searchParams.set('l', code);
  if (LOCAL_MODE) u.searchParams.set('local', '1');
  u.hash = '';
  return u.toString();
}

let playerId = '';
let playerName = '';

/** 로그인한 사용자 ID로 플레이어를 식별한다 (main에서 정한다) */
export function setPlayer(id: string, name: string) {
  playerId = id;
  playerName = name;
}

/** 플레이어 고유 ID = SIA WORLD 사용자 ID. 테스트 모드에서는 탭마다 다르게 */
export function clientId(): string {
  if (playerId) return playerId;
  try {
    let id = sessionStorage.getItem('siatank:cid');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('siatank:cid', id);
    }
    return (playerId = id);
  } catch {
    return (playerId = crypto.randomUUID());
  }
}
