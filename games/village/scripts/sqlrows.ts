/**
 * 데이터 파일의 표를 SQL 의 values 줄로 뽑는다:  npm run sqlrows
 * 건물 · 목표 · 가공 · 시세 표를 고쳤으면 이 줄들을 새 마이그레이션의 _village_types / _village_goals / … 에 붙여 넣는다
 * (두 곳이 같은지는 tests/sql.test.ts 가 본다).
 */
import { PRICES } from '../src/data/balance';
import { BUILDINGS, RECIPES } from '../src/data/buildings';
import { GOALS } from '../src/data/goals';

const q = (v: string) => `'${v}'`;
const rows = (list: string[]) => list.map((r, i) => `    (${r})${i < list.length - 1 ? ',' : ''}`).join('\n');

console.log('-- _village_types');
console.log(rows(BUILDINGS.map((d) => [q(d.id), q(d.kind), d.w, d.h, d.rice, d.wood, d.stone, d.coin, d.sia, d.upStone, d.buildSec, q(d.product ?? ''), d.rate, d.buildExp, d.cap, d.points, `array[${d.unlock.join(', ')}]`].join(', '))));
console.log('\n-- _village_goals');
console.log(rows(GOALS.map((g, i) => [i, q(g.kind), q(g.type), g.n, g.rice, g.wood, g.stone, g.coin, g.exp].join(', '))));
console.log('\n-- _village_recipes');
console.log(rows(RECIPES.map((r) => [q(r.type), q(r.in1), r.n1, q(r.in2), r.n2, q(r.out), r.sec, r.exp, r.base, r.per].join(', '))));
console.log('\n-- _village_prices');
console.log(rows(PRICES.map((p) => [q(p.res), p.base, p.idx].join(', '))));
