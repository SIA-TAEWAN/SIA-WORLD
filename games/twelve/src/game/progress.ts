/**
 * 판 밖 기록 규칙 (PRD '전체 구조' · '성장' · '맵 별 3개').
 * 테스트 모드(?local=1)는 이 파일의 규칙으로 기기에만 저장한다. 5단계에서 서버(078_twelve.sql)가 같은 규칙으로 계산한다:
 * 클라이언트는 잡은 요괴 수(종류별)와 시간만 보내고, 경험치·엽전은 맵별 표로 서버가 계산한다.
 */
import { EXIT_KILL_RATIO } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { ELITE, ENEMIES, ENEMY_IDS, type EnemyKind } from '../data/enemies';
import { BAG, FINAL_GIFT, POTION, POTION_SIZES, bossGift } from '../data/economy';
import { addExp, expPenaltyPct, type Loadout } from '../data/growth';
import { HEROES, STARTERS, heroOf, isHero, joinsAt, type HeroId } from '../data/heroes';
import { bossIdOf, mapKillMax, mapOf, mapPar, mapsOf, type MapDef } from '../data/maps';
import { FINAL_MAP, HARD_READY, MAPS_PER_REGION, REGIONS, REGIONS_READY, mapScale, parseMapId, regionOf, type Mode } from '../data/regions';
import { SLOTS, itemDef, itemStats, normalArmor, normalWeapon, starReward, type Item, type Slot } from '../data/items';
import { WEAPON_KINDS, type WeaponKind } from '../data/weapons';
import { noPity, rollRun, type Drop, type DropCtx, type Pity } from './drops';
import { chestCoins, starBits, starCount } from './sim';

export interface MapRecord {
  /** 딴 별 (비트: 1 시간 · 2 안 쓰러짐 · 4 숨은 상자). 따로따로 모아도 된다 */
  stars: number;
  clears: number;
  /** 가장 빠른 클리어 시간 (초) */
  best: number;
}

/**
 * 내 기록 전부. 서버(_twelve_state_json)가 같은 모양으로 준다.
 * 모든 대원이 한 레벨·한 가방을 같이 쓴다 (PRD '캐릭터').
 */
export interface TwelveProfile {
  level: number;
  exp: number;
  /** 엽전 (이 게임 전용) · 강화석 */
  coins: number;
  stones: number;
  /** 지금 하는 모드 */
  mode: Mode;
  /** 대표 대원 */
  hero: HeroId;
  /** 가방 칸 수 */
  bag: number;
  /** 물약 [체력 소·중·대, 마력 소·중·대] */
  potions: number[][];
  /** 착용한 장비 (items 의 id) */
  eq: Record<Slot, string | null>;
  /** 가진 장비 (가방 + 보관함) */
  items: Item[];
  /** 모드별 맵 기록 (어려움 모드는 진행·별을 따로 센다) */
  maps: Record<Mode, Record<string, MapRecord>>;
  /** 모드별 열쇠를 얻은 지형 */
  keys: Record<Mode, number[]>;
  /** 확정 보정 카운터 (모드 → 지형 번호 → 못 받은 횟수) */
  pity: Record<Mode, Record<string, Pity>>;
  /** 얻어 본 레어·별 보상 (지형 화면의 레어 목록, '아직 없는 것부터') */
  codex: string[];
  /** 끝없는 탑 기록 (한 번도 들어가지 않았으면 null). 규칙은 game/tower.ts */
  tower: TowerRecord | null;
}

/** 끝없는 탑 최고 기록 (서버 twelve_tower 의 한 줄). 한 번 들어가면 1층을 못 깨도 생긴다 (floor 0) */
export interface TowerRecord {
  /** 가장 높이 깬 층 · 그 층까지 걸린 시간(초) · 그때의 레벨·대원 · 날짜 */
  floor: number;
  time: number;
  level: number;
  hero: HeroId;
  at: string;
  /** 체크포인트: 보스 층(10 · 20 · …)을 깬 가장 빠른 누적 시간. 있으면 그 다음 층에서 시작할 수 있다 */
  cps: Record<string, number>;
}

/** 처음 받는 장비: 나무 무기 4종(칼을 들고 시작)과 나무 갑옷 — 서버의 _twelve_profile_row 와 같다 */
export const STARTER_ITEMS: readonly string[] = [...WEAPON_KINDS.map((k) => normalWeapon(k, 0)), normalArmor(0)];

export const emptyProfile = (): TwelveProfile => ({
  level: 1,
  exp: 0,
  coins: 0,
  stones: 0,
  mode: 'normal',
  hero: 'rat',
  bag: BAG.size,
  potions: POTION.start.map((r) => [...r]),
  eq: { weapon: '1', armor: String(STARTER_ITEMS.length), acc: null },
  items: STARTER_ITEMS.map((base, i) => ({ id: String(i + 1), base, plus: 0, lock: false, box: false })),
  maps: { normal: {}, hard: {} },
  keys: { normal: [], hard: [] },
  pity: { normal: {}, hard: {} },
  codex: [],
  tower: null,
});

export const LIMITS = {
  /** 이보다 빨리 깬 맵은 받지 않는다 (초) */
  clearMinTime: 20,
  /** 판 최대 시간 (초) */
  maxTime: 3600,
  /** 서버가 잰 시간과 보고한 시간의 여유 (초) */
  timeSlack: 3,
  /** 시작한 지 이보다 오래된 판은 받지 않는다 (초) */
  maxAge: 7200,
  /** 시아코인: 이보다 짧은 판 · 내 레벨이 권장 레벨보다 이만큼 이상 높으면 주지 않는다 (PRD '랭킹과 시아코인') */
  coinMinTime: 60,
  coinLevelGap: 15,
};

// ---------- 가방 ----------

export const itemOf = (p: TwelveProfile, id: string | null): Item | null => (id ? (p.items.find((it) => it.id === id) ?? null) : null);
export const equipped = (p: TwelveProfile, slot: Slot): Item | null => itemOf(p, p.eq[slot]);
export const isEquipped = (p: TwelveProfile, id: string) => SLOTS.some((s) => p.eq[s] === id);
/** 가방에 든 수 (착용한 것도 가방 칸을 쓴다. 보관함은 따로) */
export const bagCount = (p: TwelveProfile) => p.items.reduce((n, it) => n + (it.box ? 0 : 1), 0);
export const boxItems = (p: TwelveProfile) => p.items.filter((it) => it.box);
/** 지금 든 무기 종류 */
export const weaponOf = (p: TwelveProfile): WeaponKind => itemDef(equipped(p, 'weapon')?.base ?? '')?.kind ?? 'sword';
/** 새 장비 id (기기 저장: 가장 큰 번호 + 1. 서버는 표의 번호) */
const nextItemId = (p: TwelveProfile) => String(p.items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0) + 1);
/** 장비를 받는다: 가방이 꽉 찼으면 보관함으로 (PRD: 레어를 놓치지 않게) */
export function addItem(p: TwelveProfile, base: string): Item {
  const it: Item = { id: nextItemId(p), base, plus: 0, lock: false, box: bagCount(p) >= p.bag };
  p.items.push(it);
  return it;
}
export const hasKey = (p: TwelveProfile, region: number, mode: Mode = p.mode) => p.keys[mode].includes(region);
export const pityOf = (p: TwelveProfile, region: number, mode: Mode = p.mode): Pity => p.pity[mode][String(region)] ?? noPity();

export const cleared = (p: TwelveProfile, id: string, mode: Mode = p.mode) => (p.maps[mode][id]?.clears ?? 0) > 0;
export const starsOfMap = (p: TwelveProfile, id: string, mode: Mode = p.mode) => p.maps[mode][id]?.stars ?? 0;
/** 지형에서 딴 별 수 (최대 24) */
export const regionStarCount = (p: TwelveProfile, region: number, mode: Mode = p.mode) =>
  Array.from({ length: MAPS_PER_REGION }, (_, i) => starCount(starsOfMap(p, `${region}-${i + 1}`, mode))).reduce((a, b) => a + b, 0);

/** 지형이 준비됐는지 (아니면 지도에 '준비 중') */
export const regionReady = (region: number) => region <= REGIONS_READY && mapsOf(region).length === MAPS_PER_REGION;
/** 지형이 열렸는지: 1지형이거나 앞 지형 보스를 잡았다 */
export const regionOpen = (p: TwelveProfile, region: number, mode: Mode = p.mode) => modeOpen(p, mode) && (region === 1 || cleared(p, `${region - 1}-${MAPS_PER_REGION}`, mode));
/** 모드가 열렸는지: 어려움 모드는 보통 모드의 최종보스를 잡은 뒤에 (서버 _twelve_region_open · twelve_set_mode) */
export const modeOpen = (p: TwelveProfile, mode: Mode) => mode === 'normal' || (HARD_READY && (p.maps.normal[FINAL_MAP]?.clears ?? 0) > 0);

export function mapOpen(p: TwelveProfile, id: string, mode: Mode = p.mode): boolean {
  const m = parseMapId(id);
  if (!m || !mapOf(id) || !regionReady(m.region)) return false;
  if (!modeOpen(p, mode)) return false;
  // 최종보스맵: 12지형 보스를 잡았고 그 모드의 열쇠 12개를 다 모았다
  if (id === FINAL_MAP) return finalOpen(p, mode);
  return m.no === 1 ? regionOpen(p, m.region, mode) : cleared(p, `${m.region}-${m.no - 1}`, mode);
}

/** 최종보스맵이 열렸는지: 12지형 보스를 잡았고 그 모드의 열쇠 12개를 모았다 (서버 twelve_start 의 'need keys') */
export const keyCount = (p: TwelveProfile, mode: Mode = p.mode) => p.keys[mode].length;
export const finalOpen = (p: TwelveProfile, mode: Mode = p.mode) => cleared(p, `${REGIONS}-${MAPS_PER_REGION}`, mode) && keyCount(p, mode) >= REGIONS;

/** 이어하기: 열린 맵 중 아직 못 깬 첫 맵 (다 깼으면 마지막 맵. 열쇠를 다 모았고 최종보스를 아직 못 잡았으면 최종보스맵) */
export function continueMap(p: TwelveProfile): string | null {
  let last: string | null = null;
  for (let r = 1; r <= REGIONS_READY; r++) {
    for (const m of mapsOf(r)) {
      if (!mapOpen(p, m.id)) return last;
      if (!cleared(p, m.id)) return m.id;
      last = m.id;
    }
  }
  return finalOpen(p) && !cleared(p, FINAL_MAP) ? FINAL_MAP : last;
}

/** 보통 모드를 끝냈는지 (최종보스맵 'final' 클리어). 어려움 모드 · 고양이가 여기에 걸려 있다 */
export { FINAL_MAP };
export const normalDone = (p: TwelveProfile) => (p.maps.normal[FINAL_MAP]?.clears ?? 0) > 0;

/**
 * 함께하는 대원: 처음 3종 + 지형 보스를 처음 잡을 때마다 한 명 (보통·어려움 어느 쪽이든).
 * 고양이는 시아코인으로 산 뒤에만 (cat = shared/characters.js 의 loadOwnedCharacters('twelve') 에 있는지)
 */
export function heroesOf(p: TwelveProfile, cat = false): HeroId[] {
  return HEROES.filter((h) => (h.hidden ? cat : h.join === 0 || cleared(p, `${h.join}-${MAPS_PER_REGION}`, 'normal') || cleared(p, `${h.join}-${MAPS_PER_REGION}`, 'hard'))).map((h) => h.id);
}

/** 지형 화면의 추천 대원: 고향 대원 + 환경을 막는 대원 (환경 효과가 없는 지형은 고향 대원만) */
export const recommended = (region: number): HeroId[] => {
  const r = regionOf(region);
  return r.counter === r.home || r.env === 'none' ? [r.home] : [r.home, r.counter];
};

/** 맵에 들고 들어가는 것: 착용한 무기·방어구·장신구 */
export function loadoutOf(p: TwelveProfile, hero: HeroId = p.hero): Loadout {
  const bonus: NonNullable<Loadout['bonus']> = {};
  const lo = { hero, level: p.level, weapon: 'sword' as WeaponKind, weaponAtk: 0, armorHp: 0, armorDef: 0, fx: [] as NonNullable<Loadout['fx']>, bonus };
  for (const slot of SLOTS) {
    const it = equipped(p, slot);
    const d = it && itemDef(it.base);
    if (!it || !d) continue;
    const st = itemStats(d, it.plus);
    if (d.kind) lo.weapon = d.kind;
    lo.weaponAtk += st.atk;
    lo.armorHp += st.hp;
    lo.armorDef += st.def;
    if (d.fx) lo.fx.push(d.fx);
    if (d.stat) bonus[d.stat] = (bonus[d.stat] ?? 0) + (d.value ?? 0);
  }
  return lo;
}
/** 엽전 획득 장신구 (%) — 서버는 판을 시작할 때 이 값을 적어 둔다 */
export const coinBonus = (p: TwelveProfile) => loadoutOf(p).bonus?.coin ?? 0;

/** 판을 시작할 수 없는 까닭 (없으면 null) */
export function checkStart(p: TwelveProfile, id: string, mode: Mode, hero: string, cat = false): string | null {
  if (!mapOf(id)) return 'bad map';
  if (!modeOpen(p, mode)) return 'mode locked';
  // 최종보스맵: 12지형 보스를 잡았어도 열쇠가 모자라면 못 들어간다
  if (id === FINAL_MAP && cleared(p, `${REGIONS}-${MAPS_PER_REGION}`, mode) && keyCount(p, mode) < REGIONS) return 'need keys';
  if (!mapOpen(p, id, mode)) return 'map locked';
  if (!isHero(hero)) return 'bad hero';
  if (!heroesOf(p, cat).includes(hero)) return 'hero locked';
  if (!equipped(p, 'weapon')) return 'no weapon';
  return null;
}

/** 판 하나의 결과 (화면 → 서버). 경험치·엽전·드랍은 보내지 않는다 */
export interface RunReport {
  /** 판 번호 (서버가 준다. 기록되지 않는 판은 '') */
  run: string;
  map: string;
  mode: Mode;
  hero: HeroId;
  /** 판 시간 (초, 내림) */
  time: number;
  cleared: boolean;
  /** 잡은 요괴 수 (종류별, 정예·보스 제외) */
  kills: Partial<Record<EnemyKind, number>>;
  elites: number;
  boss: boolean;
  chest: boolean;
  /** 이번 도전에서 이 맵에 쓰러진 횟수 ('다시 도전'으로 이어 한 횟수) */
  deaths: number;
  /** 쓴 물약 [체력 소·중·대, 마력 소·중·대] (없으면 안 쓴 것) */
  potions?: number[][];
}

export interface FinishResult {
  exp: number;
  coins: number;
  /** 오른 레벨 수 · 오른 뒤 레벨 */
  ups: number;
  level: number;
  /** 이번 판의 별 (비트) · 새로 딴 별 (비트) */
  stars: number;
  newStars: number;
  first: boolean;
  /** 새로 합류한 대원 */
  joined: HeroId | null;
  /** 보스의 선물로 받은 강화석 (10~12지형 보스를 처음 잡았을 때. stones 에도 들어 있다) */
  gift: number;
  /** 시아코인을 받았는지 (서버만) */
  siaCoin: boolean;
  /** 얻은 것 (클리어한 판만): 장비 · 강화석 · 물약 [체력 소·중·대, 마력 소·중·대] · 열쇠 */
  items: Item[];
  stones: number;
  potions: number[][];
  key: boolean;
  /** 지형 별 24개 보상으로 받은 장신구 (items 에도 들어 있다) */
  starItem: string | null;
}

/** 처치 수로 계산한 경험치·엽전 (맵 표 기준. 최대치를 넘는 수는 잘라 낸다) */
export function rewardOf(id: string, mode: Mode, r: Pick<RunReport, 'kills' | 'elites' | 'boss' | 'chest'>): { exp: number; coins: number } {
  const map = mapOf(id);
  if (!map) return { exp: 0, coins: 0 };
  const row = mapReward(map, mode);
  let exp = 0;
  let coins = 0;
  for (const k of ENEMY_IDS) {
    const kr = row.kinds[k];
    if (!kr) continue;
    const n = Math.max(0, Math.min(kr.max, Math.floor(r.kills[k] ?? 0)));
    exp += n * kr.exp;
    coins += n * kr.coin;
  }
  const el = Math.max(0, Math.min(row.elites, Math.floor(r.elites)));
  exp += el * row.eliteExp;
  coins += el * row.eliteCoin;
  if (r.boss) {
    exp += row.bossExp;
    coins += row.bossCoin;
  }
  if (r.chest) coins += row.chestCoin;
  return { exp, coins };
}

/** 맵 하나의 보상 표 (서버 _twelve_maps 의 한 줄과 같다): 종류별 [최대 수, 경험치, 엽전] · 정예 · 보스 · 상자 */
export interface MapReward {
  level: number;
  /** 셀 수 있는 요괴 수 (종류별 합 + 정예) */
  total: number;
  kinds: Partial<Record<EnemyKind, { max: number; exp: number; coin: number }>>;
  elites: number;
  eliteExp: number;
  eliteCoin: number;
  bossExp: number;
  bossCoin: number;
  chestCoin: number;
}
export function mapReward(map: MapDef, mode: Mode): MapReward {
  const sc = mapScale(map.region, map.no, mode);
  const max = mapKillMax(map, mode);
  const kinds: MapReward['kinds'] = {};
  for (const k of ENEMY_IDS) {
    if (max.kinds[k]) kinds[k] = { max: max.kinds[k]!, exp: Math.round(ENEMIES[k].exp * sc.exp), coin: Math.round(ENEMIES[k].coin * sc.reward) };
  }
  // 정예는 맵마다 한 종류다 (그 맵 무리의 elite)
  const eliteKind = map.groups.find((g) => g.elite)?.elite;
  const boss = map.boss ? BOSSES[bossIdOf(map)] : null;
  return {
    level: sc.level,
    total: max.total,
    kinds,
    elites: max.elites,
    eliteExp: eliteKind ? Math.round(ENEMIES[eliteKind].exp * ELITE.reward * sc.exp) : 0,
    eliteCoin: eliteKind ? Math.round(ENEMIES[eliteKind].coin * ELITE.reward * sc.reward) : 0,
    bossExp: boss ? Math.round(boss.exp * sc.exp) : 0,
    bossCoin: boss ? Math.round(boss.coin * sc.reward) : 0,
    chestCoin: chestCoins(sc.reward),
  };
}

/** 출구가 열리는 처치 수 (보스 맵은 보스) — 클리어 보고의 최소 처치 수이기도 하다 */
export const exitNeed = (total: number) => Math.ceil((total * Math.round(EXIT_KILL_RATIO * 100)) / 100);
const normalKills = (r: Pick<RunReport, 'kills'>) => ENEMY_IDS.reduce((n, k) => n + (r.kills[k] ?? 0), 0);
export const potionGrid = (v: unknown): number[][] | null => {
  if (v === undefined || v === null) return [0, 1].map(() => Array<number>(POTION_SIZES).fill(0));
  if (!Array.isArray(v) || v.length !== 2) return null;
  for (const row of v) {
    if (!Array.isArray(row) || row.length !== POTION_SIZES || row.some((n) => !Number.isInteger(n) || n < 0 || n > POTION.max)) return null;
  }
  return v as number[][];
};

/** 받을 수 없는 결과인 까닭 (없으면 null) */
export function checkReport(r: RunReport): string | null {
  const map = mapOf(r.map);
  if (!map) return 'bad map';
  if (!Number.isInteger(r.time) || r.time < 0 || r.time > LIMITS.maxTime) return 'bad time';
  const max = mapKillMax(map, r.mode);
  for (const k of Object.keys(r.kills)) {
    if (!(ENEMY_IDS as readonly string[]).includes(k)) return 'bad kills';
    const n = r.kills[k as EnemyKind]!;
    if (!Number.isInteger(n) || n < 0 || n > (max.kinds[k as EnemyKind] ?? 0)) return 'bad kills';
  }
  if (!Number.isInteger(r.elites) || r.elites < 0 || r.elites > max.elites) return 'bad kills';
  if (r.boss && !map.boss) return 'bad kills';
  if (!Number.isInteger(r.deaths) || r.deaths < 0) return 'bad result';
  if (!potionGrid(r.potions)) return 'bad potions';
  if (r.cleared) {
    if (r.time < LIMITS.clearMinTime) return 'too early';
    if (map.boss ? !r.boss : normalKills(r) + r.elites < exitNeed(max.total)) return 'bad result';
  }
  return null;
}

/** 이 판의 드랍 판정에 넘길 것 (지금 기록의 복사본) */
export function dropCtx(p: TwelveProfile, map: string, mode: Mode, seed: number): DropCtx {
  const region = parseMapId(map)?.region ?? 1;
  return { seed, region, mode, pity: { ...pityOf(p, region, mode) }, codex: [...p.codex], hasKey: hasKey(p, region, mode) };
}

/**
 * 결과를 프로필에 적는다 (p 를 고친다). seed = 판을 시작할 때 받은 드랍 씨앗.
 * 쓰러진 판: 경험치는 남고, 그 맵에서 얻은 엽전·아이템은 잃는다 (PRD '죽으면'). 확정 보정 카운터도 그대로다. 쓴 물약은 돌아오지 않는다.
 * 서버의 twelve_finish 와 같은 순서·같은 규칙이다.
 */
export function applyReport(p: TwelveProfile, r: RunReport, seed = 0): FinishResult {
  const map = mapOf(r.map)!;
  const sc = mapScale(map.region, map.no, r.mode);
  const raw = rewardOf(r.map, r.mode, r);
  const exp = Math.floor((raw.exp * expPenaltyPct(p.level, sc.level)) / 100);
  const coins = r.cleared ? Math.floor((raw.coins * (100 + coinBonus(p))) / 100) : 0;
  const before = heroesOf(p);
  const up = addExp(p.level, p.exp, exp);
  p.level = up.level;
  p.exp = up.exp;
  p.coins += coins;
  const used = potionGrid(r.potions)!;
  p.potions = p.potions.map((row, s) => row.map((n, z) => Math.max(0, n - used[s][z])));
  const out: FinishResult = {
    exp,
    coins,
    ups: up.ups,
    level: p.level,
    stars: starBits(r.cleared, r.time, mapPar(map, r.mode), r.deaths, r.chest),
    newStars: 0,
    first: false,
    joined: null,
    gift: 0,
    siaCoin: false,
    items: [],
    stones: 0,
    potions: [0, 1].map(() => Array<number>(POTION_SIZES).fill(0)),
    key: false,
    starItem: null,
  };
  if (!r.cleared) return out;

  const rec = (p.maps[r.mode][r.map] ??= { stars: 0, clears: 0, best: 0 });
  out.first = rec.clears === 0;
  out.newStars = out.stars & ~rec.stars;
  rec.stars |= out.stars;
  rec.clears++;
  rec.best = rec.best ? Math.min(rec.best, r.time) : r.time;
  // 보스의 선물: 대원이 합류하지 않는 지형의 보스 · 최종보스를 이 모드에서 처음 잡았다
  if (out.first && map.boss && r.boss) {
    out.gift = map.final ? FINAL_GIFT : bossGift(map.region);
    p.stones += out.gift;
    out.stones += out.gift;
  }

  // 드랍: 일반 요괴 → 정예 → 보스
  const ctx = dropCtx(p, r.map, r.mode, seed);
  const drops: Drop[] = rollRun(ctx, normalKills(r), r.elites, r.boss && !!map.boss);
  for (const d of drops) {
    if (d.t === 'potion') {
      const now = p.potions[d.slot][d.size];
      const got = Math.min(POTION.max, now + 1) - now;
      p.potions[d.slot][d.size] += got;
      out.potions[d.slot][d.size] += got;
    } else if (d.t === 'stone') {
      p.stones += d.n;
      out.stones += d.n;
    } else if (d.t === 'key') {
      // 지형 번호 순서로 둔다 (서버가 주는 모양과 같게)
      if (!p.keys[r.mode].includes(map.region)) p.keys[r.mode] = [...p.keys[r.mode], map.region].sort((x, y) => x - y);
      out.key = true;
    } else out.items.push({ ...addItem(p, d.base) });
  }
  // 모두 0 인 줄은 두지 않는다 (서버가 주는 모양과 같게)
  if (ctx.pity.elite || ctx.pity.boss || ctx.pity.key) p.pity[r.mode][String(map.region)] = ctx.pity;
  else delete p.pity[r.mode][String(map.region)];
  p.codex = ctx.codex;
  // 지형의 별 24개를 모두 모으면 그 지형 장신구 (모드마다 한 번)
  const star = starReward(map.region, r.mode);
  if (regionStarCount(p, map.region, r.mode) >= MAPS_PER_REGION * 3 && !p.codex.includes(star)) {
    p.codex.push(star);
    out.items.push({ ...addItem(p, star) });
    out.starItem = star;
  }
  out.joined = heroesOf(p).find((h) => !before.includes(h)) ?? null;
  return out;
}

/** 모드 바꾸기 (보통 ↔ 어려움) → 못 바꾸는 까닭 (없으면 null). 레벨·장비는 그대로, 맵 진행·열쇠·별은 모드마다 따로다. 서버 twelve_set_mode */
export function setMode(p: TwelveProfile, mode: string): string | null {
  if (mode !== 'normal' && mode !== 'hard') return 'bad mode';
  if (!modeOpen(p, mode)) return 'mode locked';
  p.mode = mode;
  return null;
}
/** 어려움 모드를 끝냈는지 (어려움 최종보스 — 진짜 엔딩 · 랭킹의 👑) */
export const hardDone = (p: TwelveProfile) => (p.maps.hard[FINAL_MAP]?.clears ?? 0) > 0;

/** 대표 대원 바꾸기 → 못 바꾸는 까닭 (없으면 null) */
export function setHero(p: TwelveProfile, hero: string, cat = false): string | null {
  if (!isHero(hero)) return 'bad hero';
  if (!heroesOf(p, cat).includes(hero)) return 'hero locked';
  p.hero = hero;
  return null;
}

/** 지형 보스를 잡으면 합류하는 대원 이름 (지형 화면 안내) */
export const joinText = (region: number) => {
  const h = joinsAt(region);
  const gift = bossGift(region);
  return h ? `보스를 처음 잡으면 ${h.name}(${h.animal})가 합류해요` : gift ? `보스를 처음 잡으면 강화석 꾸러미(${gift}개)를 받아요` : '';
};

/** 서버·기기가 거절한 까닭 → 화면 글 */
export function whyText(why: string): string {
  switch (why) {
    case 'map locked': return '아직 열리지 않은 맵이에요';
    case 'mode locked': return '보통 모드를 끝내야 어려움 모드가 열려요';
    case 'need keys': return '열쇠 12개를 모두 모아야 열려요';
    case 'hero locked': return '아직 합류하지 않은 대원이에요';
    case 'locked character': return '아직 열지 않은 대원이에요';
    case 'too early': return '너무 빨리 끝난 판이라 기록되지 않았어요';
    case 'too late': return '너무 오래된 판이라 기록되지 않았어요';
    case 'overlap': return '다른 판과 시간이 겹쳐 기록되지 않았어요';
    case 'already finished': return '이미 기록된 판이에요';
    case 'need login': return '로그인이 필요해요';
    case 'not enough coins': return '엽전이 모자라요';
    case 'not enough stones': return '강화석이 모자라요';
    case 'low level': return '레벨이 모자라서 착용할 수 없어요';
    case 'locked item': return '잠근 장비예요. 잠금을 먼저 풀어 주세요';
    case 'equipped': return '착용 중인 장비예요';
    case 'bag full': return '가방이 꽉 찼어요';
    case 'max plus': return '더 강화할 수 없어요';
    case 'max bag': return '가방을 더 늘릴 수 없어요';
    case 'max potions': return '그 물약은 더 가질 수 없어요';
    case 'not for sale': return '상점에서 팔지 않는 물건이에요';
    case 'no weapon': return '무기를 착용해 주세요';
    case 'no item': return '없는 장비예요';
    case 'floor locked': return '아직 갈 수 없는 층이에요';
    case 'no run': return '기록할 수 없는 판이에요';
    default: return why.startsWith('bad ') ? '기록할 수 없는 결과예요' : '서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요';
  }
}

export { STARTERS, heroOf };
