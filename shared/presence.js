// SIA WORLD 접속 인원 (게임마다 "지금 몇 명"과 정원 30명).
//   게임마다 실시간 채널(Presence)이 있고, 들어온 사람은 그 채널에 자기 정보를 올린다 (같은 계정은 탭이 여러 개여도 한 명).
//   - 시아탱크 lobby:main · 시아레이스 race-lobby · 시아배구 volley-lobby · 시아서바이벌 survival-lobby 는 각 게임의 대기실 채널을 그대로 센다.
//   - 맞고·카지노는 이 파일의 enterGame()으로 card-lobby:<게임> 채널에 들어간다.
//   - SIA WORLD 로비는 watchGameCounts()로 구독만 해서 게임 카드에 인원을 보여 준다 (자기 정보는 올리지 않는다).
import { supabase } from './supabase.js';

/** 게임 하나에 동시에 들어올 수 있는 사람 수 */
export const GAME_MAX = 30;

/** 게임 ID(shared/games.js) → 그 게임의 접속 채널들 */
export const GAME_CHANNELS = {
  tank: ['lobby:main'],
  matgo: ['card-lobby:matgo'],
  casino: ['card-lobby:poker', 'card-lobby:holdem', 'card-lobby:blackjack', 'card-lobby:roulette'],
  race: ['race-lobby'],
  volleyball: ['volley-lobby'],
  survival: ['survival-lobby'],
  defense: ['defense-lobby'],
};

/** 맞고·카지노 게임 하나의 접속 채널 이름 */
export const cardChannel = (game) => `card-lobby:${game}`;

/** 채널에 올라온 사람들: [{ key, seen }] (들어온 순) */
function membersOf(ch) {
  const list = [];
  for (const [key, metas] of Object.entries(ch.presenceState())) {
    const last = metas[metas.length - 1];
    const m = last?.meta ?? {};
    // 들어온 시각: 이 파일·레이스·배구는 seen, 시아탱크는 at
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
  const keys = new Map(); // 채널 이름 → Set(사용자 key)
  const emit = () => {
    const out = {};
    for (const [game, topics] of Object.entries(GAME_CHANNELS)) {
      const all = new Set();
      for (const t of topics) for (const k of keys.get(t) ?? []) all.add(k);
      out[game] = all.size;
    }
    cb(out);
  };
  const channels = [];
  for (const topic of new Set(Object.values(GAME_CHANNELS).flat())) {
    const ch = supabase.channel(topic);
    ch.on('presence', { event: 'sync' }, () => {
      keys.set(topic, new Set(Object.keys(ch.presenceState())));
      emit();
    });
    ch.subscribe();
    channels.push(ch);
  }
  return () => channels.forEach((ch) => void supabase.removeChannel(ch));
}

/**
 * 게임에 들어간다 (맞고·카지노): 채널에 내 정보를 올리고, 정원(30명)을 넘으면 full: true.
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
