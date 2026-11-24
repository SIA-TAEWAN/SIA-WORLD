// 078_twelve.sql + 094_twelve_full.sql 을 실제 Postgres(PGlite)에서 돌려 보는 확인 도구. npm test 에는 들어가지 않는다 (PGlite 를 저장소에 넣지 않는다).
//
//   1) PGlite 가 있는 폴더를 하나 마련한다:  mkdir pg && cd pg && npm init -y && npm i @electric-sql/pglite
//   2) cd games/twelve
//      npx vite-node scripts/pg-expect.ts > <pg 폴더>/expect.json
//      node scripts/pg-check.mjs <pg 폴더> [마이그레이션 폴더 = ../../supabase/migrations]
//
// 하는 일: 마이그레이션 전체(001~094)를 차례로 적용 → 권한 · 거절 · 시간 검사를 보고 (최종보스맵 · 고양이 구매 · 어려움 모드 포함),
// expect.json(기기 규칙으로 계산한 기대값)과 같은 순서로 RPC 를 돌려 단계마다 서버 기록이 기기 규칙과 같은지 맞춰 본다.
// 끝없는 탑(시작 · 층 보고 · 끝)도 같은 방식으로 맞춰 보고, 권한 · 시아코인(10층마다) · 랭킹 뷰를 따로 본다.
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
  // 탑 기록의 날짜(at)는 맞춰 보지 않는다
  const tower = s.tower ? { floor: s.tower.floor, time: s.tower.time, level: s.tower.level, hero: s.tower.hero, cps: s.tower.cps } : null;
  return { ...s, eq: { weapon: at(s.eq.weapon), armor: at(s.eq.armor), acc: at(s.eq.acc) }, items: list.map((it) => ({ base: it.base, plus: it.plus, lock: it.lock, box: it.box })), codex: [...s.codex].sort(), tower };
};
const state = async (u) => (await as(u, 'select public.twelve_state() as j'))[0].j;
const ids = async (u) => (await state(u)).items.map((it) => Number(it.id)).sort((a, b) => a - b);
const start = async (u, map, hero = 'rat', mode = 'normal') => (await as(u, 'select public.twelve_start($1, $2, $3) as j', [map, mode, hero]))[0].j;
const finish = async (u, run, report) => (await as(u, 'select public.twelve_finish($1, $2) as j', [run, report]))[0].j;
/** 판 시작 시각을 sec 초 앞으로 (시간이 지난 것처럼) · 끝난 판을 하루 전으로 (다음 판과 겹치지 않게) */
const ago = (run, sec) => su(`update public.twelve_runs set started_at = now() - make_interval(secs => $2) where id = $1`, [run, sec]);
const old = (run) => su(`update public.twelve_runs set started_at = started_at - interval '1 day', finished_at = finished_at - interval '1 day' where id = $1`, [run]);
const expect = JSON.parse(readFileSync(join(pgDir, 'expect.json'), 'utf8').replace(/^﻿/, ''));
/** 1-1 의 꼬마 도깨비 수 (맵을 다시 만들면 바뀐다 — 기대값의 첫 판에서 읽는다). 1-1 은 Lv1 맵이라 한 마리에 경험치 4 */
const IMP = expect.steps[0].report.kills.imp;
const R = (o = {}) => ({ time: 100, cleared: true, kills: { imp: IMP }, elites: 0, boss: false, chest: true, deaths: 0, potions: null, ...o });
const u1 = await signUp('twelveone', '열두1');
const u2 = await signUp('twelvetwo', '열두2');
const u3 = await signUp('twelvethree', '열두3');
const u4 = await signUp('twelvefour', '열두4');
const tStart = async (u, floor, hero = 'rat') => (await as(u, 'select public.twelve_tower_start($1, $2) as j', [floor, hero]))[0].j;
const tFloor = async (u, run, floor, time, potions = null) => (await as(u, 'select public.twelve_tower_floor($1, $2, $3, $4) as j', [run, floor, time, potions]))[0].j;
const tEnd = async (u, run, potions = null) => (await as(u, 'select public.twelve_tower_end($1, $2) as j', [run, potions]))[0].j;
/** 탑 판의 마지막 보고 시각을 sec 초 앞으로 (그만큼 시간이 지난 것처럼) */
const tAgo = (run, sec) => su(`update public.twelve_tower_runs set floor_at = now() - make_interval(secs => $2) where id = $1`, [run, sec]);

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
await rejects(as(u1, 'select * from public.twelve_tower_runs'), 'permission denied', 'twelve_tower_runs 직접 읽기');
await rejects(as(u1, `select public._twelve_tower_kind(10)`), 'permission denied', '내부 함수 _twelve_tower_kind');
await rejects(as(u1, `select public._twelve_use_potions($1, array[0,0,0,0,0,0])`, [u1]), 'permission denied', '내부 함수 _twelve_use_potions');
await rejects(as(null, `select public.twelve_tower_start(1, 'rat')`, [], 'anon'), 'permission denied', 'anon 이 twelve_tower_start');
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
await rejects(start(u1, 'final'), 'map locked', '최종보스맵: 12지형 보스를 잡기 전에는 잠김');
await rejects(start(u1, 'final', 'rat', 'hard'), 'mode locked', '어려움 모드의 최종보스맵: 보통 모드를 끝내기 전에는 잠김');
await rejects(start(u1, '13-1'), 'bad map', '없는 지형');
await rejects(start(u1, '12-1'), 'map locked', '12지형은 준비됐지만 11지형 보스를 잡아야 열린다');
await rejects(start(u1, '4-1'), 'map locked', '4지형은 준비됐지만 3지형 보스를 잡아야 열린다');
await rejects(start(u1, '1-1', 'rat', 'hard'), 'mode locked', '어려움 모드: 보통 모드를 끝내기 전에는 잠김');
await rejects(as(u1, `select public.twelve_set_mode('hard')`), 'mode locked', '모드 바꾸기: 보통 모드를 끝내기 전에는 잠김');
await rejects(as(null, `select public.twelve_set_mode('hard')`, [], 'anon'), 'permission denied', 'anon 이 twelve_set_mode');
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
  await rejects(finish(u2, a.run, R({ kills: { imp: IMP + 1 } })), 'bad kills', '최대치를 넘는 처치 수');
  await rejects(finish(u2, a.run, R({ kills: { club: 1 } })), 'bad kills', '그 맵에 없는 요괴');
  await rejects(finish(u2, a.run, R({ kills: { imp: 1.5 } })), 'bad kills', '정수가 아닌 처치 수');
  await rejects(finish(u2, a.run, R({ kills: [1] })), 'bad kills', '모양이 다른 처치 수');
  await rejects(finish(u2, a.run, R({ elites: 1 })), 'bad kills', '없는 정예');
  await rejects(finish(u2, a.run, R({ boss: true })), 'bad kills', '보스 없는 맵의 보스');
  await rejects(finish(u2, a.run, R({ time: 19 })), 'too early', '20초 안에 깬 판');
  await rejects(finish(u2, a.run, R({ time: 3601 })), 'bad time', '너무 긴 판');
  await rejects(finish(u2, a.run, R({ time: 'x' })), 'bad result', '숫자가 아닌 시간');
  await rejects(finish(u2, a.run, { cleared: true }), 'bad result', '값이 빠짐');
  await rejects(finish(u2, a.run, R({ kills: { imp: Math.floor(IMP / 2) } })), 'bad result', '요괴 70% 를 안 잡고 클리어');
  await rejects(finish(u2, a.run, R({ potions: [[1, 0], [0, 0, 0]] })), 'bad potions', '모양이 다른 물약');
  await rejects(finish(u2, a.run, R({ potions: [[99, 0, 0], [0, 0, 0]] })), 'bad potions', '너무 많은 물약');
  const j = await finish(u2, a.run, R());
  ok(j.result.exp === IMP * 4 && j.result.first === true && j.result.stars === 7, `1-1 클리어: 경험치 ${j.result.exp} · 별 ${j.result.stars}`);
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
  // 101: 겹침은 두 판의 최소 판 시간이 실제로 겹칠 때만 — b(300초 전 시작)가 200초 판이면 c 시작(150초 전)을 넘긴다.
  //      (b 가 100초 판이었다면 보관했다 늦게 보낸 정상 판이라 받는다)
  await rejects(finish(u2, b.run, R({ time: 200 })), 'overlap', '먼저 끝난 다른 판과 시간이 겹침 (200초 판이 늦게 시작한 판의 시작을 넘김)');
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
  ok(jd.result.exp === Math.floor((IMP * 4 * 25) / 100), `레벨 차이 10 이상 → 경험치 25% (${jd.result.exp})`);
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
let towerRun = null;
for (const st of expect.steps) {
  n++;
  const name = `#${n} ${st.op} ${st.map ?? st.fn ?? ''} ${st.fn ? JSON.stringify(st.args) : st.floor !== undefined ? `${st.floor}층` : ''}`;
  if (st.op.startsWith('tower_')) {
    let why = null;
    let j = null;
    try {
      if (st.op === 'tower_start') {
        j = await tStart(u1, st.floor);
        towerRun = j.run;
        await su(`update public.twelve_tower_runs set seed = $2 where id = $1`, [towerRun, st.seed]);
      } else if (st.op === 'tower_floor') {
        await tAgo(towerRun, st.sec);
        j = await tFloor(u1, towerRun, st.floor, st.time, st.potions);
      } else j = { state: await tEnd(u1, towerRun, st.potions) };
    } catch (e) {
      why = e.message;
    }
    if ((why === null) !== (st.why === null) || (st.why && !why.includes(st.why))) {
      diff++;
      ok(false, `${name}: 서버 ${why ?? '됨'} / 기기 ${st.why ?? '됨'}`);
    }
    if (st.op === 'tower_start' && !why && j.base !== st.base) {
      diff++;
      ok(false, `${name}: 더해지는 시간 서버 ${j.base} / 기기 ${st.base}`);
    }
    if (st.op === 'tower_floor' && !why) {
      const res = { ...j.result, siaCoin: undefined, items: j.result.items.map((it) => ({ base: it.base, box: it.box })) };
      if (!same(res, st.result)) {
        diff++;
        eq(res, st.result, `${name} 결과`);
      }
    }
    const got = canon(await state(u1));
    if (!same(got, st.state)) {
      diff++;
      eq(got, st.state, `${name} 뒤 기록`);
    }
    continue;
  }
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
  if (st.op === 'start') {
    // 시작만 해 본다 (끝내지 않은 판은 다음 판에 걸리지 않는다)
    try {
      await start(u1, st.map, 'rat', st.mode ?? 'normal');
    } catch (e) {
      why = e.message;
    }
    if ((why === null) !== (st.why === null) || (st.why && !why.includes(st.why))) {
      diff++;
      ok(false, `${name}: 서버 ${why ?? '됨'} / 기기 ${st.why ?? '됨'}`);
    }
    continue;
  }
  if (st.op === 'play') {
    const a = await start(u1, st.map, 'rat', st.mode ?? 'normal');
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
ok(diff === 0, `기기 규칙과 서버가 ${expect.steps.length}단계 모두 같다 (드랍·확정 보정·열쇠·별 보상·상점·대장간·가방·끝없는 탑)`);
{
  const t = expect.steps.filter((x) => x.op === 'tower_floor' && !x.why);
  const items = t.flatMap((x) => x.result.items.map((it) => it.base));
  console.log(`     탑: 받은 층 보고 ${t.length}개 · 일반 장비 ${items.filter((b) => /^[wa]-/.test(b)).length} · 장신구 ${items.filter((b) => b.startsWith('c-')).length} · 레어 ${items.filter((b) => b.startsWith('r-')).length}`);
  ok(items.some((b) => b.startsWith('r-')) && items.some((b) => b.startsWith('c-')) && items.some((b) => /^[wa]-/.test(b)), '탑 시나리오에 일반 장비 · 장신구 · 레어가 모두 나왔다');
}
{
  const s = await state(u1);
  console.log(`     끝 기록: Lv ${s.level} · 엽전 ${s.coins} · 강화석 ${s.stones} · 장비 ${s.items.length}개(보관함 ${s.items.filter((i) => i.box).length}) · 열쇠 ${JSON.stringify(s.keys.normal)} · 얻어 본 것 ${JSON.stringify(s.codex)}`);
  ok(s.keys.normal.length === 12 && s.codex.includes('s-n1') && s.codex.includes('s-n12') && s.level > 40 && s.maps.normal.final?.clears === 2, '열쇠 12개 · 별 24개 보상(1 · 12지형)을 받았고, 12지형과 최종보스맵까지 깨서 레벨이 올랐다');
}

// ---------- 최종보스 · 보통 모드 클리어 · 고양이 (u1 — 위 순서에서 최종보스맵을 실제로 깼다) ----------
{
  const tries = expect.steps.filter((x) => x.op === 'start' && x.map === 'final' && (x.mode ?? 'normal') === 'normal');
  ok(tries.length === 2 && tries[0].why === 'need keys' && tries[1].why === null, `최종보스맵: 열쇠가 모자라면 need keys, 12개를 모으면 열린다 (기기 ${tries.map((x) => x.why ?? '됨').join(' → ')})`);
  const plays = expect.steps.filter((x) => x.op === 'play' && x.map === 'final' && (x.mode ?? 'normal') === 'normal');
  ok(plays.length === 3 && plays[0].result.first && plays[0].result.gift === 50 && plays[1].result.gift === 0 && !plays[0].result.key, `최종보스 첫 처치: 강화석 꾸러미 ${plays[0].result.gift}개 한 번만, 열쇠는 없다`);
  const s = await state(u1);
  eq(s.maps.normal.final, { stars: 7, clears: 2, best: 300 }, "맵 기록 ('normal', 'final'): 두 번 깸 · 별 3개(따로 모아서)");
  eq(s.keys.normal, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], '열쇠 12개');
  eq((await su('select public._twelve_normal_done($1) as v', [u1]))[0].v, true, '_twelve_normal_done');
  eq((await su('select public._cat_progress_twelve($1) as j', [u1]))[0].j, { have: 1, need: 1 }, '최종보스를 실제로 깨면 고양이 조건 1/1');
  eq((await as(u1, `select public.character_progress('twelve') as j`))[0].j, { have: 1, need: 1, owned: [] }, 'character_progress(twelve) 1/1');
  const coins = Number((await su('select sia_coins from public.wallets where user_id = $1', [u1]))[0]?.sia_coins ?? 0);
  ok(coins >= 1, `최종보스맵도 시아코인 규칙이 같다 (지갑 ${coins}개 · 판마다 1, 하루 한도 안에서)`);
  ok((await su(`select count(*)::int as n from public.sia_coin_logs l join public.twelve_runs r on r.id::text = l.ref where l.user_id = $1 and l.game = 'twelve' and r.map_id = 'final'`, [u1]))[0].n <= 2, '쓰러진 최종보스 판에는 시아코인이 없다');
  await su(`update public.wallets set sia_coins = 99 where user_id = $1`, [u1]);
  const poor = (await as(u1, `select public.buy_character('twelve', 'cat') as j`))[0].j;
  ok(poor.ok === false && poor.reason === 'coin', `시아코인이 모자라면 못 산다 (${JSON.stringify(poor)})`);
  await su(`update public.wallets set sia_coins = 130 where user_id = $1`, [u1]);
  const yes = (await as(u1, `select public.buy_character('twelve', 'cat') as j`))[0].j;
  ok(yes.ok === true && yes.siaCoins === 30 && yes.price === 100, `시아코인 100개로 산다 (${JSON.stringify(yes)})`);
  const twice = (await as(u1, `select public.buy_character('twelve', 'cat') as j`))[0].j;
  ok(twice.ok === false && twice.reason === 'owned', '두 번은 안 산다 (owned)');
  eq((await as(u1, `select public.my_characters('twelve') as j`))[0].j, ['cat'], "my_characters('twelve') = [cat]");
  eq((await as(u1, `select public.my_characters('survival') as j`))[0].j, [], '다른 게임에서는 따로 사야 한다');
  eq((await as(u1, `select public.twelve_set_hero('cat') as j`))[0].j.hero, 'cat', '고양이를 대표 대원으로');
  const a = await start(u1, 'final', 'cat');
  ok(!!a.run, '고양이로 최종보스맵 시작 (_check_character 통과)');
  ok(!!(await tStart(u1, 1, 'cat')).run, '고양이로 끝없는 탑 시작');
  await as(u1, `select public.twelve_set_hero('rat')`);
}

// ---------- 어려움 모드 (u1 — 위 순서에서 전환 → 96맵 → 열쇠 12개 → 어려움 최종보스까지 실제로 깼다) ----------
{
  const hs = expect.steps.filter((x) => x.mode === 'hard');
  const locked = expect.steps.filter((x) => x.fn === 'twelve_set_mode').map((x) => x.why ?? '됨');
  eq(locked, ['mode locked', 'bad mode', '됨', '됨', '됨'], '모드 바꾸기: 보통 모드를 끝내기 전에는 mode locked → 없는 모드 → 어려움 → 보통 → 어려움');
  const tries = hs.filter((x) => x.op === 'start').map((x) => `${x.map} ${x.why ?? '됨'}`);
  eq(tries, ['1-1 mode locked', '1-2 map locked', 'final map locked', 'final need keys', 'final 됨'], '어려움 시작 검사: 잠김 → 앞 맵 → 최종보스맵은 12지형 보스 + 열쇠 12개');
  const plays = hs.filter((x) => x.op === 'play');
  const fin = plays.filter((x) => x.map === 'final');
  ok(plays.length >= 98 && fin.length === 2 && fin[0].result.first && fin[0].result.gift === 50 && fin[1].result.gift === 0, `어려움 판 ${plays.length}개 (96맵 + 열쇠 채우기 + 최종보스 2번): 최종보스 첫 처치 강화석 ${fin[0].result.gift}개 한 번만`);
  const drops = plays.flatMap((x) => x.result.items.map((it) => it.base));
  ok(drops.some((b) => /^r-h\d+-\d$/.test(b)) && drops.some((b) => /^s-h\d+$/.test(b)) && drops.some((b) => /^(w-\w+|a)-(8|9|10|11)$/.test(b)) && !drops.some((b) => /^[rs]-n/.test(b)) && !drops.some((b) => /^(w-\w+|a)-[0-7]$/.test(b)),
    `어려움 드랍: 전용 레어 ${drops.filter((b) => b.startsWith('r-h')).length} · 별 24개 보상 ${drops.filter((b) => b.startsWith('s-h')).length} · Lv72~99 일반 장비 ${drops.filter((b) => /^[wa]-/.test(b)).length} (보통 모드의 레어·등급은 없다)`);
  const gifts = plays.filter((x) => x.result.gift > 0).map((x) => `${x.map} ${x.result.gift}`);
  eq(gifts, ['10-8 15', '11-8 20', '12-8 30', 'final 50'], '보스의 선물은 어려움에서 다시 한 번씩');
  const buys = expect.steps.filter((x) => x.fn === 'twelve_buy' && /^w-sword-(8|9|11)$/.test(x.args.p_what)).map((x) => `${x.args.p_what} ${x.why ?? '됨'}`);
  eq(buys, ['w-sword-8 됨', 'w-sword-9 not for sale', 'w-sword-11 됨'], '상점 등급: 보통 모드를 끝내면 Lv72, 어려움 지형을 열수록 Lv99 까지');
  const tw = expect.steps.filter((x) => x.op === 'tower_floor' && !x.why).slice(-120).flatMap((x) => x.result.items.map((it) => it.base));
  ok(tw.some((b) => /-11$/.test(b)) && tw.filter((b) => b.startsWith('r-')).length >= 4, `끝없는 탑(어려움을 끝낸 뒤 21~50층 네 판): 여의 등급 ${tw.filter((b) => /-11$/.test(b)).length}개 · 레어 ${tw.filter((b) => b.startsWith('r-')).length}개 (어려움 전용 ${tw.filter((b) => b.startsWith('r-h')).length})`);
  const s = await state(u1);
  ok(s.mode === 'hard' && s.keys.hard.length === 12 && s.maps.hard.final?.clears === 2 && s.maps.normal.final?.clears === 2 && s.maps.normal['1-1'].clears > s.maps.hard['1-1'].clears && Object.keys(s.maps.hard).length === 97,
    `어려움 기록은 따로: 맵 ${Object.keys(s.maps.hard).length}개 · 열쇠 ${s.keys.hard.length}개 · 최종보스 ${s.maps.hard.final?.clears}번 (보통 기록은 그대로) · Lv ${s.level}`);
  ok(['s-h1', 's-h12', 's-n1'].every((b) => s.codex.includes(b)), '별 24개 보상은 모드마다 따로 받는다 (s-n1 · s-h1 · s-h12)');
  const rank = (await as(null, 'select level, mode, region, hard_done from public.twelve_level_ranking where user_id = $1', [u1], 'anon'))[0];
  ok(rank.region === 12 && rank.hard_done === true && rank.mode === 'hard' && rank.level === s.level, `레벨 랭킹 줄: ${rank.mode} · ${rank.region}지형 · Lv ${rank.level} · 어려움 최종보스 처치 표시 ${rank.hard_done}`);
  eq((await as(u1, `select public.twelve_set_mode('normal') as j`))[0].j.mode, 'normal', '보통 모드로 돌아가기');
  const back = (await as(null, 'select mode, region, hard_done from public.twelve_level_ranking where user_id = $1', [u1], 'anon'))[0];
  ok(back.mode === 'normal' && back.region === 12 && back.hard_done === true, `보통으로 돌아가면 랭킹 줄의 모드도 보통 (처치 표시는 남는다): ${JSON.stringify(back)}`);
  await as(u1, `select public.twelve_set_mode('hard')`);
}

// ---------- 어려움 모드: 새 계정의 잠김 · 랭킹의 모드/지형 · 시아코인은 어려움 권장 레벨로 (u5) ----------
{
  const u5 = await signUp('twelvefive', '열두5');
  await state(u5);
  await rejects(as(u5, `select public.twelve_set_mode('hard')`), 'mode locked', '새 계정은 어려움 모드로 못 바꾼다');
  ok((await su('select public._twelve_shop_tier($1) as t', [u5]))[0].t === 0, '보통 모드를 끝내기 전: 어려움 1지형은 열린 지형으로 치지 않는다 (상점 등급 0)');
  // 보통 모드를 끝낸 것으로 (지형 보스 12 + 최종보스 기록)
  await su(`insert into public.twelve_maps (user_id, mode, map_id, stars, clears) select $1, 'normal', r::text || '-8', 0, 1 from generate_series(1, 12) r`, [u5]);
  await su(`insert into public.twelve_maps (user_id, mode, map_id, stars, clears) values ($1, 'normal', 'final', 0, 1)`, [u5]);
  await su(`update public.twelve_profiles set cleared_maps = 13 where user_id = $1`, [u5]);
  ok((await su('select public._twelve_shop_tier($1) as t', [u5]))[0].t === 8, '보통 모드를 끝내면 상점 등급 8 (Lv72 — 어려움 1지형)');
  eq((await as(u5, `select public.twelve_set_mode('hard') as j`))[0].j.mode, 'hard', '어려움 모드로 바꾸기');
  const r0 = (await as(null, 'select mode, region, hard_done from public.twelve_level_ranking where user_id = $1', [u5], 'anon'))[0];
  ok(r0.mode === 'hard' && r0.region === 1 && r0.hard_done === false, `어려움으로 바꾸면 랭킹 줄: 어려움 · 1지형 · 처치 표시 없음 (${JSON.stringify(r0)})`);
  await rejects(start(u5, '1-2', 'rat', 'hard'), 'map locked', '어려움 1-2 는 어려움 1-1 을 깨야 열린다 (보통 기록과 따로)');
  const rep = expect.steps.find((x) => x.op === 'play' && x.mode === 'hard' && x.map === '1-1').report;
  // 권장 레벨 66 의 맵: Lv81 (+15) 이면 시아코인이 없고, Lv80 이면 받는다
  await su(`update public.twelve_profiles set level = 81, exp = 0 where user_id = $1`, [u5]);
  const a = await start(u5, '1-1', 'rat', 'hard');
  await ago(a.run, 300);
  const ja = await finish(u5, a.run, rep);
  await old(a.run);
  ok(ja.result.siaCoin === false && ja.result.first === true, `어려움 1-1 (권장 Lv66) 을 Lv81 로 깨면 시아코인 없음 · 경험치 ${ja.result.exp}`);
  await su(`update public.twelve_profiles set level = 80, exp = 0 where user_id = $1`, [u5]);
  const b = await start(u5, '1-1', 'rat', 'hard');
  await ago(b.run, 300);
  const jb = await finish(u5, b.run, rep);
  await old(b.run);
  ok(jb.result.siaCoin === true, 'Lv80 으로 깨면 시아코인 +1 (권장 레벨이 어려움의 66 이다 — 보통의 Lv1 이었다면 없다)');
  eq(jb.state.maps.hard['1-1'], { stars: 7, clears: 2, best: rep.time }, "맵 기록 ('hard', '1-1')");
  ok(jb.state.maps.normal['1-1'] === undefined && jb.state.keys.hard.length === 0, '보통 모드 기록·열쇠는 그대로');
  await rejects(start(u5, 'final', 'rat', 'hard'), 'map locked', '어려움 최종보스맵: 어려움 12지형 보스를 잡기 전에는 잠김');
  await su(`insert into public.twelve_maps (user_id, mode, map_id, stars, clears) select $1, 'hard', r::text || '-' || n::text, 0, 1 from generate_series(1, 12) r, generate_series(1, 8) n on conflict do nothing`, [u5]);
  await su(`insert into public.twelve_keys (user_id, mode, region) select $1, 'normal', r from generate_series(1, 12) r`, [u5]);
  await rejects(start(u5, 'final', 'rat', 'hard'), 'need keys', '보통 모드의 열쇠 12개로는 어려움 최종보스맵이 안 열린다');
  ok((await su('select public._twelve_shop_tier($1) as t', [u5]))[0].t === 11, '어려움 지형을 다 열면 상점 등급 11 (Lv99)');
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
  await rejects(start(u2, '1-1', 'cat'), 'locked character', '다른 사람은 여전히 못 고른다');
}

// ---------- 끝없는 탑: 처음부터 누구나 · 들어가면 기록 · 10층마다 시아코인 · 랭킹 (u4) ----------
{
  ok((await as(null, 'select count(*)::int as n from public.twelve_tower_ranking where user_id = $1', [u4], 'anon'))[0].n === 0, '탑 랭킹: 들어가기 전에는 없음');
  await rejects(tStart(u4, 11), 'floor locked', '체크포인트 없이 11층');
  await rejects(tStart(u4, 5), 'bad floor', '시작할 수 없는 층');
  await rejects(tStart(u4, 1, 'rabbit'), 'hero locked', '합류 안 한 대원으로 탑');
  await rejects(tStart(u4, 1, 'cat'), 'locked character', '안 산 고양이로 탑');
  const a = await tStart(u4, 1);
  ok(typeof a.run === 'string' && Number.isInteger(a.seed) && a.base === 0, `탑 시작 → { run, seed ${a.seed}, base 0 }`);
  eq((await state(u4)).tower, { ...(await state(u4)).tower, floor: 0, time: 0, level: 1, hero: 'rat', cps: {} }, '들어가기만 해도 0층 기록');
  eq((await as(null, 'select best_floor, best_time, level, hero, place, total from public.twelve_tower_ranking where user_id = $1', [u4], 'anon'))[0].best_floor, 0, '1층을 못 깨도 탑 랭킹에 보인다 (0층)');
  await rejects(tFloor(u4, a.run, 1, 20), 'too early', '바로 보고한 층 (서버가 잰 시간보다 김)');
  await rejects(tFloor(u1, a.run, 1, 20), 'no run', '남의 탑 판');
  await tAgo(a.run, 20);
  await rejects(tFloor(u4, a.run, 1, 1), 'too early', '층 최소 시간보다 빠름');
  await rejects(tFloor(u4, a.run, 2, 20), 'bad floor', '층 건너뛰기');
  await rejects(tFloor(u4, a.run, 1, null), 'bad time', '시간 없음');
  await rejects(tFloor(u4, a.run, 1, 20, [[99, 0, 0], [0, 0, 0]]), 'bad potions', '너무 많은 물약');
  let j = null;
  for (let f = 1; f <= 10; f++) {
    await tAgo(a.run, 20);
    j = await tFloor(u4, a.run, f, f * 20);
    if (f === 9) ok(j.result.siaCoin === false, '9층: 시아코인 없음');
  }
  ok(j.result.siaCoin === true && j.result.best === true && j.result.time === 200, `10층(보스): 시아코인 +1 · 걸린 시간 ${j.result.time}`);
  eq((await su('select sia_coins from public.wallets where user_id = $1', [u4]))[0].sia_coins, 1, '지갑 시아코인 +1');
  eq((await su(`select count(*)::int as n from public.sia_coin_logs where user_id = $1 and game = 'twelve' and ref = $2`, [u4, `${a.run}:10`]))[0].n, 1, "sia_coin_logs ('twelve', 판 번호:층)");
  ok(j.state.exp === 0 && j.state.level === 1 && j.state.coins > 0, `탑은 경험치가 없다 (엽전 ${j.state.coins} · 강화석 ${j.state.stones})`);
  eq((await as(null, 'select best_floor, best_time, level, hero, place from public.twelve_tower_ranking where user_id = $1', [u4], 'anon'))[0], { best_floor: 10, best_time: 200, level: 1, hero: 'rat', place: (await su('select place from public.twelve_tower_ranking where user_id = $1', [u4]))[0].place }, '탑 랭킹 줄: 층 · 시간 · 레벨 · 대원');
  const rank = await as(null, 'select user_id, best_floor, best_time, place, total from public.twelve_tower_ranking order by place', [], 'anon');
  ok(rank.length === 2 && rank.every((r, i) => r.place === i + 1 && r.total === 2) && rank[0].best_floor >= rank[1].best_floor, `탑 랭킹 ${rank.length}명: ${rank.map((r) => `${r.best_floor}층 ${r.best_time}초`).join(' > ')}`);
  await tEnd(u4, a.run);
  await rejects(tEnd(u4, a.run), 'already finished', '두 번 끝내기');
  await rejects(tFloor(u4, a.run, 11, 220), 'already finished', '끝난 판에 보고');
  const b = await tStart(u4, 11);
  ok(b.base === 200, `11층에서 시작: 더해지는 시간 ${b.base}`);
  ok((await as(null, 'select count(*)::int as n from public.twelve_level_ranking where user_id = $1', [u4], 'anon'))[0].n === 0, '탑만 한 사람은 레벨 랭킹에 없다');
}

console.log(fails ? `\n실패 ${fails}개` : '\n모두 통과');
process.exit(fails ? 1 : 0);
