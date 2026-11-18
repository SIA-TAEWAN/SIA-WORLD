/** 무기 피해 표만 빨리 본다:  npx vite-node scripts/dps.ts */
import { dpsTable } from '../src/game/policy';

for (const row of dpsTable()) console.log(`${row.name.padEnd(8, '　')} ${row.dps.map((d) => d.toFixed(1).padStart(7)).join('')}`);
