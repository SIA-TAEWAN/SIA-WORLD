import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodiacId } from '../game/constants';
import { LocalChannel, SupaChannel, type Channel } from './channel';
import { worldSupabase } from './world';

/**
 * 서버 연결 (시아레이스 games/running/src/net/api.ts 와 같은 모양).
 * - 실시간 채널: 대기실(volley-lobby)과 방(volley:<코드>)
 * - 서버 시각: 두 기기가 같은 순간에 카운트다운을 끝내려고 기기 시계를 서버 시각에 맞춘다 (volleyball_now)
 * - 결과 저장: 양쪽 보고 일치 방식 (supabase/migrations/034_volleyball.sql 의 begin · report · settle)
 */
export interface VolleyApi {
  kind: 'supabase' | 'local';
  channel<M>(name: string, key: string): Channel<M>;
  /** 기기 시계를 서버 시각에 맞춘다 (서버 함수가 없거나 실패하면 기기 시각 그대로) */
  syncClock(): Promise<void>;
  /** 경기 시작: 두 사람이 각자 부른다. 서로가 서로를 지목했을 때 live. 실패하면 null */
  begin(room: string, matchNo: number, side: 0 | 1, opponent: string, character: ZodiacId): Promise<{ match: string; live: boolean } | null>;
  /** 결과 보고: 양쪽 보고가 같으면 확정(done), 다르면 무효(void), 한쪽만 있으면 waiting */
  report(match: string, left: number, right: number, reason: 'normal' | 'leave'): Promise<SaveResult>;
  /** 첫 보고 10초 뒤에도 상대 보고가 없으면 그 보고 하나로 확정 */
  settle(match: string): Promise<SaveResult>;
  /** 내 전적 (없으면 0승 0패, 못 읽으면 null) */
  myRecord(): Promise<{ wins: number; losses: number } | null>;
}

/** 결과 저장 답: error 는 통신·검증 실패 (code: 서버가 알려 준 까닭) */
export interface SaveResult {
  status: 'waiting' | 'done' | 'void' | 'error';
  wins?: number;
  losses?: number;
  code?: string;
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
    // 테스트 모드는 DB를 부르지 않는다
    async begin() {
      return null;
    },
    async report() {
      return { status: 'error', code: 'local' };
    },
    async settle() {
      return { status: 'error', code: 'local' };
    },
    async myRecord() {
      return null;
    },
  };
}

function createSupabaseApi(sb: SupabaseClient, uid: string): VolleyApi {
  const save = (data: unknown, error: { message?: string } | null): SaveResult => {
    const d = data as { status?: string; wins?: number; losses?: number } | null;
    if (error || !d || (d.status !== 'waiting' && d.status !== 'done' && d.status !== 'void')) {
      if (error) console.warn('[시아배구] 결과를 서버에 올리지 못했어요', error.message);
      return { status: 'error', code: error?.message };
    }
    return { status: d.status, wins: d.wins, losses: d.losses };
  };
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
    async begin(room, matchNo, side, opponent, character) {
      const { data, error } = await sb.rpc('volleyball_begin', { p_room_key: room, p_match_no: matchNo, p_side: side, p_opponent: opponent, p_character: character });
      const d = data as { match?: string; live?: boolean } | null;
      if (error || !d?.match) {
        console.warn('[시아배구] 경기 시작을 서버에 알리지 못했어요 (이 경기는 기록되지 않아요)', error?.message);
        return null;
      }
      return { match: d.match, live: d.live === true };
    },
    async report(match, left, right, reason) {
      const { data, error } = await sb.rpc('volleyball_report', { p_match: match, p_left_score: left, p_right_score: right, p_reason: reason });
      return save(data, error);
    },
    async settle(match) {
      const { data, error } = await sb.rpc('volleyball_settle', { p_match: match });
      return save(data, error);
    },
    async myRecord() {
      const { data, error } = await sb.from('volleyball_rankings').select('wins,losses').eq('user_id', uid).maybeSingle();
      if (error) return null;
      const d = data as { wins: number; losses: number } | null;
      return { wins: Number(d?.wins ?? 0), losses: Number(d?.losses ?? 0) };
    },
  };
}

let api: VolleyApi | null = null;
export async function getApi(uid: string): Promise<VolleyApi> {
  if (api) return api;
  if (LOCAL_MODE) return (api = createLocalApi());
  try {
    api = createSupabaseApi(await worldSupabase(), uid);
    void api.syncClock();
  } catch {
    return createLocalApi(); // 다음에 다시 시도
  }
  return api;
}
