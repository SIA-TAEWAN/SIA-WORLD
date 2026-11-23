/**
 * 어느 요괴가 어느 웨이브에 새는지 센다 (별 3개 = 하나도 새지 않기 — 무엇이 막는지 찾는 도구).
 *   npx vite-node scripts/leaks.ts <지역> [레벨=12] [공통강화=5] [실력=normal] [판수=16]
 */
import { CHAR_MAX_LV, presetUpgrades } from '../src/data/growth';
import { ROSTER, TOWERS } from '../src/data/characters';
import { ENEMIES } from '../src/data/enemies';
import { BOSSES } from '../src/data/bosses';
import { STAGES } from '../src/data/stages';
import { SKILLS, pickSquad, skillPolicy } from '../src/game/policy';
import { createGame, isOver, step, summarize } from '../src/game/sim';

const region = Number(process.argv[2] ?? 12);
const lv = Math.min(CHAR_MAX_LV, Number(process.argv[3] ?? 12));
const upg = Number(process.argv[4] ?? 5);
const skill = (process.argv[5] ?? 'normal') as keyof typeof SKILLS;
const runs = Number(process.argv[6] ?? 16);
const levels = Object.fromEntries(ROSTER.map((c) => [c.id, lv]));
const unlocked = ROSTER.filter((c) => c.unlockRegion >= 0 && c.unlockRegion < region && TOWERS.some((t) => t.id === c.id)).map((c) => c.id);

for (const stage of STAGES.filter((s) => s.region === region)) {
  const squad = pickSquad(stage, unlocked);
  const by = new Map<string, number>();
  const waves = [0, 0, 0, 0, 0, 0];
  let perfect = 0;
  let clears = 0;
  for (let i = 0; i < runs; i++) {
    const s = createGame({ seed: 1 + i * 7919, stage: stage.id, squad, levels, upgrades: presetUpgrades(upg) });
    const policy = skillPolicy(31 + i * 104729, SKILLS[skill]);
    while (!isOver(s) && s.tick < 900 * 60) {
      policy.act(s);
      if (s.phase === 'prep') break;
      const before = s.lives;
      const alive: boolean[] = [];
      for (let k = 0; k < s.enemyHi; k++) alive[k] = s.enemies[k].alive;
      step(s);
      if (s.lives < before) {
        for (let k = 0; k < alive.length; k++) {
          const e = s.enemies[k];
          if (alive[k] && !e.alive && e.d >= s.routes[e.route].len) {
            const name = e.boss >= 0 ? `보스 ${BOSSES[e.boss].name}` : e.look >= 0 ? '분신·마디' : ENEMIES[e.kind].name;
            by.set(name, (by.get(name) ?? 0) + 1);
            waves[Math.min(5, Math.floor(s.time / 30))]++;
          }
        }
      }
    }
    const sum = summarize(s);
    clears += sum.cleared ? 1 : 0;
    perfect += sum.stars === 3 ? 1 : 0;
  }
  const list = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${(c / runs).toFixed(1)}`).join(' · ');
  console.log(`${stage.id} [${squad.map((id) => TOWERS.find((t) => t.id === id)!.nick).join(' ')}] 클리어 ${Math.round((clears / runs) * 100)}% ★★★ ${Math.round((perfect / runs) * 100)}%  웨이브별 샌 수(판당) ${waves.map((w) => (w / runs).toFixed(1)).join(' ')}  | ${list}`);
}
