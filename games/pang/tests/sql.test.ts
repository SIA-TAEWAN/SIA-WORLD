import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/net/api';
import { SQL_FILE, stageBlock } from '../scripts/sqlrows.mjs';

const sql = readFileSync(SQL_FILE, 'utf8');

describe('111_pang.sql 이 클라이언트와 같다', () => {
  it('스테이지 표 (이동 수·별 기준) = src/data/levels.json  (다르면 npm run sqlrows)', () => {
    const block = sql.match(/-- <gen:stages>[\s\S]*?-- <\/gen:stages>/)?.[0];
    expect(block).toBe(stageBlock());
  });
  it('한계 값 = LIMITS', () => {
    const m = sql.match(/select '(\{"maxScore"[^']*)'::jsonb/);
    expect(JSON.parse(m![1])).toEqual(LIMITS);
  });
});
