import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { Backend, Channel, Member, NetMsg, Room, RoomPlayer } from './backend';

class SupaChannel<M> implements Channel<M> {
  private ch: RealtimeChannel;
  private presenceCbs: ((m: Member<M>[]) => void)[] = [];
  private msgCbs: ((m: NetMsg) => void)[] = [];

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

  join(meta: M): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      this.ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.ch.track({ meta });
          if (!done) {
            done = true;
            resolve();
          }
        } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !done) {
          done = true;
          reject(new Error(status));
        }
      });
    });
  }

  async track(meta: M) {
    await this.ch.track({ meta });
  }

  send(msg: NetMsg) {
    void this.ch.send({ type: 'broadcast', event: 'm', payload: msg });
  }

  async leave() {
    this.presenceCbs = [];
    this.msgCbs = [];
    await this.ch.unsubscribe();
  }
}

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });

  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  };

  let token: string | null = null;
  const withTok = (p: RoomPlayer) => ({ ...p, token });

  return {
    kind: 'supabase',
    setToken: (t) => void (token = t),
    signUp: (name, pw) => rpc<string>('sign_up', { p_name: name, p_pw: pw }),
    signIn: (name, pw) => rpc<string>('sign_in', { p_name: name, p_pw: pw }),
    checkSession: (name, tok) => rpc<boolean>('check_session', { p_name: name, p_token: tok }).catch(() => false),
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
    createRoom: (lobby, name, player: RoomPlayer) => rpc<Room>('create_room', { p_lobby: lobby, p_name: name, p_player: withTok(player) }),
    joinRoom: (id, player) => rpc<Room>('join_room', { p_id: id, p_player: withTok(player) }),
    kickPlayer: (id, host, target) => rpc<void>('kick_player', { p_id: id, p_host: host, p_target: target }),
    leaveRoom: (id, playerId) => rpc<void>('leave_room', { p_id: id, p_player_id: playerId }),
    updatePlayer: (id, player) => rpc<void>('update_player', { p_id: id, p_player: withTok(player) }),
    setOptions: (id, playerId, speed, wind) => rpc<void>('set_room_options', { p_id: id, p_player: playerId, p_speed: speed, p_wind: wind }),
    setMode: (id, playerId, mode) => rpc<void>('set_room_mode', { p_id: id, p_player: playerId, p_mode: mode }),
    setMap: (id, playerId, map) => rpc<void>('set_room_map', { p_id: id, p_player: playerId, p_map: map }),
    startGame: (id, host, seed) => rpc<Room>('start_game', { p_id: id, p_host: host, p_seed: seed }),
    endGame: (id, gameNo, present, winner) => rpc<void>('end_game', { p_id: id, p_game_no: gameNo, p_present: present, p_winner: winner ?? null }),
    async getRanking() {
      const { data, error } = await sb.from('player_points').select('name,points,wins,losses').order('points', { ascending: false }).limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as { name: string; points: number; wins: number; losses: number }[];
    },
    async getPoints(name) {
      const { data, error } = await sb.from('player_points').select('points').eq('name', name).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { points: number } | null)?.points ?? 1000;
    },
    submitTargetScore: (name, tok, score) => rpc<number>('submit_target_score', { p_name: name, p_token: tok, p_score: score }),
    async getTargetRanking() {
      const { data, error } = await sb.from('target_scores').select('name,best').order('best', { ascending: false }).limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as { name: string; best: number }[];
    },
    quitGame: (id, playerId) => rpc<void>('quit_game', { p_id: id, p_player: playerId }),
    touchRoom: (id, playerId) => rpc<void>('touch_room', { p_id: id, p_player: playerId }),
    sweepRooms: (lobby) => rpc<void>('sweep_rooms', { p_lobby: lobby }),
  };
}
