/**
 * 밸런스 표를 화면 없이, 여러 프로세스로 나눠 뽑는다 (PRD 7장의 밸런스 목표를 맞출 때 쓴다).
 *   npm run balance                     → 전부 (아래 다섯 가지)
 *   npm run balance -- 40 towers        → 캐릭터별 효율 표
 *   npm run balance -- 40 stages [3]    → 스테이지별 클리어율·별 분포 (실력 3단계, 캐릭터 레벨 = 지역 번호). 끝의 숫자는 지역, '3-5' 는 스테이지
 *   npm run balance -- 40 levels        → 지역 × 캐릭터 레벨 표 (N지역은 N레벨쯤에서 클리어되는가)
 *   npm run balance -- 40 chars         → 캐릭터 × 지역 표: 다른 4종만 데려갔을 때 → 그 캐릭터를 다섯째로 더했을 때의 클리어율 (쓸모없는 캐릭터가 없는가)
 *   npm run balance -- 12 endless       → 끝없는 모드: 캐릭터 레벨별 도달 웨이브 (평균 · 최고)
 *   npm run balance -- 12 journey       → '몇 판째' 어림셈: 처음부터 마지막 스테이지 클리어까지의 판 수 (PRD: 120~150판)
 * 맨 앞 숫자는 조합마다 돌리는 판 수. '보통 실력'은 src/game/policy.ts 의 자동 배치 정책이다.
 * 몇 분 걸리므로 테스트(npm test)에는 넣지 않는다.
 */
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VITE_NODE = join(ROOT, 'node_modules', 'vite-node', 'vite-node.mjs');
const runs = Math.max(2, Number(process.argv[2]) || 40);
const only = process.argv[3] ?? '';
const filter = process.argv[4] ?? '';
const WORKERS = Math.max(1, Math.min(12, cpus().length - 1));
/** 한 일감의 판 수 (작게 나눠야 일꾼들이 고르게 바쁘다) */
const CHUNK = 10;
const SKILLS = [['novice', '서툰'], ['normal', '보통'], ['expert', '능숙']];

function work(...args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [VITE_NODE, join(HERE, 'worker.ts'), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))) : reject(new Error(`worker exit ${code}`))));
  });
}

// 스테이지·캐릭터 목록은 데이터에서 읽는다 (데이터에 더하면 표에도 저절로 들어온다)
const [info] = await work('info');
const ALL_STAGES = info.stages;
const STAGES = ALL_STAGES.filter((s) => !filter || s.id === filter || String(s.region) === filter);
const REGION_NOS = [...new Set(ALL_STAGES.map((s) => s.region))];

/** 조합 목록 [{ key, stage, skill, … }] 을 판 수만큼 돌려 key → 합계 */
async function sweep(combos) {
  const jobs = [];
  for (const c of combos) for (let from = 0; from < runs; from += CHUNK) jobs.push({ ...c, from, to: Math.min(runs, from + CHUNK) });
  const packs = Array.from({ length: Math.min(WORKERS, jobs.length) }, () => []);
  jobs.forEach((j, i) => packs[i % packs.length].push(j));
  // 명령줄이 너무 길어지지 않게 일감 묶음을 다시 나눈다
  const calls = [];
  for (const p of packs) for (let i = 0; i < p.length; i += 40) calls.push(p.slice(i, i + 40));
  const lines = [];
  for (let i = 0; i < calls.length; i += WORKERS) lines.push(...(await Promise.all(calls.slice(i, i + WORKERS).map((p) => work(JSON.stringify(p))))).flat());
  const sum = new Map();
  for (const l of lines) {
    const s = sum.get(l.key) ?? { runs: 0, clears: 0, stars: [0, 0, 0, 0], lives: 0, time: 0, kills: 0, towers: 0, bossDown: 0, waves: 0, maxWave: 0, failWave: [0, 0, 0, 0, 0, 0], squad: l.squad };
    for (const k of ['runs', 'clears', 'lives', 'time', 'kills', 'towers', 'bossDown', 'waves']) s[k] += l[k];
    s.maxWave = Math.max(s.maxWave, l.maxWave);
    l.stars.forEach((n, i) => (s.stars[i] += n));
    l.failWave.forEach((n, i) => (s.failWave[i] += n));
    sum.set(l.key, s);
  }
  return sum;
}

const pct = (n, d) => `${((n / d) * 100).toFixed(0)}%`.padStart(4);
const t0 = Date.now();

if (!only || only === 'towers') {
  const [{ towers }] = await work('towers');
  console.log('■ 캐릭터별 효율 (한 마리를 계속 때릴 때): 단계 1 → 2 → 3   [쓴 기운 / 초당 피해(독·불 포함) / 기운 1당 초당 피해 / 사거리]');
  for (const t of towers) {
    const cells = t.levels.map((L) => `${String(L.spent).padStart(4)} ${L.dps.toFixed(1).padStart(6)} ${L.per.toFixed(3)} ${String(L.range).padStart(4)}${L.note ? ` ${L.note}` : ''}`);
    console.log(`  ${t.name.padEnd(4, '　')} ${cells.join('  |  ')}`);
  }
}

if (!only || only === 'stages') {
  const sum = await sweep(STAGES.flatMap((st) => SKILLS.map(([skill]) => ({ key: `${st.id}:${skill}`, stage: st.id, skill }))));
  console.log(`\n■ 스테이지별 결과 (캐릭터 레벨 = 지역 번호, 그 지역에서 쓸 수 있는 캐릭터 가운데 5종, ${runs}판): 클리어율 · 별 3/2/1/실패 · 평균 남은 생명 · 평균 배치 수`);
  for (const [skill, name] of SKILLS) {
    console.log(`  ── ${name} 실력 ──`);
    for (const st of STAGES) {
      const s = sum.get(`${st.id}:${skill}`);
      const fails = s.failWave.some((n) => n > 0) ? `  실패한 웨이브 ${s.failWave.map((n) => String(n).padStart(3)).join('')}` : '';
      console.log(
        `  ${st.id.padEnd(5)}${st.name.padEnd(9, '　')} 클리어 ${pct(s.clears, s.runs)}   ★★★ ${pct(s.stars[3], s.runs)}  ★★ ${pct(s.stars[2], s.runs)}  ★ ${pct(s.stars[1], s.runs)}  실패 ${pct(s.stars[0], s.runs)}   생명 ${(s.lives / s.runs).toFixed(1).padStart(4)}   배치 ${(s.towers / s.runs).toFixed(1).padStart(4)}${st.id.endsWith('-5') ? `   보스 처치 ${pct(s.bossDown, s.runs)}` : ''}   ${skill === 'normal' ? s.squad.join(' ') : ''}${fails}`,
      );
    }
  }
}

if (!only || only === 'levels') {
  // 지역 × 캐릭터 레벨: 그 지역의 5스테이지를 합친 클리어율 (공통 강화는 (지역 - 1) / 2 레벨로 고정)
  const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const stages = ALL_STAGES.filter((s) => !filter || String(s.region) === filter);
  const sum = await sweep(stages.flatMap((st) => LEVELS.filter((lv) => Math.abs(lv - st.region) <= 3 || lv === 1 || lv === 12).map((lv) => ({ key: `${st.region}:${lv}`, stage: st.id, skill: 'normal', lv }))));
  console.log(`\n■ 지역 × 캐릭터 레벨 (보통 실력, 스테이지마다 ${runs}판, 지역의 5스테이지 합): 클리어율 / 별 3개 비율   [ ] = 지역 번호와 같은 레벨 (PRD 7장의 목표)`);
  console.log(`  ${'지역'.padEnd(10, '　')}${LEVELS.map((l) => `Lv${l}`.padStart(11)).join('')}`);
  for (const r of [...new Set(stages.map((s) => s.region))]) {
    const cells = LEVELS.map((lv) => {
      const s = sum.get(`${r}:${lv}`);
      if (!s) return ''.padStart(11);
      const txt = `${pct(s.clears, s.runs)}/${pct(s.stars[3], s.runs)}`;
      return (lv === r ? `[${txt}]` : ` ${txt} `).padStart(11);
    });
    console.log(`  ${`${r} ${info.regions[r - 1]}`.padEnd(10, '　')}${cells.join('')}`);
  }
}

if (!only || only === 'chars') {
  // 캐릭터 × 지역: 그 캐릭터를 뺀 4종만 데려갔을 때 → 그 캐릭터를 다섯째로 더했을 때의 클리어율 (지역의 5스테이지 합, 레벨 = 지역 번호)
  const regions = REGION_NOS.filter((r) => !filter || String(r) === filter);
  const combos = [];
  for (const r of regions) {
    for (const st of ALL_STAGES.filter((s) => s.region === r)) {
      combos.push({ key: `${r}:*`, stage: st.id, skill: 'normal' });
      for (const c of info.chars.filter((x) => x.unlock < r)) {
        combos.push({ key: `${r}:+${c.id}`, stage: st.id, skill: 'normal', with: c.id });
        combos.push({ key: `${r}:-${c.id}`, stage: st.id, skill: 'normal', without: c.id });
      }
    }
  }
  const sum = await sweep(combos);
  console.log(`\n■ 캐릭터 × 지역 (보통 실력, 레벨 = 지역 번호, 스테이지마다 ${runs}판): 다른 4종만 → 이 캐릭터를 더했을 때의 클리어율 (오를수록 그 지역에서 쓸모가 크다)`);
  console.log(`  ${'지역'.padEnd(6, '　')}${regions.map((r) => String(r).padStart(9)).join('')}`);
  const base = regions.map((r) => sum.get(`${r}:*`));
  console.log(`  ${'고른 5종'.padEnd(6, '　')}${base.map((s) => pct(s.clears, s.runs).padStart(9)).join('')}`);
  for (const c of info.chars) {
    const cells = regions.map((r) => {
      const a = sum.get(`${r}:+${c.id}`);
      const b = sum.get(`${r}:-${c.id}`);
      return (a && b ? `${((b.clears / b.runs) * 100).toFixed(0)}→${((a.clears / a.runs) * 100).toFixed(0)}` : '').padStart(9);
    });
    console.log(`  ${c.name.padEnd(6, '　')}${cells.join('')}`);
  }
}

if (!only || only === 'endless') {
  // 끝없는 모드: 모든 캐릭터를 쓸 수 있을 때, 캐릭터 레벨(공통 강화는 레벨에 맞춰 0~5)별 도달 웨이브
  const LV = [1, 3, 6, 9, 12];
  const sum = await sweep(LV.flatMap((lv) => SKILLS.map(([skill]) => ({ key: `${lv}:${skill}`, stage: 'endless', skill, lv, upg: Math.min(5, Math.floor(lv / 2)) }))));
  console.log(`\n■ 끝없는 모드 (끝없는 고개, ${runs}판): 도달 웨이브 평균 (최고)`);
  console.log(`  ${'실력'.padEnd(4, '　')}${LV.map((l) => `Lv${l}`.padStart(14)).join('')}`);
  for (const [skill, name] of SKILLS) {
    console.log(`  ${name.padEnd(4, '　')}${LV.map((lv) => { const s = sum.get(`${lv}:${skill}`); return `${(s.waves / s.runs).toFixed(1)} (${s.maxWave})`.padStart(14); }).join('')}`);
  }
  console.log(`  고른 5종: ${sum.get('1:normal').squad.join(' ')}`);
}

if (!only || only === 'journey') {
  const [{ journey }] = await work('journey', String(Math.min(runs, 16)));
  console.log('\n■ 몇 판째 (보통 실력이 스테이지를 차례로 깨며, 번 엽전으로 데려갈 캐릭터를 고르게 올리고 공통 강화를 살 때)');
  console.log('  지역              이 지역 판 수   누적 판 수   보스 스테이지 명단의 레벨       공통 강화   모은 별 (다음 지역 필요)   남은 엽전');
  for (const r of journey) {
    console.log(`  ${`${r.region} ${r.name}`.padEnd(11, '　')} ${r.runs.toFixed(1).padStart(8)} ${r.total.toFixed(0).padStart(12)}      ${r.lv.join(' ').padEnd(22)} ${String(r.upg).padStart(8)} ${r.stars.toFixed(0).padStart(10)} (${r.need})  ${String(r.coins).padStart(14)}`);
  }
}

console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)}초 걸림)`);
