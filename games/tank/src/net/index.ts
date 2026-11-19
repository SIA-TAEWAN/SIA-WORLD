import type { Backend } from './backend';
import { createLocalBackend } from './local';
import { worldSupabase } from './world';
import { parseFinish, parseStart, type AiRpc } from './aiRecord';

let backend: Backend | null | undefined;

const params = new URLSearchParams(location.search);

/** 주소의 ?local=1 이면 탭끼리 통신하는 테스트 모드 (로그인 없이). 개발 서버나 내 컴퓨터(localhost)에서만 켜진다 */
export const LOCAL_MODE =
  params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(location.hostname));

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

/**
 * AI 1:1 판의 전적 기록용 서버 함수 (056_ai_matches.sql). 테스트 모드는 null (서버를 부르지 않는다).
 * 연결하지 못하면 예외 → 그 판은 기록하지 못한 것으로 끝난다.
 */
export async function getAiRpc(difficulty: 'normal' | 'hard'): Promise<AiRpc | null> {
  if (LOCAL_MODE) return null;
  const sb = await worldSupabase();
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as unknown;
  };
  return {
    start: async () => parseStart(await rpc('ai_match_start', { p_game: 'tank', p_difficulty: difficulty })),
    finish: async (id, won) => parseFinish(await rpc('ai_match_finish', { p_id: id, p_won: won })),
    cancel: async (id) => void (await rpc('ai_match_cancel', { p_id: id })),
  };
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
