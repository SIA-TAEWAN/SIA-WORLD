// SIA WORLD 공통 Supabase 클라이언트.
// 모든 페이지(로비, 각 게임)가 이 모듈 하나를 같이 써서 로그인 세션도 하나로 유지된다.
// anon(publishable) 키는 공개용 키라 코드에 두어도 된다. 데이터 보호는 RLS와 DB 함수가 맡는다.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

export const SUPABASE_URL = 'https://ssbopykmgqrjrrtfespm.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable__nVhHXDOjH4QdvsrzPyPAg_nxhsTsK3';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  // 세션은 localStorage에 저장 → 브라우저를 닫았다 열어도 로그인 유지
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sia-world-auth' },
  realtime: { params: { eventsPerSecond: 20 } },
});
