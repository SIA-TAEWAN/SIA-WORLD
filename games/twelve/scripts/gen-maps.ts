/**
 * 맵 생성: npm run gen [지형 번호…]  (번호가 없으면 REGION_GEN 에 있는 지형 전부)
 * src/data/mapgen.ts 의 조각을 이어 붙여 src/data/maps/rNN.ts 를 다시 쓴다.
 * 새 지형을 더하면 src/data/maps.ts 의 LIST 에 그 파일을 넣는다.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGION_GEN, generateRegion, regionFile } from '../src/data/mapgen';

const args = process.argv.slice(2).map(Number).filter((n) => n >= 1 && n <= 12);
const regions = args.length ? args : Object.keys(REGION_GEN).map(Number);
for (const r of regions) {
  const maps = generateRegion(r);
  const file = fileURLToPath(new URL(`../src/data/maps/r${String(r).padStart(2, '0')}.ts`, import.meta.url));
  writeFileSync(file, regionFile(r, maps));
  const enemies = maps.map((m) => m.groups.reduce((a, g) => a + g.list.reduce((b, [, n]) => b + n, 0) + (g.elite ? 1 : 0), 0));
  console.log(`${r}지형: ${maps.map((m, i) => `${m.id} ${m.rows.length}줄·무리 ${m.groups.length}·요괴 ${enemies[i]}·${m.par}초`).join(' | ')}`);
}
