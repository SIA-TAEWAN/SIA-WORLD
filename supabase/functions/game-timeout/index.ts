/**
 * game-timeout: 차례 시간(20초)이 지난 방에서 자동 행동을 실행한다.
 * pg_cron(cron_tick)이 마감이 지난 방이 있을 때만 { rooms: [{ id, version }] }로 부른다.
 * 사용자 JWT 없이 불리므로(verify_jwt 끔) DB에만 있는 비밀값(app_config.cron_secret)으로 확인한다.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { ENGINES } from '../_shared/engines.ts';
import { Runner } from '../_shared/runner.ts';
import { supabaseStore } from '../_shared/store.ts';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let secret: string | null = null;

/** 길이와 내용을 끝까지 비교 (시간차로 비밀값을 알아내지 못하게) */
function sameText(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!secret) {
    const { data } = await sb.from('app_config').select('value').eq('key', 'cron_secret').maybeSingle();
    secret = (data as { value: string } | null)?.value ?? null;
  }
  const given = req.headers.get('x-cron-secret') ?? '';
  if (!secret || !sameText(given, secret)) return new Response('forbidden', { status: 403 });

  const body = await req.json().catch(() => null);
  const rooms: { id: string; version?: number; autoOnly?: boolean }[] = Array.isArray(body?.rooms) ? body.rooms.slice(0, 50) : [];
  const runner = new Runner(supabaseStore(sb), ENGINES);
  const results: Record<string, unknown> = {};
  for (const r of rooms) {
    if (typeof r?.id !== 'string') continue;
    try {
      results[r.id] = await runner.timeout(r.id, typeof r.version === 'number' ? r.version : undefined, r.autoOnly === true);
    } catch (e) {
      console.error(r.id, e);
      results[r.id] = { error: String((e as Error)?.message ?? e) };
    }
  }
  return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
});
