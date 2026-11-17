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
      const r = await sb.from('game_decks').select('version,round_no,state,carry').eq('room_id', id).maybeSingle();
      return (must(r) ?? { version: 0, round_no: 0, state: null, carry: null }) as DeckRow;
    },
    async saveDeck(id, expectVersion, state, carry, round) {
      const r = await sb
        .from('game_decks')
        .update({ state, carry, round_no: round, version: expectVersion + 1 })
        .eq('room_id', id)
        .eq('version', expectVersion)
        .select('room_id');
      return (must(r) ?? []).length === 1;
    },
    async beginRound(id) {
      const r = await sb.rpc('begin_round', { p_room: id });
      return (must(r) as number | null) ?? null;
    },
    async publish(id, version, round, pub, pendingSeats, deadline, privates) {
      // 버전이 더 새로울 때만 저장 (늦게 도착한 옛 상태가 덮어쓰지 않게)
      must(
        await sb.rpc('publish_state', {
          p_room: id,
          p_version: version,
          p_round: round,
          p_pub: pub,
          p_pending: pendingSeats,
          p_deadline: deadline ? deadline.toISOString() : null,
          p_privates: privates.map((p) => ({ seat: p.seat, userId: p.userId, hand: p.hand })),
        }),
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
    async placeBet(id, round, spin, userId, bets, total) {
      must(await sb.rpc('roulette_place_bet', { p_room: id, p_round: round, p_spin: spin, p_user: userId, p_bets: bets, p_total: total }));
    },
    async paySpin(id, round, spin, result) {
      must(await sb.rpc('roulette_pay', { p_room: id, p_round: round, p_spin: spin, p_result: result }));
    },
  };
}
