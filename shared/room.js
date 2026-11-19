// 맞고·카지노 공용 방: 방 목록 · 만들기 · 입장 · 레디 · 퇴장 · 게임 행동 · 실시간 구독.
// 방 상태 변경은 DB 함수(security definer)로, 게임 행동은 Edge Function(game-action)으로만 한다.
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';

export const SEATS = { matgo: 2, poker: 4, blackjack: 4, holdem: 4, roulette: 8 };
export const GAME_NAME = { matgo: '시아맞고', poker: '세븐포커', blackjack: '블랙잭', holdem: '텍사스 홀덤', roulette: '십이지신 룰렛' };
export const CURRENCY = { matgo: 'nyang', poker: 'chips', blackjack: 'chips', holdem: 'chips', roulette: 'chips' };
/** 살아 있음 신호 간격 (60초 넘게 없으면 서버가 나간 것으로 본다) */
export const TOUCH_MS = 20_000;

const ERRORS = {
  'need login': '로그인이 필요해요',
  'room not found': '방이 사라졌어요',
  'wrong password': '비밀번호가 맞지 않아요',
  'not enough money': '돈이 부족해요. 무료 충전을 해 보세요',
  'room full': '자리가 없어요 (사람으로 가득 찼어요)',
  'avatar taken': '다른 사람이 고른 동물이에요. 다른 동물을 골라 주세요',
  'not in room': '방에 들어가 있지 않아요',
  'not your turn': '내 차례가 아니에요',
  'not playing': '게임 중이 아니에요',
  'busy, try again': '잠시 후 다시 해 주세요',
  'bad password': '비밀번호는 20자까지예요',
};

export class RoomError extends Error {}

/** 서버 오류 → 한국어 */
export function friendly(e) {
  const m = String(e?.message ?? e ?? '');
  for (const [k, v] of Object.entries(ERRORS)) if (m.includes(k)) return v;
  return m && /[가-힣]/.test(m) ? m : '서버와 통신하지 못했어요. 잠시 후 다시 시도해 주세요';
}

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new RoomError(friendly(error));
  return data;
}

// ---------- 방 목록 ----------

/** 이 게임의 방 목록 (자리 정보 포함) */
export async function listRooms(game) {
  const { data, error } = await supabase
    .from('game_rooms')
    .select('id,game,name,has_password,base_unit,host_id,status,round_no,created_at,room_seats(seat_no,user_id,nickname,avatar,ready,left_game,pending_user_id)')
    .eq('game', game)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new RoomError(friendly(error));
  return (data ?? []).map((r) => ({ ...r, seats: (r.room_seats ?? []).sort((a, b) => a.seat_no - b.seat_no) }));
}

/** 방 목록이 바뀌면 cb (해제 함수 반환) */
export function watchRooms(game, cb) {
  let t = null;
  const soon = () => {
    clearTimeout(t);
    t = setTimeout(cb, 150);
  };
  const ch = supabase
    .channel(`rooms:${game}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: `game=eq.${game}` }, soon)
    // 삭제(DELETE)는 필터를 걸 수 없어서 따로 받는다
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'game_rooms' }, soon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_seats' }, soon)
    .subscribe();
  return () => {
    clearTimeout(t);
    void supabase.removeChannel(ch);
  };
}

// ---------- 방 들어가기 / 나가기 ----------

/** → 방 id */
export const createRoom = ({ game, name, password, baseUnit, avatar }) =>
  rpc('create_room', { p_game: game, p_name: name ?? '', p_password: password ?? '', p_base_unit: baseUnit, p_avatar: avatar });

/** → { seat, pending, avatar } (pending: 게임 중이라 다음 판부터) */
export const joinRoom = (roomId, password, avatar) => rpc('join_room', { p_room: roomId, p_password: password ?? '', p_avatar: avatar });

export const leaveRoom = (roomId) => rpc('leave_room', { p_room: roomId });
export const setAvatar = (roomId, avatar) => rpc('set_avatar', { p_room: roomId, p_avatar: avatar });
export const touchRoom = (roomId) => rpc('touch_room', { p_room: roomId }).catch(() => undefined);

/** 레디. 사람이 모두 레디했으면 바로 판을 시작한다 (onStart: 판 시작 응답을 받는다 — 혼자 하는 맞고는 여기에 전체 상태가 온다) */
export async function setReady(roomId, ready, onStart) {
  const all = await rpc('set_ready', { p_room: roomId, p_ready: ready });
  if (all) {
    const res = await startRound(roomId).catch(() => undefined);
    if (res && onStart) {
      try {
        onStart(res);
      } catch {
        /* 화면 쪽 문제로 레디가 실패한 것처럼 보이지 않게 */
      }
    }
  }
  return all;
}

// ---------- 게임 ----------

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('game-action', { body });
  if (error) {
    // 함수가 돌려준 { error } 메시지를 꺼낸다
    let msg = error.message;
    try {
      const j = await error.context?.json?.();
      if (j?.error) msg = j.error;
    } catch {
      /* 그대로 */
    }
    const err = new RoomError(friendly(msg));
    // 서버가 준 원래 문구와 상태 코드 (화면이 'out of sync' 같은 경우를 가려 처리한다). 통신 실패면 status 가 없다
    err.code = msg;
    err.status = error.context?.status;
    throw err;
  }
  return data;
}

export const startRound = (roomId) => invoke({ roomId, action: 'start' });
/**
 * 게임 행동 (payload 모양은 게임마다 다르다).
 * n: 기기에서 먼저 진행하는 화면(맞고)이 보내는 진행 수 — 서버 상태와 다르면 409 'out of sync' (중복·순서 뒤바뀜 방지)
 */
export const act = (roomId, payload, n) => invoke(n === undefined ? { roomId, action: 'act', payload } : { roomId, action: 'act', payload, n });

// ---------- 혼자 하는 맞고: 기기에서 진행 (supabase/functions/_shared/solo.ts) ----------

/** 진행 중인 혼자 하는 판의 전체 상태 → { state, version, round } (새로고침·재접속한 화면이 이어서 두려고) */
// (duo: 사람이 둘인 판의 상태도 달라는 표시. 서버는 이 표시가 있을 때만 사람 둘인 판의 전체 상태를 준다)
export const soloSync = (roomId) => invoke({ roomId, action: 'sync', payload: { duo: true } });

/**
 * 방 채널: 같은 방에 있는 화면끼리 바로 주고받는 알림 (Realtime Broadcast, DB·서버 함수를 거치지 않는다).
 * 사람 둘이 하는 맞고에서 내 행동을 상대 화면에 바로 보여 주는 데 쓴다. 누구나 보낼 수 있는 길이므로
 * 받은 쪽은 내용을 믿지 않는다 (규칙 검사를 통과한 것만 쓰고, 진실은 서버가 공개한 상태다).
 * 인원 집계 채널(card-lobby:*)·DB 변경 구독 채널(room:*)과는 따로 쓴다.
 */
export function roomCast(roomId, onMessage) {
  const ch = supabase
    .channel(`matgo-room:${roomId}`, { config: { broadcast: { self: false, ack: false } } })
    .on('broadcast', { event: 'act' }, (m) => {
      try {
        onMessage?.(m?.payload);
      } catch {
        /* 받은 쪽 문제로 채널이 끊기지 않게 */
      }
    })
    .subscribe();
  return {
    send: (msg) => {
      // 아직 연결 전이면 라이브러리가 HTTP 로 대신 보낸다. 실패해도 된다 (상대는 서버 공개 상태로 따라온다)
      void Promise.resolve(ch.send({ type: 'broadcast', event: 'act', payload: msg })).catch(() => undefined);
    },
    close: () => void supabase.removeChannel(ch),
  };
}
/** 기기에서 둔 사람 행동 목록 보내기: payload { n, actions } → { ok, n, done } (끝난 판이면 서버가 정산한다) */
export const soloReplay = (roomId, payload) => invoke({ roomId, action: 'replay', payload });

// 페이지를 떠나는 순간에는 로그인 정보를 기다려 읽을 수 없다 → 미리 받아 둔다
let accessToken = null;
void supabase.auth.getSession().then(({ data }) => {
  accessToken = data?.session?.access_token ?? accessToken;
}, () => undefined);
supabase.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token ?? null;
});

/**
 * 페이지를 떠나는 중(pagehide)에 행동 목록 보내기: 페이지가 닫혀도 요청이 끝까지 가게 한다 (fetch keepalive).
 * 응답은 기다리지 않고, 실패해도 무시한다 → 보냈으면 true
 */
export function soloReplayOnExit(roomId, payload) {
  if (!accessToken) return false;
  try {
    void fetch(`${SUPABASE_URL}/functions/v1/game-action`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ roomId, action: 'replay', payload }),
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

// ---------- 방 하나 읽기 · 구독 ----------

export async function getRoom(roomId) {
  const { data, error } = await supabase
    .from('game_rooms')
    .select('id,game,name,has_password,base_unit,host_id,status,round_no,created_at')
    .eq('id', roomId)
    .maybeSingle();
  if (error) throw new RoomError(friendly(error));
  return data;
}

export async function getSeats(roomId) {
  const { data, error } = await supabase
    .from('room_seats')
    .select('seat_no,user_id,nickname,avatar,ready,left_game,pending_user_id,pending_nickname,pending_avatar')
    .eq('room_id', roomId)
    .order('seat_no');
  if (error) throw new RoomError(friendly(error));
  return data ?? [];
}

/** 공개 게임 상태 (방 참가자만 읽힌다) */
export async function getState(roomId) {
  const { data } = await supabase.from('game_states').select('round_no,public_state,pending_seats,turn_deadline,updated_at').eq('room_id', roomId).maybeSingle();
  return data ?? null;
}

/** 내 비공개 패 (본인 것만 읽힌다) */
export async function getPrivate(roomId) {
  // 판 도중 나갔다가 다른 자리를 예약하면 내 행이 둘일 수 있다 → 가장 최근 판의 것
  const { data } = await supabase
    .from('game_private')
    .select('seat_no,round_no,hand')
    .eq('room_id', roomId)
    .order('round_no', { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

/**
 * 방 하나의 변경 구독: { onRoom, onSeats, onState, onPrivate } 중 필요한 것만.
 * 끊겼다 다시 연결되면 onResync를 부른다 (그 사이 놓친 변경을 다시 읽도록).
 */
export function watchRoom(roomId, { onRoom, onSeats, onState, onPrivate, onResync } = {}) {
  let first = true;
  const ch = supabase
    .channel(`room:${roomId}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` }, (p) => {
      if (p.eventType !== 'DELETE') onRoom?.(p.new);
    })
    // 방 삭제는 필터 없이 받고 id로 고른다
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'game_rooms' }, (p) => {
      if (p.old?.id === roomId) onRoom?.(null);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_seats', filter: `room_id=eq.${roomId}` }, () => onSeats?.())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_states', filter: `room_id=eq.${roomId}` }, (p) => onState?.(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_private', filter: `room_id=eq.${roomId}` }, (p) => onPrivate?.(p.new))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (!first) onResync?.();
        first = false;
      }
    });
  return () => void supabase.removeChannel(ch);
}
