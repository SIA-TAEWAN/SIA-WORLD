/**
 * 판 밖 기록 규칙 (PRD '전체 구조' · '성장' · '맵 별 3개').
 * 테스트 모드(?local=1)는 이 파일의 규칙으로 기기에만 저장한다. 5단계에서 서버(078_twelve.sql)가 같은 규칙으로 계산한다:
 * 클라이언트는 잡은 요괴 수(종류별)와 시간만 보내고, 경험치·엽전은 맵별 표로 서버가 계산한다.
 */
import { BOSSES } from '../data/bosses';
import { ELITE, ENEMIES, ENEMY_IDS, type EnemyKind } from '../data/enemies';
import { addExp, defaultLoadout, expPenalty, type Loadout } from '../data/growth';
import { HEROES, STARTERS, heroOf, isHero, joinsAt, type HeroId } from '../data/heroes';
import { mapKillMax, mapOf, mapsOf } from '../data/maps';
import { HARD_READY, MAPS_PER_REGION, REGIONS_READY, mapScale, parseMapId, regionOf, type Mode } from '../data/regions';
import { WEAPON_KINDS, tierForLevel, type WeaponKind } from '../data/weapons';
import { chestCoins, starBits, starCount } from './sim';

export interface MapRecord {
  /** 딴 별 (비트: 1 시간 · 2 안 쓰러짐 · 4 숨은 상자). 따로따로 모아도 된다 */
  stars: number;
  clears: number;
  /** 가장 빠른 클리어 시간 (초) */
  best: number;
}

export interface TwelveProfile {
  level: number;
  exp: number;
  /** 엽전 (이 게임 전용) */
  coins: number;
  /** 지금 하는 모드 */
  mode: Mode;
  hero: HeroId;
  weapon: WeaponKind;
  /** 모드별 맵 기록 (어려움 모드는 진행·별을 따로 센다) */
  maps: Record<Mode, Record<string, MapRecord>>;
}

export const emptyProfile = (): TwelveProfile => ({ level: 1, exp: 0, coins: 0, mode: 'normal', hero: 'rat', weapon: 'sword', maps: { normal: {}, hard: {} } });

/** 맵에 들어갈 때마다 기본으로 받는 물약 [체력, 마력] — 5단계에서 상점 물약으로 바뀐다 */
export const START_POTIONS: [number, number] = [3, 3];

export const LIMITS = {
  /** 이보다 빨리 깬 맵은 받지 않는다 (초) */
  clearMinTime: 20,
  /** 판 최대 시간 (초) */
  maxTime: 3600,
};

export const cleared = (p: TwelveProfile, id: string, mode: Mode = p.mode) => (p.maps[mode][id]?.clears ?? 0) > 0;
export const starsOfMap = (p: TwelveProfile, id: string, mode: Mode = p.mode) => p.maps[mode][id]?.stars ?? 0;
/** 지형에서 딴 별 수 (최대 24) */
export const regionStarCount = (p: TwelveProfile, region: number, mode: Mode = p.mode) =>
  Array.from({ length: MAPS_PER_REGION }, (_, i) => starCount(starsOfMap(p, `${region}-${i + 1}`, mode))).reduce((a, b) => a + b, 0);

/** 지형이 준비됐는지 (아니면 지도에 '준비 중') */
export const regionReady = (region: number) => region <= REGIONS_READY && mapsOf(region).length === MAPS_PER_REGION;
/** 지형이 열렸는지: 1지형이거나 앞 지형 보스를 잡았다 */
export const regionOpen = (p: TwelveProfile, region: number, mode: Mode = p.mode) => region === 1 || cleared(p, `${region - 1}-${MAPS_PER_REGION}`, mode);

export function mapOpen(p: TwelveProfile, id: string, mode: Mode = p.mode): boolean {
  const m = parseMapId(id);
  if (!m || !mapOf(id) || !regionReady(m.region)) return false;
  if (mode === 'hard' && !HARD_READY) return false;
  return m.no === 1 ? regionOpen(p, m.region, mode) : cleared(p, `${m.region}-${m.no - 1}`, mode);
}

/** 이어하기: 열린 맵 중 아직 못 깬 첫 맵 (다 깼으면 마지막 맵) */
export function continueMap(p: TwelveProfile): string | null {
  let last: string | null = null;
  for (let r = 1; r <= REGIONS_READY; r++) {
    for (const m of mapsOf(r)) {
      if (!mapOpen(p, m.id)) return last;
      if (!cleared(p, m.id)) return m.id;
      last = m.id;
    }
  }
  return last;
}

/** 함께하는 대원: 처음 3종 + 지형 보스를 처음 잡을 때마다 한 명 (보통·어려움 어느 쪽이든). 고양이는 5단계 구매 뒤 */
export function heroesOf(p: TwelveProfile): HeroId[] {
  return HEROES.filter((h) => !h.hidden && (h.join === 0 || cleared(p, `${h.join}-${MAPS_PER_REGION}`, 'normal') || cleared(p, `${h.join}-${MAPS_PER_REGION}`, 'hard'))).map((h) => h.id);
}

/** 지형 화면의 추천 대원: 고향 대원 + 환경을 막는 대원 */
export const recommended = (region: number): HeroId[] => {
  const r = regionOf(region);
  return r.counter === r.home ? [r.home] : [r.home, r.counter];
};

/** 맵에 들고 들어가는 것 (장비 표가 생기기 전: 레벨에 맞는 등급의 일반 무기) */
export const loadoutOf = (p: TwelveProfile): Loadout => defaultLoadout(p.hero, p.level, p.weapon, tierForLevel(p.level));

/** 판을 시작할 수 없는 까닭 (없으면 null) */
export function checkStart(p: TwelveProfile, id: string, mode: Mode, hero: string, weapon: string): string | null {
  if (!mapOf(id)) return 'bad map';
  if (!mapOpen(p, id, mode)) return 'map locked';
  if (!isHero(hero)) return 'bad hero';
  if (!heroesOf(p).includes(hero)) return 'hero locked';
  if (!(WEAPON_KINDS as readonly string[]).includes(weapon)) return 'bad weapon';
  return null;
}

/** 판 하나의 결과 (화면 → 서버). 경험치·엽전은 보내지 않는다 */
export interface RunReport {
  /** 판 번호 (서버가 준다. 기록되지 않는 판은 '') */
  run: string;
  map: string;
  mode: Mode;
  hero: HeroId;
  weapon: WeaponKind;
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
  /** 시아코인을 받았는지 (서버만) */
  siaCoin: boolean;
}

/** 처치 수로 계산한 경험치·엽전 (맵 표 기준. 최대치를 넘는 수는 잘라 낸다) */
export function rewardOf(id: string, mode: Mode, r: Pick<RunReport, 'kills' | 'elites' | 'boss' | 'chest'>): { exp: number; coins: number } {
  const map = mapOf(id);
  if (!map) return { exp: 0, coins: 0 };
  const sc = mapScale(map.region, map.no, mode);
  const max = mapKillMax(map, mode);
  let exp = 0;
  let coins = 0;
  for (const k of ENEMY_IDS) {
    const n = Math.max(0, Math.min(max.kinds[k] ?? 0, Math.floor(r.kills[k] ?? 0)));
    exp += n * Math.round(ENEMIES[k].exp * sc.reward);
    coins += n * Math.round(ENEMIES[k].coin * sc.reward);
  }
  // 정예는 맵마다 한 종류다 (그 맵 무리의 elite)
  const eliteKind = map.groups.find((g) => g.elite)?.elite;
  if (eliteKind) {
    const n = Math.max(0, Math.min(max.elites, Math.floor(r.elites)));
    exp += n * Math.round(ENEMIES[eliteKind].exp * ELITE.reward * sc.reward);
    coins += n * Math.round(ENEMIES[eliteKind].coin * ELITE.reward * sc.reward);
  }
  if (r.boss && map.boss) {
    const b = BOSSES[regionOf(map.region).boss];
    exp += Math.round(b.exp * sc.reward);
    coins += Math.round(b.coin * sc.reward);
  }
  if (r.chest) coins += chestCoins(sc.reward);
  return { exp, coins };
}

/** 받을 수 없는 결과인 까닭 (없으면 null) */
export function checkReport(r: RunReport): string | null {
  const map = mapOf(r.map);
  if (!map) return 'bad map';
  if (!(r.time >= 0) || r.time > LIMITS.maxTime) return 'bad time';
  const max = mapKillMax(map, r.mode);
  for (const k of Object.keys(r.kills)) {
    if (!(ENEMY_IDS as readonly string[]).includes(k)) return 'bad kills';
    const n = r.kills[k as EnemyKind]!;
    if (!Number.isInteger(n) || n < 0 || n > (max.kinds[k as EnemyKind] ?? 0)) return 'bad kills';
  }
  if (!Number.isInteger(r.elites) || r.elites < 0 || r.elites > max.elites) return 'bad kills';
  if (r.boss && !map.boss) return 'bad kills';
  if (r.cleared) {
    if (r.time < LIMITS.clearMinTime) return 'too early';
    if (map.boss && !r.boss) return 'bad result';
  }
  return null;
}

/**
 * 결과를 프로필에 적는다 (p 를 고친다).
 * 쓰러진 판: 경험치는 남고, 그 맵에서 얻은 엽전은 잃는다 (PRD '죽으면').
 */
export function applyReport(p: TwelveProfile, r: RunReport): FinishResult {
  const map = mapOf(r.map)!;
  const sc = mapScale(map.region, map.no, r.mode);
  const raw = rewardOf(r.map, r.mode, r);
  const exp = Math.floor(raw.exp * expPenalty(p.level, sc.level));
  const coins = r.cleared ? raw.coins : 0;
  const before = heroesOf(p);
  const up = addExp(p.level, p.exp, exp);
  p.level = up.level;
  p.exp = up.exp;
  p.coins += coins;
  const stars = starBits(r.cleared, r.time, map.par, r.deaths, r.chest);
  let newStars = 0;
  let first = false;
  if (r.cleared) {
    const rec = (p.maps[r.mode][r.map] ??= { stars: 0, clears: 0, best: 0 });
    first = rec.clears === 0;
    newStars = stars & ~rec.stars;
    rec.stars |= stars;
    rec.clears++;
    rec.best = rec.best ? Math.min(rec.best, r.time) : r.time;
  }
  const joined = heroesOf(p).find((h) => !before.includes(h)) ?? null;
  return { exp, coins, ups: up.ups, level: p.level, stars, newStars, first, joined, siaCoin: false };
}

/** 대원·무기 바꾸기 → 못 바꾸는 까닭 (없으면 null) */
export function setLoadout(p: TwelveProfile, hero: string, weapon: string): string | null {
  if (!isHero(hero)) return 'bad hero';
  if (!heroesOf(p).includes(hero)) return 'hero locked';
  if (!(WEAPON_KINDS as readonly string[]).includes(weapon)) return 'bad weapon';
  p.hero = hero;
  p.weapon = weapon as WeaponKind;
  return null;
}

/** 지형 보스를 잡으면 합류하는 대원 이름 (지형 화면 안내) */
export const joinText = (region: number) => {
  const h = joinsAt(region);
  return h ? `보스를 처음 잡으면 ${h.name}(${h.animal})가 합류해요` : '';
};

/** 서버·기기가 거절한 까닭 → 화면 글 */
export function whyText(why: string): string {
  switch (why) {
    case 'map locked': return '아직 열리지 않은 맵이에요';
    case 'hero locked': return '아직 합류하지 않은 대원이에요';
    case 'too early': return '너무 빨리 끝난 판이라 기록되지 않았어요';
    case 'need login': return '로그인이 필요해요';
    default: return why.startsWith('bad ') ? '기록할 수 없는 결과예요' : '서버에 연결하지 못했어요. 잠시 뒤 다시 해 주세요';
  }
}

export { STARTERS, heroOf };
