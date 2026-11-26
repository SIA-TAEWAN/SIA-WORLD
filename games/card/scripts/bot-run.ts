/**
 * 봇 클리어율: 영웅마다 N판을 봇(tests/bot.ts)으로 끝까지 돌려 막별 도달·클리어율을 출력한다.
 *   npm run bot              # 영웅마다 100판
 *   npm run bot -- 300       # 영웅마다 300판
 *   npm run bot -- 200 tiger,dog
 * 출력: 1막·2막·3막 클리어율, 정예 3+ & 3막 클리어(4막 열림), 어둑시니 클리어, 평균 칸 수, 어디서 쓰러졌나(지역별 보스·정예·일반).
 */
import { HEROES, enemyDef, heroDef, newRun, regionDef, type RunState } from '../src/game/rules';
import { playRun } from '../tests/bot';

const N = Math.max(1, Number(process.argv[2]) || 100);
const only = (process.argv[3] ?? '').split(',').filter(Boolean);
const heroes = HEROES.filter((h) => !only.length || only.includes(h.id));

const pct = (a: number, n: number) => `${((a / n) * 100).toFixed(0).padStart(3)}%`;

interface Row {
  hero: string;
  c1: number;
  c2: number;
  c3: number;
  open4: number;
  final: number;
  floors: number;
}

const deaths = new Map<string, number>();
const rows: Row[] = [];
const t0 = Date.now();
for (const h of heroes) {
  const row: Row = { hero: h.id, c1: 0, c2: 0, c3: 0, open4: 0, final: 0, floors: 0 };
  for (let s = 0; s < N; s++) {
    const run: RunState = newRun({ seed: (h.id.length * 100003 + s * 7919) >>> 0, hero: h.id });
    playRun(run);
    const cleared = run.phase === 'won' ? (run.ending ? 3 : run.act) : run.act - 1;
    if (cleared >= 1) row.c1++;
    if (cleared >= 2) row.c2++;
    if (cleared >= 3) row.c3++;
    if (run.act === 4) row.open4++;
    if (run.ending === 'true') row.final++;
    row.floors += run.stats.floors;
    if (run.phase === 'dead' && run.battle) {
      const f = run.battle.foes.find((x) => !x.minion) ?? run.battle.foes[0];
      const key = `${run.act}막 ${regionDef(run.map.region).name} · ${run.battle.kind === 'battle' ? '일반' : run.battle.kind === 'elite' ? '정예' : '보스'} ${enemyDef(f.id).name}`;
      deaths.set(key, (deaths.get(key) ?? 0) + 1);
    }
  }
  rows.push(row);
}

console.log(`봇 클리어율 — 영웅마다 ${N}판 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
console.log('영웅        1막   2막   3막  4막열림 어둑시니  평균칸');
for (const r of rows) {
  const name = `${heroDef(r.hero).name}(${heroDef(r.hero).animal})`.padEnd(9, '　');
  console.log(`${name} ${pct(r.c1, N)}  ${pct(r.c2, N)}  ${pct(r.c3, N)}   ${pct(r.open4, N)}    ${pct(r.final, N)}   ${(r.floors / N).toFixed(1)}`);
}
console.log('\n많이 쓰러진 곳 (상위 15):');
for (const [k, n] of [...deaths].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${k}: ${n}`);
