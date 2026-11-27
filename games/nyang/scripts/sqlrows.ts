/**
 * 데이터 파일(src/data/balance.ts)의 값 · 표를 SQL 줄로 뽑는다:  npm run sqlrows
 * 값을 고쳤으면 이 줄들을 마이그레이션의 _nyang_const · _nyang_table · _nyang_ids · _nyang_personalities · _nyang_foods 에 붙여 넣는다
 * (이미 올라간 마이그레이션이면 새 번호의 파일에 함수를 다시 정의하고 tests/sql.test.ts 의 FILES 에 더한다. 두 곳이 같은지는 그 시험이 본다).
 */
import { CAT_NEED, COLOR_IDS, CONST, FOODS, LOVE_NEED, PERSONALITIES, SPOTS } from '../src/data/balance';

const q = (v: string) => `'${v}'`;
const rows = (list: string[]) => list.map((r, i) => `    (${r})${i < list.length - 1 ? ',' : ''}`).join('\n');

console.log('-- _nyang_const');
console.log(Object.entries(CONST).map(([k, v]) => `    when '${k}' then ${v}`).join('\n'));
console.log('\n-- _nyang_table');
console.log(`    when 'love_need' then array[${LOVE_NEED.join(', ')}]\n    when 'cat_need' then array[${CAT_NEED.join(', ')}]`);
console.log('\n-- _nyang_ids');
console.log(`    when 'colors' then array[${COLOR_IDS.map(q).join(', ')}]\n    when 'spots' then array[${SPOTS.map(q).join(', ')}]`);
console.log('\n-- _nyang_personalities');
console.log(rows(PERSONALITIES.map((p) => [q(p.id), p.full_sec, p.water_sec, p.poop_sec, p.mood_sec, q(p.likes.join(',')), q(p.dislikes.join(',')), q(p.toy), q(p.churu)].join(', '))));
console.log('\n-- _nyang_foods');
console.log(rows(FOODS.map((f) => [q(f.id), f.add, f.price].join(', '))));
