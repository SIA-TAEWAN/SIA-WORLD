import type { Backend } from './backend';
import { createLocalBackend } from './local';

let backend: Backend | null | undefined;

const params = new URLSearchParams(location.search);

/** 주소의 ?local=1 이면 탭끼리 통신하는 테스트 모드 */
export const LOCAL_MODE = params.get('local') === '1';

export function onlineConfigured(): boolean {
  return LOCAL_MODE || !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export async function getBackend(): Promise<Backend | null> {
  if (backend !== undefined) return backend;
  if (LOCAL_MODE) backend = createLocalBackend();
  else if (onlineConfigured()) {
    // Supabase 라이브러리는 온라인에 들어갈 때만 불러온다
    const { createSupabaseBackend } = await import('./supabase');
    backend = createSupabaseBackend(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
  } else backend = null;
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

/** 이 기기의 플레이어 고유 ID. 테스트 모드에서는 탭마다 다르게 */
export function clientId(): string {
  const store = LOCAL_MODE ? sessionStorage : localStorage;
  const k = 'siatank:cid';
  try {
    let id = store.getItem(k);
    if (!id) {
      id = crypto.randomUUID();
      store.setItem(k, id);
    }
    return id;
  } catch {
    return (window as unknown as { __cid?: string }).__cid ??= crypto.randomUUID();
  }
}
