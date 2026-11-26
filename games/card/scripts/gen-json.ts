/** src/data/*.json 을 규칙 코드의 데이터(_shared/card/data/*.ts)에서 다시 만든다: npm run json */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSON_TABLES, jsonText } from '../src/data/tables';

for (const [name, v] of Object.entries(JSON_TABLES)) {
  const file = fileURLToPath(new URL(`../src/data/${name}`, import.meta.url));
  writeFileSync(file, jsonText(v));
  console.log('wrote', name);
}
