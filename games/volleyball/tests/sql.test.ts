import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_PER_DAY, PVP_PER_DAY } from '../src/game/unlock';
import { MIN_MATCH_MS } from '../src/net/record';

// 서버(SQL)와 기기가 따로 들고 있는 값이 어긋나지 않는지 본다 (서버는 바꾸지 않고 읽기만)
const MIG = new URL('../../../supabase/migrations/', import.meta.url);

/** 상수 함수의 마지막 정의 (create or replace — 가장 늦은 마이그레이션이 이긴다) → { 이름: 값 }, 정의한 파일 */
function consts(fn: string): { vals: Record<string, number>; from: string } {
  const files = readdirSync(MIG)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
  const re = new RegExp(`function public\\.${fn}\\(p_name text\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`);
  let body = '';
  let from = '';
  for (const f of files) {
    const m = readFileSync(new URL(f, MIG), 'utf8').match(re);
    if (m) [body, from] = [m[1], f];
  }
  const vals: Record<string, number> = {};
  for (const m of body.matchAll(/when '(\w+)' then (\d+)/g)) vals[m[1]] = Number(m[2]);
  return { vals, from };
}

describe('SQL 상수와 기기 상수', () => {
  it("056 _ai_match_const: 'per_day' = AI_PER_DAY, 'volleyball_min_sec' = MIN_MATCH_MS", () => {
    const { vals, from } = consts('_ai_match_const');
    expect(from).toBe('056_ai_matches.sql');
    expect(vals.per_day).toBe(30);
    expect(vals.per_day).toBe(AI_PER_DAY);
    expect(vals.volleyball_min_sec * 1000).toBe(MIN_MATCH_MS);
  });
  it("036 _volleyball_const: 'min_sec' = MIN_MATCH_MS, 'pair_per_day' = PVP_PER_DAY", () => {
    const { vals, from } = consts('_volleyball_const');
    expect(from).toBe('036_hardening.sql');
    expect(vals.min_sec).toBe(15);
    expect(vals.min_sec * 1000).toBe(MIN_MATCH_MS);
    expect(vals.pair_per_day).toBe(PVP_PER_DAY);
  });
});
