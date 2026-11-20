/**
 * 끝없는 탑 난이도 재기: npm run tower [레벨 ...]   (예: npm run tower -- 5 15 25)
 * 자동 플레이어(src/game/autopilot.ts)로 레벨마다 탑을 끝까지 올라 몇 층 · 몇 턴인지 찍는다.
 * 파티 = 그 레벨이 예상 레벨인 지역까지 깼을 때 합류해 있는 가장 늦은 4명 (src/data/balance.ts). 레벨마다 프로세스 하나.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { towerParty } from '../src/data/balance';
import { towerCoins } from '../src/data/growth';
import { choose } from '../src/game/autopilot';
import { buildConfig, createRun, playShot, resultOf, type HeroId } from '../src/sim';

const args = process.argv.slice(2);

function climb(level: number) {
  const party = towerParty(level);
  const levels = Object.fromEntries(party.map((id) => [id, level])) as Partial<Record<HeroId, number>>;
  const s = createRun(buildConfig({ stage: 'tower', mode: 'tower', party, levels }));
  const t0 = Date.now();
  const fellAt: number[] = [];
  while (s.phase === 'aim') {
    const before = s.heroes.filter((h) => h.fallen).length;
    playShot(s, choose(s));
    if (s.heroes.filter((h) => h.fallen).length > before) fellAt.push(s.wave + 1);
  }
  const r = resultOf(s);
  return { level, party: party.join(','), floors: r.floors, turns: r.turns, fellAt, coins: towerCoins(r.floors), sec: Math.round((Date.now() - t0) / 1000) };
}

async function main() {
  if (args[0] === '--worker') {
    console.log(JSON.stringify(climb(Number(args[1]))));
    return;
  }
  const levels = args.length ? args.map(Number) : [3, 5, 10, 15, 20, 25, 30];
  const viteNode = fileURLToPath(new URL('../node_modules/vite-node/vite-node.mjs', import.meta.url));
  const script = fileURLToPath(import.meta.url);
  const rows = await Promise.all(
    levels.map(
      (lv) =>
        new Promise<ReturnType<typeof climb>>((res, rej) => {
          const p = spawn(process.execPath, [viteNode, script, '--worker', String(lv)], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
          let out = '';
          p.stdout.on('data', (d) => (out += d));
          p.stderr.on('data', (d) => process.stderr.write(d));
          p.on('close', (code) => (code === 0 ? res(JSON.parse(out.split('\n').find((l) => l.startsWith('{'))!)) : rej(new Error(`worker ${code}`))));
        }),
    ),
  );
  console.log('| 레벨 | 파티 | 올라간 층 | 턴 | 쓰러진 층 | 엽전(주운 것 빼고) | 걸린 초 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.level} | ${r.party} | ${r.floors} | ${r.turns} | ${r.fellAt.join(',')} | ${r.coins} | ${r.sec} |`);
}

void main();
