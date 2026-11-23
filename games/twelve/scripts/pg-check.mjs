// 078_twelve.sql 을 실제 Postgres(PGlite)에서 돌려 보는 확인 도구. npm test 에는 들어가지 않는다 (PGlite 를 저장소에 넣지 않는다).
//
//   1) PGlite 가 있는 폴더를 하나 마련한다:  mkdir pg && cd pg && npm init -y && npm i @electric-sql/pglite
//   2) cd games/twelve
//      npx vite-node scripts/pg-expect.ts > <pg 폴더>/expect.json
//      node scripts/pg-check.mjs <pg 폴더> [마이그레이션 폴더 = ../../supabase/migrations]
//
// 하는 일: 마이그레이션 전체(001~078)를 차례로 적용 → 권한 · 거절 · 시간 검사를 보고,
// expect.json(기기 규칙으로 계산한 기대값)과 같은 순서로 RPC 를 돌려 단계마다 서버 기록이 기기 규칙과 같은지 맞춰 본다.
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

// ---------- Supabase 흉내: auth 스키마, 역할, publication · pg_cron · pg_net 스텁 ----------
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

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!cond) fails++;
};
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sortKeys(v[k])])) : v);
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const eq = (a, b, msg) => ok(same(a, b), same(a, b) ? msg : `${msg}\n     서버 ${JSON.stringify(sortKeys(a))}\n     기대 ${JSON.stringify(sortKeys(b))}`);
const rejects = async (p, word, msg) => {
  try {
    await p;
    ok(false, `${msg}: 거절되지 않음`);
  } catch (e) {
    ok(String(e.message).includes(word), `${msg}: ${e.message}`);
  }
};
const su = async (sql, params = []) => {
  await db.exec('reset role');
  return (await db.query(sql, params)).rows;
};
const as = async (uid, sql, params = [], role = 'authenticated') => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role}`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
};
const signUp = async (login, nick) => (await su(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`${login}@sia-world.local`, { nickname: nick }]))[0].id;

/** 서버 기록 → 장비 id 를 순서 번호로 바꾼 모양 (pg-expect.ts 의 canon 과 같다) */
const canon = (s) => {
  const list = [...s.items].sort((a, b) => Number(a.id) - Number(b.id));
  const at = (id) => (id === null ? null : list.findIndex((it) => it.id === id));
  return { ...s, eq: { weapon: at(s.eq.weapon), armor: at(s.eq.armor), acc: at(s.eq.acc) }, items: list.map((it) => ({ base: it.base, plus: it.plus, lock: it.lock, box: it.box })), codex: [...s.codex].sort() };
};
const state = async (u) => (await as(u, 'select public.twelve_state() as j'))[0].j;
const ids = async (u) => (await state(u)).items.map((it) => Number(it.id)).sort((a, b) => a - b);
const start = async (u, map, hero = 'rat', mode = 'normal') => (await as(u, 'select public.twelve_start($1, $2, $3) as j', [map, mode, hero]))[0].j;
const finish = async (u, run, report) => (await as(u, 'select public.twelve_finish($1, $2) as j', [run, report]))[0].j;
/** 판 시작 시각을 sec 초 앞으로 (시간이 지난 것처럼) · 끝난 판을 하루 전으로 (다음 판과 겹치지 않게) */
const ago = (run, sec) => su(`update public.twelve_runs set started_at = now() - make_interval(secs => $2) where id = $1`, [run, sec]);
const old = (run) => su(`update public.twelve_runs set started_at = started_at - interval '1 day', finished_at = finished_at - interval '1 day' where id = $1`, [run]);
const R = (o = {}) => ({ time: 100, cleared: true, kills: { imp: 39 }, elites: 0, boss: false, chest: true, deaths: 0, potions: null, ...o });

const expect = JSON.parse(readFileSync(join(pgDir, 'expect.json'), 'utf8').replace(/^﻿/, ''));
const u1 = await signUp('twelveone', '열두1');
const u2 = await signUp('twelvetwo', '열두2');
const u3 = await signUp('twelvethree', '열두3');

// ---------- 무작위 ----------
for (const v of expect.rolls) {
  const got = Number((await su('select public._twelve_roll($1, $2, $3) as v', [v.seed, v.tag, v.n]))[0].v);
  ok(got === v.value, `_twelve_roll(${v.seed}, ${v.tag}, ${v.n}) = ${got} (기기 ${v.value})`);
}

// ---------- 프로필 · 권한 ----------
eq(canon(await state(u1)), expect.first, '처음 기록 = 기기의 emptyProfile');
eq(canon(await state(u1)), expect.first, '다시 읽어도 처음 장비가 또 생기지 않는다');
await rejects(as(null, 'select public.twelve_state()'), 'need login', '로그인 안 함');
await rejects(as(null, 'select public.twelve_state()', [], 'anon'), 'permission denied', 'anon 이 twelve_state');
await rejects(as(u1, 'select * from public.twelve_runs'), 'permission denied', 'twelve_runs 직접 읽기');
await rejects(as(u1, `update public.twelve_profiles set coins = 99999`), 'permission denied', '프로필 직접 고치기');
await rejects(as(u1, `insert into public.twelve_items (user_id, base) values ($1, 'r-n1-1')`, [u1]), 'permission denied', '장비 직접 넣기');
await rejects(as(u1, `insert into public.twelve_maps (user_id, mode, map_id, clears) values ($1, 'normal', '1-8', 1)`, [u1]), 'permission denied', '맵 기록 직접 넣기');
await rejects(as(u1, `insert into public.twelve_keys (user_id, mode, region) values ($1, 'normal', 1)`, [u1]), 'permission denied', '열쇠 직접 넣기');
await rejects(as(u1, `update public.twelve_pity set elite = 99`), 'permission denied', '확정 보정 직접 고치기');
await rejects(as(u1, `insert into public.twelve_tower (user_id, best_floor) values ($1, 99)`, [u1]), 'permission denied', '탑 기록 직접 넣기');
for (const fn of ['_twelve_profile_row($1)', '_twelve_grant($1, \'r-n1-1\')', '_twelve_state_json($1)', '_cat_progress_twelve($1)', '_twelve_check_hero($1, \'rat\')']) {
  await rejects(as(u1, `select public.${fn}`, [u1]), 'permission denied', `내부 함수 ${fn.split('(')[0]}`);
}
await rejects(as(u1, `select public._twelve_roll(1, 1, 1)`), 'permission denied', '내부 함수 _twelve_roll');
await rejects(as(u1, `select * from public._twelve_maps()`), 'permission denied', '내부 표 _twelve_maps');
ok((await as(u2, 'select count(*)::int as n from public.twelve_profiles'))[0].n === 0, '남의 프로필은 안 보임');
ok((await as(u1, 'select count(*)::int as n from public.twelve_items'))[0].n === 5, '내 장비 5개는 보임');
ok((await as(null, 'select count(*)::int as n from public.twelve_level_ranking', [], 'anon'))[0].n === 0, '레벨 랭킹: 아직 아무도 없음');
eq((await su(`select value from public.app_settings where key = 'game_open:twelve'`))[0].value, false, 'game_open:twelve 는 닫힘');
eq((await su('select public._cat_progress_twelve($1) as j', [u1]))[0].j, { have: 0, need: 1 }, '고양이 조건 0/1');
eq((await as(u1, `select public.character_progress('twelve') as j`))[0].j, { have: 0, need: 1, owned: [] }, 'character_progress(twelve)');

// ---------- 시작 검사 ----------
await rejects(start(u1, '1-2'), 'map locked', '잠긴 맵');
await rejects(start(u1, '9-9'), 'bad map', '없는 맵');
await rejects(start(u1, '2-1'), 'bad map', '준비 안 된 지형');
await rejects(start(u1, '1-1', 'rat', 'hard'), 'bad map', '어려움 모드는 준비 중');
await rejects(start(u1, '1-1', 'rat', 'easy'), 'bad mode', '없는 모드');
await rejects(start(u1, '1-1', 'rabbit'), 'hero locked', '합류 안 한 대원');
await rejects(start(u1, '1-1', 'cat'), 'locked character', '안 산 고양이');
await rejects(start(u1, '1-1', 'lion'), 'bad hero', '없는 대원');
await rejects(as(u1, `select public.twelve_set_hero('dragon')`), 'hero locked', '대표 대원: 합류 안 함');
await rejects(as(u1, `select public.twelve_set_hero('cat')`), 'locked character', '대표 대원: 안 산 고양이');
eq((await as(u1, `select public.twelve_set_hero('tiger') as j`))[0].j.hero, 'tiger', '대표 대원 바꾸기');
await as(u1, `select public.twelve_set_hero('rat')`);

// ---------- 끝 검사 (u2) ----------
{
  const a = await start(u2, '1-1');
  ok(typeof a.run === 'string' && Number.isInteger(a.seed) && a.seed >= 0, `시작 → { run, seed ${a.seed} }`);
  await rejects(finish(u2, a.run, R()), 'too early', '바로 끝낸 판 (서버가 잰 시간보다 김)');
  await rejects(finish(u1, a.run, R()), 'no run', '남의 판');
  await rejects(finish(u2, '00000000-0000-0000-0000-000000000000', R()), 'no run', '없는 판');
  await ago(a.run, 200);
  await rejects(finish(u2, a.run, R({ kills: { imp: 40 } })), 'bad kills', '최대치를 넘는 처치 수');
  await rejects(finish(u2, a.run, R({ kills: { club: 1 } })), 'bad kills', '그 맵에 없는 요괴');
  await rejects(finish(u2, a.run, R({ kills: { imp: 1.5 } })), 'bad kills', '정수가 아닌 처치 수');
  await rejects(finish(u2, a.run, R({ kills: [1] })), 'bad kills', '모양이 다른 처치 수');
  await rejects(finish(u2, a.run, R({ elites: 1 })), 'bad kills', '없는 정예');
  await rejects(finish(u2, a.run, R({ boss: true })), 'bad kills', '보스 없는 맵의 보스');
  await rejects(finish(u2, a.run, R({ time: 19 })), 'too early', '20초 안에 깬 판');
  await rejects(finish(u2, a.run, R({ time: 3601 })), 'bad time', '너무 긴 판');
  await rejects(finish(u2, a.run, R({ time: 'x' })), 'bad result', '숫자가 아닌 시간');
  await rejects(finish(u2, a.run, { cleared: true }), 'bad result', '값이 빠짐');
  await rejects(finish(u2, a.run, R({ kills: { imp: 20 } })), 'bad result', '요괴 70% 를 안 잡고 클리어');
  await rejects(finish(u2, a.run, R({ potions: [[1, 0], [0, 0, 0]] })), 'bad potions', '모양이 다른 물약');
  await rejects(finish(u2, a.run, R({ potions: [[99, 0, 0], [0, 0, 0]] })), 'bad potions', '너무 많은 물약');
  const j = await finish(u2, a.run, R());
  ok(j.result.exp === 39 * 4 && j.result.first === true && j.result.stars === 7, `1-1 클리어: 경험치 ${j.result.exp} · 별 ${j.result.stars}`);
  ok(j.result.siaCoin === true, '100초 판 → 시아코인');
  eq((await su('select sia_coins from public.wallets where user_id = $1', [u2]))[0].sia_coins, 1, '지갑 시아코인 +1');
  eq((await su(`select count(*)::int as n from public.sia_coin_logs where game = 'twelve' and ref = $1`, [a.run]))[0].n, 1, "sia_coin_logs ('twelve', 판 번호)");
  await rejects(finish(u2, a.run, R()), 'already finished', '두 번 끝내기');
  await old(a.run);
  // 겹침 · 너무 늦음 · 짧은 판
  const b = await start(u2, '1-1');
  const c = await start(u2, '1-1');
  await ago(b.run, 300);
  await ago(c.run, 150);
  const jc = await finish(u2, c.run, R({ time: 30 }));
  ok(jc.result.siaCoin === false && jc.result.first === false, '30초 판은 시아코인 없음 (60초 미만)');
  await rejects(finish(u2, b.run, R()), 'overlap', '먼저 끝난 다른 판과 시간이 겹침');
  await old(c.run);
  await su(`update public.twelve_runs set started_at = now() - interval '3 hours' where id = $1`, [b.run]);
  await rejects(finish(u2, b.run, R()), 'too late', '3시간 지난 판');
  // 도중에 닫은 판(끝내지 않은 판)은 아무것도 주지 않는다
  eq((await state(u2)).maps.normal['1-1'].clears, 2, '끝내지 않은 판은 기록되지 않음');
  eq((await as(null, 'select level, region, hero, hard_done, place, total from public.twelve_level_ranking', [], 'anon'))[0], { level: (await state(u2)).level, region: 1, hero: 'rat', hard_done: false, place: 1, total: 1 }, '레벨 랭킹에 한 줄');
  // 시아코인: 내 레벨이 권장 레벨보다 15 이상 높으면 없음
  await su(`update public.twelve_profiles set level = 16, exp = 0 where user_id = $1`, [u2]);
  await su(`update public.sia_coin_logs set created_at = created_at - interval '1 hour' where user_id = $1`, [u2]).catch(() => null);
  const d = await start(u2, '1-1');
  await ago(d.run, 200);
  const jd = await finish(u2, d.run, R());
  ok(jd.result.siaCoin === false, 'Lv16 이 권장 Lv1 맵을 깨면 시아코인 없음');
  ok(jd.result.exp === Math.floor((39 * 4 * 25) / 100), `레벨 차이 10 이상 → 경험치 25% (${jd.result.exp})`);
}

// ---------- 기기 규칙과 맞춰 보기 (u1) ----------
const itemArgs = async (args) => {
  const list = await ids(u1);
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'item') out.p_item = list[v];
    else if (k === 'items') out.p_items = v.map((i) => list[i]);
    else out[k] = v;
  }
  return out;
};
let n = 0;
let diff = 0;
for (const st of expect.steps) {
  n++;
  const name = `#${n} ${st.op} ${st.map ?? st.fn ?? ''} ${st.fn ? JSON.stringify(st.args) : ''}`;
  if (st.op === 'pity') {
    await su(`insert into public.twelve_pity (user_id, mode, region, elite, boss, key) values ($1, 'normal', $2, $3, $4, $5)
      on conflict (user_id, mode, region) do update set elite = excluded.elite, boss = excluded.boss, key = excluded.key`, [u1, st.region, st.elite, st.boss, st.key]);
    continue;
  }
  if (st.op === 'coins') {
    await su(`update public.twelve_profiles set coins = coins + $2 where user_id = $1`, [u1, st.add]);
    continue;
  }
  let got;
  let why = null;
  if (st.op === 'play') {
    const a = await start(u1, st.map);
    await su(`update public.twelve_runs set seed = $2, started_at = now() - make_interval(secs => $3) where id = $1`, [a.run, st.seed, st.report.time + 30]);
    const j = await finish(u1, a.run, st.report);
    await old(a.run);
    got = canon(j.state);
    const res = { ...j.result, siaCoin: undefined, items: j.result.items.map((it) => ({ base: it.base, box: it.box })) };
    if (!same(res, st.result)) {
      diff++;
      eq(res, st.result, `${name} 결과`);
    }
  } else {
    const args = await itemArgs(st.args);
    const keys = Object.keys(args);
    try {
      got = canon((await as(u1, `select public.${st.fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as j`, keys.map((k) => args[k])))[0].j);
    } catch (e) {
      why = e.message;
      got = canon(await state(u1));
    }
    if ((why === null) !== (st.why === null) || (st.why && !why.includes(st.why))) {
      diff++;
      ok(false, `${name}: 서버 ${why ?? '됨'} / 기기 ${st.why ?? '됨'}`);
    }
  }
  if (!same(got, st.state)) {
    diff++;
    eq(got, st.state, `${name} 뒤 기록`);
  }
}
ok(diff === 0, `기기 규칙과 서버가 ${expect.steps.length}단계 모두 같다 (드랍·확정 보정·열쇠·별 보상·상점·대장간·가방)`);
{
  const s = await state(u1);
  console.log(`     끝 기록: Lv ${s.level} · 엽전 ${s.coins} · 강화석 ${s.stones} · 장비 ${s.items.length}개(보관함 ${s.items.filter((i) => i.box).length}) · 열쇠 ${JSON.stringify(s.keys.normal)} · 얻어 본 것 ${JSON.stringify(s.codex)}`);
  ok(s.keys.normal.length === 1 && s.codex.includes('s-n1'), '열쇠 1개 · 별 24개 보상을 받았다');
}

// ---------- 고양이: 조건(보통 모드 최종보스) 뒤에 사서 고른다 (u3) ----------
{
  await state(u3);
  await su(`insert into public.wallets (user_id, sia_coins) values ($1, 150) on conflict (user_id) do update set sia_coins = 150`, [u3]);
  const no = (await as(u3, `select public.buy_character('twelve', 'cat') as j`))[0].j;
  ok(no.ok === false && no.reason === 'condition', `조건 전에는 못 산다 (${JSON.stringify(no)})`);
  await su(`insert into public.twelve_maps (user_id, mode, map_id, stars, clears) values ($1, 'normal', 'final', 0, 1)`, [u3]);
  eq((await su('select public._cat_progress_twelve($1) as j', [u3]))[0].j, { have: 1, need: 1 }, '최종보스 처치 → 고양이 조건 1/1');
  const yes = (await as(u3, `select public.buy_character('twelve', 'cat') as j`))[0].j;
  ok(yes.ok === true && yes.siaCoins === 50, `시아코인 100개로 산다 (${JSON.stringify(yes)})`);
  eq((await as(u3, `select public.twelve_set_hero('cat') as j`))[0].j.hero, 'cat', '고양이를 대표 대원으로');
  const a = await start(u3, '1-1', 'cat');
  ok(!!a.run, '고양이로 판 시작');
  await rejects(start(u1, '1-1', 'cat'), 'locked character', '다른 사람은 여전히 못 고른다');
}

console.log(fails ? `\n실패 ${fails}개` : '\n모두 통과');
process.exit(fails ? 1 : 0);
