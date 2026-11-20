import { ConfigError, buildConfig } from './config.ts';
import { HERO_IDS, isHeroId, type HeroId, type UpgradeKey, type Upgrades } from './heroes.ts';
import { MAX_TURNS, POWER_MAX, TOWER_TURNS, replayRun, type RunResult, type ShotInput } from './sim.ts';

/**
 * 서버 다시 돌리기 (PRD "서버와 검증"). Edge Function finger-finish 와 테스트가 같은 함수를 부른다.
 * 판 시작 때 DB(finger_runs)에 남긴 스냅숏(스테이지 · 파티 · 레벨 · 강화)으로 설정을 만들고,
 * 화면이 보낸 조작 목록으로 판을 처음부터 다시 돌려 결과를 직접 계산한다.
 * 화면이 보낸 결과 값은 받지 않는다.
 */

/** finger_runs 에 남은 판 시작 때의 값 */
export interface RunSnapshot {
  stage: string;
  mode: string;
  /** 쏘는 순서 */
  party: string[];
  /** 대원 → 레벨 (시작 때) */
  levels: Record<string, number>;
  /** 공통 강화 (시작 때) */
  upgrades: Record<string, number>;
}

/** 다시 돌리기를 거절한 까닭 (Edge Function 이 그대로 돌려준다) */
export class VerifyError extends Error {}

/**
 * 규칙 판 번호: 같은 조작 목록이 다른 결과를 내게 시뮬레이션·스테이지·대원 값을 바꾸면 1 올린다 (맞고 MATGO_RULES 와 같은 뜻).
 * 화면은 판을 시작할 때의 번호를 결과와 함께 보내고, 서버(finger-finish)는 다르면 'old rules' 로 거절한다 — 예전 화면이 깬 판을 새 규칙으로 다시 돌려 엉뚱한 결과를 남기지 않게.
 */
export const FINGER_RULES = 1;

/** 한 판에 받는 조작 수 상한 (= 판의 최대 턴) */
export const MAX_INPUTS = MAX_TURNS;
/** 끝없는 탑 한 판에 받는 조작 수 상한 */
export const MAX_TOWER_INPUTS = TOWER_TURNS;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** 조작 목록 검사: 정규화 없이 정확한 정수 범위만 받는다 (화면은 이미 정규화한 s.log 를 보낸다) */
export function checkInputs(inputs: unknown, max = MAX_INPUTS): ShotInput[] {
  if (!Array.isArray(inputs)) throw new VerifyError('bad inputs');
  if (inputs.length > max) throw new VerifyError('too many turns');
  const out: ShotInput[] = [];
  for (const i of inputs) {
    if (!i || typeof i !== 'object') throw new VerifyError('bad inputs');
    const { a, p, s } = i as Record<string, unknown>;
    if (!isInt(a) || a < 0 || a > 3599) throw new VerifyError('bad inputs');
    if (!isInt(p) || p < 1 || p > POWER_MAX) throw new VerifyError('bad inputs');
    if (s !== 0 && s !== 1) throw new VerifyError('bad inputs');
    out.push({ a, p, s });
  }
  return out;
}

const UP_KEYS: UpgradeKey[] = ['hp', 'charge', 'heal', 'coin'];

/** 스냅숏 → buildConfig 입력 (모르는 값은 버린다) */
function snapLevels(snap: RunSnapshot): Partial<Record<HeroId, number>> {
  const out: Partial<Record<HeroId, number>> = {};
  for (const id of HERO_IDS) {
    const v = Number(snap.levels?.[id]);
    if (Number.isFinite(v)) out[id] = v;
  }
  return out;
}
function snapUpgrades(snap: RunSnapshot): Upgrades {
  const out: Upgrades = {};
  for (const k of UP_KEYS) {
    const v = Number(snap.upgrades?.[k]);
    if (Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * 스냅숏 + 조작 목록 → 다시 계산한 결과. 틀리면 VerifyError:
 *  · 'bad inputs' 조작 모양이 틀림 · 'too many turns' 40턴(끝없는 탑 200턴) 넘음 · 'extra inputs' 판이 끝난 뒤에도 조작이 남음
 *  · 'bad mode' · 'bad stage' · 'bad party' 스냅숏이 틀림
 * 판이 끝나지 않은 결과(ended = false)는 '그만하기'로 끝낸 실패 판이다.
 */
export function verifyRun(snap: RunSnapshot, inputs: unknown): RunResult {
  if (!snap || (snap.mode !== 'normal' && snap.mode !== 'tower')) throw new VerifyError('bad mode');
  const tower = snap.mode === 'tower';
  if (!Array.isArray(snap.party) || !snap.party.every(isHeroId)) throw new VerifyError('bad party');
  const list = checkInputs(inputs, tower ? MAX_TOWER_INPUTS : MAX_INPUTS);
  let cfg;
  try {
    cfg = buildConfig({ stage: snap.stage, mode: tower ? 'tower' : 'normal', party: snap.party, levels: snapLevels(snap), upgrades: snapUpgrades(snap) });
  } catch (e) {
    if (e instanceof ConfigError) throw new VerifyError(e.message === 'stage' ? 'bad stage' : 'bad party');
    throw e;
  }
  const r = replayRun(cfg, list);
  if (r.extra > 0) throw new VerifyError('extra inputs');
  return r;
}
