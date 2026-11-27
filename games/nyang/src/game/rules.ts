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
  BEHAVIOR, CAT_NEED, CONST, EXCHANGES, FOOD, MAX_CATS, NAME_RE, PERSONALITY, PLANT, POT_MAX, POT_PRICES, POT_START, PRESENT_FURNITURE, PRESENT_SEEDS,
  PRESENT_TOYS, SELL, SHOP_ITEM, TOYS, TREAT, BASE_FURNITURE, BASE_STYLE, BLOCKED, DEFAULT_ITEMS, FURNITURE_OF, POSE_IDS, STYLE_OF, VASE_FLOWERS,
  isChuruId, isColorId, isFoodId, isPersonalityId, isPlantId, isToyId, isTreatId, itemKey, kstDay, loveLevel, mix,
  type ColorId, type FoodId, type PersonalityId, type PlantId, type Spot, type ToyId, SPOTS,
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
  /** 마지막으로 감기가 나은 때 (0 = 없음) — 바닥인 채 sick_sec 는 이때부터 다시 센다 */
  wellAt: number;
  /** 쓰다듬기: 그날(한국 날짜) · 그날 쓰다듬기로 오른 친밀도 · 마지막으로 쓰다듬은 때 */
  petDay: number;
  petLove: number;
  petAt: number;
  /** 놀아 주기: 시작한 때(0 = 놀고 있지 않음) · 장난감 · 그날 · 그날 놀이로 오른 친밀도 */
  playAt: number;
  playToy: string | null;
  playDay: number;
  playLove: number;
  /** 빗질한 날 (하루 한 번) */
  brushDay: number;
  /** 츄르: 그날 · 그날 먹은 개수 (하루 2개) */
  churuDay: number;
  churuN: number;
  /** 선물: 마지막으로 굴린 때 · 바닥에 놓인 선물 (없으면 null) */
  presentAt: number;
  present: Present | null;
  /** 처음 본 행동 (행동 도감, 본 순서) */
  seen: string[];
  /** 캣그라스 · 캣닢: 그날 · 그날 먹은 수 · 캣닢을 먹은 때 (0 = 없음, 화면은 nip_sec 동안 우다다) */
  treatDay: number;
  treatN: number;
  nipAt: number;
}

/** 베란다 화분 하나 (빈 화분은 목록에 없다) */
export interface Pot {
  /** 1 ~ 12 */
  slot: number;
  plant: PlantId;
  plantedAt: number;
  /** 마지막으로 물을 준 때까지 자란 초 */
  grown: number;
  /** 마지막으로 물을 준 때 (아직 안 줬으면 null) */
  waterAt: number | null;
}

/** 고양이가 물어다 놓은 선물 */
export interface Present {
  kind: 'coin' | 'seed' | 'toy' | 'furniture';
  id: string;
  n: number;
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
  /** 보관함 { 'toy:laser' · 'churu:tuna' · 'seed:daisy' · 'fur' · 'medicine' … : 개수 } (0 개는 지운다) */
  items: Record<string, number>;
  /** 가진 가구 id (꾸미기는 5단계) */
  furniture: string[];
  /** 선물을 굴린 수 (선물을 정하는 번호) */
  pseq: number;
  /** 화분 칸 수 (4 ~ 12) · 시아코인으로 산 수 (결제 기록 번호) */
  pots: number;
  buySeq: number;
  /** 5단계: 방 배치 · 벽지 · 바닥 · 창문 · 꽃병 (한 번도 꾸미지 않았으면 {}) */
  layout: RoomLayout;
  /** 찍은 사진 수 (사진 번호) */
  photoSeq: number;
}

/** 방에 놓은 가구 하나: 격자 칸 (x, y 는 왼쪽 위 칸) */
export interface Placed {
  id: string;
  x: number;
  y: number;
}
export interface RoomLayout {
  items?: Placed[];
  wall?: string;
  floor?: string;
  window?: string;
  /** 꽃병에 꽂은 꽃 (sunflower · rose) */
  vase?: string;
}

/** 앨범의 사진 한 장 (그림은 저장하지 않는다 — 화면이 이 정보로 다시 그린다) */
export interface Photo {
  id: number;
  slot: number;
  name: string;
  color: string;
  behavior: string;
  pose: string;
  /** 1 오른쪽 · -1 왼쪽 */
  face: number;
  /** 같이 찍힌 고양이 (고양이끼리 어울릴 때) */
  mate: { slot: number; color: string; pose: string } | null;
  at: number;
}

export interface NyangState {
  profile: Profile;
  cats: Cat[];
  pots: Pot[];
  /** 앨범 (사진 번호 순) */
  album: Photo[];
  /** 이 상태를 만든 서버 시각 (화면용 — 늦게 온 옛 상태를 버린다. 규칙은 쓰지 않는다) */
  now?: number;
}

/** 돌보기 결과에 붙는 것: 하루 첫 돌보기 엽전 · 시아코인을 받게 됐는지 */
export interface CareResult {
  bonus: number;
  sia: boolean;
}

const { max: MAX, half: HALF } = CONST;
const ceilDiv = (a: number, b: number) => Math.floor((a + b - 1) / b);

export function newProfile(): Profile {
  return {
    coins: 0, seq: 0, visitAt: 0, bonusDay: -1, careDays: 0, siaDay: -1, siaToday: 0, siaDue: 0, siaPaid: 0, sia: 0, items: {}, furniture: [], pseq: 0,
    pots: POT_START, buySeq: 0, layout: {}, photoSeq: 0,
  };
}
export function newState(): NyangState {
  return { profile: newProfile(), cats: [], pots: [], album: [] };
}
const cloneLayout = (l: RoomLayout): RoomLayout => ({ ...l, ...(l.items ? { items: l.items.map((i) => ({ ...i })) } : {}) });
export const cloneState = (s: NyangState): NyangState => ({
  profile: { ...s.profile, items: { ...s.profile.items }, furniture: [...s.profile.furniture], layout: cloneLayout(s.profile.layout) },
  cats: s.cats.map(cloneCat),
  pots: s.pots.map((p) => ({ ...p })),
  album: s.album.map((a) => ({ ...a, mate: a.mate ? { ...a.mate } : null })),
});
const cloneCat = (c: Cat): Cat => ({ ...c, seen: [...c.seen], present: c.present ? { ...c.present } : null });

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
  const c = cloneCat(c0);
  if (t <= c.calcAt) return c;
  let from = c.calcAt;
  let good = true;
  if (c.sickAt != null) {
    if (c.cureAt != null && c.cureAt <= t) {
      from = Math.max(from, c.cureAt);
      c.wellAt = c.cureAt;
      c.sickAt = null;
      c.cureAt = null;
    } else good = false;
  }
  if (good) {
    const to = Math.min(t, goodUntil(c, from));
    if (to > from) c.love += to - from;
    // 바닥인 채 sick_sec: 감기가 나은 뒤에는 나은 때부터 다시 센다 (약 간식 · 츄르는 상태를 채우지 않고도 낫게 한다)
    const f0 = floorSince(c, t);
    const fl = f0 == null ? null : Math.max(f0, c.wellAt);
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
  if (p.bonusDay < day) {
    p.bonusDay = day;
    p.careDays += 1;
    p.coins += CONST.day_bonus;
    bonus = CONST.day_bonus;
  }
  let sia = false;
  if (needed) {
    if (p.siaDay < day) {
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
    love: 0, sickAt: null, cureAt: null, wellAt: 0, petDay: -1, petLove: 0, petAt: 0,
    playAt: 0, playToy: null, playDay: -1, playLove: 0, brushDay: -1, churuDay: -1, churuN: 0, presentAt: t, present: null, seen: [],
    treatDay: -1, treatN: 0, nipAt: 0,
  });
  // 첫 고양이를 들이면 그 고양이가 좋아하는 맛 츄르를 조금 (상점은 4단계)
  if (slot === 1) addItem(s.profile, itemKey.churu(PERSONALITY[personality as PersonalityId].churu), CONST.start_churu);
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
    // 고양이마다 선물을 물어 왔는지 (지난번에 굴리고 present_gap_sec 이 지났을 때 한 번)
    for (const c of s.cats) rollPresent(c, s.profile, t);
  }
  return { state: s, away };
}

/** 밥 주기: 밥그릇을 채운다. 기본 사료는 공짜, 상점 사료는 보관함의 'food:<id>' 하나를 쓰고 기분도 오른다 */
export function feed(s0: NyangState, slot: number, food: string, t: number): { state: NyangState } & CareResult {
  const s = cloneState(s0);
  if (!isFoodId(food)) throw new RuleError('bad food');
  const f = FOOD[food as FoodId];
  const c = settle(catOf(s, slot), t);
  const before = fullOf(c, t);
  if (before >= CONST.feed_full) throw new RuleError('bowl full');
  if (f.price > 0) {
    if (itemCount(s.profile, itemKey.food(f.id)) < 1) throw new RuleError('no food');
    addItem(s.profile, itemKey.food(f.id), -1);
  }
  const after = Math.min(MAX, before + f.add);
  c.fedAmount = after;
  c.fedAt = t;
  if (f.mood > 0) raiseMood(c, f.mood, t);
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
  if (c.petDay < day) {
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

/**
 * 감기 낫게 하기: 담요(blanket)는 네 상태를 모두 채운 뒤에만, 약 간식(medicine)은 보관함에서 하나 쓴다. cure_sec 뒤에 낫는다.
 * (츄르를 줘도 낫기 시작한다 — churu)
 */
export function cure(s0: NyangState, slot: number, kind: string, t: number): { state: NyangState } {
  const s = cloneState(s0);
  if (kind !== 'blanket' && kind !== 'medicine') throw new RuleError('bad cure');
  const c = settle(catOf(s, slot), t);
  if (c.sickAt == null) throw new RuleError('not sick');
  if (c.cureAt != null) throw new RuleError('already curing');
  if (kind === 'medicine') {
    if (itemCount(s.profile, itemKey.medicine) < 1) throw new RuleError('no medicine');
    addItem(s.profile, itemKey.medicine, -1);
  } else if ([fullOf(c, t), waterOf(c, t), cleanOf(c, t), moodOf(c, t)].some((v) => v < CONST.cure_need) || spoiledOf(c, t)) throw new RuleError('need care');
  c.cureAt = t + CONST.cure_sec;
  putCat(s, c);
  return { state: s };
}

/** 돌봐야 할 것 (느낌표): 상태가 절반 아래이거나 물이 상했다 */
export function needs(c: Cat, t: number) {
  const l = levelsOf(c, t);
  return { food: l.full < HALF, water: l.water < HALF || l.spoiled, litter: l.clean < HALF, mood: l.mood < HALF, sick: l.sick && !l.curing };
}

// ---------- 3단계: 보관함 · 놀아 주기 · 빗질 · 츄르 · 선물 · 행동 도감 ----------

export const itemCount = (p: Profile, key: string) => p.items[key] ?? 0;
/** 보관함에 n 개 더하기 (0 개 이하가 되면 열쇠를 지운다 — SQL 도 같다) */
export function addItem(p: Profile, key: string, n: number) {
  const v = itemCount(p, key) + n;
  if (v <= 0) delete p.items[key];
  else p.items[key] = v;
}
/** 장난감을 가지고 있는지 (낚싯대는 처음부터) */
export const hasToy = (p: Profile, toy: ToyId) => TOYS[toy].free || itemCount(p, itemKey.toy(toy)) > 0;

/** 기분을 올리고 '필요한 돌보기'였는지 (절반 아래 → 절반 이상) */
function raiseMood(c: Cat, add: number, t: number): boolean {
  const before = moodOf(c, t);
  const after = Math.min(MAX, before + add);
  c.moodVal = after;
  c.moodAt = t;
  return before < HALF && after >= HALF;
}

/** 놀아 주기 시작: 장난감을 고른다 (가지고 있어야 한다) */
export function playStart(s0: NyangState, slot: number, toy: string, t: number): { state: NyangState } {
  const s = cloneState(s0);
  if (!isToyId(toy)) throw new RuleError('bad toy');
  const c = settle(catOf(s, slot), t);
  if (!hasToy(s.profile, toy)) throw new RuleError('no toy');
  c.playAt = t;
  c.playToy = toy;
  putCat(s, c);
  return { state: s };
}

/**
 * 놀아 주기 끝: 잡은 수만큼 기분 · 친밀도 (좋아하는 장난감이면 더). 서버가 믿을 수 있게 잡은 수는
 * 한 번에 play_catch_max, 시작부터 play_catch_sec 초마다 하나까지만 센다. 친밀도는 하루 play_love_day 까지.
 * 아플 때는 반응이 시큰둥하다 (기분 절반, 친밀도 없음).
 */
export function play(s0: NyangState, slot: number, catches: number, t: number): { state: NyangState; catches: number; love: number; liked: boolean } & CareResult {
  const s = cloneState(s0);
  const c = settle(catOf(s, slot), t);
  if (!c.playAt || !c.playToy || t - c.playAt > CONST.play_max_sec) throw new RuleError('no play');
  const n = Math.max(0, Math.min(Number.isFinite(catches) ? Math.floor(catches) : 0, CONST.play_catch_max, Math.floor((t - c.playAt) / CONST.play_catch_sec)));
  const liked = pers(c).toy === c.playToy;
  const sick = c.sickAt != null;
  let mood = n * (liked ? CONST.play_mood_like : CONST.play_mood);
  if (sick) mood = Math.floor(mood / 2);
  const needed = raiseMood(c, mood, t);
  const day = kstDay(t);
  if (c.playDay < day) {
    c.playDay = day;
    c.playLove = 0;
  }
  const love = sick ? 0 : Math.max(0, Math.min(n * (liked ? CONST.play_love_like : CONST.play_love), CONST.play_love_day - c.playLove));
  c.love += love;
  c.playLove += love;
  c.playAt = 0;
  c.playToy = null;
  putCat(s, c);
  return { state: s, catches: n, love, liked, ...care(s.profile, needed, t) };
}

/** 빗질 (고양이마다 하루 한 번): 기분 · 친밀도 + 털 뭉치 */
export function brush(s0: NyangState, slot: number, t: number): { state: NyangState; fur: number; love: number } & CareResult {
  const s = cloneState(s0);
  const c = settle(catOf(s, slot), t);
  const day = kstDay(t);
  if (c.brushDay >= day) throw new RuleError('brushed today');
  c.brushDay = day;
  const needed = raiseMood(c, CONST.brush_mood, t);
  const love = c.sickAt != null ? 0 : CONST.brush_love;
  c.love += love;
  const fur = CONST.fur_min + (mix(day * 4 + c.slot, 5) % CONST.fur_span);
  addItem(s.profile, itemKey.fur, fur);
  putCat(s, c);
  return { state: s, fur, love, ...care(s.profile, needed, t) };
}

/**
 * 츄르 (고양이마다 하루 churu_day_max 개, 보관함의 'churu:<맛>' 하나): 기분 · 친밀도가 크게 (좋아하는 맛이면 더).
 * 아플 때 주면 친밀도는 오르지 않지만 감기가 낫기 시작한다 (cure_sec 뒤).
 */
export function churu(s0: NyangState, slot: number, flavor: string, t: number): { state: NyangState; love: number; liked: boolean; cured: boolean } & CareResult {
  const s = cloneState(s0);
  if (!isChuruId(flavor)) throw new RuleError('bad flavor');
  const c = settle(catOf(s, slot), t);
  const day = kstDay(t);
  if (c.churuDay < day) {
    c.churuDay = day;
    c.churuN = 0;
  }
  if (c.churuN >= CONST.churu_day_max) throw new RuleError('churu full');
  if (itemCount(s.profile, itemKey.churu(flavor)) < 1) throw new RuleError('no churu');
  addItem(s.profile, itemKey.churu(flavor), -1);
  c.churuN += 1;
  const liked = pers(c).churu === flavor;
  const needed = raiseMood(c, liked ? CONST.churu_mood_like : CONST.churu_mood, t);
  let love = 0;
  let cured = false;
  if (c.sickAt != null) {
    if (c.cureAt == null) {
      c.cureAt = t + CONST.cure_sec;
      cured = true;
    }
  } else love = liked ? CONST.churu_love_like : CONST.churu_love;
  c.love += love;
  putCat(s, c);
  return { state: s, love, liked, cured, ...care(s.profile, needed, t) };
}

/** 들어올 때 고양이 한 마리의 선물 굴리기 (visit 이 부른다. 아프면 가져오지 않는다) */
export function rollPresent(c: Cat, p: Profile, t: number) {
  if (c.present || c.sickAt != null || t - c.presentAt < CONST.present_gap_sec) return;
  c.presentAt = t;
  p.pseq += 1;
  const q = p.pseq;
  const lv = levelOf(c);
  if (mix(q, 1) % 100 >= CONST.present_pct + lv * CONST.present_pct_level) return;
  const k = mix(q, 2) % 100;
  const coin: Present = { kind: 'coin', id: 'coin', n: CONST.present_coin_min + lv * 2 + (mix(q, 3) % CONST.present_coin_span) };
  if (k < CONST.present_coin_pct) c.present = coin;
  else if (k < CONST.present_coin_pct + CONST.present_seed_pct) c.present = { kind: 'seed', id: PRESENT_SEEDS[mix(q, 3) % PRESENT_SEEDS.length], n: 1 + (mix(q, 4) % 2) };
  else if (k < CONST.present_coin_pct + CONST.present_seed_pct + CONST.present_toy_pct) {
    const missing = PRESENT_TOYS.filter((toy) => !hasToy(p, toy));
    c.present = missing.length ? { kind: 'toy', id: missing[mix(q, 3) % missing.length], n: 1 } : coin;
  } else {
    const missing = PRESENT_FURNITURE.filter((f) => !p.furniture.includes(f));
    c.present = missing.length ? { kind: 'furniture', id: missing[mix(q, 3) % missing.length], n: 1 } : coin;
  }
}

/** 선물 줍기: 엽전 · 보관함 · 가구로 */
export function gift(s0: NyangState, slot: number, t: number): { state: NyangState; present: Present } {
  const s = cloneState(s0);
  const c = settle(catOf(s, slot), t);
  let g = c.present;
  if (!g) throw new RuleError('no present');
  const p = s.profile;
  // 그사이 같은 장난감 · 가구가 생겼으면 (다른 고양이의 선물 · 상점) 엽전으로
  if ((g.kind === 'furniture' && p.furniture.includes(g.id)) || (g.kind === 'toy' && hasToy(p, g.id as ToyId)))
    g = { kind: 'coin', id: 'coin', n: CONST.present_coin_min + levelOf(c) * 2 };
  if (g.kind === 'coin') p.coins += g.n;
  else if (g.kind === 'furniture') p.furniture.push(g.id);
  else addItem(p, g.kind === 'seed' ? itemKey.seed(g.id) : itemKey.toy(g.id), g.n);
  c.present = null;
  putCat(s, c);
  return { state: s, present: g };
}

/** 처음 본 행동을 도감에 (이미 있으면 그대로) */
export function seen(s0: NyangState, slot: number, behavior: string, t: number): { state: NyangState; added: boolean } {
  const s = cloneState(s0);
  const b = Object.prototype.hasOwnProperty.call(BEHAVIOR, behavior) ? BEHAVIOR[behavior] : undefined;
  if (!b) throw new RuleError('bad behavior');
  const c = settle(catOf(s, slot), t);
  if (levelOf(c) < b.level) throw new RuleError('too early');
  const added = !c.seen.includes(b.id);
  if (added) c.seen.push(b.id);
  putCat(s, c);
  return { state: s, added };
}

// ---------- 4단계: 베란다 정원 · 상점 ----------

/** 내 고양이 중 가장 높은 친밀도 단계 (씨앗이 열리는 기준, 고양이가 없으면 1) */
export const topLevel = (s: NyangState) => Math.max(1, ...s.cats.map(levelOf));

/** 화분이 지금까지 자란 초 (물을 준 뒤 water_sec 동안만 자란다 · 다 자라면 멈춘다) */
export function potGrown(p: Pot, t: number): number {
  const pl = PLANT[p.plant];
  const wet = p.waterAt == null ? 0 : Math.max(0, Math.min(t - p.waterAt, pl.water_sec));
  return Math.min(pl.grow_sec, p.grown + wet);
}
/** 물이 아직 남아 있나 (자라는 중) */
export const potWet = (p: Pot, t: number) => p.waterAt != null && t < p.waterAt + PLANT[p.plant].water_sec && potGrown(p, t) < PLANT[p.plant].grow_sec;
/** 그림 단계: 0 씨앗 · 1 새싹 · 2 봉오리 · 3 꽃 (다 자람) */
export function potStage(p: Pot, t: number): 0 | 1 | 2 | 3 {
  const g = potGrown(p, t);
  const total = PLANT[p.plant].grow_sec;
  if (g >= total) return 3;
  return Math.min(2, Math.floor((g * 3) / total)) as 0 | 1 | 2;
}
/** 다 자라는 때 (물이 계속 있다면 · 지금 물이 마르면 null) */
export function potReadyAt(p: Pot, t: number): number | null {
  const pl = PLANT[p.plant];
  const g = potGrown(p, t);
  if (g >= pl.grow_sec) return t;
  if (!potWet(p, t)) return null;
  const at = p.waterAt! + (pl.grow_sec - p.grown);
  return at <= p.waterAt! + pl.water_sec ? at : null;
}

function potOf(s: NyangState, slot: number): Pot | undefined {
  return s.pots.find((p) => p.slot === slot);
}

/** 심기: 빈 화분에 보관함의 씨앗 하나 */
export function plant(s0: NyangState, slot: number, seed: string, t: number): { state: NyangState } & CareResult {
  const s = cloneState(s0);
  if (!isPlantId(seed)) throw new RuleError('bad seed');
  if (!Number.isInteger(slot) || slot < 1 || slot > s.profile.pots) throw new RuleError('bad pot');
  if (potOf(s, slot)) throw new RuleError('pot busy');
  if (itemCount(s.profile, itemKey.seed(seed)) < 1) throw new RuleError('no seed');
  addItem(s.profile, itemKey.seed(seed), -1);
  s.pots.push({ slot, plant: seed, plantedAt: t, grown: 0, waterAt: null });
  s.pots.sort((a, b) => a.slot - b.slot);
  return { state: s, ...care(s.profile, false, t) };
}

/** 물 주기: 지금까지 자란 것을 적어 두고 물을 새로 (water_sec 동안 자란다). 물이 남아 있으면 'pot wet' */
export function waterPot(s0: NyangState, slot: number, t: number): { state: NyangState } & CareResult {
  const s = cloneState(s0);
  const p = potOf(s, slot);
  if (!p) throw new RuleError('no plant');
  const g = potGrown(p, t);
  if (g >= PLANT[p.plant].grow_sec) throw new RuleError('pot ready');
  if (potWet(p, t)) throw new RuleError('pot wet');
  p.grown = g;
  p.waterAt = t;
  return { state: s, ...care(s.profile, false, t) };
}

/** 수확: 다 자란 것을 보관함('plant:<id>')에, 화분은 빈 칸으로 */
export function harvest(s0: NyangState, slot: number, t: number): { state: NyangState; plant: PlantId } & CareResult {
  const s = cloneState(s0);
  const p = potOf(s, slot);
  if (!p) throw new RuleError('no plant');
  if (potGrown(p, t) < PLANT[p.plant].grow_sec) throw new RuleError('not ready');
  s.pots = s.pots.filter((x) => x.slot !== slot);
  addItem(s.profile, itemKey.plant(p.plant), 1);
  return { state: s, plant: p.plant, ...care(s.profile, false, t) };
}

/** 화분 칸 늘리기 (엽전) */
export function expandPots(s0: NyangState, t: number): { state: NyangState; price: number } {
  void t;
  const s = cloneState(s0);
  const pr = s.profile;
  if (pr.pots >= POT_MAX) throw new RuleError('max pots');
  const price = POT_PRICES[pr.pots - POT_START];
  if (pr.coins < price) throw new RuleError('no coins');
  pr.coins -= price;
  pr.pots += 1;
  return { state: s, price };
}

/** 이미 가진 것인지 (하나만 가질 수 있는 장난감 · 가구) */
function owns(p: Profile, id: string): boolean {
  if (id.startsWith('furniture:')) return p.furniture.includes(id.slice('furniture:'.length));
  return itemCount(p, id) > 0;
}

/**
 * 상점에서 사기: 엽전(price × n) · 시아코인(sia × n, 서버는 _spend_sia_coin 으로 지갑에서 한 번에). 보관함에 give × n 개.
 * 가구는 nyang_profiles.furniture 에 (하나만). 씨앗은 친밀도 단계가 닿아야 열린다.
 */
export function buy(s0: NyangState, id: string, n: number, t: number): { state: NyangState; id: string; n: number } {
  void t;
  const s = cloneState(s0);
  const it = Object.prototype.hasOwnProperty.call(SHOP_ITEM, id) ? SHOP_ITEM[id] : undefined;
  if (!it) throw new RuleError('bad item');
  if (!Number.isInteger(n) || n < 1 || n > CONST.buy_max || (it.once && n !== 1)) throw new RuleError('bad amount');
  if (topLevel(s) < it.level) throw new RuleError('locked');
  const p = s.profile;
  if (it.once && owns(p, id)) throw new RuleError('have it');
  const coins = it.price * n;
  if (p.coins < coins) throw new RuleError('no coins');
  const sia = it.sia * n;
  if (sia > 0 && p.sia < sia) throw new RuleError('not enough coin');
  p.coins -= coins;
  if (sia > 0) {
    p.sia -= sia;
    p.buySeq += 1;
  }
  if (id.startsWith('furniture:')) p.furniture.push(id.slice('furniture:'.length));
  else addItem(p, id, it.give * n);
  return { state: s, id, n };
}

/** 팔기 (수확한 꽃 · 털 뭉치) → 받은 엽전 */
export function sell(s0: NyangState, id: string, n: number, t: number): { state: NyangState; coins: number } {
  void t;
  const s = cloneState(s0);
  const price = Object.prototype.hasOwnProperty.call(SELL, id) ? SELL[id] : 0;
  if (!price) throw new RuleError('bad item');
  if (!Number.isInteger(n) || n < 1 || n > CONST.sell_max) throw new RuleError('bad amount');
  if (itemCount(s.profile, id) < n) throw new RuleError('no item');
  addItem(s.profile, id, -n);
  s.profile.coins += price * n;
  return { state: s, coins: price * n };
}

/** 수확물과 특별 가구 바꾸기 (보름달꽃 3송이 → 보름달 등) */
export function exchange(s0: NyangState, id: string, t: number): { state: NyangState } {
  void t;
  const s = cloneState(s0);
  const ex = EXCHANGES.find((e) => e.id === id);
  if (!ex) throw new RuleError('bad item');
  const p = s.profile;
  if (p.furniture.includes(ex.id)) throw new RuleError('have it');
  if (itemCount(p, ex.need) < ex.n) throw new RuleError('no item');
  addItem(p, ex.need, -ex.n);
  p.furniture.push(ex.id);
  return { state: s };
}

/** 캣그라스 · 캣닢을 고양이에게 (고양이마다 하루 treat_day_max 번): 기분 크게 · 친밀도. 캣닢이면 nipAt (화면은 10분 우다다) */
export function treat(s0: NyangState, slot: number, kind: string, t: number): { state: NyangState; love: number } & CareResult {
  const s = cloneState(s0);
  if (!isTreatId(kind)) throw new RuleError('bad treat');
  const c = settle(catOf(s, slot), t);
  const day = kstDay(t);
  if (c.treatDay < day) {
    c.treatDay = day;
    c.treatN = 0;
  }
  if (c.treatN >= CONST.treat_day_max) throw new RuleError('treat full');
  if (itemCount(s.profile, itemKey.plant(kind)) < 1) throw new RuleError('no item');
  addItem(s.profile, itemKey.plant(kind), -1);
  c.treatN += 1;
  const needed = raiseMood(c, TREAT[kind].mood, t);
  const love = c.sickAt != null ? 0 : TREAT[kind].love;
  c.love += love;
  if (kind === 'catnip') c.nipAt = t;
  putCat(s, c);
  return { state: s, love, ...care(s.profile, needed, t) };
}

// ---------- 5단계: 꾸미기 · 앨범 ----------

/** 가지고 있는 가구인지 (책상 · 방석은 처음부터, 상자는 장난감 상자가 있으면) */
export function ownsFurniture(p: Profile, id: string): boolean {
  if ((BASE_FURNITURE as readonly string[]).includes(id)) return true;
  if (id === 'box') return hasToy(p, 'box');
  return p.furniture.includes(id);
}
/** 가지고 있는 벽지 · 바닥 · 창문인지 (기본은 처음부터, 나머지는 보관함 'style:<id>') */
export const ownsStyle = (p: Profile, id: string) => STYLE_OF[id]?.price === 0 || itemCount(p, itemKey.style(id)) > 0;

/** 지금 방에 놓인 가구 (한 번도 저장하지 않았으면 기본 배치 중 가진 것) */
export function layoutItems(p: Profile): Placed[] {
  if (p.layout.items) return p.layout.items;
  return DEFAULT_ITEMS.filter((i) => ownsFurniture(p, i.id));
}
/** 지금 벽지 · 바닥 · 창문 */
export const layoutStyle = (p: Profile, kind: 'wall' | 'floor' | 'window') => p.layout[kind] ?? BASE_STYLE[kind];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 꾸미기 저장: 방에 놓을 가구(격자 칸) · 벽지 · 바닥 · 창문을 한 번에. 서버는 가진 것인지 · 격자 안인지 · 겹치지 않는지를 본다.
 * 거절: 'bad layout'(모양 · 모르는 가구 · 두 번 · 격자 밖 · 겹침 · 종류가 다른 무늬) · 'not owned'(없는 가구 · 무늬). 꽃병의 꽃은 그대로 둔다.
 */
export function place(s0: NyangState, layout: unknown, t: number): { state: NyangState } {
  void t;
  const s = cloneState(s0);
  const p = s.profile;
  if (!isObj(layout)) throw new RuleError('bad layout');
  const raw = layout.items ?? [];
  if (!Array.isArray(raw) || raw.length > Object.keys(FURNITURE_OF).length) throw new RuleError('bad layout');
  const used = new Set<string>(BLOCKED);
  const seenIds = new Set<string>();
  const items: Placed[] = [];
  for (const it of raw) {
    if (!isObj(it) || typeof it.id !== 'string' || typeof it.x !== 'number' || typeof it.y !== 'number') throw new RuleError('bad layout');
    const f = Object.prototype.hasOwnProperty.call(FURNITURE_OF, it.id) ? FURNITURE_OF[it.id] : undefined;
    if (!f || seenIds.has(f.id)) throw new RuleError('bad layout');
    seenIds.add(f.id);
    if (!ownsFurniture(p, f.id)) throw new RuleError('not owned');
    const { x, y } = it;
    const cols = f.kind === 'wall' ? CONST.wall_cols : CONST.grid_cols;
    const rows = f.kind === 'wall' ? CONST.wall_rows : CONST.grid_rows;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + f.w > cols || y + f.h > rows) throw new RuleError('bad layout');
    const k = f.kind === 'wall' ? 'w' : 'f';
    for (let dx = 0; dx < f.w; dx++)
      for (let dy = 0; dy < f.h; dy++) {
        const cell = `${k}${x + dx}_${y + dy}`;
        if (used.has(cell)) throw new RuleError('bad layout');
        used.add(cell);
      }
    items.push({ id: f.id, x, y });
  }
  const out: RoomLayout = { items };
  for (const kind of ['wall', 'floor', 'window'] as const) {
    const v = layout[kind] ?? BASE_STYLE[kind];
    if (typeof v !== 'string') throw new RuleError('bad layout');
    const st = Object.prototype.hasOwnProperty.call(STYLE_OF, v) ? STYLE_OF[v] : undefined;
    if (!st || st.kind !== kind) throw new RuleError('bad layout');
    if (!ownsStyle(p, v)) throw new RuleError('not owned');
    out[kind] = v;
  }
  if (p.layout.vase) out.vase = p.layout.vase;
  p.layout = out;
  return { state: s };
}

/** 꽃병에 꽃 꽂기 (보관함의 꽃 하나를 쓴다 · 빈 글자면 꽃을 뺀다 — 뺀 꽃은 돌아오지 않는다) */
export function vase(s0: NyangState, flower: string, t: number): { state: NyangState } {
  void t;
  const s = cloneState(s0);
  const p = s.profile;
  if (flower !== '' && !(VASE_FLOWERS as readonly string[]).includes(flower)) throw new RuleError('bad flower');
  if (!ownsFurniture(p, 'vase')) throw new RuleError('no vase');
  if (flower === '') {
    delete p.layout.vase;
    return { state: s };
  }
  if (itemCount(p, itemKey.plant(flower)) < 1) throw new RuleError('no item');
  addItem(p, itemKey.plant(flower), -1);
  p.layout.vase = flower;
  return { state: s };
}

/**
 * 사진 찍기: 지금 행동 · 자세 · 방향(+ 같이 찍힌 고양이)을 앨범에 (그림은 저장하지 않는다). 처음 본 행동이면 도감에도.
 * 거절: 'no cat' · 'bad behavior' · 'too early' · 'bad pose' · 'album full'
 */
export function photo(
  s0: NyangState, slot: number, behavior: string, pose: string, face: number, mate: number, matePose: string, t: number,
): { state: NyangState; id: number; added: boolean } {
  const s = cloneState(s0);
  const c = settle(catOf(s, slot), t);
  const b = Object.prototype.hasOwnProperty.call(BEHAVIOR, behavior) ? BEHAVIOR[behavior] : undefined;
  if (!b) throw new RuleError('bad behavior');
  if (levelOf(c) < b.level) throw new RuleError('too early');
  if (!(POSE_IDS as readonly string[]).includes(pose)) throw new RuleError('bad pose');
  let m: Photo['mate'] = null;
  if (mate) {
    const mc = s.cats.find((x) => x.slot === mate);
    if (!mc || mate === slot) throw new RuleError('no cat');
    if (!(POSE_IDS as readonly string[]).includes(matePose)) throw new RuleError('bad pose');
    m = { slot: mate, color: mc.color, pose: matePose };
  }
  if (s.album.length >= CONST.album_max) throw new RuleError('album full');
  const added = !c.seen.includes(b.id);
  if (added) c.seen.push(b.id);
  putCat(s, c);
  s.profile.photoSeq += 1;
  const id = s.profile.photoSeq;
  s.album.push({ id, slot, name: c.name, color: c.color, behavior: b.id, pose, face: face < 0 ? -1 : 1, mate: m, at: t });
  return { state: s, id, added };
}

/** 사진 지우기 */
export function deletePhoto(s0: NyangState, id: number, t: number): { state: NyangState } {
  void t;
  const s = cloneState(s0);
  if (!s.album.some((a) => a.id === id)) throw new RuleError('no photo');
  s.album = s.album.filter((a) => a.id !== id);
  return { state: s };
}
