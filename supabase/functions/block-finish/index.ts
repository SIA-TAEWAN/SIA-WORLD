/**
 * block-finish: 시아블록 판 끝 기록 (PRD 8 "기록과 검증").
 * 입력 { rules, runId, log: [조각 번호, 줄, 칸][], score } (사용자 JWT로 호출). 화면은 놓기 기록과 자기가 계산한 점수만 보낸다.
 * block_runs 에서 판(주인 · 아직 안 끝남)과 서버가 고른 시드를 읽고 → 같은 규칙 코드로 다시 돌려
 * (_shared/block/verify.ts) → block_finish_verified(service_role 만)로 기록 · 랭킹 · 시아코인을 저장한다.
 * 기기 점수와 서버 점수가 다르면 판은 끝내되 랭킹에 넣지 않는다 (verified false).
 * 출력 { score, verified, best, weekBest, newBest, rank, weekRank, gotCoin, siaCoins }
 * 거절은 4xx { error: '<까닭>' } (화면이 보관하지 않고 버린다), 서버 문제는 5xx (화면이 보관했다 다시 보낸다).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { BLOCK_RULES, VerifyError, verifyRun } from '../_shared/block/verify.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** block_finish_verified 가 raise 하는 거절 글자 → 상태 코드 */
const REJECTS: [string, number][] = [
  ['already finished', 409],
  ['too fast', 400],
  ['too late', 400],
  ['no run', 404],
  ['bad result', 400],
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth, error: authErr } = await sb.auth.getUser(token);
    const userId = auth?.user?.id;
    // 인증 서버가 잠깐 안 될 때(5xx · 통신 실패)는 'need login'(4xx: 화면이 기록을 버림) 대신 503: 화면이 보관했다 다시 보낸다
    if (!userId) return authErr && !(authErr.status && authErr.status < 500) ? json({ error: 'auth unavailable' }, 503) : json({ error: 'need login' }, 401);

    const body = await req.json().catch(() => null);
    if (body?.rules !== BLOCK_RULES) return json({ error: 'old rules' }, 409);
    const runId = typeof body?.runId === 'string' ? body.runId : '';
    if (!/^[0-9a-f-]{36}$/i.test(runId)) return json({ error: 'bad run' }, 400);
    // SQL int 범위 밖의 점수는 받지 않는다 (null → 점수 불일치로 끝냄, 다시 보내지 않음)
    const claimed = Number.isInteger(body?.score) && body.score >= 0 && body.score <= 2147483647 ? (body.score as number) : null;

    const { data: run, error: readErr } = await sb
      .from('block_runs')
      .select('id, user_id, seed, finished_at')
      .eq('id', runId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!run || run.user_id !== userId) return json({ error: 'no run' }, 404);
    if (run.finished_at) return json({ error: 'already finished' }, 409);

    let v;
    try {
      v = verifyRun(Number(run.seed), body?.log);
    } catch (e) {
      if (e instanceof VerifyError) return json({ error: e.message }, 400);
      throw e;
    }
    if (v.score > 2147483647) return json({ error: 'bad result' }, 400);

    const { data, error } = await sb.rpc('block_finish_verified', { p_user: userId, p_run: runId, p_result: v, p_claimed: claimed, p_log: body.log });
    if (error) {
      const hit = REJECTS.find(([w]) => error.message.includes(w));
      if (hit) return json({ error: hit[0] }, hit[1]);
      throw new Error(error.message);
    }
    return json(data);
  } catch (e) {
    console.error(e);
    return json({ error: 'server error', detail: String((e as Error)?.message ?? e).slice(0, 200) }, 500);
  }
});
