/** 언제 죽는지 30초 단위로 본다:  npx vite-node scripts/hist.ts [판 수] [강화] */
import { RUN_SEC } from '../src/data/balance';
import { CHARACTERS } from '../src/data/characters';
import { presetUpgrades } from '../src/data/upgrades';
import { normalPolicy, simulate } from '../src/game/policy';

const runs = Number(process.argv[2]) || 60;
const upg = Number(process.argv[3]) || 0;
const hist = new Array(11).fill(0);
let clear = 0;
let sum = 0;
let bossHp = 0;
let reached = 0;
for (let i = 0; i < runs; i++) {
  const c = CHARACTERS[i % 6];
  const r = simulate({ seed: 100 + i * 31, char: c.id, map: 'field', upgrades: presetUpgrades(upg) }, normalPolicy(i));
  hist[Math.min(10, Math.floor(r.time / 30))]++;
  sum += r.time;
  if (r.cleared) clear++;
  if (r.time >= RUN_SEC && !r.cleared) {
    reached++;
    const b = r.state.enemies.items.slice(0, r.state.enemies.n).find((e) => e.uid === r.state.finalUid);
    bossHp += b ? b.hp / b.maxHp : 0;
    console.log(`  5분 도달 뒤 사망: ${c.id} 경과 ${r.elapsed.toFixed(0)}초 레벨 ${r.level} 보스 체력 ${b ? Math.round((b.hp / b.maxHp) * 100) : '?'}%`);
  }
}
console.log(`강화 ${upg}: 평균 ${(sum / runs / 60).toFixed(2)}분, 30초 단위 사망 ${hist.join(' ')}, 클리어 ${clear}/${runs}, 5분 뒤 사망 ${reached} (남은 보스 체력 평균 ${reached ? Math.round((bossHp / reached) * 100) : 0}%)`);
