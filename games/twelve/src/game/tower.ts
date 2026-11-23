/**
 * 끝없는 탑의 기록 규칙 (PRD '끝없는 탑' · '랭킹과 시아코인'). 방과 숫자는 data/tower.ts.
 * - 처음부터 누구나 들어갈 수 있고, 들어가면 1층을 못 깨도 기록(0층)이 생긴다.
 * - 층을 깰 때마다 보고한다: 보상(엽전 · 강화석 · 장비)은 그 자리에서 받고, 쓰러져도 그때까지 받은 것은 남는다. 경험치는 없다.
 * - 장비 등급은 지금까지 연 지형 등급까지 (상점 등급과 같다), 레어는 연 지형의 레어 가운데.
 * - 쓰러지면 그 판은 끝. 보스 층(10 · 20 · …)을 깨면 그 다음 층에서 다시 시작할 수 있다 (체크포인트).
 * - 걸린 시간 = 판에서 논 시간 + 체크포인트에서 시작했다면 그 체크포인트까지의 가장 빠른 기록.
 * 테스트 모드(?local=1)는 이 규칙으로 기기에 저장하고, 서버(078_twelve.sql 의 twelve_tower_start · _floor · _end)는 같은 규칙이다 —
 * 한쪽을 바꾸면 다른 쪽도 바꾼다 (scripts/pg-check.mjs 가 맞춰 본다).
 */
import { ACC_STATS } from '../data/economy';
import { isHero, type HeroId } from '../data/heroes';
import { accessory, gearDrops, regionRares, type Item } from '../data/items';
import { MODES, REGIONS, REGIONS_READY } from '../data/regions';
import { TOWER, floorKind, floorMinTime, isStartFloor, towerCoins, towerRareRate, towerStones } from '../data/tower';
import { roll } from './drops';
import { LIMITS, addItem, coinBonus, equipped, heroesOf, potionGrid, regionOpen, type TwelveProfile } from './progress';
import { shopTier } from './rules';

/** 판정 종류 (SQL twelve_tower_floor 와 같은 번호. 맵 드랍의 1~12 와 겹치지 않게 20부터). 순번 = 층 */
export const TOWER_TAG = { stone: 20, gear: 21, gearPick: 22, acc: 23, accPick: 24, rare: 25, rareRegion: 26, rarePick: 27 } as const;

/** 진행 중인 탑 판 (서버 twelve_tower_runs 의 한 줄) */
export interface TowerRun {
  id: string;
  hero: HeroId;
  seed: number;
  /** 시작할 때의 엽전 획득 장신구 (%) */
  coinPct: number;
  /** 마지막으로 깬 층 (시작 층 − 1 에서 시작) */
  floor: number;
  /** 체크포인트에서 시작했을 때 더하는 시간 (초) · 이 판에서 논 시간 (초) */
  base: number;
  played: number;
  /** 마지막 보고(시작) 시각 (ms) */
  at: number;
  done: boolean;
}

export interface TowerFloorResult {
  floor: number;
  coins: number;
  stones: number;
  items: Item[];
  /** 시아코인을 받았는지 (서버만. 10층마다 1개) */
  siaCoin: boolean;
  /** 이 층까지 걸린 시간 (초) · 내 최고 기록을 새로 썼는지 */
  time: number;
  best: boolean;
}

/** 지금 시작할 수 있는 층: 1층 + 깬 보스 층의 다음 층 */
export function startFloors(p: TwelveProfile): number[] {
  const out = [1];
  for (let f: number = TOWER.cp; p.tower?.cps[String(f)] !== undefined; f += TOWER.cp) out.push(f + 1);
  return out;
}

/** 탑을 시작할 수 없는 까닭 (없으면 null) */
export function checkTowerStart(p: TwelveProfile, floor: number, hero: string, cat = false): string | null {
  if (!isStartFloor(floor)) return 'bad floor';
  if (floor > 1 && p.tower?.cps[String(floor - 1)] === undefined) return 'floor locked';
  if (!isHero(hero)) return 'bad hero';
  if (!heroesOf(p, cat).includes(hero)) return 'hero locked';
  if (!equipped(p, 'weapon')) return 'no weapon';
  return null;
}

/** 탑에 들어간다 (p 를 고친다: 처음이면 0층 기록이 생긴다). now = 지금 시각 (ms) */
export function beginTower(p: TwelveProfile, floor: number, hero: HeroId, id: string, seed: number, now: number): TowerRun {
  p.tower ??= { floor: 0, time: 0, level: p.level, hero, at: new Date(now).toISOString(), cps: {} };
  return { id, hero, seed, coinPct: coinBonus(p), floor: floor - 1, base: floor > 1 ? (p.tower.cps[String(floor - 1)] ?? 0) : 0, played: 0, at: now, done: false };
}

/** 레어가 나올 수 있는 지형들의 레어 목록 (연 지형. 보통 → 어려움, 지형 번호 순서 — 서버와 같은 순서) */
export function towerRareLists(p: TwelveProfile): string[][] {
  const out: string[][] = [];
  for (const mode of MODES) {
    for (let r = 1; r <= Math.min(REGIONS, REGIONS_READY); r++) if (regionOpen(p, r, mode)) out.push(regionRares(r, mode));
  }
  return out;
}

/** 층 보고를 받을 수 없는 까닭 (없으면 null). time = 이 판에서 지금까지 논 시간 (초) */
export function checkTowerFloor(run: TowerRun, floor: number, time: number, used: unknown, now: number): string | null {
  if (run.done) return 'already finished';
  if (!Number.isInteger(floor) || floor !== run.floor + 1) return 'bad floor';
  if (!Number.isInteger(time)) return 'bad time';
  const ft = time - run.played;
  if (ft > LIMITS.maxTime) return 'bad time';
  if (!potionGrid(used)) return 'bad potions';
  if (ft < floorMinTime(floor)) return 'too early';
  const elapsed = (now - run.at) / 1000;
  if (elapsed < ft - LIMITS.timeSlack) return 'too early';
  if (elapsed > LIMITS.maxAge) return 'too late';
  return null;
}

/**
 * 깬 층 하나를 적는다 (p · run 을 고친다). checkTowerFloor 를 통과한 보고만 넘길 것.
 * 서버의 twelve_tower_floor 와 같은 순서: 쓴 물약 → 강화석 → 일반 장비 → 장신구 → 레어 → 엽전 → 기록.
 */
export function applyTowerFloor(p: TwelveProfile, run: TowerRun, floor: number, time: number, used: number[][] | undefined, now: number): TowerFloorResult {
  const kind = floorKind(floor);
  const tier = shopTier(p);
  const grid = potionGrid(used)!;
  p.potions = p.potions.map((row, s) => row.map((n, z) => Math.max(0, n - grid[s][z])));
  const out: TowerFloorResult = { floor, coins: Math.floor((towerCoins(floor) * (100 + run.coinPct)) / 100), stones: towerStones(floor), items: [], siaCoin: false, time: 0, best: false };
  const hit = (tag: number, rate: number) => roll(run.seed, tag, floor) % 10000 < rate;
  const pick = <T>(tag: number, list: readonly T[]): T => list[roll(run.seed, tag, floor) % list.length];
  if (kind === 'normal') {
    if (hit(TOWER_TAG.stone, TOWER.stone.rate)) out.stones += 1;
    if (hit(TOWER_TAG.gear, TOWER.gear)) out.items.push({ ...addItem(p, pick(TOWER_TAG.gearPick, gearDrops(tier))) });
  } else if (hit(TOWER_TAG.acc, kind === 'boss' ? TOWER.acc.boss : TOWER.acc.elite)) {
    out.items.push({ ...addItem(p, accessory(pick(TOWER_TAG.accPick, ACC_STATS), tier)) });
  }
  if (hit(TOWER_TAG.rare, towerRareRate(floor))) {
    const base = pick(TOWER_TAG.rarePick, pick(TOWER_TAG.rareRegion, towerRareLists(p)));
    if (!p.codex.includes(base)) p.codex.push(base);
    out.items.push({ ...addItem(p, base) });
  }
  p.coins += out.coins;
  p.stones += out.stones;

  run.floor = floor;
  run.played = time;
  run.at = now;
  out.time = run.base + time;
  const rec = (p.tower ??= { floor: 0, time: 0, level: p.level, hero: run.hero, at: new Date(now).toISOString(), cps: {} });
  if (floor > rec.floor || (floor === rec.floor && out.time < rec.time)) {
    rec.floor = floor;
    rec.time = out.time;
    rec.level = p.level;
    rec.hero = run.hero;
    rec.at = new Date(now).toISOString();
    out.best = true;
  }
  if (kind === 'boss') rec.cps[String(floor)] = Math.min(rec.cps[String(floor)] ?? Infinity, out.time);
  return out;
}

/** 판을 끝낸다 (쓰러졌거나 그만뒀다): 마지막 층에서 쓴 물약만 빠진다. 못 끝내는 까닭 (없으면 null) */
export function endTower(p: TwelveProfile, run: TowerRun, used: unknown): string | null {
  if (run.done) return 'already finished';
  const grid = potionGrid(used);
  if (!grid) return 'bad potions';
  p.potions = p.potions.map((row, s) => row.map((n, z) => Math.max(0, n - grid[s][z])));
  run.done = true;
  return null;
}
