import type { SupabaseClient } from '@supabase/supabase-js';
import { CHURU_IDS, PRESENT_FURNITURE, loveAt } from '../data/balance';
import {
  RuleError, adopt, brush, churu, clean, cure, feed, gift, newState, payLocal, pet, play, playStart, seen, visit, water,
  type Cat, type NyangState, type Present, type Profile,
} from '../game/rules';
import { worldSupabase } from './world';

/**
 * 서버 연결. 시아집사는 서버가 진실이다 (PRD 9장): 상태를 바꾸는 것은 모두 서버 함수(supabase/migrations/123_nyang.sql)가
 * 서버 시각으로 계산하고, 화면은 돌려받은 상태를 서버 시각(now())으로 풀어서(game/rules.ts) 보여 주기만 한다.
 * 테스트 모드(?local=1, 개발 서버 · localhost 전용)는 같은 규칙으로 이 기기에만 저장한다.
 *   &time=10  시간 10배 빠르게 · &skip=6h  6시간 지난 것처럼 (한 번) · &love=7  첫 고양이 친밀도 7단계로 (한 번) · &reset=1 처음부터
 *   &toys=1  장난감 모두 (한 번) · &churu=5  츄르 맛마다 5개 더 (한 번) · &gift=1  첫 고양이가 선물을 물어 온 것처럼 (한 번)
 */
const loc = typeof location === 'undefined' ? null : location;
const params = new URLSearchParams(loc?.search ?? '');
export const LOCAL_MODE = !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));

/** 서버가 거절한 까닭 (SQL 의 raise exception 글자 = RuleError 의 글자). 통신 문제는 Error('network') */
export class ApiError extends Error {}

export interface CareOut {
  state: NyangState;
  bonus: number;
  sia: boolean;
}
export interface NyangApi {
  kind: 'supabase' | 'local';
  /** 지금의 서버 시각 (초, 소수). 마지막 답에 실려 온 서버 시각으로 기기 시계와의 차이를 맞춘 값 */
  now(): number;
  /** 내 상태. entry: 게임에 들어올 때만 true → away (떠나 있던 초) */
  state(entry?: boolean): Promise<{ state: NyangState; away: number }>;
  adopt(color: string, personality: string, name: string): Promise<{ state: NyangState; slot: number }>;
  feed(slot: number, food?: string): Promise<CareOut>;
  water(slot: number): Promise<CareOut>;
  clean(slot: number): Promise<CareOut & { gift: number; poops: number }>;
  pet(slot: number, spot: string): Promise<CareOut & { kind: 'like' | 'ok' | 'hate'; love: number }>;
  cure(slot: number, kind?: string): Promise<{ state: NyangState }>;
  playStart(slot: number, toy: string): Promise<{ state: NyangState }>;
  play(slot: number, catches: number): Promise<CareOut & { catches: number; love: number; liked: boolean }>;
  brush(slot: number): Promise<CareOut & { fur: number; love: number }>;
  churu(slot: number, flavor: string): Promise<CareOut & { love: number; liked: boolean; cured: boolean }>;
  gift(slot: number): Promise<{ state: NyangState; present: Present }>;
  seen(slot: number, behavior: string): Promise<{ state: NyangState; added: boolean }>;
}

// ---------- 서버 ----------

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const numOrNull = (v: unknown) => (v == null ? null : num(v));
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);
function cleanPresent(v: unknown): Present | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const kind = String(r.kind);
  if (kind !== 'coin' && kind !== 'seed' && kind !== 'toy' && kind !== 'furniture') return null;
  return { kind, id: String(r.id ?? ''), n: num(r.n, 1) };
}
function cleanItems(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, n] of Object.entries(v)) if (num(n) > 0) out[k] = num(n);
  return out;
}
function cleanCat(raw: unknown): Cat {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    slot: num(r.slot, 1), name: String(r.name ?? ''), color: String(r.color ?? 'white') as Cat['color'], pattern: typeof r.pattern === 'string' ? r.pattern : null,
    personality: String(r.personality ?? 'calm') as Cat['personality'], adoptedAt: num(r.adoptedAt), calcAt: num(r.calcAt), fedAt: num(r.fedAt), fedAmount: num(r.fedAmount),
    waterAt: num(r.waterAt), poopBase: num(r.poopBase), poopAt: num(r.poopAt), moodVal: num(r.moodVal), moodAt: num(r.moodAt), love: num(r.love),
    sickAt: numOrNull(r.sickAt), cureAt: numOrNull(r.cureAt), petDay: num(r.petDay, -1), petLove: num(r.petLove), petAt: num(r.petAt),
    playAt: num(r.playAt), playToy: strOrNull(r.playToy), playDay: num(r.playDay, -1), playLove: num(r.playLove), brushDay: num(r.brushDay, -1),
    churuDay: num(r.churuDay, -1), churuN: num(r.churuN), presentAt: num(r.presentAt), present: cleanPresent(r.present),
    seen: Array.isArray(r.seen) ? r.seen.map(String) : [],
  };
}
export function cleanState(raw: unknown): NyangState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const p = (r.profile ?? {}) as Record<string, unknown>;
  const profile: Profile = {
    coins: num(p.coins), seq: num(p.seq), visitAt: num(p.visitAt), bonusDay: num(p.bonusDay, -1), careDays: num(p.careDays), siaDay: num(p.siaDay, -1),
    siaToday: num(p.siaToday), siaDue: num(p.siaDue), siaPaid: num(p.siaPaid), sia: num(p.sia),
    items: cleanItems(p.items), furniture: Array.isArray(p.furniture) ? p.furniture.map(String) : [], pseq: num(p.pseq),
  };
  return { profile, cats: (Array.isArray(r.cats) ? r.cats : []).map(cleanCat) };
}

async function createSupabaseApi(): Promise<NyangApi> {
  const sb: SupabaseClient = await worldSupabase();
  let offset = 0;
  async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const t0 = Date.now() / 1000;
    let res;
    try {
      res = await sb.rpc(fn, args);
    } catch {
      throw new Error('network');
    }
    if (res.error) {
      const m = /^[a-z][a-z ]+$/.exec(res.error.message ?? '');
      if (m) throw new ApiError(m[0]);
      throw new Error('network');
    }
    const data = (res.data ?? {}) as Record<string, unknown>;
    const st = data.state as Record<string, unknown> | undefined;
    if (st && typeof st.now === 'number') offset = st.now - (t0 + Date.now() / 1000) / 2;
    return data;
  }
  const care = (d: Record<string, unknown>): CareOut => ({ state: cleanState(d.state), bonus: num(d.bonus), sia: d.sia === true });
  return {
    kind: 'supabase',
    now: () => Date.now() / 1000 + offset,
    async state(entry = false) {
      const d = await rpc('nyang_state', { p_entry: entry });
      return { state: cleanState(d.state), away: num(d.away) };
    },
    async adopt(color, personality, name) {
      const d = await rpc('nyang_adopt', { p_color: color, p_personality: personality, p_name: name });
      return { state: cleanState(d.state), slot: num(d.slot, 1) };
    },
    feed: async (slot, food = 'basic') => care(await rpc('nyang_feed', { p_slot: slot, p_food: food })),
    water: async (slot) => care(await rpc('nyang_water', { p_slot: slot })),
    async clean(slot) {
      const d = await rpc('nyang_clean', { p_slot: slot });
      return { ...care(d), gift: num(d.gift), poops: num(d.poops) };
    },
    async pet(slot, spot) {
      const d = await rpc('nyang_pet', { p_slot: slot, p_spot: spot });
      return { ...care(d), kind: d.kind === 'like' || d.kind === 'hate' ? d.kind : 'ok', love: num(d.love) };
    },
    async cure(slot, kind = 'blanket') {
      const d = await rpc('nyang_cure', { p_slot: slot, p_kind: kind });
      return { state: cleanState(d.state) };
    },
    async playStart(slot, toy) {
      const d = await rpc('nyang_play_start', { p_slot: slot, p_toy: toy });
      return { state: cleanState(d.state) };
    },
    async play(slot, catches) {
      const d = await rpc('nyang_play', { p_slot: slot, p_catches: Math.max(0, Math.floor(catches)) });
      return { ...care(d), catches: num(d.catches), love: num(d.love), liked: d.liked === true };
    },
    async brush(slot) {
      const d = await rpc('nyang_brush', { p_slot: slot });
      return { ...care(d), fur: num(d.fur), love: num(d.love) };
    },
    async churu(slot, flavor) {
      const d = await rpc('nyang_churu', { p_slot: slot, p_flavor: flavor });
      return { ...care(d), love: num(d.love), liked: d.liked === true, cured: d.cured === true };
    },
    async gift(slot) {
      const d = await rpc('nyang_gift', { p_slot: slot });
      return { state: cleanState(d.state), present: cleanPresent(d.present) ?? { kind: 'coin', id: 'coin', n: 0 } };
    },
    async seen(slot, behavior) {
      const d = await rpc('nyang_seen', { p_slot: slot, p_behavior: behavior });
      return { state: cleanState(d.state), added: d.added === true };
    },
  };
}

// ---------- 테스트 모드 (이 기기에만) ----------

const KEY = 'siaNyang:local';
interface LocalSave {
  state: NyangState;
  /** 개발 시계: real0(실제 초)일 때 virt0(게임 초), 그 뒤로 factor 배 빠르게 */
  clock: { real0: number; virt0: number; factor: number };
}
/** '6h' · '90m' · '30s' · '2d' · '3600' → 초 */
export function parseSkip(v: string | null): number {
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec((v ?? '').trim());
  if (!m) return 0;
  return Math.round(Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's'] ?? 1));
}

function createLocalApi(): NyangApi {
  const real = () => Date.now() / 1000;
  let save: LocalSave | null = null;
  try {
    if (params.get('reset') !== '1') save = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LocalSave | null;
  } catch {
    save = null;
  }
  const factor = Math.max(1, Math.min(3600, Number(params.get('time')) || 1));
  if (!save || !save.state || !save.clock) save = { state: newState(), clock: { real0: real(), virt0: real(), factor } };
  else {
    // 지난번 배속으로 지금까지 흐른 게임 시간을 이어 받고, 이번 배속으로 다시 잰다
    const c = save.clock;
    save.clock = { real0: real(), virt0: c.virt0 + (real() - c.real0) * c.factor, factor };
    save.state = cleanState(save.state);
  }
  const skip = parseSkip(params.get('skip'));
  if (skip) save.clock.virt0 += skip;
  const s = save;
  const now = () => s.clock.virt0 + (real() - s.clock.real0) * s.clock.factor;
  const love = Number(params.get('love'));
  if (love >= 1 && love <= 10) s.state.cats = s.state.cats.map((c) => (c.slot === 1 ? { ...c, love: Math.max(c.love, loveAt(love)) } : c));
  const items = s.state.profile.items;
  if (params.get('toys') === '1') for (const t of ['laser', 'ball', 'box']) items['toy:' + t] = Math.max(1, items['toy:' + t] ?? 0);
  const ch = Math.min(99, Number(params.get('churu')) || 0);
  if (ch > 0) for (const f of CHURU_IDS) items['churu:' + f] = (items['churu:' + f] ?? 0) + ch;
  if (params.get('gift') === '1' && s.state.cats[0]) {
    const kinds: Present[] = [
      { kind: 'coin', id: 'coin', n: 12 }, { kind: 'seed', id: 'catgrass', n: 2 }, { kind: 'toy', id: 'ball', n: 1 }, { kind: 'furniture', id: PRESENT_FURNITURE[0], n: 1 },
    ];
    s.state.cats[0] = { ...s.state.cats[0], present: kinds[Math.floor(Math.random() * kinds.length)] };
  }
  // 한 번만 쓰는 설정은 주소에서 지운다 (새로 고침해도 다시 걸리지 않게)
  const ONCE = ['skip', 'love', 'reset', 'toys', 'churu', 'gift'];
  if (loc && ONCE.some((k) => params.has(k))) {
    const u = new URL(loc.href);
    for (const k of ONCE) u.searchParams.delete(k);
    history.replaceState(null, '', u.href);
  }
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* 저장이 막힌 기기 */
    }
  };
  persist();
  const t = () => Math.floor(now());
  /** 규칙을 돌리고 저장 (서버처럼 조금 기다렸다가 답한다) */
  async function step<R extends { state: NyangState }>(fn: (st: NyangState, at: number) => R): Promise<R> {
    await new Promise((r) => setTimeout(r, 60));
    try {
      const r = fn(s.state, t());
      payLocal(r.state.profile);
      s.state = r.state;
      persist();
      return { ...r, state: s.state };
    } catch (e) {
      if (e instanceof RuleError) throw new ApiError(e.message);
      throw e;
    }
  }
  return {
    kind: 'local',
    now,
    state: (entry = false) => step((st, at) => visit(st, entry, at)),
    adopt: (color, personality, name) => step((st, at) => adopt(st, color, personality, name, at)),
    feed: (slot, food = 'basic') => step((st, at) => feed(st, slot, food, at)),
    water: (slot) => step((st, at) => water(st, slot, at)),
    clean: (slot) => step((st, at) => clean(st, slot, at)),
    pet: (slot, spot) => step((st, at) => pet(st, slot, spot, at)),
    cure: (slot, kind = 'blanket') => step((st, at) => cure(st, slot, kind, at)),
    playStart: (slot, toy) => step((st, at) => playStart(st, slot, toy, at)),
    play: (slot, catches) => step((st, at) => play(st, slot, catches, at)),
    brush: (slot) => step((st, at) => brush(st, slot, at)),
    churu: (slot, flavor) => step((st, at) => churu(st, slot, flavor, at)),
    gift: (slot) => step((st, at) => gift(st, slot, at)),
    seen: (slot, behavior) => step((st, at) => seen(st, slot, behavior, at)),
  };
}

export async function getApi(): Promise<NyangApi> {
  return LOCAL_MODE ? createLocalApi() : createSupabaseApi();
}

/** 거절 까닭 → 화면에 보일 글 */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return '서버와 통신하지 못했어요. 잠시 뒤 다시 해 주세요';
  return (
    {
      'bowl full': '밥그릇이 아직 가득해요',
      'water fresh': '물이 아직 깨끗해요',
      'no poop': '화장실이 깨끗해요',
      'too soon': '조금 있다가 다시 쓰다듬어 주세요',
      'need care': '밥 · 물 · 화장실 · 기분을 모두 채워 주어야 해요',
      'not sick': '아프지 않아요',
      'already curing': '담요를 덮고 쉬는 중이에요',
      'no room': '지금은 더 입양할 수 없어요',
      'bad name': '이름은 한글 · 영문 · 숫자로 1~8글자예요',
      'need login': '로그인이 필요해요',
      'no toy': '아직 없는 장난감이에요',
      'no play': '놀이 시간이 지났어요',
      'brushed today': '오늘은 벌써 빗질했어요',
      'churu full': '오늘은 츄르를 그만 먹을래요',
      'no churu': '이 맛 츄르가 없어요',
      'no present': '선물이 없어요',
      'no medicine': '약 간식이 없어요',
    } as Record<string, string>
  )[e.message] ?? '할 수 없어요';
}
