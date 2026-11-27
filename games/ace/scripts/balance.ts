// 밸런스 확인: 기체 13종 × 스테이지 보스 12마리 — 파워 최대 · 무적 · 보스 몸통 아래를 따라다니며
// 3칸 차지를 되풀이할 때 보스를 잡는 데 걸리는 초. 90초(제한 시간)를 넘으면 '도망'.
//   npm run balance            표 전체
//   npm run balance -- mid     중간 보스
import { NO_INPUT, Sim, W, type Input } from '../src/game/sim';
import { SHIPS, SHIP_ORDER } from '../src/data/ships';
import { BOSSES, RUSH } from '../src/data/bosses';
import { STAGES } from '../src/data/stages';

const mid = process.argv.includes('mid');
const list = mid ? STAGES.map(s => s.midboss!.id) : RUSH;

function killTime(ship: (typeof SHIP_ORDER)[number], boss: string, stage: number) {
  const s = new Sim({ seed: 5, ship, waves: { length: 0, waves: [], ...(mid ? { midboss: { at: 0, id: boss } } : { boss }) }, stage });
  s.power = 4; s.iframes = 1e12; s.bombs = 0;
  let fightAt = 0;
  for (let f = 0; f < 60 * 140; f++) {
    const b = s.boss;
    if (b?.state === 'fight' && !fightAt) fightAt = f;
    const tx = b ? b.x + b.def.core.x : W / 2;
    const inp: Input = { ...NO_INPUT, kx: Math.max(-1, Math.min(1, (tx - s.px) / 20)), ky: s.py > 1000 ? -1 : s.py < 960 ? 1 : 0, charge: f % 130 < 110 };
    s.step(inp);
    if (s.events.some(e => e.t === 'bossDown')) return (f - fightAt) / 60;
    if (s.events.some(e => e.t === 'flee')) return Infinity;
  }
  return Infinity;
}

const head = '기체'.padEnd(8) + list.map(id => BOSSES[id].name.slice(0, 4).padStart(6)).join('');
console.log(head);
const avg: number[] = [];
for (const id of SHIP_ORDER) {
  const ts = list.map((b, i) => killTime(id, b, i + 1));
  avg.push(ts.filter(Number.isFinite).reduce((a, b) => a + b, 0) / ts.length);
  console.log(SHIPS[id].name.padEnd(6) + ts.map(t => (Number.isFinite(t) ? t.toFixed(0) + 's' : '도망').padStart(6)).join(''));
}
console.log('평균(초):', SHIP_ORDER.map((id, i) => `${SHIPS[id].name} ${avg[i].toFixed(0)}`).join(' · '));
