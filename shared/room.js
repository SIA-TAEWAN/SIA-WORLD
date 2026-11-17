// 맞고·카지노 공용 방: 방 목록 · 만들기 · 입장 · 레디 · 퇴장 · 게임 행동 · 실시간 구독.
// 방 상태 변경은 DB 함수(security definer)로, 게임 행동은 Edge Function(game-action)으로만 한다.
import { supabase } from './supabase.js';

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

/** 레디. 사람이 모두 레디했으면 바로 판을 시작한다 */
export async function setReady(roomId, ready) {
  const all = await rpc('set_ready', { p_room: roomId, p_ready: ready });
  if (all) await startRound(roomId).catch(() => undefined);
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
    throw new RoomError(friendly(msg));
  }
  return data;
}

export const startRound = (roomId) => invoke({ roomId, action: 'start' });
/** 게임 행동 (payload 모양은 게임마다 다르다) */
export const act = (roomId, payload) => invoke({ roomId, action: 'act', payload });

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
