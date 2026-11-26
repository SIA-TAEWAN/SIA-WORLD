import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, LIVES } from '../src/net/api';
import { SQL_FILE, stageBlock } from '../scripts/sqlrows.mjs';

const latest = readFileSync(SQL_FILE, 'utf8'); // 113_pang_lives.sql — 스테이지 표·목숨의 최신 정의
const first = readFileSync(new URL('../../../supabase/migrations/111_pang.sql', import.meta.url), 'utf8');

describe('pang SQL (111 + 113) 이 클라이언트와 같다', () => {
  it('스테이지 표 (이동 수·별 기준) = src/data/levels.json  (다르면 npm run sqlrows)', () => {
    const block = latest.match(/-- <gen:stages>[\s\S]*?-- <\/gen:stages>/)?.[0];
    expect(block).toBe(stageBlock());
  });
  it('한계 값 = LIMITS', () => {
    const m = first.match(/select '(\{"maxScore"[^']*)'::jsonb/);
    expect(JSON.parse(m![1])).toEqual(LIMITS);
  });
  it('목숨 = LIVES', () => {
    const m = latest.match(/select '(\{"max"[^']*)'::jsonb/);
    expect(JSON.parse(m![1])).toEqual(LIVES);
  });
});
