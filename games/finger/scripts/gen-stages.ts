/**
 * 2~12지역 스테이지 데이터 쓰기: npm run gen → supabase/functions/_shared/finger/stages-gen.ts
 * 판 모양은 src/data/stagegen.ts (씨앗 고정), 요괴 체력 배율·별 기준 턴은 src/data/calib.ts (npm run calib 가 만든다).
 * 다시 돌려도 같은 파일이 나온다 (tests/stagegen.test.ts 가 확인).
 */
import { writeFileSync } from 'node:fs';
import { CALIB } from '../src/data/calib';
import { generatedSource } from '../src/data/stagegen';

export const GEN_FILE = new URL('../../../supabase/functions/_shared/finger/stages-gen.ts', import.meta.url);

writeFileSync(GEN_FILE, generatedSource(CALIB));
console.log('stages-gen.ts 를 썼어요');
