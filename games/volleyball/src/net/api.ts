import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalChannel, SupaChannel, type Channel } from './channel';
import { worldSupabase } from './world';

/**
 * 서버 연결 (시아레이스 games/running/src/net/api.ts 와 같은 모양).
 * - 실시간 채널: 대기실(volley-lobby)과 방(volley:<코드>)
 * - 서버 시각: 두 기기가 같은 순간에 카운트다운을 끝내려고 기기 시계를 서버 시각에 맞춘다 (volleyball_now)
 */
export interface VolleyApi {
  kind: 'supabase' | 'local';
  channel<M>(name: string, key: string): Channel<M>;
  /** 기기 시계를 서버 시각에 맞춘다 (서버 함수가 없거나 실패하면 기기 시각 그대로) */
  syncClock(): Promise<void>;
}

let offset = 0;
/** 서버 시각 (ms). syncClock 전에는 기기 시각 */
export const serverNow = () => Date.now() + offset;

const params = new URLSearchParams(location.search);
/** 주소의 ?local=1 이면 탭끼리 통신하는 테스트 모드 (로그인 없이) */
export const LOCAL_MODE = params.get('local') === '1';
/** 테스트 모드에서 통신 지연 흉내 (?lag=150 → 받는 쪽에서 150ms 늦게) */
export const LAG_MS = LOCAL_MODE ? Math.max(0, Math.min(1000, Number(params.get('lag')) || 0)) : 0;

function createLocalApi(): VolleyApi {
  return {
    kind: 'local',
    channel: <M>(name: string, key: string) => new LocalChannel<M>(name, key, LAG_MS),
    async syncClock() {},
  };
}

function createSupabaseApi(sb: SupabaseClient): VolleyApi {
  return {
    kind: 'supabase',
    channel: <M>(name: string, key: string) => new SupaChannel<M>(sb, name, key),
    async syncClock() {
      // 세 번 물어 가장 빨리 돌아온 답으로 맞춘다
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        const { data, error } = await sb.rpc('volleyball_now');
        const t1 = Date.now();
        if (error || typeof data !== 'number') return;
        if (t1 - t0 < best) {
          best = t1 - t0;
          offset = data - (t0 + t1) / 2;
        }
      }
    },
  };
}

let api: VolleyApi | null = null;
export async function getApi(): Promise<VolleyApi> {
  if (api) return api;
  if (LOCAL_MODE) return (api = createLocalApi());
  try {
    api = createSupabaseApi(await worldSupabase());
    void api.syncClock();
  } catch {
    return createLocalApi(); // 다음에 다시 시도
  }
  return api;
}
