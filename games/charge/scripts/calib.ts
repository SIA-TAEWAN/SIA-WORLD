/**
 * 만든 스테이지(2~12지역)의 보정 값 만들기: npm run calib → src/data/calib.ts
 * 그 지역까지 보통만큼 강화한 "생각하는 플레이어"(src/game/autopilot.ts)가 보스 앞에 왔을 때의 대원 수를 잰다.
 * 보스 체력과 별 기준은 이 값으로 정한다 (stages.ts 의 generated). 스테이지 모양을 바꾸면 다시 돌린다.
 * tests/data.test.ts 가 이 파일이 최신인지 확인한다.
 */
import { writeFileSync } from 'node:fs';
import { measureArrivals } from '../src/data/calibrate';

const rows = measureArrivals();
const body = Object.entries(rows).map(([id, n]) => `  '${id}': ${n},`).join('\n');
writeFileSync(
  new URL('../src/data/calib.ts', import.meta.url),
  `// npm run calib 로 만든 파일 (손으로 고치지 않는다). 스테이지 → 보스 앞 예상 대원 수\nexport const CALIB: Record<string, number> = {\n${body}\n};\n`,
);
console.log(`${Object.keys(rows).length}개 스테이지 보정 값을 썼어요`);
