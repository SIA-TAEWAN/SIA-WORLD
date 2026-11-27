/**
 * 시아집사의 규칙 (PRD 3 · 4 · 7장). 서버(supabase/migrations/123_nyang.sql)의 RPC 와 같은 계산을 한다:
 * 로컬 모드(?local=1)는 이 함수들로 기기 안에서 돌리고, 서버 모드에서는 화면이 서버가 준 상태를 서버 시각으로 풀어 보여 주는 데 쓴다.
 * 모든 함수는 순수하다 — 시각 t(초)는 인자로 받는다. 정수 계산만 쓴다 (SQL 과 똑같이 나와야 한다).
 *
 * 상태 4가지는 '마지막으로 돌본 때'의 기록으로부터 언제든 바로 계산한다 (쌓아 두지 않으니 자주 계산해도 어긋나지 않는다):
 *   배부름 = fedAmount 에서 fedAt 부터 성격의 full_sec 동안 0 까지 일정하게 준다
 *   목마름 = waterAt 에 가득, water_sec 동안 0 까지 (waterAt 에서 12시간 지나면 물이 상함)
 *   청결   = 똥 개수 (poopBase 개였던 때가 poopAt, 그 뒤 poop_sec 마다 하나, 최대 4개) → (4 - 개수) × 2500
 *   기분   = moodVal 에서 moodAt 부터 mood_sec 동안 0 까지
 * 친밀도와 감기는 settle 이 calcAt 부터 t 까지를 한 번에 반영한다 (자주 불러도 한 번 부른 것과 결과가 같다).
 */
import {
  CAT_NEED, CONST, FOOD, MAX_CATS, NAME_RE, PERSONALITY, isColorId, isFoodId, isPersonalityId, kstDay, loveLevel, mix,
  type ColorId, type FoodId, type PersonalityId, type Spot, SPOTS,
} from '../data/balance';

/** 서버가 거절한 까닭과 같은 글자 (SQL 의 raise exception) */
export class RuleError extends Error {}

export interface Cat {
  /** 1 ~ 4 (입양 순서) */
  slot: number;
  name: string;
  color: ColorId;
  /** 털 색 위에 겹치는 무늬 (나중 단계. 지금은 늘 null) */
  pattern: string | null;
  personality: PersonalityId;
  adoptedAt: number;
  /** 친밀도 · 감기를 마지막으로 계산한 때 */
  calcAt: number;
  fedAt: number;
  fedAmount: number;
  waterAt: number;
  poopBase: number;
  poopAt: number;
  moodVal: number;
  moodAt: number;
  /** 친밀도 점수 (내려가지 않는다) */
  love: number;
  /** 감기 기운에 걸린 때 (안 아프면 null) · 낫는 때 (담요를 덮어 줬으면) */
  sickAt: number | null;
  cureAt: number | null;
  /** 쓰다듬기: 그날(한국 날짜) · 그날 쓰다듬기로 오른 친밀도 · 마지막으로 쓰다듬은 때 */
  petDay: number;
  petLove: number;
  petAt: number;
}

export interface Profile {
  /** 엽전 (시아집사 전용) */
  coins: number;
  /** 똥을 퍼낸 수 (모래 속 선물을 정하는 번호) */
  seq: number;
  /** 마지막으로 들어온 때 (0 = 처음) */
  visitAt: number;
  /** 하루 첫 돌보기 보너스를 받은 날 · 돌본 날 수 (랭킹) */
  bonusDay: number;
  careDays: number;
  /** 시아코인: 센 날 · 그날 받기로 한 수 (최대 5) · 아직 못 받은 수 · 받은 수 (기록 번호) */
  siaDay: number;
  siaToday: number;
  siaDue: number;
  siaPaid: number;
  /** 시아코인 잔액 (서버: wallets.sia_coins, 로컬 모드: 이 기기에서만 센다) */
  sia: number;
}

export interface NyangState {
  profile: Profile;
  cats: Cat[];
}

/** 돌보기 결과에 붙는 것: 하루 첫 돌보기 엽전 · 시아코인을 받게 됐는지 */
export interface CareResult {
  bonus: number;
  sia: boolean;
}

const { max: MAX, half: HALF } = CONST;
const ceilDiv = (a: number, b: number) => Math.floor((a + b - 1) / b);

export function newProfile(): Profile {
  return { coins: 0, seq: 0, visitAt: 0, bonusDay: -1, careDays: 0, siaDay: -1, siaToday: 0, siaDue: 0, siaPaid: 0, sia: 0 };
}
export function newState(): NyangState {
  return { profile: newProfile(), cats: [] };
}
export const cloneState = (s: NyangState): NyangState => ({ profile: { ...s.profile }, cats: s.cats.map((c) => ({ ...c })) });

const pers = (c: Cat) => PERSONALITY[c.personality];

// ---------- 상태 4가지 ----------

/** amount 에서 at 부터 dur 동안 0 까지 일정하게 줄어드는 값 */
export const lin = (amount: number, at: number, dur: number, t: number) => Math.max(0, amount - Math.floor((Math.max(0, t - at) * MAX) / dur));
/** lin 이 절반 이상인 마지막 때의 다음 초 (t < 이 값이면 절반 이상) */
export const linHalfAt = (amount: number, at: number, dur: number) => (amount >= HALF ? at + ceilDiv((amount - HALF + 1) * dur, MAX) : at);
/** lin 이 0 이 되는 때 */
export const linZeroAt = (amount: number, at: number, dur: number) => at + ceilDiv(amount * dur, MAX);

export const fullOf = (c: Cat, t: number) => lin(c.fedAmount, c.fedAt, pers(c).full_sec, t);
export const waterOf = (c: Cat, t: number) => lin(MAX, c.waterAt, pers(c).water_sec, t);
export const spoiledOf = (c: Cat, t: number) => t - c.waterAt >= CONST.spoil_sec;
export const poopsOf = (c: Cat, t: number) => Math.min(CONST.poop_max, c.poopBase + Math.floor(Math.max(0, t - c.poopAt) / pers(c).poop_sec));
export const cleanOf = (c: Cat, t: number) => ((CONST.poop_max - poopsOf(c, t)) * MAX) / CONST.poop_max;
export const moodOf = (c: Cat, t: number) => lin(c.moodVal, c.moodAt, pers(c).mood_sec, t);

/** 화면용: 지금의 상태 4가지 (0 ~ 10000) · 똥 개수 · 물 상함 · 감기 */
export interface Levels {
  full: number;
  water: number;
  clean: number;
  mood: number;
  poops: number;
  spoiled: boolean;
  sick: boolean;
  /** 담요를 덮어 줘서 낫는 중 */
  curing: boolean;
}
export function levelsOf(c: Cat, t: number): Levels {
  const s = settle(c, t);
  return {
    full: fullOf(s, t), water: waterOf(s, t), clean: cleanOf(s, t), mood: moodOf(s, t), poops: poopsOf(s, t), spoiled: spoiledOf(s, t),
    sick: s.sickAt != null, curing: s.sickAt != null && s.cureAt != null,
  };
}

/** 네 상태가 모두 절반 이상인 동안의 끝 (t < 이 값이면 네 상태 모두 절반 이상) */
export function goodUntil(c: Cat, t0: number): number {
  const p = pers(c);
  const clean = c.poopBase <= 2 ? c.poopAt + (3 - c.poopBase) * p.poop_sec : c.poopAt;
  return Math.max(t0, Math.min(linHalfAt(c.fedAmount, c.fedAt, p.full_sec), linHalfAt(MAX, c.waterAt, p.water_sec), clean, linHalfAt(c.moodVal, c.moodAt, p.mood_sec)));
}

/** 바닥(0)인 상태가 있으면 그중 가장 먼저 바닥이 된 때, 없으면 null */
export function floorSince(c: Cat, t: number): number | null {
  const p = pers(c);
  const zeros = [
    linZeroAt(c.fedAmount, c.fedAt, p.full_sec),
    linZeroAt(MAX, c.waterAt, p.water_sec),
    c.poopAt + Math.max(0, CONST.poop_max - c.poopBase) * p.poop_sec,
    linZeroAt(c.moodVal, c.moodAt, p.mood_sec),
  ].filter((z) => z <= t);
  return zeros.length ? Math.min(...zeros) : null;
}

/**
 * calcAt 부터 t 까지를 반영한다: 친밀도 (네 상태가 모두 절반 이상이고 아프지 않은 시간 1초 = 1점) · 감기 걸림 · 나음.
 * 돌보기 기록은 바꾸지 않는다. 같은 t 로 여러 번 불러도 같고, 중간에 몇 번 부르든 결과가 같다.
 */
export function settle(c0: Cat, t: number): Cat {
  const c = { ...c0 };
  if (t <= c.calcAt) return c;
  let from = c.calcAt;
  let good = true;
  if (c.sickAt != null) {
    if (c.cureAt != null && c.cureAt <= t) {
      from = Math.max(from, c.cureAt);
      c.sickAt = null;
      c.cureAt = null;
    } else good = false;
  }
  if (good) {
    const to = Math.min(t, goodUntil(c, from));
    if (to > from) c.love += to - from;
    const fl = floorSince(c, t);
    if (fl != null && fl + CONST.sick_sec <= t) c.sickAt = Math.max(fl + CONST.sick_sec, from);
  }
  c.calcAt = t;
  return c;
}

// ---------- 친밀도 · 쓰다듬기 ----------

export const levelOf = (c: Cat) => loveLevel(c.love).level;

/** 쓰다듬는 곳이 좋아하는 곳 · 보통 · 싫어하는 곳인지 (친밀도 단계가 오르면 좋아하는 곳이 늘어난다) */
export function spotKind(c: Cat, spot: Spot): 'like' | 'ok' | 'hate' {
  const p = pers(c);
  const lv = levelOf(c);
  if (p.dislikes.includes(spot) && lv < (spot === 'belly' ? CONST.belly_ok_level : CONST.hate_ok_level)) return 'hate';
  if (p.likes.includes(spot)) return 'like';
  if (lv >= CONST.like_all_level && !p.dislikes.includes(spot)) return 'like';
  return 'ok';
}

// ---------- 돌보기 ----------

function catOf(s: NyangState, slot: number): Cat {
  const c = s.cats.find((x) => x.slot === slot);
  if (!c) throw new RuleError('no cat');
  return c;
}
function putCat(s: NyangState, c: Cat) {
  s.cats = s.cats.map((x) => (x.slot === c.slot ? c : x));
}

/** 돌보기 한 번의 공통 처리: 하루 첫 돌보기 엽전 · 필요한 돌보기였으면 시아코인 (하루 최대 5) */
export function care(p: Profile, needed: boolean, t: number): CareResult {
  const day = kstDay(t);
  let bonus = 0;
  if (p.bonusDay !== day) {
    p.bonusDay = day;
    p.careDays += 1;
    p.coins += CONST.day_bonus;
    bonus = CONST.day_bonus;
  }
  let sia = false;
  if (needed) {
    if (p.siaDay !== day) {
      p.siaDay = day;
      p.siaToday = 0;
    }
    if (p.siaToday < CONST.sia_day_max) {
      p.siaToday += 1;
      p.siaDue += 1;
      sia = true;
    }
  }
  return { bonus, sia };
}

/**
 * 못 받은 시아코인 주기. 서버는 _grant_sia_coin 이 15초 간격 · 하루 100개를 지키느라 바로 못 줄 때가 있어
 * 다음 요청 때 다시 준다 (siaDue). 로컬 모드는 바로 준다.
 */
export function payLocal(p: Profile) {
  p.sia += p.siaDue;
  p.siaPaid += p.siaDue;
  p.siaDue = 0;
}

/** 첫 고양이의 친밀도 단계로 정해지는 입양할 수 있는 고양이 수 */
export function catRoom(s: NyangState): number {
  const first = s.cats.find((c) => c.slot === 1);
  const lv = first ? levelOf(first) : 0;
  return 1 + CAT_NEED.filter((n) => lv >= n).length;
}

export const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ');

export function adopt(s0: NyangState, color: string, personality: string, name: string, t: number): { state: NyangState; slot: number } {
  const s = cloneState(s0);
  s.cats = s.cats.map((c) => settle(c, t));
  if (!isColorId(color)) throw new RuleError('bad color');
  if (!isPersonalityId(personality)) throw new RuleError('bad personality');
  const nm = cleanName(name);
  if ([...nm].length < 1 || [...nm].length > CONST.name_max || !NAME_RE.test(nm)) throw new RuleError('bad name');
  if (s.cats.length >= Math.min(MAX_CATS, catRoom(s))) throw new RuleError('no room');
  const slot = s.cats.length + 1;
  s.cats.push({
    slot, name: nm, color, pattern: null, personality, adoptedAt: t, calcAt: t,
    fedAt: t, fedAmount: MAX, waterAt: t, poopBase: 0, poopAt: t, moodVal: CONST.start_mood, moodAt: t,
    love: 0, sickAt: null, cureAt: null, petDay: -1, petLove: 0, petAt: 0,
  });
  return { state: s, slot };
}

/** 들어올 때 · 다시 읽을 때: 고양이마다 지금까지를 반영. entry 면 마지막 방문 시각을 바꾸고 떠나 있던 시간(초)을 준다 */
export function visit(s0: NyangState, entry: boolean, t: number): { state: NyangState; away: number } {
  const s = cloneState(s0);
  s.cats = s.cats.map((c) => settle(c, t));
  let away = 0;
  if (entry) {
    away = s.profile.visitAt > 0 ? Math.max(0, t - s.profile.visitAt) : 0;
    s.profile.visitAt = t;
  }
  return { state: s, away };
}

/** 밥 주기: 밥그릇을 채운다 (사료마다 양이 다르다) */
export function feed(s0: NyangState, slot: number, food: string, t: number): { state: NyangState } & CareResult {
  const s = cloneState(s0);
  if (!isFoodId(food)) throw new RuleError('bad food');
  const c = settle(catOf(s, slot), t);
  const before = fullOf(c, t);
  if (before >= CONST.feed_full) throw new RuleError('bowl full');
  const after = Math.min(MAX, before + FOOD[food as FoodId].add);
  c.fedAmount = after;
  c.fedAt = t;
  putCat(s, c);
  return { state: s, ...care(s.profile, before < HALF && after >= HALF, t) };
}

/** 물 갈기: 헌 물을 버리고 새 물 (가득) */
export function water(s0: NyangState, slot: number, t: number): { state: NyangState } & CareResult {
  const s = cloneState(s0);
  const c = settle(catOf(s, slot), t);
  const before = waterOf(c, t);
  const spoiled = spoiledOf(c, t);
  if (before >= CONST.water_fresh && !spoiled) throw new RuleError('water fresh');
  c.waterAt = t;
  putCat(s, c);
  return { state: s, ...care(s.profile, before < HALF || spoiled, t) };
}

/** 똥 하나 퍼내기 → 모래 속 선물(엽전, 없으면 0) */
export function clean(s0: NyangState, slot: number, t: number): { state: NyangState; gift: number; poops: number } & CareResult {
  const s = cloneState(s0);
  const c = settle(catOf(s, slot), t);
  const iv = pers(c).poop_sec;
  // 지금까지 생긴 똥을 poopBase 로 옮겨 적는다 (다음 똥까지 남은 시간은 그대로)
  const n = Math.floor(Math.max(0, t - c.poopAt) / iv);
  if (c.poopBase + n >= CONST.poop_max) {
    c.poopAt = c.poopAt + Math.max(0, CONST.poop_max - c.poopBase) * iv;
    c.poopBase = CONST.poop_max;
  } else {
    c.poopBase += n;
    c.poopAt += n * iv;
  }
  const before = c.poopBase;
  if (before <= 0) throw new RuleError('no poop');
  // 가득 찬 동안은 새 똥이 생기지 않았으니, 가득 찬 상태에서 퍼내면 다음 똥은 지금부터 센다
  if (before >= CONST.poop_max) c.poopAt = t;
  c.poopBase = before - 1;
  putCat(s, c);
  const p = s.profile;
  p.seq += 1;
  let gift = 0;
  if (mix(p.seq, 1) % 100 < CONST.gift_pct) {
    gift = CONST.gift_min + (mix(p.seq, 2) % CONST.gift_span);
    p.coins += gift;
  }
  // 청결이 절반 아래(똥 3개 이상)에서 절반(2개)으로 돌아오는 한 번이 '필요한 돌보기'
  return { state: s, gift, poops: c.poopBase, ...care(p, before === CONST.poop_max - 1, t) };
}

/** 쓰다듬기: 좋아하는 곳이면 기분 · 친밀도가 더 오른다. 싫어하는 곳이면 냥펀치 (아무것도 오르지 않는다) */
export function pet(s0: NyangState, slot: number, spot: string, t: number): { state: NyangState; kind: 'like' | 'ok' | 'hate'; love: number } & CareResult {
  const s = cloneState(s0);
  if (!(SPOTS as readonly string[]).includes(spot)) throw new RuleError('bad spot');
  const c = settle(catOf(s, slot), t);
  if (t - c.petAt < CONST.pet_gap_sec) throw new RuleError('too soon');
  const kind = spotKind(c, spot as Spot);
  c.petAt = t;
  if (kind === 'hate') {
    putCat(s, c);
    return { state: s, kind, love: 0, bonus: 0, sia: false };
  }
  const before = moodOf(c, t);
  const after = Math.min(MAX, before + (kind === 'like' ? CONST.pet_mood_like : CONST.pet_mood));
  c.moodVal = after;
  c.moodAt = t;
  const day = kstDay(t);
  if (c.petDay !== day) {
    c.petDay = day;
    c.petLove = 0;
  }
  // 아플 때는 친밀도가 쌓이지 않는다
  const love = c.sickAt != null ? 0 : Math.max(0, Math.min(kind === 'like' ? CONST.pet_love_like : CONST.pet_love, CONST.pet_love_day - c.petLove));
  c.love += love;
  c.petLove += love;
  putCat(s, c);
  return { state: s, kind, love, ...care(s.profile, before < HALF && after >= HALF, t) };
}

/** 감기 낫게 하기 (담요): 네 상태를 모두 채운 뒤에만. cure_sec 뒤에 낫는다 */
export function cure(s0: NyangState, slot: number, kind: string, t: number): { state: NyangState } {
  const s = cloneState(s0);
  if (kind !== 'blanket') throw new RuleError('bad cure');
  const c = settle(catOf(s, slot), t);
  if (c.sickAt == null) throw new RuleError('not sick');
  if (c.cureAt != null) throw new RuleError('already curing');
  if ([fullOf(c, t), waterOf(c, t), cleanOf(c, t), moodOf(c, t)].some((v) => v < CONST.cure_need) || spoiledOf(c, t)) throw new RuleError('need care');
  c.cureAt = t + CONST.cure_sec;
  putCat(s, c);
  return { state: s };
}

/** 돌봐야 할 것 (느낌표): 상태가 절반 아래이거나 물이 상했다 */
export function needs(c: Cat, t: number) {
  const l = levelsOf(c, t);
  return { food: l.full < HALF, water: l.water < HALF || l.spoiled, litter: l.clean < HALF, mood: l.mood < HALF, sick: l.sick && !l.curing };
}
