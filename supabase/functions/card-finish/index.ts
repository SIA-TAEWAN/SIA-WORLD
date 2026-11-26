/**
 * card-finish: 시아카드배틀 막 끝 · 판 끝 기록 (PRD [기술] · [진행·재화]).
 * 입력 { rules, runId, log: Input[] } (사용자 JWT로 호출). 화면은 판 처음부터의 입력 목록 전부를 보낸다.
 * card_runs 에서 판(주인 · 진행 중)과 시작 때 정한 씨앗·영웅·모드·숙련·시작 엽전(관리자 시험 판)을 읽고 → 같은 규칙 코드로 다시 돌려
 * (_shared/card/verify.ts) → card_finish_verified(service_role 만)로 깬 막·시아코인·숙련·끝없는 기록·오늘의 도전 점수를 저장한다.
 * 진행 중인 판은 마지막으로 시작한 막의 처음까지만 기록한다 (다른 기기는 거기서 이어 한다).
 * 출력 { result: { mode, acts, floors, over, cleared, newCoins, coins, mastery, daily, endless } }
 * 거절은 4xx { error: '<까닭>' } (화면이 보관하지 않고 버린다), 서버 문제는 5xx (화면이 보관했다 다시 보낸다).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { CARD_RULES, VerifyError, verifyRun } from '../_shared/card/verify.ts';

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

/** card_finish_verified 가 raise 하는 거절 글자 → 상태 코드 */
const REJECTS: [string, number][] = [
  ['already finished', 409],
  ['stale', 409],
  ['old rules', 409],
  ['no run', 404],
  ['bad log', 400],
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
    if (body?.rules !== CARD_RULES) return json({ error: 'old rules' }, 409);
    const runId = typeof body?.runId === 'string' ? body.runId : '';
    if (!/^[0-9a-f-]{36}$/i.test(runId)) return json({ error: 'bad run' }, 400);

    const { data: run, error: readErr } = await sb
      .from('card_runs')
      .select('id, user_id, mode, hero, mastery, seed, day, status, start_gold')
      .eq('id', runId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!run || run.user_id !== userId) return json({ error: 'no run' }, 404);
    if (run.status !== 'active') return json({ error: 'already finished' }, 409);

    let v;
    try {
      v = verifyRun({ mode: run.mode, hero: run.hero, mastery: run.mastery ?? 0, seed: Number(run.seed), day: run.day ?? null, startGold: run.start_gold ?? null }, body?.log);
    } catch (e) {
      if (e instanceof VerifyError) return json({ error: e.message }, 400);
      throw e;
    }

    const { data, error } = await sb.rpc('card_finish_verified', { p_user: userId, p_run: runId, p_result: v.result, p_log: v.log });
    if (error) {
      const hit = REJECTS.find(([w]) => error.message.includes(w));
      if (hit) return json({ error: hit[0] }, hit[1]);
      throw new Error(error.message);
    }
    return json(data);
  } catch (e) {
    console.error(e);
    // 원인을 찾을 수 있게 짧은 설명을 같이 보낸다 (비밀값은 들어 있지 않다)
    return json({ error: 'server error', detail: String((e as Error)?.message ?? e).slice(0, 200) }, 500);
  }
});
