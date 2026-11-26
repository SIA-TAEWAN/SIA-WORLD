import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodiacId } from '../game/constants';
import { LocalChannel, SupaChannel, type Channel } from './channel';
import { worldSupabase } from './world';
import { parseCancel, parseFinish, parseStart, type AiRpc } from './aiRecord';
import { parseH2h, parseH2hParam, type H2h } from './h2h';

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
  /** 경기 시작: 두 사람이 각자 부른다. 서로가 서로를 지목했을 때 live. 실패하면 null, 서버가 거절했으면 { error: 까닭 } */
  begin(room: string, matchNo: number, side: 0 | 1, opponent: string, character: ZodiacId): Promise<{ match: string; live: boolean } | { error: string } | null>;
  /** 결과 보고: 양쪽 보고가 같으면 확정(done), 다르면 무효(void), 한쪽만 있으면 waiting */
  report(match: string, left: number, right: number, reason: 'normal' | 'leave'): Promise<SaveResult>;
  /** 첫 보고 10초 뒤에도 상대 보고가 없으면 그 보고 하나로 확정 */
  settle(match: string): Promise<SaveResult>;
  /** 내 전적 (없으면 0승 0패, 못 읽으면 null) */
  myRecord(): Promise<{ wins: number; losses: number } | null>;
  /** 맞대결 전적: 나와 그 사람 사이의 확정 경기만 (090_volley_h2h.sql). 못 읽으면 null → 화면에서 그 줄을 숨긴다 */
  h2h(opponent: string): Promise<H2h | null>;
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
/** 주소의 ?local=1 이면 탭끼리 통신하는 테스트 모드 (로그인 없이). 개발 서버나 내 컴퓨터(localhost)에서만 켜진다 */
export const LOCAL_MODE =
  params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(location.hostname));
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
    // 화면 확인용: ?h2h=7,4,2 (승,패,이어진 판 수 — 음수면 연패). 없으면 숨김
    async h2h() {
      return parseH2hParam(params.get('h2h'));
    },
  };
}

function createSupabaseApi(sb: SupabaseClient, uid: string): VolleyApi {
  const save = (data: unknown, error: { message?: string; code?: string } | null): SaveResult => {
    const d = data as { status?: string; wins?: number; losses?: number } | null;
    if (error || !d || (d.status !== 'waiting' && d.status !== 'done' && d.status !== 'void')) {
      if (error) console.warn('[시아배구] 결과를 서버에 올리지 못했어요', error.message);
      // 서버(Postgres)가 거절한 오류만 code 가 있다. 통신 실패(TypeError: Failed to fetch 등)는 code 가 비어 있으니
      // code 를 비워 두어 확정 대기 목록에 남긴다 (다음에 다시 확정)
      return { status: 'error', code: error?.code ? error.message : undefined };
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
        return error?.message ? { error: error.message } : null;
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
    async h2h(opponent) {
      const { data, error } = await sb.rpc('volleyball_h2h', { p_opponent: opponent });
      return error ? null : parseH2h(data);
    },
  };
}

/**
 * AI 대전 전적 기록용 서버 함수 (056_ai_matches.sql). 테스트 모드는 null (서버를 부르지 않는다).
 * 연결하지 못하면 예외 → 그 경기는 기록하지 못한 것으로 끝난다. character: 내 캐릭터 (랭킹에 보인다)
 */
export async function getAiRpc(character: ZodiacId): Promise<AiRpc | null> {
  if (LOCAL_MODE) return null;
  const sb = await worldSupabase();
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as unknown;
  };
  return {
    start: async () => parseStart(await rpc('ai_match_start', { p_game: 'volleyball', p_difficulty: 'normal', p_character: character })),
    finish: async (id, won) => parseFinish(await rpc('ai_match_finish', { p_id: id, p_won: won })),
    cancel: async (id) => parseCancel(await rpc('ai_match_cancel', { p_id: id })),
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
