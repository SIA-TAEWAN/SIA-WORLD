// 123_nyang.sql 을 실제 Postgres(PGlite)에서 돌려 기기 규칙(src/game/rules.ts)과 같은 결과인지 본다. npm test 에는 들어가지 않는다.
//
//   1) PGlite 가 있는 폴더:  mkdir pg && cd pg && npm init -y && npm i @electric-sql/pglite
//   2) cd games/nyang
//      npx vite-node scripts/pg-expect.ts > <pg 폴더>/nyang-expect.json
//      node scripts/pg-check.mjs <pg 폴더> [마이그레이션 폴더 = ../../supabase/migrations]
//
// 서버 시각은 _nyang_now() 를 설정 값(nyang.now)을 읽도록 바꿔서 단계마다 맞춘다. 시아코인은 _grant_sia_coin 의 15초 간격(실제 시계) 때문에
// 바로 못 받을 수 있어 siaDue · siaPaid · sia 는 (siaDue + siaPaid) 만 맞춰 본다.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pgDir = resolve(process.argv[2] ?? '.');
const migDir = resolve(process.argv[3] ?? join(here, '../../../supabase/migrations'));
const req = createRequire(join(pgDir, 'x.js'));
const pglitePath = req.resolve('@electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(pglitePath).href);
const pgcrypto = { name: 'pgcrypto', setup: async () => ({ bundlePath: pathToFileURL(join(dirname(pglitePath), 'pgcrypto.tar.gz')) }) };

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth; create schema extensions;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  create publication supabase_realtime;
  create schema cron; create table cron.jobs (name text primary key, sched text, cmd text);
  create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.jobs values (n, s, c) on conflict (name) do update set sched = excluded.sched, cmd = excluded.cmd returning 1::bigint $$;
  create schema net; create table net.calls (id serial, url text, headers jsonb, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ insert into net.calls (url, headers, body) values (url, headers, body) returning id::bigint $$;
`);
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(migDir, f), 'utf8').replace(/create extension if not exists pg_(cron|net)[^;]*;/g, ''));
  } catch (e) {
    throw new Error(`${f}: ${e.message}`);
  }
}
console.log(`마이그레이션 적용 끝 (${migDir})`);
await db.exec(`create or replace function public._nyang_now() returns bigint language sql stable as $$ select current_setting('nyang.now')::bigint $$;`);

let fails = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond || process.env.VERBOSE) console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!cond) fails++;
};
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

const signUp = async (login) => (await db.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [`${login}@sia-world.local`, { nickname: login }])).rows[0].id;
async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  if (uid) await db.exec('set role authenticated');
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
async function call(uid, sql, params) {
  try {
    return { ok: (await as(uid, sql, params))[0]?.r };
  } catch (e) {
    return { error: e.message };
  }
}

// ---------- 권한 ----------
const u1 = await signUp('nyang1');
await db.exec(`select set_config('nyang.now', '1795680000', false)`);
ok((await call(null, 'select public.nyang_state(true) r')).error !== undefined, '로그인 안 하면 거절');
for (const t of ['nyang_profiles', 'nyang_cats', 'nyang_pots', 'nyang_album']) {
  ok(/permission denied/.test((await call(u1, `select count(*) r from public.${t}`)).error ?? ''), `${t} 직접 읽기 거절`);
  ok(/permission denied/.test((await call(u1, `delete from public.${t} returning 1 r`)).error ?? ''), `${t} 직접 쓰기 거절`);
}
for (const f of ['_nyang_top_level(auth.uid())', "_nyang_owns_furniture(auth.uid(), 'desk')", "_nyang_owns_style(auth.uid(), 'wall_cream')", '_nyang_care(auth.uid(), true, 0)', '_nyang_pay(auth.uid())', "_nyang_const('max')", '_nyang_now()', "_nyang_add_item(auth.uid(), 'medicine', 5)", "_nyang_item(auth.uid(), 'fur')"]) {
  ok(/permission denied/.test((await call(u1, `select public.${f} r`)).error ?? ''), `내부 함수 ${f} 거절`);
}
const open = await db.query("select value from public.app_settings where key = 'game_open:nyang'");
ok(open.rows[0]?.value === false, 'game_open:nyang = false');

// ---------- 기기 규칙과 단계마다 대조 ----------
const steps = JSON.parse(readFileSync(join(pgDir, 'nyang-expect.json'), 'utf8'));
const u2 = await signUp('nyang2');
const CALL = {
  state: 'select public.nyang_state($1) r',
  adopt: 'select public.nyang_adopt($1, $2, $3) r',
  feed: 'select public.nyang_feed($1, $2) r',
  water: 'select public.nyang_water($1) r',
  clean: 'select public.nyang_clean($1) r',
  pet: 'select public.nyang_pet($1, $2) r',
  cure: 'select public.nyang_cure($1, $2) r',
  play_start: 'select public.nyang_play_start($1, $2) r',
  play: 'select public.nyang_play($1, $2) r',
  brush: 'select public.nyang_brush($1) r',
  churu: 'select public.nyang_churu($1, $2) r',
  gift: 'select public.nyang_gift($1) r',
  seen: 'select public.nyang_seen($1, $2) r',
  plant: 'select public.nyang_plant($1, $2) r',
  water_pot: 'select public.nyang_water_pot($1) r',
  harvest: 'select public.nyang_harvest($1) r',
  expand_pots: 'select public.nyang_expand_pots() r',
  buy: 'select public.nyang_buy($1, $2) r',
  sell: 'select public.nyang_sell($1, $2) r',
  exchange: 'select public.nyang_exchange($1) r',
  treat: 'select public.nyang_treat($1, $2) r',
  place: 'select public.nyang_place($1::jsonb) r',
  vase: 'select public.nyang_vase($1) r',
  photo: 'select public.nyang_photo($1, $2, $3, $4, $5, $6) r',
  photo_delete: 'select public.nyang_photo_delete($1) r',
};
const fixSia = (st) => {
  const p = { ...st.profile, siaGot: st.profile.siaDue + st.profile.siaPaid };
  delete p.siaDue;
  delete p.siaPaid;
  delete p.sia;
  return { profile: p, cats: st.cats };
};
let n = 0;
const kinds = {};
for (const step of steps) {
  await db.exec(`select set_config('nyang.now', '${step.t}', false)`);
  if (step.op === 'setlove') {
    await db.query('update public.nyang_cats set love = $1 where user_id = $2 and slot = $3', [step.args[1], u2, step.args[0]]);
    continue;
  }
  if (step.op === 'setitem') {
    await db.query('update public.nyang_profiles set items = items || jsonb_build_object($1::text, $2::int) where user_id = $3', [step.args[0], step.args[1], u2]);
    continue;
  }
  if (step.op === 'setcoins') {
    await db.query('update public.nyang_profiles set coins = $1 where user_id = $2', [step.args[0], u2]);
    continue;
  }
  if (step.op === 'rank') {
    // 집사 랭킹: 내 줄이 기기 규칙의 친밀도 합 · 돌본 날 · 달성 시각과 같고, 관리자가 되면 빠진다
    const e = step.out;
    const q = () => as(u2, 'select love, cats, care_days, extract(epoch from achieved_at)::bigint at, place, total from public.nyang_ranking where user_id = $1', [u2]);
    const row = (await q())[0];
    ok(!!row && Number(row.love) === e.love && row.cats === e.cats && row.care_days === e.careDays && Number(row.at) === e.at && row.place === 1 && row.total === 1,
      `집사 랭킹 줄 ${JSON.stringify(row)} = 기대 ${JSON.stringify(e)}`);
    await db.exec('set role anon');
    const anonN = (await db.query('select count(*)::int n from public.nyang_ranking')).rows[0]?.n;
    await db.exec('reset role');
    ok(anonN === 1, '집사 랭킹: 로그인 안 해도 읽기 · 고양이 없는 사람(nyang1)은 없음');
    await db.query('update public.profiles set is_admin = true where id = $1', [u2]);
    ok((await q()).length === 0, '집사 랭킹: 관리자는 빠진다');
    await db.query('update public.profiles set is_admin = false where id = $1', [u2]);
    continue;
  }
  if (step.op === 'setsia') {
    await db.query('update public.wallets set sia_coins = $1 where user_id = $2', [step.args[0], u2]);
    continue;
  }
  n++;
  const key = `${step.op}:${'error' in step.out ? step.out.error : 'ok'}`;
  kinds[key] = (kinds[key] ?? 0) + 1;
  const r = await call(u2, CALL[step.op], step.op === 'place' ? [JSON.stringify(step.args[0])] : step.args);
  const label = `${n}. ${step.op}(${step.args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(', ')}) @${step.t}`;
  if ('error' in step.out) {
    ok(r.error === step.out.error, `${label} → '${step.out.error}' (서버 ${r.error ?? '성공'})`);
    continue;
  }
  if (r.error) {
    ok(false, `${label} 서버 거절 '${r.error}'`);
    continue;
  }
  const { state: es, ...erest } = step.out;
  const { state: gs, ...grest } = r.ok;
  ok(gs.now === step.t, `${label} 서버 시각`);
  delete gs.now;
  const st = same(fixSia(gs), fixSia(es));
  ok(st, `${label} 상태${st ? '' : `\n     서버 ${JSON.stringify(sortKeys(fixSia(gs)))}\n     기대 ${JSON.stringify(sortKeys(fixSia(es)))}`}`);
  const rs = same(grest, erest);
  ok(rs, `${label} 결과${rs ? '' : `\n     서버 ${JSON.stringify(grest)}\n     기대 ${JSON.stringify(erest)}`}`);
}
// 시아코인: 받은 기록이 sia_coin_logs 에 'nyang' 으로 남고, 쓴 기록(sia_coin_spends 'buy:<n>')이 산 수와 같다 (지갑은 setsia 로 맞췄으니 보지 않는다)
const logs = await db.query("select count(*)::int n from public.sia_coin_logs where user_id = $1 and game = 'nyang'", [u2]);
const spends = await db.query("select count(*)::int n, coalesce(sum(amount), 0)::int a from public.sia_coin_spends where user_id = $1 and game = 'nyang'", [u2]);
const prof = await db.query('select p.sia_paid, p.sia_due, p.buy_seq from public.nyang_profiles p where p.user_id = $1', [u2]);
const pr = prof.rows[0];
ok(logs.rows[0].n === pr.sia_paid && logs.rows[0].n > 0, `시아코인 기록 ${logs.rows[0].n}개 = 받은 수 ${pr.sia_paid} (못 받은 것 ${pr.sia_due})`);
ok(spends.rows[0].n === pr.buy_seq && pr.buy_seq > 0, `시아코인 쓴 기록 ${spends.rows[0].n}개 (${spends.rows[0].a}개) = 산 수 ${pr.buy_seq}`);
console.log('단계 종류:', JSON.stringify(kinds));
console.log(`\n${n}단계 대조 · 확인 ${checks}개 · ${fails ? `실패 ${fails}개` : '모두 통과'}`);
process.exit(fails ? 1 : 0);
