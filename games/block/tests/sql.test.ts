import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/net/api.ts';
import { BLOCK_RULES } from '../src/rules.ts';

const sql = readFileSync(new URL('../../../supabase/migrations/122_block.sql', import.meta.url), 'utf8');
const fn = readFileSync(new URL('../../../supabase/functions/block-finish/index.ts', import.meta.url), 'utf8');

describe('서버와 같은 한계', () => {
  it('_block_const 가 LIMITS 와 같다', () => {
    const m = sql.match(/_block_const\(\)[\s\S]*?select '(\{.*?\})'::jsonb/);
    expect(m).toBeTruthy();
    expect(JSON.parse(m![1])).toEqual({ ...LIMITS });
  });
  it('block-finish 는 같은 규칙 판본을 확인한다', () => {
    expect(fn).toContain("from '../_shared/block/verify.ts'");
    expect(fn).toContain('body?.rules !== BLOCK_RULES');
    expect(BLOCK_RULES).toBeGreaterThanOrEqual(1);
  });
  it('게임은 닫힌 채로 시작한다', () => {
    expect(sql).toContain("('game_open:block', 'false'::jsonb)");
  });
});
