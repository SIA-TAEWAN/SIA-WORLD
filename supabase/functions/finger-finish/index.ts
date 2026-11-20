/**
 * finger-finish: 시아핑거 판 결과 저장 (PRD "서버와 검증").
 * 입력 { runId, inputs: ShotInput[] } (사용자 JWT로 호출). 화면은 조작 목록만 보낸다.
 * finger_runs 에서 판(주인 · 아직 안 끝남)과 시작 때 스냅숏을 읽고 → 같은 시뮬레이션으로 다시 돌려
 * (_shared/finger/verify.ts) → finger_finish_verified(service_role 만)로 엽전·별·합류·시아코인을 저장한다.
 * 출력 { profile, result: { coins, stars, first, best, siaCoin, newHeroes }, replay: RunResult }
 * 거절은 4xx { error: '<까닭>' } (화면이 보관하지 않고 버린다), 서버 문제는 5xx (화면이 보관했다 다시 보낸다).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { VerifyError, verifyRun } from '../_shared/finger/verify.ts';

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

/** finger_finish_verified 가 raise 하는 거절 글자 → 상태 코드 */
const REJECTS: [string, number][] = [
  ['already finished', 409],
  ['overlap', 409],
  ['too early', 400],
  ['too late', 400],
  ['no run', 404],
  ['bad result', 400],
  ['bad stage', 400],
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await sb.auth.getUser(token);
    const userId = auth?.user?.id;
    if (!userId) return json({ error: 'need login' }, 401);

    const body = await req.json().catch(() => null);
    const runId = typeof body?.runId === 'string' ? body.runId : '';
    if (!/^[0-9a-f-]{36}$/i.test(runId)) return json({ error: 'bad run' }, 400);

    const { data: run, error: readErr } = await sb
      .from('finger_runs')
      .select('id, user_id, stage_id, mode, party, levels, upgrades, finished_at')
      .eq('id', runId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!run || run.user_id !== userId) return json({ error: 'no run' }, 404);
    if (run.finished_at) return json({ error: 'already finished' }, 409);

    let replay;
    try {
      replay = verifyRun(
        { stage: run.stage_id, mode: run.mode, party: run.party ?? [], levels: run.levels ?? {}, upgrades: run.upgrades ?? {} },
        body?.inputs,
      );
    } catch (e) {
      if (e instanceof VerifyError) return json({ error: e.message }, 400);
      throw e;
    }

    const { data, error } = await sb.rpc('finger_finish_verified', { p_user: userId, p_run: runId, p_result: replay });
    if (error) {
      const hit = REJECTS.find(([w]) => error.message.includes(w));
      if (hit) return json({ error: hit[0] }, hit[1]);
      throw new Error(error.message);
    }
    return json({ ...(data as Record<string, unknown>), replay });
  } catch (e) {
    console.error(e);
    // 원인을 찾을 수 있게 짧은 설명을 같이 보낸다 (비밀값은 들어 있지 않다)
    return json({ error: 'server error', detail: String((e as Error)?.message ?? e).slice(0, 200) }, 500);
  }
});
