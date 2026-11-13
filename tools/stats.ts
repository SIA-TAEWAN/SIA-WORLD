import { Match } from '../src/game/match';
import { Rng } from '../src/game/rng';
import { decideMove, decideShot } from '../src/ai/ai';
import { TANK_IDS } from '../src/game/data';
const agg: Record<string, { dmg: number; shots: number; zero: number }> = {};
for (const id of TANK_IDS) agg[id] = { dmg: 0, shots: 0, zero: 0 };
for (const map of ['valley', 'sky', 'sphinx'] as const)
  for (let g = 0; g < 4; g++)
    for (const a of TANK_IDS) {
      const b = TANK_IDS[(TANK_IDS.indexOf(a) + 1 + g % 3) % 4];
      const rng = new Rng(g * 77 + 5);
      const m = new Match([{ name: 'A', tank: a, team: 0, ai: 'normal', items: [] }, { name: 'B', tank: b, team: 1, ai: 'normal', items: [] }], map, g * 1000 + 7);
      let n = 0;
      while (!m.over && n++ < 30) {
        const t = m.startTurn();
        const mv = decideMove(m, 'normal', rng);
        for (let i = 0; i < Math.abs(mv); i++) if (!m.moveStep(mv > 0 ? 1 : -1)) break;
        if (m.over) break;
        const before = t.damageDealt;
        m.fire(decideShot(m, 'normal', rng));
        const d = t.damageDealt - before;
        agg[t.tankId].dmg += d; agg[t.tankId].shots++; if (d === 0) agg[t.tankId].zero++;
      }
    }
for (const id of TANK_IDS) { const s = agg[id]; console.log(id, 'avg', (s.dmg / s.shots).toFixed(0), 'miss%', (100 * s.zero / s.shots).toFixed(0), 'shots', s.shots); }
