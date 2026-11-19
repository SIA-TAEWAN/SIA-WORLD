import { LEADERS, METER, RUN_SPEED, leaderOf, type ZodiacId } from '../data/balance';
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
import { ENDLESS_ID, ENDLESS_SEG, STAGES, crateCoinsOf, stageOf } from '../data/stages';
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

/** 판 하나의 결과 (화면 → 서버) */
export interface RunReport {
  /** 서버가 charge_start 로 준 판 번호 (기록되지 않는 판은 '') */
  run: string;
  stage: string;
  leader: ZodiacId;
  mode: 'normal' | 'endless';
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
  newLeaders: ZodiacId[];
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
export const leadersOf = (p: ChargeProfile) => unlockedLeaders((id) => cleared(p, id));

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
  const endless = r.mode === 'endless';
  if (endless !== (r.stage === ENDLESS_ID)) return 'bad stage';
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
  if (r.mode === 'endless') {
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
export function checkStart(p: ChargeProfile, stage: string, leader: string, mode: 'normal' | 'endless'): string | null {
  if (!LEADERS.some((l) => l.id === leader)) return 'bad leader';
  if (!leadersOf(p).includes(leader as ZodiacId)) return 'leader locked';
  if (mode === 'endless') return stage === ENDLESS_ID ? (endlessOpen(p) ? null : 'endless locked') : 'bad stage';
  if (!stageOf(stage)) return 'bad stage';
  return stageOpen(p, stage) ? null : 'stage locked';
}

/** 서버가 거절한 까닭 → 화면 글 */
export function whyText(why: string): string {
  const m: Record<string, string> = {
    'stage locked': '아직 열리지 않은 스테이지예요',
    'leader locked': '아직 열리지 않은 대장이에요',
    'endless locked': '끝없는 모드는 1-5를 깨면 열려요',
    'not enough coins': '엽전이 모자라요',
    'max level': '이미 최대 강화예요',
    'need login': '다시 로그인해 주세요',
  };
  return m[why] ?? '서버가 받아 주지 않았어요';
}

/** 지역의 별 합 */
export const regionStarsOf = (p: ChargeProfile, region: number) =>
  STAGES.filter((s) => s.region === region).reduce((a, s) => a + (p.stages[s.id] ?? 0), 0);
