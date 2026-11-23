import { EXTRA_HERO_IDS, HERO_IDS, HEROES, isExtraHero, MAX_LEVEL, MAX_TURNS, STAGES, TOWER_TURNS, isHeroId, stageOf, type HeroId, type RunResult, type RunSnapshot, type UpgradeKey, type Upgrades } from '../sim';
import { REGIONS } from '../data/regions';
import { clearCoins, failCoins, levelCost, levelOf, rewardFor, totalCoins, towerCoins, upgradeCost, upgradeLv, upgradeOf } from '../data/growth';

/**
 * 판 밖 기록 규칙 (PRD "성장·재화", "서버와 검증"). 서버(067_finger.sql 의 finger_start · finger_finish_verified 등)가
 * 같은 규칙으로 다시 계산한다. 테스트 모드(?local=1)는 이 파일의 규칙으로 기기에서만 저장한다.
 * 지역 열기·대원 합류 규칙은 돌격대와 같다.
 */

export interface FingerProfile {
  /** 엽전 (시아핑거 전용 지갑) */
  coins: number;
  /** 스테이지 id → 딴 별 (클리어한 스테이지만) */
  stages: Record<string, number>;
  /** 공통 강화 단계 */
  upgrades: Upgrades;
  /** 대원 → 레벨 (없으면 1) */
  levels: Partial<Record<HeroId, number>>;
  /** 끝없는 탑 최고 기록 (올라간 층 · 그때 쓴 턴). 없으면 null */
  tower: { floor: number; turns: number } | null;
  /** 시아코인으로 연 추가 대원 (고양이). 서버 _finger_profile_json 의 owned (077), 로비에서 사고 오면 다시 읽는다 */
  owned: HeroId[];
}

export const emptyProfile = (): FingerProfile => ({ coins: 0, stages: {}, upgrades: {}, levels: {}, tower: null, owned: [] });

/** 서버·기기에서 읽은 값을 프로필 모양으로 (모르는 값은 버린다) */
export function normalize(p: unknown): FingerProfile {
  const o = (p ?? {}) as Record<string, unknown>;
  const stages: Record<string, number> = {};
  for (const [k, v] of Object.entries((o.stages as Record<string, unknown>) ?? {})) {
    const n = Math.max(0, Math.min(3, Math.floor(Number(v) || 0)));
    if (stageOf(k) && n > 0) stages[k] = n;
  }
  const upgrades: Upgrades = {};
  for (const [k, v] of Object.entries((o.upgrades as Record<string, unknown>) ?? {})) {
    const u = upgradeOf(k);
    if (u) upgrades[u.key] = Math.max(0, Math.min(u.max, Math.floor(Number(v) || 0)));
  }
  const levels: Partial<Record<HeroId, number>> = {};
  for (const [k, v] of Object.entries((o.levels as Record<string, unknown>) ?? {})) if (isHeroId(k)) levels[k] = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(v) || 1)));
  const t = o.tower as { floor?: unknown; turns?: unknown } | null | undefined;
  const floor = Math.max(0, Math.floor(Number(t?.floor) || 0));
  const tower = floor > 0 ? { floor, turns: Math.max(0, Math.floor(Number(t?.turns) || 0)) } : null;
  const owned = EXTRA_HERO_IDS.filter((id) => Array.isArray(o.owned) && o.owned.includes(id));
  return { coins: Math.max(0, Math.floor(Number(o.coins) || 0)), stages, upgrades, levels, tower, owned };
}

/** 서버 검증 값 (SQL _finger_const 와 같다) */
export const LIMITS = {
  /** 한 턴에 드는 최소 시간 (조준 + 멈춘 뒤 기다림, 초) */
  turnMinTime: 0.4,
  /** 날아가는 스텝을 2배속으로 볼 때 1초에 지나는 스텝 수 (1/60초 × 2배속) */
  stepRate: 120,
  /** 서버가 잰 시간과의 여유 (초) */
  timeSlack: 2,
  /** 시작한 지 이보다 오래된 스테이지 판은 받지 않는다 (초) */
  maxAge: 7200,
  /** 끝없는 탑 판은 200턴까지라 더 오래 받는다 (초, 070) */
  towerMaxAge: 21600,
  /** 시아코인을 받는 최소 판 시간 (서버 경과, 초) */
  coinMinTime: 20,
  /** 한 판 최대 턴 */
  maxTurns: MAX_TURNS,
  /** 끝없는 탑 한 판 최대 턴 */
  towerTurns: TOWER_TURNS,
};

/** 판이 끝날 수 있는 가장 짧은 시간 (초): 턴 수 × 턴 최소 시간 + 날아간 스텝 / 2배속 */
export const minRunTime = (turns: number, steps: number) => turns * LIMITS.turnMinTime + steps / LIMITS.stepRate;

export const cleared = (p: FingerProfile, id: string) => (p.stages[id] ?? 0) > 0;
export const totalStars = (p: FingerProfile) => Object.values(p.stages).reduce((a, b) => a + b, 0);
export const clearedCount = (p: FingerProfile) => Object.keys(p.stages).length;
export const regionStarsOf = (p: FingerProfile, r: number) => STAGES.filter((s) => s.region === r).reduce((a, s) => a + (p.stages[s.id] ?? 0), 0);

/** 지역 r 을 여는 데 필요한 별 (+ 앞 지역 5번째 스테이지 클리어). 돌격대와 같다 */
export const regionStars = (region: number) => (region <= 1 ? 0 : (region - 1) * 9);

export function regionOpen(p: FingerProfile, r: number): boolean {
  if (r <= 1) return true;
  if (r > REGIONS) return false;
  return cleared(p, `${r - 1}-5`) && totalStars(p) >= regionStars(r);
}

/** 끝없는 탑: 1-5 를 깨면 열린다 */
export const towerOpen = (p: FingerProfile) => cleared(p, '1-5');

export function stageOpen(p: FingerProfile, id: string): boolean {
  const st = stageOf(id);
  if (!st || !regionOpen(p, st.region)) return false;
  return st.no === 1 || cleared(p, `${st.region}-${st.no - 1}`);
}

/**
 * 추가 대원(고양이)을 쓸 수 있나 — 잠금 판단은 이 한 곳. 지역 합류와 상관없이 시아코인으로 계정마다 연다
 * (서버 _check_character 가 'locked character' 로 막는다). heroesOf · 파티 고르기 · 시작 검사 · 레벨 올리기가 이걸 따른다.
 */
export const extraOpen = (p: FingerProfile, id: HeroId): boolean => (p.owned ?? []).includes(id);

/** 합류한 대원: 처음 3종 + 합류 지역의 5번째 스테이지를 깬 대원 (십이지 순서) + 연 추가 대원 */
export function heroesOf(p: FingerProfile): HeroId[] {
  const zodiac: HeroId[] = HERO_IDS.filter((id) => HEROES[id].unlockRegion === 0 || cleared(p, `${HEROES[id].unlockRegion}-5`));
  return [...zodiac, ...EXTRA_HERO_IDS.filter((id) => extraOpen(p, id))];
}

/** 판에 들고 갈 파티: 마지막 파티 중 합류한 대원만, 비었으면 합류한 대원 앞에서 4명 */
export function partyOf(p: FingerProfile, last: HeroId[]): HeroId[] {
  const open = heroesOf(p);
  const party = last.filter((id) => open.includes(id));
  return party.length ? party : open.slice(0, 4);
}

// ---------- 마지막 파티 (기기에만) ----------

const PARTY_KEY = (user: string) => `siafinger:party:${user}`;

export function loadParty(user: string): HeroId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PARTY_KEY(user)) ?? '[]') as unknown;
    return Array.isArray(raw) ? [...new Set(raw.filter(isHeroId))].slice(0, 4) : [];
  } catch {
    return [];
  }
}

export function saveParty(user: string, party: HeroId[]) {
  try {
    localStorage.setItem(PARTY_KEY(user), JSON.stringify(party));
  } catch {
    /* 저장 공간 없음 */
  }
}

// ---------- 판 시작 · 끝 ----------

/** 시작할 수 있는가 (서버 finger_start 와 같은 기준) → 틀리면 까닭 */
export function checkStart(p: FingerProfile, stage: string, party: string[], mode = 'normal'): string | null {
  if (mode !== 'normal' && mode !== 'tower') return 'bad mode';
  if (mode === 'tower') {
    if (!towerOpen(p)) return 'tower locked';
  } else {
    if (!stageOf(stage)) return 'bad stage';
    if (!stageOpen(p, stage)) return 'stage locked';
  }
  if (!Array.isArray(party) || party.length < 1 || party.length > 4 || new Set(party).size !== party.length || !party.every(isHeroId)) return 'bad party';
  // 서버와 같은 순서: 공용 캐릭터 검사(안 연 고양이)가 먼저
  if (party.some((id) => isExtraHero(id as HeroId) && !extraOpen(p, id as HeroId))) return 'locked character';
  const open = heroesOf(p);
  if (!party.every((id) => open.includes(id as HeroId))) return 'hero locked';
  return null;
}

/** 판 시작 때의 스냅숏 (서버는 finger_runs 에 같은 값을 남긴다): 파티 대원 레벨 + 강화 */
export function snapshotOf(p: FingerProfile, stage: string, party: HeroId[], mode: 'normal' | 'tower' = 'normal'): RunSnapshot {
  const levels: Record<string, number> = {};
  for (const id of party) levels[id] = levelOf(p.levels, id);
  const upgrades: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.upgrades)) if (v) upgrades[k] = v;
  return { stage: mode === 'tower' ? 'tower' : stage, mode, party: [...party], levels, upgrades };
}

export interface FinishResult {
  /** 받은 엽전 */
  coins: number;
  /** 이번 판 별 (실패 · 끝없는 탑 0) */
  stars: number;
  /** 끝없는 탑: 올라간 층 (스테이지 0) */
  floors?: number;
  /** 첫 클리어 */
  first: boolean;
  /** 별이 늘었다 (끝없는 탑: 최고 기록을 고쳤다) */
  best: boolean;
  /** 시아코인을 받았다 */
  siaCoin: boolean;
  /** 이번에 새로 합류한 대원 */
  newHeroes: HeroId[];
}

/** 다시 계산한 결과를 프로필에 반영 (finger_finish_verified 와 같은 식). up = 판 시작 때 강화 */
export function applyResult(p: FingerProfile, stage: string, r: RunResult, up: Upgrades): FinishResult {
  if (stage === 'tower') return applyTower(p, r, up);
  const rw = rewardFor(stage);
  if (!rw) throw new Error('bad stage');
  const before = heroesOf(p);
  let raw: number;
  let stars = 0;
  let first = false;
  let best = false;
  if (r.cleared) {
    stars = r.stars;
    first = !cleared(p, stage);
    raw = clearCoins(rw, stars) + (first ? rw.first : 0);
    if (stars > (p.stages[stage] ?? 0)) {
      p.stages[stage] = stars;
      best = true;
    }
  } else raw = failCoins(rw, r.wave, r.waves);
  const coins = totalCoins(raw, r.coins, up);
  p.coins += coins;
  return { coins, stars, first, best, siaCoin: false, newHeroes: heroesOf(p).filter((id) => !before.includes(id)) };
}

/** 끝없는 탑 결과 (finger_finish_verified 의 tower 갈래와 같은 식): 엽전 = 층 엽전 + 주운 엽전 (엽전 강화), 기록은 더 높은 층 · 같은 층이면 적은 턴 */
function applyTower(p: FingerProfile, r: RunResult, up: Upgrades): FinishResult {
  const floors = r.floors;
  const old = p.tower;
  const best = floors >= 1 && (!old || floors > old.floor || (floors === old.floor && r.turns < old.turns));
  if (best) p.tower = { floor: floors, turns: r.turns };
  const coins = totalCoins(towerCoins(floors), r.coins, up);
  p.coins += coins;
  return { coins, stars: 0, floors, first: false, best, siaCoin: false, newHeroes: [] };
}

// ---------- 강화 · 레벨 ----------

/** 강화 사기 (프로필을 고친다). 엽전이 모자라거나 최대면 까닭 */
export function buyUpgrade(p: FingerProfile, key: UpgradeKey): string | null {
  const u = upgradeOf(key);
  if (!u) return 'bad upgrade';
  const lv = upgradeLv(p.upgrades, u.key);
  if (lv >= u.max) return 'max level';
  const cost = upgradeCost(u, lv);
  if (p.coins < cost) return 'not enough coins';
  p.coins -= cost;
  p.upgrades[u.key] = lv + 1;
  return null;
}

/** 대원 레벨 올리기 (프로필을 고친다) */
export function levelUp(p: FingerProfile, id: string): string | null {
  if (!isHeroId(id)) return 'bad hero';
  if (isExtraHero(id) && !extraOpen(p, id)) return 'locked character';
  if (!heroesOf(p).includes(id)) return 'hero locked';
  const lv = levelOf(p.levels, id);
  if (lv >= MAX_LEVEL) return 'max level';
  const cost = levelCost(lv);
  if (p.coins < cost) return 'not enough coins';
  p.coins -= cost;
  p.levels[id] = lv + 1;
  return null;
}

/** 잠긴 고양이 안내 (선택 화면 칸 · shared/characters.js 의 LOCK_HINT 와 같은 글) · 서버 거절 'locked character' */
export const LOCK_HINT = '로비에서 열 수 있어요';
export const CAT_LOCKED_TEXT = '고양이는 로비에서 시아코인으로 열 수 있어요';

/** 서버가 거절한 까닭 → 화면 글 */
export function whyText(why: string): string {
  const m: Record<string, string> = {
    'stage locked': '아직 열리지 않은 스테이지예요',
    'hero locked': '아직 합류하지 않은 대원이 있어요',
    'locked character': CAT_LOCKED_TEXT,
    'bad character': '파티를 다시 골라 주세요',
    'bad party': '파티를 다시 골라 주세요 (1~4명, 같은 대원 없이)',
    'bad stage': '아직 준비 중인 스테이지예요',
    'not enough coins': '엽전이 모자라요',
    'max level': '이미 최대예요',
    'need login': '다시 로그인해 주세요',
    'too early': '판이 너무 빨리 끝나서 기록하지 않았어요',
    'too late': '너무 오래된 판이라 기록하지 않았어요',
    overlap: '다른 판과 시간이 겹쳐서 기록하지 않았어요',
    'already finished': '이미 기록된 판이에요',
    'no run': '서버에 없는 판이에요',
    'extra inputs': '판 기록이 맞지 않아 받지 않았어요',
    'too many turns': `${MAX_TURNS}턴(끝없는 탑 ${TOWER_TURNS}턴)을 넘은 기록은 받지 않아요`,
    'tower locked': '끝없는 탑은 1-5 를 깨면 열려요',
    'bad inputs': '판 기록이 맞지 않아 받지 않았어요',
    'old rules': '게임이 새로 바뀌어 이 판은 기록하지 못했어요. 새로고침해 주세요',
  };
  return m[why] ?? '서버가 받아 주지 않았어요';
}
