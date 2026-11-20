import { describe, expect, it } from 'vitest';
import { UPGRADES, type Upgrades } from '../src/data/growth';
import { ENDLESS_ID, ENDLESS_STAGE } from '../src/data/endless';
import { STAGES, stageOf } from '../src/data/stages';
import { LIMITS, applyRun, defaultProfile, quitCoins, startLivesOf, waveOf, type DefenseProfile, type RunMode, type RunReport } from '../src/game/progress';

/**
 * 일시정지 창의 "지금 그만하면 받을 엽전"(quitCoins)이 실제 저장 계산(applyRun)과 같은지.
 * 정해 둔 예외: quitCoins 는 처치 수 검사(isValid)를 보지 않는다 — 끝없는 모드의 처치 하한도 마찬가지라,
 * 여기 판들은 처치 수를 그 하한에 맞춰(정상 판으로) 만든다.
 */

/** 모든 스테이지를 ★3 으로 깬 프로필 (모든 스테이지·끝없는 모드가 열림) */
const profileWith = (upgrades: Upgrades): DefenseProfile => ({
  ...defaultProfile(),
  stages: Object.fromEntries(STAGES.filter((s) => s.id !== ENDLESS_ID).map((s) => [s.id, 3])),
  upgrades,
});

/** 그만하기로 끝낸 판 (생명은 남아 있지만 클리어 아님) */
function quitReport(stage: string, time: number, mode: RunMode, bonus: number, upgrades: Upgrades): RunReport {
  const st = stageOf(stage) ?? ENDLESS_STAGE;
  const startLives = startLivesOf(st, upgrades);
  // 끝없는 모드는 도달 웨이브에 걸맞은 처치 수가 있어야 정상 판이다 (quitCoins 가 보지 않는 검사)
  const kills = mode === 'endless' ? Math.max(0, waveOf(time) - LIMITS.endless_kills_from) * LIMITS.endless_kills_per_wave : 10;
  return { run: 'r', stage, cleared: false, lives: startLives, startLives, time, kills, placed: 3, cmds: 6, bonus, codex: { enemies: [], bosses: [] } };
}

const coinUp = UPGRADES.find((u) => u.id === 'coin')!;
const upgradeSets: Upgrades[] = [{}, ...Array.from({ length: coinUp.max }, (_, i) => ({ coin: i + 1, lives: i % 3 }) as Upgrades)];
const squads = [
  ['rat', 'ox', 'tiger'],
  ['rat', 'pig', 'tiger'],
];
const bonuses = [0, 37, LIMITS.bonus_max + 100];

describe('그만하기 엽전 미리 보기 = 실제 저장 계산', () => {
  it('스테이지 판 (여러 스테이지·시간·강화·돼지)', () => {
    const stages = ['1-1', '1-5', '3-2', STAGES.filter((s) => s.id !== ENDLESS_ID).at(-1)!.id];
    const times = [0, LIMITS.count_min_time - 1, LIMITS.count_min_time, 29, 30, 61, 95, 150, 179];
    let checked = 0;
    for (const up of upgradeSets) {
      const p = profileWith(up);
      for (const id of stages)
        for (const t of times)
          for (const squad of squads)
            for (const bonus of bonuses) {
              const st = stageOf(id)!;
              const { result } = applyRun(p, quitReport(id, t, 'normal', bonus, up), squad, 'normal');
              expect(result.valid).toBe(true);
              expect(quitCoins(st, t, 'normal', squad, bonus, up), `${id} t=${t} ${squad} bonus=${bonus} ${JSON.stringify(up)}`).toBe(result.coins);
              checked++;
            }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('끝없는 모드 (처치 하한을 채운 판, 엽전 상한 넘는 시간까지)', () => {
    const times = [0, LIMITS.count_min_time - 1, LIMITS.count_min_time, 30, 59, 200, 1199, 1500, LIMITS.endless_max_time];
    for (const up of upgradeSets) {
      const p = profileWith(up);
      for (const t of times)
        for (const squad of squads)
          for (const bonus of bonuses) {
            const { result } = applyRun(p, quitReport(ENDLESS_ID, t, 'endless', bonus, up), squad, 'endless');
            expect(result.valid).toBe(true);
            expect(quitCoins(ENDLESS_STAGE, t, 'endless', squad, bonus, up), `endless t=${t} ${squad} bonus=${bonus} ${JSON.stringify(up)}`).toBe(result.coins);
          }
    }
  });

  it('돼지 엽전이 실제로 더해지고 강화로 늘어난다 (위 비교가 0끼리만 같지 않게)', () => {
    const st = stageOf('1-1')!;
    expect(quitCoins(st, 95, 'normal', squads[1], 37, {})).toBeGreaterThan(quitCoins(st, 95, 'normal', squads[0], 37, {}));
    expect(quitCoins(st, 95, 'normal', squads[1], 37, { coin: coinUp.max })).toBeGreaterThan(quitCoins(st, 95, 'normal', squads[1], 37, {}));
  });
});
