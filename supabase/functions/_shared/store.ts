/**
 * Runner가 쓰는 Store의 Supabase 구현 (service role 클라이언트, Edge Function 전용).
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import type { DeckRow, GameId, RoomRow, SeatRow, Store } from './runner.ts';

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

export function supabaseStore(sb: SupabaseClient): Store {
  return {
    async room(id) {
      const r = await sb.from('game_rooms').select('id,game,base_unit,status,round_no').eq('id', id).maybeSingle();
      return must(r) as RoomRow | null;
    },
    async seats(id) {
      const r = await sb.from('room_seats').select('seat_no,user_id,nickname,avatar,ready,left_game').eq('room_id', id).order('seat_no');
      return (must(r) ?? []) as SeatRow[];
    },
    async balances(userIds, game: GameId) {
      if (!userIds.length) return {};
      const r = await sb.from('wallets').select('user_id,chips,nyang').in('user_id', userIds);
      const out: Record<string, number> = {};
      for (const w of (must(r) ?? []) as { user_id: string; chips: number; nyang: number }[]) {
        out[w.user_id] = Number(game === 'matgo' ? w.nyang : w.chips);
      }
      return out;
    },
    async deck(id) {
      const r = await sb.from('game_decks').select('version,state,carry').eq('room_id', id).maybeSingle();
      return (must(r) ?? { version: 0, state: null, carry: null }) as DeckRow;
    },
    async saveDeck(id, expectVersion, state, carry) {
      const r = await sb
        .from('game_decks')
        .update({ state, carry, version: expectVersion + 1 })
        .eq('room_id', id)
        .eq('version', expectVersion)
        .select('room_id');
      return (must(r) ?? []).length === 1;
    },
    async beginRound(id) {
      const r = await sb.rpc('begin_round', { p_room: id });
      return (must(r) as number | null) ?? null;
    },
    async publish(id, round, pub, pendingSeats, deadline, privates) {
      must(
        await sb
          .from('game_states')
          .upsert({
            room_id: id,
            round_no: round,
            public_state: pub,
            pending_seats: pendingSeats,
            turn_deadline: deadline ? deadline.toISOString() : null,
            updated_at: new Date().toISOString(),
          }),
      );
      must(
        await sb.from('game_private').upsert(
          privates.map((p) => ({ room_id: id, seat_no: p.seat, user_id: p.userId, round_no: round, hand: p.hand })),
        ),
      );
    },
    async applyResult(id, round, deltas) {
      const r = await sb.rpc('apply_round_result', { p_room: id, p_round: round, p_deltas: deltas });
      return Boolean(must(r));
    },
    async finishRound(id) {
      const r = await sb.rpc('finish_round', { p_room: id });
      return Boolean(must(r));
    },
  };
}
