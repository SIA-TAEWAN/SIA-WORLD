/**
 * 서버의 스테이지 표(_defense_stages)에 넣을 values 줄을 찍는다 — 스테이지를 더하거나 보상을 바꿨을 때 SQL 에 옮겨 적는다.
 *   node node_modules/vite-node/vite-node.mjs scripts/sql-stages.ts            → 줄만 찍는다
 *   node node_modules/vite-node/vite-node.mjs scripts/sql-stages.ts <SQL 파일> → 그 파일의 _defense_stages 표를 바꿔 쓴다
 * (이미 push 한 마이그레이션은 고치지 않는다: 새 번호의 파일에서 create or replace 로 다시 정의하고, tests/sql.test.ts 의 파일 목록에 더한다)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { STAGES } from '../src/data/stages';

const rows = STAGES.map((s) => `    ('${s.id}', ${s.region}, ${s.no}, ${s.coins}, ${s.firstCoins})`).join(',\n');
const file = process.argv[2];
if (!file) console.log(rows);
else {
  const sql = readFileSync(file, 'utf8');
  const at = sql.lastIndexOf('create or replace function public._defense_stages(');
  const a = sql.indexOf('  values\n', at) + '  values\n'.length;
  const b = sql.indexOf('\n$$;', a);
  if (at < 0 || a < at || b < a) throw new Error('_defense_stages 표를 찾지 못했다');
  writeFileSync(file, sql.slice(0, a) + rows + sql.slice(b));
  console.log(`${file}: 스테이지 ${STAGES.length}줄`);
}
