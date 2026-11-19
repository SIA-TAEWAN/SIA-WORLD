/**
 * 밸런스 표를 화면 없이, 여러 프로세스로 나눠 뽑는다 (PRD 7장의 밸런스 목표를 맞출 때 쓴다).
 *   npm run balance                    → 전부: 캐릭터 효율 표 + 스테이지별 클리어율·별 분포 (실력 3단계) + 캐릭터 조합별
 *   npm run balance -- 300             → 스테이지마다 300판
 *   npm run balance -- 200 stages 1    → 1지역만   (towers: 캐릭터 효율 표만)
 *   npm run balance -- 200 stages 1-5  → 그 스테이지만
 *   npm run balance -- 200 chars 1     → 캐릭터 조합별 (하나를 뺐을 때 · 하나만 데려갔을 때): 쓸모없는 캐릭터가 없는지 본다
 * '보통 실력'은 src/game/policy.ts 의 자동 배치 정책이다. 수십 초 걸리므로 테스트(npm test)에는 넣지 않는다.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VITE_NODE = join(ROOT, 'node_modules', 'vite-node', 'vite-node.mjs');
const runs = Math.max(2, Number(process.argv[2]) || 200);
const only = process.argv[3] ?? '';
const filter = process.argv[4] ?? '';
const WORKERS = Math.max(1, Math.min(12, cpus().length - 1));
/** 한 일감의 판 수 (작게 나눠야 일꾼들이 고르게 바쁘다) */
const CHUNK = 20;

// 스테이지 목록은 데이터 파일에서 읽는다 (id: '1-3' 꼴). 데이터에 스테이지를 더하면 표에도 저절로 들어온다
const STAGES = [...readFileSync(join(ROOT, 'src', 'data', 'stages.ts'), 'utf8').matchAll(/\bid: '(\d+-\d+)'.*?name: '([^']+)'/g)]
  .map((m) => ({ id: m[1], name: m[2] }))
  .filter((s) => !filter || s.id === filter || s.id.startsWith(`${filter}-`));
const SKILLS = [['novice', '서툰'], ['normal', '보통'], ['expert', '능숙']];
/** 지금 쓸 수 있는 캐릭터 (src/data/characters.ts 의 TOWERS 와 같은 순서) */
const CHARS = [['rat', '쥐'], ['ox', '소'], ['tiger', '호랑이'], ['rabbit', '토끼']];

function work(arg) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [VITE_NODE, join(HERE, 'worker.ts'), arg], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))) : reject(new Error(`worker exit ${code}`))));
  });
}

/** 조합 목록 [{ key, stage, skill }] 을 판 수만큼 돌려 key → 합계 */
async function sweep(combos) {
  const jobs = [];
  for (const c of combos) for (let from = 0; from < runs; from += CHUNK) jobs.push({ ...c, from, to: Math.min(runs, from + CHUNK) });
  const packs = Array.from({ length: Math.min(WORKERS, jobs.length) }, () => []);
  jobs.forEach((j, i) => packs[i % packs.length].push(j));
  const lines = (await Promise.all(packs.map((p) => work(JSON.stringify(p))))).flat();
  const sum = new Map();
  for (const l of lines) {
    const s = sum.get(l.key) ?? { runs: 0, clears: 0, stars: [0, 0, 0, 0], lives: 0, time: 0, kills: 0, towers: 0, bossDown: 0, failWave: [0, 0, 0, 0, 0, 0] };
    for (const k of ['runs', 'clears', 'lives', 'time', 'kills', 'towers', 'bossDown']) s[k] += l[k];
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
  console.log('■ 캐릭터별 효율 (한 마리를 계속 때릴 때): 단계 1 → 2 → 3   [쓴 기운 / 초당 피해 / 기운 1당 초당 피해 / 사거리]');
  for (const t of towers) {
    const cells = t.levels.map((L) => `${String(L.spent).padStart(4)} ${L.dps.toFixed(1).padStart(6)} ${L.per.toFixed(3)} ${String(L.range).padStart(4)}${L.splash ? ` 범위${L.splash}` : ''}${L.stun ? ` 멈춤${L.stun}초/${L.every}초` : ''}`);
    console.log(`  ${t.name.padEnd(4, '　')} ${cells.join('  |  ')}`);
  }
}

if (!only || only === 'stages') {
  const sum = await sweep(STAGES.flatMap((st) => SKILLS.map(([skill]) => ({ key: `${st.id}:${skill}`, stage: st.id, skill }))));
  console.log(`\n■ 스테이지별 결과 (강화 없음, 기본 4종 출전, ${runs}판): 클리어율 · 별 3/2/1/실패 · 평균 남은 생명 · 평균 배치 수`);
  for (const [skill, name] of SKILLS) {
    console.log(`  ── ${name} 실력 ──`);
    for (const st of STAGES) {
      const s = sum.get(`${st.id}:${skill}`);
      const fails = s.failWave.some((n) => n > 0) ? `  실패한 웨이브 ${s.failWave.map((n) => String(n).padStart(3)).join('')}` : '';
      console.log(
        `  ${st.id} ${st.name.padEnd(8, '　')} 클리어 ${pct(s.clears, s.runs)}   ★★★ ${pct(s.stars[3], s.runs)}  ★★ ${pct(s.stars[2], s.runs)}  ★ ${pct(s.stars[1], s.runs)}  실패 ${pct(s.stars[0], s.runs)}   생명 ${(s.lives / s.runs).toFixed(1).padStart(4)}   배치 ${(s.towers / s.runs).toFixed(1).padStart(4)}   끝난 시각 ${(s.time / s.runs).toFixed(0).padStart(3)}초${fails}`,
      );
    }
  }
}

if (!only || only === 'chars') {
  // 조합: 전부 · 하나를 뺀 것 · 하나만 (소는 혼자서는 요괴를 잡지 못하므로 '하나만'에서 뺀다)
  const squads = [
    { name: '4종 모두', squad: CHARS.map(([id]) => id) },
    ...CHARS.map(([id, name]) => ({ name: `${name} 없이`, squad: CHARS.map(([c]) => c).filter((c) => c !== id) })),
    ...CHARS.filter(([id]) => id !== 'ox').map(([id, name]) => ({ name: `${name}만`, squad: [id] })),
  ];
  const sum = await sweep(squads.flatMap((q, qi) => STAGES.map((st) => ({ key: `${qi}:${st.id}`, stage: st.id, skill: 'normal', squad: q.squad }))));
  console.log(`\n■ 캐릭터 조합별 (보통 실력, ${runs}판): 스테이지마다 클리어율 / 별 3개 비율`);
  console.log(`  ${''.padEnd(8, '　')}${STAGES.map((st) => st.id.padStart(12)).join('')}`);
  squads.forEach((q, qi) => {
    const cells = STAGES.map((st) => {
      const s = sum.get(`${qi}:${st.id}`);
      return `${pct(s.clears, s.runs)} /${pct(s.stars[3], s.runs)}`.padStart(12);
    });
    console.log(`  ${q.name.padEnd(8, '　')}${cells.join('')}`);
  });
}

console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)}초 걸림)`);
