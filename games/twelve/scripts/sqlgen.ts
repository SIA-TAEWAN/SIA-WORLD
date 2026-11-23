/**
 * 서버 표 다시 만들기: npm run sqlgen
 * src/data 의 숫자(맵 보상·경험치 곡선·장비·드랍·값)로 supabase/migrations/078_twelve.sql 의 gen 블록을 다시 쓴다.
 * 078 이 이미 배포된 뒤에는 그 파일을 고치면 안 된다 — 새 번호의 마이그레이션에 같은 함수를 create or replace 로 다시 정의하고
 * 여기 FILE 과 tests/sql.test.ts 가 읽는 파일을 그쪽으로 바꾼다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fillBlocks, sqlBlocks } from '../src/data/sqlrows';

const FILE = fileURLToPath(new URL('../../../supabase/migrations/078_twelve.sql', import.meta.url));
const before = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const after = fillBlocks(before);
if (process.argv.includes('--check')) {
  console.log(after === before ? '078_twelve.sql 이 src/data 와 같아요' : '078_twelve.sql 이 src/data 와 달라요 → npm run sqlgen');
  process.exit(after === before ? 0 : 1);
}
writeFileSync(FILE, after);
const blocks = sqlBlocks();
console.log(after === before ? '바뀐 것 없음' : '078_twelve.sql 을 다시 썼어요');
console.log(Object.entries(blocks).map(([k, v]) => `${k} ${v.split('\n').length}줄`).join(' · '));
