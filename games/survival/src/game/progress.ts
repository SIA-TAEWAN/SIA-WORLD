/**
 * 판 밖 성장 (PRD 7·11장): 엽전 · 영구 강화 · 해금 · 최고 기록 · 도감의 규칙.
 * 진짜 계산은 서버 함수가 한다 (supabase/migrations/038_survival.sql). 여기는 같은 규칙의 순수 함수로,
 *   · 테스트 모드(?local=1)의 기기 저장 프로필이 쓰고
 *   · 화면이 "살 수 있나 · 얼마인가 · 무엇이 잠겼나" 를 보여 줄 때 쓰고
 *   · tests/sql.test.ts 가 SQL의 표·상수와 같은지 비교한다.
 * 시간 단위는 모두 초.
 */
import { RUN_SEC, ZODIAC_IDS, type ZodiacId } from '../data/balance';
import { BOSSES } from '../data/bosses';
import { CHARACTERS, CHARACTER_BY_ID } from '../data/characters';
import { ENEMIES } from '../data/enemies';
import { EVOLUTIONS } from '../data/evolutions';
import { MAPS, MAP_INDEX } from '../data/maps';
import { PASSIVES, PASSIVE_INDEX, type PassiveDef } from '../data/passives';
import { UPGRADES, UPGRADE_BY_ID, upgradeCost, upgradeSpent, type UpgradeLevels } from '../data/upgrades';
import { WEAPONS, WEAPON_INDEX, type WeaponDef } from '../data/weapons';
import type { Codex, RunSummary } from './sim';

/** 판 밖에 저장하는 것 (survival_profiles) */
export interface SurvivalProfile {
  coins: number;
  /** 영구 강화: 항목 id → 레벨 */
  upgrades: UpgradeLevels;
  unlockedCharacters: ZodiacId[];
  unlockedMaps: string[];
  codex: Codex;
  /** 해금 조건용 누적 값 */
  totals: { kills: number; cakes: number; bestTime: number; bossKills: number; clears: number; runs: number };
}

/** 맵별 최고 기록 (survival_records) */
export interface SurvivalRecord {
  time: number;
  kills: number;
  cleared: boolean;
  character: string;
  at: number;
}

/** 판을 끝낼 때 서버에 보내는 것 (survival_finish 의 인자) */
export interface RunReport extends RunSummary {
  /** survival_start 가 준 판 id */
  run: string;
}

/** 판을 끝낸 뒤 받는 것 */
export interface FinishResult {
  /** 받은 엽전 (상한을 넘으면 상한까지만) */
  coins: number;
  /** 비정상 기록이 아닌가 (false면 랭킹·해금·도감에 넣지 않는다) */
  valid: boolean;
  newRecord: boolean;
  unlockedCharacters: ZodiacId[];
  unlockedMaps: string[];
}

/** 판 검증 값. SQL의 _survival_const 와 같아야 한다 (열쇠 이름은 SQL 이름을 그대로 쓴다) */
export const LIMITS = {
  max_time: RUN_SEC,
  time_slack: 5,
  max_age: 604800,
  kills_base: 100,
  kills_per_sec: 30,
  level_base: 5,
  level_per_sec: 0.2,
  coins_base: 50,
  coins_per_sec: 3,
  cakes_base: 5,
  cakes_per_sec: 0.1,
  boss_max: 3,
  boss1_time: 180,
  coin_min_time: 60,
  codex_max: 40,
};

export function defaultProfile(): SurvivalProfile {
  return {
    coins: 0,
    upgrades: {},
    unlockedCharacters: CHARACTERS.filter((c) => c.unlock.kind === 'base').map((c) => c.id),
    unlockedMaps: [MAPS[0].id],
    codex: { enemies: [], bosses: [], weapons: [], passives: [] },
    totals: { kills: 0, cakes: 0, bestTime: 0, bossKills: 0, clears: 0, runs: 0 },
  };
}

const strings = (v: unknown, allow?: readonly string[]): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && (!allow || allow.includes(x))))] : [];
const count = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

/** 서버·기기에서 읽은 값을 믿을 수 있는 모양으로 고친다 (빠진 칸은 처음 값) */
export function cleanProfile(raw: unknown): SurvivalProfile {
  const d = defaultProfile();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const up: UpgradeLevels = {};
  const ru = (r.upgrades && typeof r.upgrades === 'object' ? r.upgrades : {}) as Record<string, unknown>;
  for (const u of UPGRADES) {
    const lv = Math.min(u.max, count(ru[u.id]));
    if (lv > 0) up[u.id] = lv;
  }
  const chars = strings(r.unlockedCharacters, ZODIAC_IDS) as ZodiacId[];
  const maps = strings(r.unlockedMaps, MAPS.map((m) => m.id));
  const cx = (r.codex && typeof r.codex === 'object' ? r.codex : {}) as Record<string, unknown>;
  const tt = (r.totals && typeof r.totals === 'object' ? r.totals : {}) as Record<string, unknown>;
  return {
    coins: count(r.coins),
    upgrades: up,
    unlockedCharacters: [...new Set([...d.unlockedCharacters, ...chars])],
    unlockedMaps: [...new Set([...d.unlockedMaps, ...maps])],
    codex: {
      enemies: strings(cx.enemies, ENEMIES.map((e) => e.id)),
      bosses: strings(cx.bosses, BOSSES.map((e) => e.id)),
      weapons: strings(cx.weapons, WEAPONS.map((e) => e.id)),
      passives: strings(cx.passives, PASSIVES.map((e) => e.id)),
    },
    totals: { kills: count(tt.kills), cakes: count(tt.cakes), bestTime: count(tt.bestTime), bossKills: count(tt.bossKills), clears: count(tt.clears), runs: count(tt.runs) },
  };
}

/** 이 판에서 받을 수 있는 엽전의 상한 */
export const coinCap = (map: string, time: number) => Math.floor((LIMITS.coins_base + time * LIMITS.coins_per_sec) * (MAPS[MAP_INDEX[map] ?? 0].coinMul));

/** 비정상 기록인가: 상한을 넘는 값이 하나라도 있으면 false (서버의 valid 와 같은 판단) */
export function validRun(r: RunSummary): boolean {
  if (r.kills > LIMITS.kills_base + r.time * LIMITS.kills_per_sec) return false;
  if (r.level > LIMITS.level_base + r.time * LIMITS.level_per_sec) return false;
  if (r.cakes > LIMITS.cakes_base + r.time * LIMITS.cakes_per_sec) return false;
  if (r.bossKills > LIMITS.boss_max) return false;
  if (r.bossKills > 0 && r.time < LIMITS.boss1_time) return false;
  if (r.cleared && r.bossKills < 1) return false;
  if (r.coins > coinCap(r.map, r.time)) return false;
  return true;
}

/** 아예 받지 않는 보고인가 (서버가 오류로 거절하는 것) */
export function rejectReason(r: RunSummary, elapsedSec: number): string | null {
  const ints = [r.time, r.kills, r.level, r.coins, r.bossKills, r.cakes];
  if (ints.some((v) => !Number.isInteger(v))) return 'bad result';
  if (r.time < 0 || r.time > LIMITS.max_time) return 'bad time';
  if (r.kills < 0 || r.level < 1 || r.coins < 0 || r.bossKills < 0 || r.cakes < 0) return 'bad result';
  if (r.cleared && r.time !== LIMITS.max_time) return 'bad time';
  if (elapsedSec < r.time - LIMITS.time_slack) return 'too early';
  if (elapsedSec > LIMITS.max_age) return 'too late';
  return null;
}

/** 새 기록이 더 좋은가: 생존 시간 → 클리어 → 처치 수 (같으면 먼저 달성한 기록을 그대로 둔다) */
export function betterRecord(run: { time: number; kills: number; cleared: boolean }, old: SurvivalRecord | undefined): boolean {
  if (!old) return true;
  if (run.time !== old.time) return run.time > old.time;
  if (run.cleared !== old.cleared) return run.cleared;
  return run.kills > old.kills;
}

/** 캐릭터 해금 조건을 채웠나 (엽전으로 푸는 캐릭터는 언제나 false) */
export function characterEarned(id: ZodiacId, run: RunSummary, totals: SurvivalProfile['totals']): boolean {
  const u = CHARACTER_BY_ID[id].unlock;
  switch (u.kind) {
    case 'base':
      return true;
    case 'time':
      return run.time >= (u.value ?? 0);
    case 'boss':
      return run.bossKills >= (u.value ?? 1);
    case 'kills':
      return totals.kills >= (u.value ?? 0);
    case 'cakes':
      return totals.cakes >= (u.value ?? 0);
    case 'clear':
      return run.cleared;
    default:
      return false;
  }
}

const merge = (old: string[], add: string[], allow: string[]) => allow.filter((id) => old.includes(id) || add.slice(0, LIMITS.codex_max).includes(id));

/**
 * 판 결과를 프로필에 반영한다 (서버의 survival_finish 와 같은 규칙).
 * 엽전은 언제나 주고(상한까지), 정상 기록일 때만 누적 값·최고 기록·해금·도감에 넣는다.
 */
export function applyRun(
  profile: SurvivalProfile,
  records: Record<string, SurvivalRecord>,
  run: RunSummary,
  now: number,
): { profile: SurvivalProfile; records: Record<string, SurvivalRecord>; result: FinishResult } {
  const valid = validRun(run);
  const coins = Math.min(run.coins, coinCap(run.map, run.time));
  const p: SurvivalProfile = {
    ...profile,
    coins: profile.coins + coins,
    unlockedCharacters: [...profile.unlockedCharacters],
    unlockedMaps: [...profile.unlockedMaps],
    totals: { ...profile.totals },
  };
  const rec = { ...records };
  const result: FinishResult = { coins, valid, newRecord: false, unlockedCharacters: [], unlockedMaps: [] };
  if (!valid) return { profile: p, records: rec, result };

  p.totals.kills += run.kills;
  p.totals.cakes += run.cakes;
  p.totals.bestTime = Math.max(p.totals.bestTime, run.time);
  p.totals.bossKills += run.bossKills;
  p.totals.clears += run.cleared ? 1 : 0;
  p.totals.runs += 1;

  if (betterRecord(run, rec[run.map])) {
    rec[run.map] = { time: run.time, kills: run.kills, cleared: run.cleared, character: run.character, at: now };
    result.newRecord = true;
  }
  for (const c of CHARACTERS) {
    if (p.unlockedCharacters.includes(c.id) || !characterEarned(c.id, run, p.totals)) continue;
    p.unlockedCharacters.push(c.id);
    result.unlockedCharacters.push(c.id);
  }
  if (run.cleared) {
    const next = MAPS[(MAP_INDEX[run.map] ?? 0) + 1];
    if (next && !p.unlockedMaps.includes(next.id)) {
      p.unlockedMaps.push(next.id);
      result.unlockedMaps.push(next.id);
    }
  }
  p.codex = {
    enemies: merge(profile.codex.enemies, run.codex.enemies, ENEMIES.map((e) => e.id)),
    bosses: merge(profile.codex.bosses, run.codex.bosses, BOSSES.map((e) => e.id)),
    weapons: merge(profile.codex.weapons, run.codex.weapons, WEAPONS.map((e) => e.id)),
    passives: merge(profile.codex.passives, run.codex.passives, PASSIVES.map((e) => e.id)),
  };
  return { profile: p, records: rec, result };
}

/** 강화 한 레벨을 살 수 있나: 값 또는 까닭 */
export function upgradeOffer(profile: SurvivalProfile, id: string): { cost: number; level: number; ok: boolean; why: '' | 'max level' | 'not enough coins' | 'bad upgrade' } {
  const u = UPGRADE_BY_ID[id];
  if (!u) return { cost: 0, level: 0, ok: false, why: 'bad upgrade' };
  const level = profile.upgrades[id] ?? 0;
  if (level >= u.max) return { cost: 0, level, ok: false, why: 'max level' };
  const cost = upgradeCost(id, level);
  return { cost, level, ok: profile.coins >= cost, why: profile.coins >= cost ? '' : 'not enough coins' };
}

/** 강화 한 레벨 사기. 안 되면 까닭(서버가 내는 오류 글자와 같다)을 던진다 */
export function buyUpgrade(profile: SurvivalProfile, id: string): SurvivalProfile {
  const o = upgradeOffer(profile, id);
  if (!o.ok) throw new Error(o.why);
  return { ...profile, coins: profile.coins - o.cost, upgrades: { ...profile.upgrades, [id]: o.level + 1 } };
}

/** 강화 초기화: 쓴 엽전을 전액 돌려받는다 */
export function resetUpgrades(profile: SurvivalProfile): SurvivalProfile {
  return { ...profile, coins: profile.coins + upgradeSpent(profile.upgrades), upgrades: {} };
}

/** 엽전으로 푸는 캐릭터의 값 (그런 캐릭터가 아니면 null) */
export const characterPrice = (id: ZodiacId): number | null => (CHARACTER_BY_ID[id].unlock.kind === 'coins' ? (CHARACTER_BY_ID[id].unlock.value ?? 0) : null);

export function unlockCharacter(profile: SurvivalProfile, id: ZodiacId): SurvivalProfile {
  const price = characterPrice(id);
  if (price === null) throw new Error('bad character');
  if (profile.unlockedCharacters.includes(id)) throw new Error('already unlocked');
  if (profile.coins < price) throw new Error('not enough coins');
  return { ...profile, coins: profile.coins - price, unlockedCharacters: [...profile.unlockedCharacters, id] };
}

/** 모든 강화 레벨의 합 (0~49) */
export const upgradeCount = (levels: UpgradeLevels) => UPGRADES.reduce((n, u) => n + Math.min(u.max, levels[u.id] ?? 0), 0);

// ───────────────────────── 도감 (PRD 8장) ─────────────────────────

export interface EvolutionHint {
  weapon: WeaponDef;
  passive: PassiveDef;
  result: WeaponDef;
  /** 도감에 있는 것만 보여 준다 (없는 것은 ? 로 가린다) */
  weaponKnown: boolean;
  passiveKnown: boolean;
  resultKnown: boolean;
}

/** 진화 조합 힌트: 재료(무기·패시브)는 얻어 본 것만 보이고, 진화 무기는 한 번 만들어 봐야 보인다 */
export function evolutionHints(codex: Codex): EvolutionHint[] {
  return EVOLUTIONS.map((e) => ({
    weapon: WEAPONS[WEAPON_INDEX[e.weapon]],
    passive: PASSIVES[PASSIVE_INDEX[e.passive]],
    result: WEAPONS[WEAPON_INDEX[e.result]],
    weaponKnown: codex.weapons.includes(e.weapon),
    passiveKnown: codex.passives.includes(e.passive),
    resultKnown: codex.weapons.includes(e.result),
  }));
}

/** 도감을 얼마나 모았나: 요괴·보스·무기(진화 포함)·패시브·캐릭터 */
export function codexCount(p: SurvivalProfile): { have: number; all: number } {
  return {
    have: p.codex.enemies.length + p.codex.bosses.length + p.codex.weapons.length + p.codex.passives.length + p.unlockedCharacters.length,
    all: ENEMIES.length + BOSSES.length + WEAPONS.length + PASSIVES.length + CHARACTERS.length,
  };
}
