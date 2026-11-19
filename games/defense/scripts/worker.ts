/**
 * 밸런스 시뮬레이션 일꾼 (scripts/sweep.mjs 가 여러 개를 한꺼번에 띄운다).
 * 인자: 일감 목록(JSON) [{ key, stage, skill, lv?, upg?, squad?, without?, with?, from, to }] → 일감마다 한 줄씩 결과(JSON)를 찍는다.
 * 인자가 'towers' 면 캐릭터별 효율 표, 'journey' 면 처음부터 끝까지 가는 데 걸리는 판 수 어림셈, 'info' 면 스테이지·캐릭터 목록.
 */
import { COINS, WAVES, type ZodiacId } from '../src/data/balance';
import { ROSTER, TOWERS, spentAt, towerOf } from '../src/data/characters';
import { CHAR_MAX_LV, UPGRADES, levelCost, presetUpgrades, upgradeCost, type Upgrades } from '../src/data/growth';
import { REGIONS } from '../src/data/regions';
import { STAGES, stageOf, stagesOf } from '../src/data/stages';
import { SKILLS, pickSquad, simulate, skillPolicy } from '../src/game/policy';
import { partialCoins } from '../src/game/progress';

interface Job {
  key: string;
  stage: string;
  skill: keyof typeof SKILLS;
  /** 모든 캐릭터의 레벨 (없으면 그 스테이지의 지역 번호) · 공통 강화 레벨 (없으면 (지역 - 1) / 2) */
  lv?: number;
  upg?: number;
  /** 데려갈 캐릭터 (없으면 그 지역에서 쓸 수 있는 캐릭터 가운데 보통 실력이 고르는 5종) */
  squad?: ZodiacId[];
  /** 이 캐릭터를 뺀 4종만 / 그 4종에 이 캐릭터를 더한 5종 */
  without?: ZodiacId;
  with?: ZodiacId;
  from: number;
  to: number;
}

/** 그 지역에 들어설 때 쓸 수 있는 캐릭터 (앞 지역들을 클리어해 해금한 것) */
/** (끝없는 모드의 맵은 지역 0: 모든 캐릭터를 쓸 수 있는 것으로 본다) */
const unlockedAt = (region: number) => ROSTER.filter((c) => (region === 0 || c.unlockRegion < region) && towerOf(c.id)).map((c) => c.id);

function squadFor(j: Job): ZodiacId[] {
  if (j.squad) return j.squad;
  const stage = stageOf(j.stage)!;
  const pool = unlockedAt(stage.region);
  // 캐릭터 한 종의 쓸모: 그 캐릭터를 뺀 나머지에서 고른 4종만 데려갔을 때(without)와, 거기에 그 캐릭터를 다섯째로 더했을 때(with)를 견준다
  if (j.without) return pickSquad(stage, pool.filter((c) => c !== j.without), undefined, 4);
  if (j.with) return pickSquad(stage, pool, j.with);
  return pickSquad(stage, pool);
}

const arg = process.argv[2] ?? '[]';
if (arg === 'info') {
  console.log(JSON.stringify({ stages: STAGES.map((s) => ({ id: s.id, name: s.name, region: s.region })), chars: TOWERS.map((t) => ({ id: t.id, name: t.name, unlock: ROSTER.find((r) => r.id === t.id)!.unlockRegion })), regions: REGIONS.map((r) => r.name) }));
} else if (arg === 'towers') {
  // 한 마리를 계속 때릴 때의 초당 피해와 기운 1당 효율 (범위 공격은 맞는 요괴 수만큼 곱해진다)
  const rows = TOWERS.map((t) => ({
    name: t.name,
    kind: t.kind,
    levels: t.levels.map((L, i) => {
      const dps = (L.dmg * (L.count ?? 1)) / L.every + (L.poison ?? 0) + (L.burn ?? 0);
      const spent = spentAt(t, i + 1);
      const note = [L.splash ? `범위${L.splash}` : '', L.stun ? `멈춤${L.stun}초` : '', L.slow ? `감속${L.slow}` : '', L.haste ? `지원+${Math.round(L.haste * 100)}%` : '', L.income ? `기운+${L.income}` : '', L.airMul ? `공중×${L.airMul}` : '', L.bossMul ? `보스×${L.bossMul}` : ''].filter(Boolean).join(' ');
      return { spent, dps, per: dps / spent, range: L.range, note };
    }),
  }));
  console.log(JSON.stringify({ towers: rows }));
} else if (arg === 'journey') {
  // 처음부터 60스테이지 클리어까지: 보통 실력이 스테이지를 차례로 깨면서, 번 엽전으로 주력 5종을 고르게 올리고 공통 강화를 산다.
  // 스테이지마다 지금 레벨로 RUNS 판을 돌려 클리어율을 재고, 클리어까지의 판 수를 1 / 클리어율 (최대 MAX_TRIES)로 어림한다.
  const RUNS = Number(process.argv[3]) || 12;
  const MAX_TRIES = 8;
  let coins = 0;
  let runs = 0;
  let stars = 0;
  const levels: Partial<Record<ZodiacId, number>> = {};
  const upgrades: Record<string, number> = {};
  const rows: unknown[] = [];
  for (const r of REGIONS) {
    const list = stagesOf(r.no);
    if (!list.length) break;
    const enter = { runs, coins, stars };
    let regionRuns = 0;
    for (const stage of list) {
      const squad = pickSquad(stage, unlockedAt(r.no));
      // 엽전을 쓴다: 이 스테이지에 데려갈 캐릭터 가운데 레벨이 가장 낮은 것부터, 더 싼 공통 강화가 있으면 그것부터
      for (;;) {
        const low = [...squad].sort((a, b) => (levels[a] ?? 1) - (levels[b] ?? 1))[0];
        const lc = levelCost(levels[low] ?? 1);
        const up = UPGRADES.map((u) => ({ id: u.id, cost: upgradeCost(u.id, upgrades[u.id] ?? 0) })).filter((u) => u.cost !== null).sort((a, b) => a.cost! - b.cost!)[0];
        if (up && up.cost! <= coins && (lc === null || up.cost! < lc * 0.8)) {
          coins -= up.cost!;
          upgrades[up.id] = (upgrades[up.id] ?? 0) + 1;
        } else if (lc !== null && lc <= coins && (levels[low] ?? 1) < CHAR_MAX_LV) {
          coins -= lc;
          levels[low] = (levels[low] ?? 1) + 1;
        } else break;
      }
      let clears = 0;
      let starSum = 0;
      let timeSum = 0;
      for (let i = 0; i < RUNS; i++) {
        const out = simulate({ seed: 1 + i * 7919, stage: stage.id, squad, levels, upgrades: upgrades as Upgrades }, skillPolicy(31 + i * 104729, SKILLS.normal)).summary;
        clears += out.cleared ? 1 : 0;
        starSum += out.stars;
        timeSum += out.cleared ? 0 : out.time;
      }
      const p = clears / RUNS;
      const tries = Math.min(MAX_TRIES, p > 0 ? 1 / p : MAX_TRIES);
      const got = clears ? starSum / clears : 1;
      const coinMul = (100 + 5 * (upgrades.coin ?? 0)) / 100;
      // 첫 클리어 한 판 + 그 전에 실패한 판들 (실패한 판은 버틴 만큼의 엽전)
      const failCoins = clears < RUNS ? partialCoins(stage, timeSum / (RUNS - clears)) : 0;
      coins += Math.floor((stage.coins + stage.firstCoins + got * COINS.perStar) * coinMul + (tries - 1) * failCoins * coinMul);
      runs += tries;
      regionRuns += tries;
      stars += got;
    }
    const squadLv = pickSquad(list[4], unlockedAt(r.no)).map((c) => levels[c] ?? 1);
    rows.push({ region: r.no, name: r.name, runs: regionRuns, total: runs, enter, lv: squadLv, upg: Object.values(upgrades).reduce((a, b) => a + b, 0), stars, need: REGIONS[r.no]?.stars ?? 0, coins });
  }
  console.log(JSON.stringify({ journey: rows }));
} else {
  const jobs = JSON.parse(arg) as Job[];
  for (const j of jobs) {
    const stage = stageOf(j.stage)!;
    const squad = squadFor(j);
    const lv = j.lv ?? stage.region;
    const levels = Object.fromEntries(squad.map((c) => [c, lv]));
    const upgrades = presetUpgrades(j.upg ?? Math.floor((stage.region - 1) / 2));
    const out = { key: j.key, runs: 0, clears: 0, stars: [0, 0, 0, 0], lives: 0, time: 0, kills: 0, towers: 0, bossDown: 0, waves: 0, maxWave: 0, failWave: new Array(WAVES).fill(0) as number[], squad };
    for (let i = j.from; i < j.to; i++) {
      // 판 번호마다 정해진 시드: 일꾼을 어떻게 나누든 같은 판이 나온다
      const r = simulate({ seed: 1 + i * 7919, stage: j.stage, squad, levels, upgrades }, skillPolicy(31 + i * 104729, SKILLS[j.skill]), 3700).summary;
      out.waves += r.wave;
      out.maxWave = Math.max(out.maxWave, r.wave);
      out.runs++;
      out.clears += r.cleared ? 1 : 0;
      out.stars[r.stars]++;
      out.lives += r.lives;
      out.time += r.time;
      out.kills += r.kills;
      out.towers += r.towers;
      out.bossDown += r.bossDown ? 1 : 0;
      if (!r.cleared) out.failWave[Math.max(0, Math.min(WAVES - 1, r.wave - 1))]++;
    }
    console.log(JSON.stringify(out));
  }
}
