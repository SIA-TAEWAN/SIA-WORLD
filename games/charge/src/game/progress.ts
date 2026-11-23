import { LEADERS, METER, RUN_SPEED, leaderOf, type LeaderId } from '../data/balance';
import {
  UPGRADES,
  clearCoins,
  endlessCoins,
  failCoins,
  firstCoins,
  modsOf,
  regionStars,
  totalCoins,
  unlockedLeaders,
  upgradeCost,
  type UpgradeKey,
  type Upgrades,
} from '../data/growth';
import { DAILY_ID, ENDLESS_ID, ENDLESS_SEG, STAGES, crateCoinsOf, stageOf } from '../data/stages';
import { starsOf } from './sim';

/**
 * 판 밖 기록 규칙 (PRD 9·11장). 서버(061_charge.sql 의 charge_finish 등)가 같은 규칙으로 다시 계산한다.
 * 테스트 모드(?local=1)는 이 파일의 규칙으로 기기에서만 저장한다.
 */

export interface ChargeProfile {
  coins: number;
  /** 스테이지 → 최고 별 (클리어한 스테이지만) */
  stages: Record<string, number>;
  upgrades: Upgrades;
  /** 끝없는 모드 최고 기록 */
  endless: { meters: number; leader: string } | null;
}

export const emptyProfile = (): ChargeProfile => ({ coins: 0, stages: {}, upgrades: {}, endless: null });

/** 'daily' = 오늘의 도전(오늘의 길): 끝없는 길과 같은 규칙, 기록은 오늘 순위에만 */
export type RunMode = 'normal' | 'endless' | 'daily';

/** 판 하나의 결과 (화면 → 서버) */
export interface RunReport {
  /** 서버가 charge_start 로 준 판 번호 (기록되지 않는 판은 '') */
  run: string;
  stage: string;
  leader: LeaderId;
  mode: RunMode;
  /** 판 시간 (초, 내림) */
  time: number;
  cleared: boolean;
  troops: number;
  kills: number;
  /** 0~1 (실패한 판의 엽전) */
  progress: number;
  meters: number;
  bosses: number;
  /** 상자에서 얻은 엽전 */
  crate: number;
}

export interface FinishResult {
  coins: number;
  stars: number;
  first: boolean;
  /** 별이 늘었다 · 끝없는 모드 기록이 늘었다 */
  best: boolean;
  /** 시아코인을 받았다 */
  siaCoin: boolean;
  /** 이번에 새로 열린 대장 */
  newLeaders: LeaderId[];
  /** 오늘의 도전 판: 기록된 날 · 오늘 기록이 늘었는지 · 오늘 최고 거리 (기록하지 못했으면 없음) */
  daily?: { day: string; improved: boolean; best: number } | null;
}

/** 서버 검증 값 (SQL _charge_const 와 같다) */
export const LIMITS = {
  /** 스테이지 판의 최대 시간 */
  maxTime: 600,
  endlessMaxTime: 3600,
  /** 클리어하려면 적어도 이만큼 달려야 한다 (보스 앞까지 50초쯤) */
  clearMinTime: 45,
  /** 서버가 잰 시간과의 여유 */
  timeSlack: 3,
  maxTroops: 9999,
  /** 시아코인을 받는 최소 판 시간 */
  coinMinTime: 20,
};

export const totalStars = (p: ChargeProfile) => Object.values(p.stages).reduce((a, b) => a + b, 0);
export const cleared = (p: ChargeProfile, id: string) => (p.stages[id] ?? 0) > 0;
/** 고양이를 여는 값 (시아코인). shared/characters.js 의 CHARACTER_PRICE.cat · SQL _character_price 와 같다 (tests/progress.test.ts 가 대조) */
export const CAT_PRICE = 100;
/** 잠긴 고양이 칸의 버튼 글 (shared/characters.js 의 unlockLabel('cat') 과 같은 글) */
export const UNLOCK_LABEL = `시아코인 ${CAT_PRICE}개로 열기`;
/** 이 게임(charge)에서 시아코인으로 연 추가 캐릭터 (shared/characters.js 의 loadOwnedCharacters('charge') 결과. 테스트 모드는 net/local.ts 가 정한다) */
let ownedExtras: string[] = [];
export const setOwnedExtras = (ids: readonly string[]) => {
  ownedExtras = [...ids];
};
/**
 * 추가 캐릭터(고양이)를 고를 수 있는가: 진행으로는 열리지 않고, 이 게임의 대장 고르기 화면에서 시아코인으로 연 사람만
 * (게임마다 따로 연다. 서버 _check_character(user, id, 'charge') 의 'locked character').
 * 선택 화면·시작 검사·저장된 대장 복원이 모두 leadersOf 를 거쳐 여기를 본다.
 */
export const extraOpen = (_p: ChargeProfile, id: LeaderId) => ownedExtras.includes(id);

/** 고양이 구매 조건: 이 스테이지를 클리어 (서버 075 의 _cat_progress_charge 와 같다, tests/sql.test.ts 가 대조) */
export const CAT_STAGE = '3-5';
/** 고양이를 살 수 있는가 (조건만. 서버 buy_character 가 같은 기록으로 다시 확인한다) */
export const catReady = (p: ChargeProfile) => cleared(p, CAT_STAGE);
/** 잠긴 동안 보여 줄 남은 조건 글: "3-5 스테이지를 클리어하면 열 수 있어요 · 지금 2-4까지" */
export function catConditionText(p: ChargeProfile): string {
  const far = [...STAGES].reverse().find((s) => cleared(p, s.id));
  return `${CAT_STAGE} 스테이지를 클리어하면 열 수 있어요 · ${far ? `지금 ${far.id}까지` : '아직 클리어한 스테이지가 없어요'}`;
}
/** 고를 수 있는 대장: 진행으로 열린 십이지 + 열린 추가 캐릭터 (LEADERS 순서) */
export const leadersOf = (p: ChargeProfile): LeaderId[] => [
  ...unlockedLeaders((id) => cleared(p, id)),
  ...LEADERS.filter((l) => l.extra && extraOpen(p, l.id)).map((l) => l.id),
];

export function regionOpen(p: ChargeProfile, region: number): boolean {
  if (region <= 1) return true;
  return cleared(p, `${region - 1}-5`) && totalStars(p) >= regionStars(region);
}

export function stageOpen(p: ChargeProfile, id: string): boolean {
  const st = stageOf(id);
  if (!st) return false;
  if (!regionOpen(p, st.region)) return false;
  return st.no === 1 || cleared(p, `${st.region}-${st.no - 1}`);
}

export const endlessOpen = (p: ChargeProfile) => cleared(p, '1-5');

/** 판 결과 검사 (서버와 같은 기준. 시간 겹침·경과 시간은 서버만 본다) → 틀리면 까닭 */
export function checkReport(r: RunReport): string | null {
  const endless = r.mode !== 'normal';
  if ((r.mode === 'endless') !== (r.stage === ENDLESS_ID) || (r.mode === 'daily') !== (r.stage === DAILY_ID)) return 'bad stage';
  if (!endless && !stageOf(r.stage)) return 'bad stage';
  if (![r.time, r.troops, r.kills, r.progress, r.meters, r.bosses, r.crate].every(Number.isFinite)) return 'bad result';
  if (r.time < 0 || r.time > (endless ? LIMITS.endlessMaxTime : LIMITS.maxTime)) return 'bad time';
  if (r.troops < 0 || r.troops > LIMITS.maxTroops || r.kills < 0 || r.crate < 0 || r.progress < 0 || r.progress > 1) return 'bad result';
  if (endless) {
    if (r.cleared) return 'bad result';
    if (r.meters > (r.time * RUN_SPEED) / METER + 5) return 'bad result';
    if (r.bosses > Math.floor((r.meters * METER) / ENDLESS_SEG) + 1) return 'bad result';
  } else if (r.cleared && (r.time < LIMITS.clearMinTime || r.troops < 1)) return 'bad result';
  return null;
}

/** 판 결과 반영 (프로필을 고친다) → 결과 */
export function applyReport(p: ChargeProfile, r: RunReport): FinishResult {
  const why = checkReport(r);
  if (why) throw new Error(why);
  const leaderMul = leaderOf(r.leader).coinMul;
  const coinMul = modsOf(p.upgrades).coinMul;
  const before = leadersOf(p);
  let raw = 0;
  let crate = 0;
  let stars = 0;
  let first = false;
  let best = false;
  if (r.mode === 'daily') {
    // 오늘의 길: 엽전은 끝없는 길과 같고, 끝없는 길 최고 기록은 건드리지 않는다
    raw = endlessCoins(r.meters, r.bosses);
  } else if (r.mode === 'endless') {
    raw = endlessCoins(r.meters, r.bosses);
    if (!p.endless || r.meters > p.endless.meters) {
      p.endless = { meters: r.meters, leader: r.leader };
      best = true;
    }
  } else {
    const st = stageOf(r.stage)!;
    crate = Math.min(r.crate, Math.round(crateCoinsOf(st.items) * 1.2));
    if (r.cleared) {
      stars = starsOf(st, r.troops);
      first = !cleared(p, st.id);
      raw = clearCoins(st.region, stars) + (first ? firstCoins(st.region) : 0);
      if (stars > (p.stages[st.id] ?? 0)) {
        p.stages[st.id] = stars;
        best = true;
      }
    } else raw = failCoins(st.region, r.progress);
  }
  const coins = totalCoins(raw, crate, coinMul, leaderMul);
  p.coins += coins;
  const after = leadersOf(p);
  return { coins, stars, first, best, siaCoin: false, newLeaders: after.filter((id) => !before.includes(id)) };
}

/** 강화 사기 (엽전이 모자라거나 최대면 까닭) */
export function buyUpgrade(p: ChargeProfile, key: UpgradeKey): string | null {
  const u = UPGRADES.find((x) => x.key === key);
  if (!u) return 'bad upgrade';
  const lv = p.upgrades[key] ?? 0;
  if (lv >= u.max) return 'max level';
  const cost = upgradeCost(u, lv);
  if (p.coins < cost) return 'not enough coins';
  p.coins -= cost;
  p.upgrades[key] = lv + 1;
  return null;
}

/** 시작할 수 있는가 (잠긴 스테이지·대장이면 까닭) */
export function checkStart(p: ChargeProfile, stage: string, leader: string, mode: RunMode): string | null {
  const def = LEADERS.find((l) => l.id === leader);
  if (!def) return 'bad leader';
  if (def.extra && !extraOpen(p, def.id)) return 'locked character';
  if (!leadersOf(p).includes(leader as LeaderId)) return 'leader locked';
  if (mode === 'daily') return stage === DAILY_ID ? null : 'bad stage';
  if (mode === 'endless') return stage === ENDLESS_ID ? (endlessOpen(p) ? null : 'endless locked') : 'bad stage';
  if (!stageOf(stage)) return 'bad stage';
  return stageOpen(p, stage) ? null : 'stage locked';
}

/** 서버가 거절한 까닭 → 화면 글 */
export function whyText(why: string): string {
  const m: Record<string, string> = {
    'stage locked': '아직 열리지 않은 스테이지예요',
    'leader locked': '아직 열리지 않은 대장이에요',
    'locked character': `고양이는 캐릭터 고르기 화면에서 시아코인 ${CAT_PRICE}개로 열 수 있어요`,
    'endless locked': '끝없는 모드는 1-5를 깨면 열려요',
    'not enough coins': '엽전이 모자라요',
    'max level': '이미 최대 강화예요',
    'need login': '다시 로그인해 주세요',
    'bad day': '날짜가 바뀌었어요. 새 길을 준비했어요',
  };
  return m[why] ?? '서버가 받아 주지 않았어요';
}

/** 지역의 별 합 */
export const regionStarsOf = (p: ChargeProfile, region: number) =>
  STAGES.filter((s) => s.region === region).reduce((a, s) => a + (p.stages[s.id] ?? 0), 0);
