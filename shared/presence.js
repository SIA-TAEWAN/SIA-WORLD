// SIA WORLD 접속 인원 (게임마다 "지금 몇 명"과 정원 30명).
//   게임마다 실시간 채널(Presence)이 있고, 들어온 사람은 그 채널에 자기 정보를 올린다 (같은 계정은 탭이 여러 개여도 한 명).
//   - 시아탱크 lobby:main · 시아배구 volley-lobby · 시아서바이벌 survival-lobby 는 각 게임의 대기실 채널을 그대로 센다.
//   - 맞고·카지노는 이 파일의 enterGame()으로 card-lobby:<게임> 채널에 들어간다.
//   - 시아돌격대·시아핑거·시아레이스도 enterGame()으로 charge-lobby · finger-lobby · race-lobby 에 들어간다
//     (시아레이스는 2026-11-23 방 경기를 없애며 예전 대기실 채널 이름 race-lobby 를 그대로 접속 인원 채널로 쓴다).
//   - SIA WORLD 로비는 watchWorld()로 게임 채널을 구독만 해서(게임 채널에는 자기 정보를 올리지 않는다 → 게임 정원과 무관)
//     게임 카드에 인원과 닉네임 목록을 보여 주고, 로비 전용 채널 world-lobby 에만 자기 정보를 올려 로비 사람끼리 보이게 한다.
//   - 모든 채널이 같은 모양으로 올린다: key = 사용자 ID, 내용 = { meta: { name: 닉네임, ... } }
import { supabase } from './supabase.js';

/** 게임 하나에 동시에 들어올 수 있는 사람 수 */
export const GAME_MAX = 30;

/** 게임 ID(shared/games.js) → 그 게임의 접속 채널들 */
export const GAME_CHANNELS = {
  tank: ['lobby:main'],
  matgo: ['card-lobby:matgo'],
  casino: ['card-lobby:poker', 'card-lobby:holdem', 'card-lobby:blackjack', 'card-lobby:roulette'],
  race: ['race-lobby'], // enterGame (예전 대기실 채널과 같은 이름)
  volleyball: ['volley-lobby'],
  survival: ['survival-lobby'],
  defense: ['defense-lobby'],
  village: ['village-lobby'],
  charge: ['charge-lobby'],
  finger: ['finger-lobby'],
  twelve: ['twelve-lobby'],
};

/** 맞고·카지노 게임 하나의 접속 채널 이름 */
export const cardChannel = (game) => `card-lobby:${game}`;

/** SIA WORLD 로비에 있는 사람들의 채널 (게임 채널이 아니라서 게임 정원 30명과 상관없고, 정원도 없다) */
export const WORLD_LOBBY_CHANNEL = 'world-lobby';

/** 채널에 올라온 사람들: [{ id, name }] (이름을 올리지 않은 사람은 name 이 '') */
function peopleOf(ch) {
  const list = [];
  for (const [id, metas] of Object.entries(ch.presenceState())) {
    const last = metas[metas.length - 1];
    const m = last?.meta ?? last ?? {};
    list.push({ id, name: typeof m.name === 'string' ? m.name.trim().slice(0, 16) : '' });
  }
  return list;
}

/**
 * 로비용: 지금 누가 어디에 있는지 받는다. 게임 채널은 구독만 하고, user 를 주면 로비 채널(world-lobby)에 내 정보를 올린다.
 * cb({
 *   counts: { tank: 3, ... },                    게임마다 사람 수 (같은 계정은 한 번)
 *   games:  { tank: [{ id, name }], ... },       게임마다 있는 사람 (name 이 '' 이면 이름을 모르는 사람)
 *   lobby:  [{ id, name }],                      로비에 있는 사람
 *   online: [{ id, name, games: ['tank'], lobby: true }]   전체 (같은 사람은 한 번, 이름 모르는 사람은 뺀다)
 * }) 가 바뀔 때마다 불린다. 돌려주는 함수를 부르면 그만 보고 로비 채널에서도 나온다.
 * @param {(w: object) => void} cb
 * @param {{ user?: { userId: string, nickname: string } | null, lobby?: boolean }} [opt] lobby: false 면 로비 채널을 보지 않는다
 */
export function watchWorld(cb, opt = {}) {
  const user = opt.user ?? null;
  const withLobby = opt.lobby !== false;
  const seen = new Map(); // 채널 이름 → [{ id, name }]
  let stopped = false;
  const emit = () => {
    if (stopped) return;
    const counts = {};
    const games = {};
    const online = new Map(); // id → { id, name, games, lobby }
    const person = (p) => {
      let o = online.get(p.id);
      if (!o) online.set(p.id, (o = { id: p.id, name: '', games: [], lobby: false }));
      if (!o.name && p.name) o.name = p.name;
      return o;
    };
    for (const [game, topics] of Object.entries(GAME_CHANNELS)) {
      const byId = new Map();
      for (const t of topics) {
        for (const p of seen.get(t) ?? []) {
          if (!byId.get(p.id)?.name) byId.set(p.id, p);
        }
      }
      games[game] = [...byId.values()];
      counts[game] = byId.size;
      for (const p of byId.values()) person(p).games.push(game);
    }
    const lobby = withLobby ? [...(seen.get(WORLD_LOBBY_CHANNEL) ?? [])] : [];
    for (const p of lobby) person(p).lobby = true;
    cb({ counts, games, lobby, online: [...online.values()].filter((o) => o.name) });
  };
  const channels = [];
  const watch = (topic, config, onUp) => {
    const ch = config ? supabase.channel(topic, { config }) : supabase.channel(topic);
    ch.on('presence', { event: 'sync' }, () => {
      seen.set(topic, peopleOf(ch));
      emit();
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') onUp?.(ch);
    });
    channels.push(ch);
  };
  for (const topic of new Set(Object.values(GAME_CHANNELS).flat())) watch(topic);
  if (withLobby) {
    if (user?.userId) {
      const meta = { name: user.nickname, seen: Date.now() };
      // 다시 연결됐을 때도 내 정보를 다시 올린다
      watch(WORLD_LOBBY_CHANNEL, { presence: { key: user.userId } }, (ch) => void ch.track({ meta }).catch(() => undefined));
    } else {
      watch(WORLD_LOBBY_CHANNEL);
    }
  }
  return () => {
    stopped = true;
    channels.forEach((ch) => void supabase.removeChannel(ch));
  };
}

/** 채널에 올라온 사람들: [{ key, seen }] (들어온 순) */
function membersOf(ch) {
  const list = [];
  for (const [key, metas] of Object.entries(ch.presenceState())) {
    const last = metas[metas.length - 1];
    const m = last?.meta ?? {};
    // 들어온 시각: 이 파일·배구는 seen, 시아탱크는 at
    const seen = Number(m.seen ?? m.at) || 0;
    list.push({ key, seen });
  }
  return list.sort((a, b) => a.seen - b.seen || (a.key < b.key ? -1 : 1));
}

/**
 * 로비용: 게임마다 지금 들어와 있는 사람 수를 받는다 (구독만 한다).
 * cb({ tank: 3, matgo: 0, ... }) 가 바뀔 때마다 불린다. 돌려주는 함수를 부르면 그만 본다.
 */
export function watchGameCounts(cb) {
  return watchWorld((w) => cb(w.counts), { lobby: false });
}

/**
 * 게임에 들어간다 (맞고·카지노·돌격대·핑거·레이스): 채널에 내 정보를 올리고, 정원(30명)을 넘으면 full: true.
 * → { full, count(), onChange(fn) → 해제 함수, leave() }
 * 실시간 연결을 못 하면 막지 않는다 (full: false, count 0).
 */
export async function enterGame(topic, user) {
  const fns = new Set();
  let members = [];
  let ch = null;
  const handle = {
    full: false,
    count: () => members.length,
    onChange(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    async leave() {
      fns.clear();
      if (ch) await supabase.removeChannel(ch).catch(() => undefined);
      ch = null;
    },
  };
  try {
    ch = supabase.channel(topic, { config: { presence: { key: user.userId } } });
    ch.on('presence', { event: 'sync' }, () => {
      members = membersOf(ch);
      fns.forEach((f) => f());
    });
    const meta = { name: user.nickname, seen: Date.now() };
    await new Promise((resolve, reject) => {
      let done = false;
      ch.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // 다시 연결됐을 때도 내 정보를 다시 올린다
          await ch.track({ meta });
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
    // 먼저 와 있던 사람들의 정보가 도착할 시간을 잠깐 준다
    await new Promise((r) => setTimeout(r, 900));
    members = membersOf(ch);
    const idx = members.findIndex((m) => m.key === user.userId);
    if (idx >= GAME_MAX) {
      handle.full = true;
      await handle.leave();
    }
  } catch {
    await handle.leave();
  }
  return handle;
}
