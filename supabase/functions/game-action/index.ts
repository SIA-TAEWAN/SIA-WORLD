/**
 * game-action: 모든 게임 행동을 처리하는 딜러.
 * 입력 { roomId, action: 'start' | 'act' | 'sync' | 'replay', payload } (사용자 JWT로 호출)
 * 권한·차례 확인 → 규칙 검사 → 상태 변경 → AI 차례 이어서 → 판 끝이면 정산 → 공개 상태 저장(Realtime으로 전달)
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { ENGINES } from '../_shared/engines.ts';
import { GameError, Runner } from '../_shared/runner.ts';
import { supabaseStore } from '../_shared/store.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await sb.auth.getUser(token);
    const userId = auth?.user?.id;
    if (!userId) return json({ error: 'need login' }, 401);

    const body = await req.json().catch(() => null);
    const roomId = typeof body?.roomId === 'string' ? body.roomId : '';
    if (!/^[0-9a-f-]{36}$/i.test(roomId)) return json({ error: 'bad room' }, 400);

    const runner = new Runner(supabaseStore(sb), ENGINES);
    if (body.action === 'start') return json(await runner.start(roomId, userId));
    // n: 기기에서 먼저 진행하는 화면(맞고)이 보내는 진행 수 — 서버 상태와 다르면 409 'out of sync'
    if (body.action === 'act') return json(await runner.act(roomId, userId, body.payload, Number.isInteger(body.n) ? body.n : undefined));
    // 혼자 하는 맞고 (기기에서 진행): 전체 상태 받기 · 사람 행동 목록 보내기
    if (body.action === 'sync') return json(await runner.sync(roomId, userId, body.payload));
    if (body.action === 'replay') return json(await runner.replay(roomId, userId, body.payload));
    return json({ error: 'bad action' }, 400);
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    console.error(e);
    // 원인을 찾을 수 있게 짧은 설명을 같이 보낸다 (비밀값은 들어 있지 않다)
    return json({ error: 'server error', detail: String((e as Error)?.message ?? e).slice(0, 200) }, 500);
  }
});
