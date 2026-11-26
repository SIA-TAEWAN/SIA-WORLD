// 113_pang_lives.sql 의 스테이지 표(-- <gen:stages> ~ -- </gen:stages>)를 src/data/levels.json 으로 다시 쓴다.
//   node scripts/sqlrows.mjs          → 파일을 고친다
//   node scripts/sqlrows.mjs --print  → 표만 출력
// tests/sql.test.ts 가 같은 줄을 만들어 파일과 비교한다 (levels.json 을 바꾸고 이걸 안 돌리면 테스트가 실패한다)
import { readFileSync, writeFileSync } from 'node:fs';

const LEVELS = JSON.parse(readFileSync(new URL('../src/data/levels.json', import.meta.url), 'utf8'));
// 스테이지 표의 최신 정의는 113 (111 은 배포됨 — 그 표는 그대로 둔다)
export const SQL_FILE = new URL('../../../supabase/migrations/113_pang_lives.sql', import.meta.url);

export function stageRows(levels = LEVELS) {
  return levels.map((L) => `  (${L.id}, ${L.moves}, ${L.stars[0]}, ${L.stars[1]})`).join(',\n');
}
export function stageBlock(levels = LEVELS) {
  return `-- <gen:stages>\ninsert into public._pang_stages (stage, moves, star2, star3) values\n${stageRows(levels)}\non conflict (stage) do update set moves = excluded.moves, star2 = excluded.star2, star3 = excluded.star3;\n-- </gen:stages>`;
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  if (process.argv.includes('--print')) console.log(stageBlock());
  else {
    const sql = readFileSync(SQL_FILE, 'utf8');
    const next = sql.replace(/-- <gen:stages>[\s\S]*?-- <\/gen:stages>/, stageBlock());
    writeFileSync(SQL_FILE, next);
    console.log('113_pang_lives.sql 스테이지 표를 고쳤어요');
  }
}
