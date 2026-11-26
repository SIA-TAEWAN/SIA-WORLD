/**
 * 서버 표 다시 만들기: npm run sqlgen
 * src/data 의 숫자(맵 보상·경험치 곡선·장비·드랍·값)로 마이그레이션의 gen 블록을 다시 쓴다 (블록마다 `blockFile` 이 정한 파일).
 * 078_twelve.sql 은 운영에 있어 고치지 않는다 — 094 가 표 함수(_twelve_maps 등)를 create or replace 로 다시 정의한다.
 * 094 도 운영에 있다: 맵 표(_twelve_maps)는 109_twelve_short_maps.sql 이 다시 정의하므로 094 의 maps 블록은 옛 값 그대로 두고 109 의 블록을 쓴다.
 * 다른 표를 또 바꿀 때도 배포된 파일은 두고, 새 번호의 마이그레이션에 그 함수를 다시 정의한 뒤 src/data/sqlrows.ts 의 SQL_FILES · LATER 에 더한다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SQL_FILES, fillBlocks, sqlBlocks } from '../src/data/sqlrows';

const check = process.argv.includes('--check');
let differ = false;
for (const name of SQL_FILES) {
  const file = fileURLToPath(new URL(`../../../supabase/migrations/${name}`, import.meta.url));
  const before = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const after = fillBlocks(before, name);
  if (after !== before) differ = true;
  if (check) {
    console.log(after === before ? `${name} 이 src/data 와 같아요` : `${name} 이 src/data 와 달라요 → npm run sqlgen`);
    continue;
  }
  if (after !== before) writeFileSync(file, after);
  console.log(after === before ? `${name}: 바뀐 것 없음` : `${name} 을 다시 썼어요`);
}
if (check) process.exit(differ ? 1 : 0);
const blocks = sqlBlocks();
console.log(Object.entries(blocks).map(([k, v]) => `${k} ${v.split('\n').length}줄`).join(' · '));
