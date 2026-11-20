import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Backend, Channel, Member, NetMsg, RankEntry, Room, RoomPlayer, TargetEntry } from './backend';
import { LOBBY_MAX } from './lobby';

class SupaChannel<M> implements Channel<M> {
  private ch: RealtimeChannel;
  private presenceCbs: ((m: Member<M>[]) => void)[] = [];
  private msgCbs: ((m: NetMsg) => void)[] = [];
  private reconnectCbs: (() => void)[] = [];

  constructor(sb: SupabaseClient, name: string, key: string) {
    this.ch = sb.channel(name, { config: { presence: { key }, broadcast: { self: false, ack: false } } });
    this.ch.on('presence', { event: 'sync' }, () => {
      const state = this.ch.presenceState<{ meta: M }>();
      const list: Member<M>[] = [];
      for (const [k, metas] of Object.entries(state)) {
        const last = metas[metas.length - 1];
        if (last) list.push({ key: k, meta: last.meta });
      }
      this.presenceCbs.forEach((cb) => cb(list));
    });
    this.ch.on('broadcast', { event: 'm' }, ({ payload }) => this.msgCbs.forEach((cb) => cb(payload as NetMsg)));
  }

  onPresence(cb: (m: Member<M>[]) => void) {
    this.presenceCbs.push(cb);
  }
  onMessage(cb: (m: NetMsg) => void) {
    this.msgCbs.push(cb);
  }
  onReconnect(cb: () => void) {
    this.reconnectCbs.push(cb);
  }

  /** 마지막으로 올린 내 정보 (다시 연결되면 처음 정보가 아니라 이걸 올린다) */
  private meta: M | null = null;

  join(meta: M): Promise<void> {
    this.meta = meta;
    return new Promise((resolve, reject) => {
      let done = false;
      this.ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.ch.track({ meta: this.meta ?? meta });
          if (!done) {
            done = true;
            resolve();
          } else {
            // 소켓이 끊겼다 다시 이어짐 (와이파이→LTE 등): 그동안 남들은 내가 나갔다 들어온 것으로 봤다
            this.reconnectCbs.forEach((cb) => cb());
          }
        } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !done) {
          done = true;
          reject(new Error(status));
        }
      });
    });
  }

  async track(meta: M) {
    this.meta = meta;
    await this.ch.track({ meta });
  }

  send(msg: NetMsg) {
    void this.ch.send({ type: 'broadcast', event: 'm', payload: msg });
  }

  async leave() {
    this.presenceCbs = [];
    this.msgCbs = [];
    this.reconnectCbs = [];
    await this.ch.unsubscribe();
  }
}

/** 랭킹 줄의 이름: 가입자는 닉네임, 아직 이어받지 않은 예전 기록은 예전 ID */
type RankRowDb = { user_id: string | null; legacy_id: string | null; profiles: { nickname: string } | null };
const keyOf = (r: RankRowDb) => (r.user_id ? r.user_id : `legacy:${r.legacy_id ?? ''}`);
const nameOf = (r: RankRowDb) => r.profiles?.nickname ?? r.legacy_id ?? '?';

/** sb: SIA WORLD 공통 클라이언트 (로그인 세션을 그대로 쓴다. 서버는 auth.uid()로 본인을 확인) */
export function createSupabaseBackend(sb: SupabaseClient): Backend {

  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  };

  return {
    kind: 'supabase',
    channel: <M>(name: string, key: string) => new SupaChannel<M>(sb, name, key),
    async listRooms(lobby) {
      const { data, error } = await sb.from('rooms').select('*').eq('lobby', lobby).order('created_at');
      if (error) throw new Error(error.message);
      return (data ?? []) as Room[];
    },
    watchRooms(lobby, cb) {
      const ch = sb
        .channel(`rooms-db:${lobby}:${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => cb())
        .subscribe();
      return () => void sb.removeChannel(ch);
    },
    createRoom: (lobby, name, player: RoomPlayer) => rpc<Room>('create_room', { p_lobby: lobby, p_name: name, p_player: player }),
    joinRoom: (id, player) => rpc<Room>('join_room', { p_id: id, p_player: player }),
    kickPlayer: (id, host, target) => rpc<void>('kick_player', { p_id: id, p_host: host, p_target: target }),
    leaveRoom: (id, playerId) => rpc<void>('leave_room', { p_id: id, p_player_id: playerId }),
    updatePlayer: (id, player) => rpc<void>('update_player', { p_id: id, p_player: player }),
    setOptions: (id, playerId, speed, wind) => rpc<void>('set_room_options', { p_id: id, p_player: playerId, p_speed: speed, p_wind: wind }),
    setMode: (id, playerId, mode) => rpc<void>('set_room_mode', { p_id: id, p_player: playerId, p_mode: mode }),
    setMap: (id, playerId, map) => rpc<void>('set_room_map', { p_id: id, p_player: playerId, p_map: map }),
    startGame: (id, host, seed) => rpc<Room>('start_game', { p_id: id, p_host: host, p_seed: seed }),
    endGame: (id, gameNo, present, winner) => rpc<void>('end_game', { p_id: id, p_game_no: gameNo, p_present: present, p_winner: winner ?? null }),
    async getRanking(): Promise<RankEntry[]> {
      const { data, error } = await sb
        .from('player_points')
        .select('user_id,legacy_id,points,wins,losses,profiles(nickname)')
        .order('wins', { ascending: false })
        .order('losses', { ascending: true })
        .limit(1000);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as (RankRowDb & { points: number; wins: number; losses: number })[]).map((r) => ({
        key: keyOf(r),
        name: nameOf(r),
        points: r.points,
        wins: r.wins,
        losses: r.losses,
      }));
    },
    async getLobbyMax() {
      const { data } = await sb.from('app_settings').select('value').eq('key', 'tank_lobby_max').maybeSingle();
      const n = Number((data as { value: unknown } | null)?.value);
      return Number.isFinite(n) && n >= 2 ? n : LOBBY_MAX;
    },
    setLobbyMax: (n) => rpc<number>('set_app_setting', { p_key: 'tank_lobby_max', p_value: Math.round(n) }),
    async getPoints(userId) {
      const { data, error } = await sb.from('player_points').select('points').eq('user_id', userId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { points: number } | null)?.points ?? 1000;
    },
    submitTargetScore: (score) => rpc<number>('submit_target_score', { p_score: score }),
    async getTargetRanking(): Promise<TargetEntry[]> {
      const { data, error } = await sb
        .from('target_scores')
        .select('user_id,legacy_id,best,profiles(nickname)')
        .order('best', { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as (RankRowDb & { best: number })[]).map((r) => ({ key: keyOf(r), name: nameOf(r), best: r.best }));
    },
    quitGame: (id, playerId) => rpc<void>('quit_game', { p_id: id, p_player: playerId }),
    touchRoom: (id, playerId) => rpc<void>('touch_room', { p_id: id, p_player: playerId }),
    sweepRooms: (lobby) => rpc<void>('sweep_rooms', { p_lobby: lobby }),
  };
}
