import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS, LIVES } from '../src/net/api';
import { SQL_FILE, stageBlock } from '../scripts/sqlrows.mjs';

// 윈도우 체크아웃(CRLF)에서도 같게 비교하도록 줄바꿈을 맞춘다
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const latest = lf(readFileSync(SQL_FILE, 'utf8')); // 113_pang_lives.sql — 스테이지 표·목숨의 최신 정의
const first = lf(readFileSync(new URL('../../../supabase/migrations/111_pang.sql', import.meta.url), 'utf8'));

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

describe('119: pang_start 재시도 · 랭킹에서 관리자 빼기', () => {
  const t = lf(readFileSync(new URL('../../../supabase/migrations/119_review_fixes.sql', import.meta.url), 'utf8'));
  const at = t.indexOf('create or replace function public.pang_start(p_stage int)');
  const body = t.slice(at, t.indexOf('$$;', at)).replace(/\s+/g, ' ');
  it('2분 안에 시작한 끝나지 않은 같은 스테이지 판은 목숨을 빼기 전에 그대로 돌려준다', () => {
    expect(at).toBeGreaterThan(0);
    const reuse = body.indexOf("pr.stage = p_stage and pr.finished_at is null and pr.started_at > now() - interval '2 minutes'");
    expect(reuse).toBeGreaterThan(body.indexOf('from public._pang_refill(me)'));
    expect(reuse).toBeLessThan(body.indexOf('left_ := left_ - 1;'));
    expect(body).toContain("return jsonb_build_object('run', rid, 'lives', left_, 'nextLife', nxt);");
    expect(body).toContain('security definer set search_path = public');
    expect(t).toContain('grant execute on function public.pang_start(int) to authenticated;');
  });
  it('pang_ranking 에서 관리자 빼기 (열 그대로)', () => {
    expect(t).toContain('where r.total_stars > 0 and not coalesce(p.is_admin, false);');
    expect(t).toContain('grant select on public.pang_ranking to anon, authenticated;');
  });
});
