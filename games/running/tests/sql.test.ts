import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DT, END_AFTER_GO, MIN_VALID_MS } from '../src/game/constants';
import { GHOST_MAX_PRESSES, GHOST_MAX_STEP } from '../src/game/ghost';

// 서버(SQL)와 기기가 따로 들고 있는 값이 어긋나지 않는지 본다 (서버는 바꾸지 않고 읽기만)
const MIG = new URL('../../../supabase/migrations/', import.meta.url);
const sql = (name: string) => readFileSync(new URL(name, MIG), 'utf8');

/** _race_const 의 마지막 정의 (create or replace — 가장 늦은 마이그레이션이 이긴다) */
function raceConst(): Record<string, number> {
  const files = readdirSync(MIG)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
  let body = '';
  let from = '';
  for (const f of files) {
    const m = sql(f).match(/function public\._race_const\(p_name text\)[\s\S]*?\$\$([\s\S]*?)\$\$/);
    if (m) [body, from] = [m[1], f];
  }
  expect(from).toBe('095_race_ghost.sql');
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/when '(\w+)' then (\d+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

/** 기기 쪽 api.ts 의 상수 (api.ts 는 서버 연결을 불러오므로 글자로 읽는다) */
function apiConst(name: string): number {
  const m = readFileSync(new URL('../src/net/api.ts', import.meta.url), 'utf8').match(new RegExp(`const ${name} = (\\d+);`));
  expect(m, name).not.toBeNull();
  return Number(m![1]);
}

describe('095_race_ghost.sql 과 기기 상수', () => {
  const c = raceConst();
  it('_race_const: 최소 기록 · 경기 끝 · 다음 판 간격 · 준비까지', () => {
    expect(c.min_ms).toBe(27000);
    expect(c.min_ms).toBe(MIN_VALID_MS);
    expect(c.max_ms).toBe(END_AFTER_GO * 1000);
    expect(c.gap_ms).toBe(apiConst('GO_GAP_MS'));
    expect(c.lead_ms).toBe(apiConst('LEAD_MS'));
  });
  it('race_records 의 기록 하한도 min_ms', () => {
    expect(sql('095_race_ghost.sql')).toMatch(new RegExp(`check \\(best_ms >= ${MIN_VALID_MS}\\)`));
  });
  it('고스트 누름: 200개까지, 걸음 번호 1~10800 (GO 뒤 90초)', () => {
    const s = sql('095_race_ghost.sql');
    const n = s.match(/jsonb_array_length\(p_ghost->'presses'\) > (\d+)/);
    const step = s.match(/step > (\d+) then raise exception 'bad ghost'/);
    expect(Number(n?.[1])).toBe(200);
    expect(GHOST_MAX_PRESSES).toBe(200);
    expect(Number(step?.[1])).toBe(10800);
    expect(GHOST_MAX_STEP).toBe(10800);
    expect(Math.ceil(END_AFTER_GO / DT)).toBe(10800);
  });
});
