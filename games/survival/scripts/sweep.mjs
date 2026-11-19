/**
 * 밸런스 표를 화면 없이, 여러 프로세스로 나눠 뽑는다 (PRD 7장의 밸런스 목표를 맞출 때 쓴다).
 *   npm run balance                  → 전부 (무기 피해 · 캐릭터별 · 맵×강화 · 몇 판째)
 *   npm run balance -- 100           → 조합마다 100판
 *   npm run balance -- 60 maps       → 맵 × 강화 수준 표와 '몇 판째' 표만   (chars: 캐릭터별, dps: 무기 피해)
 *   npm run balance -- 60 maps field,bamboo   → 그 맵만
 *   npm run balance -- 40 endless             → 무한 모드: 맵 × 강화 수준별 평균·최대 생존 시간 (endless field 처럼 맵을 고를 수 있다)
 * 수십 초~몇 분 걸리므로 테스트(npm test)에는 넣지 않는다.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const VITE_NODE = join(ROOT, 'node_modules', 'vite-node', 'vite-node.mjs');
const runs = Math.max(2, Number(process.argv[2]) || 60);
const only = process.argv[3] ?? '';
const onlyMaps = process.argv[4] ? process.argv[4].split(',') : null;
const WORKERS = Math.max(1, Math.min(12, cpus().length - 1));
/** 한 일감의 판 수 (작게 나눠야 일꾼들이 고르게 바쁘다) */
const CHUNK = 6;

const MAPS = [['field', '들판'], ['bamboo', '대나무 숲'], ['palace', '달빛 궁궐'], ['underworld', '황천길']];
const CHARS = [['rat', '쥐'], ['ox', '소'], ['tiger', '호랑이'], ['rabbit', '토끼'], ['dragon', '용'], ['snake', '뱀'], ['horse', '말'], ['sheep', '양'], ['monkey', '원숭이'], ['rooster', '닭'], ['dog', '개'], ['pig', '돼지']];
/** PRD 7장: 들판 10 · 대나무 숲 22 · 달빛 궁궐 34 · 황천길 44 레벨쯤에서 클리어 */
const LEVELS = [0, 10, 22, 34, 44, 49];
const TARGET = { field: 10, bamboo: 22, palace: 34, underworld: 44 };
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function work(arg) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [VITE_NODE, join(HERE, 'worker.ts'), arg], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))) : reject(new Error(`worker exit ${code}`))));
  });
}

/** 조합 목록 [{ key, map, char, upg }] 을 판 수만큼 돌려 key → 합계 */
async function sweep(combos) {
  const jobs = [];
  for (const c of combos) for (let from = 0; from < runs; from += CHUNK) jobs.push({ ...c, from, to: Math.min(runs, from + CHUNK) });
  // 일꾼마다 일감을 번갈아 나눠 준다
  const packs = Array.from({ length: Math.min(WORKERS, jobs.length) }, () => []);
  jobs.forEach((j, i) => packs[i % packs.length].push(j));
  const lines = (await Promise.all(packs.map((p) => work(JSON.stringify(p))))).flat();
  const sum = new Map();
  for (const l of lines) {
    const s = sum.get(l.key) ?? { runs: 0, time: 0, clears: 0, coins: 0, clearCoins: 0, kills: 0, level: 0, cakes: 0, bosses: 0, evos: 0, times: [], max: { coins: 0, coinRate: 0, killRate: 0, levelRate: 0, cakeRate: 0 } };
    for (const k of ['runs', 'time', 'clears', 'coins', 'clearCoins', 'kills', 'level', 'cakes', 'bosses', 'evos']) s[k] += l[k];
    for (const k of Object.keys(s.max)) s.max[k] = Math.max(s.max[k], l.max[k]);
    s.times.push(...l.times);
    sum.set(l.key, s);
  }
  return sum;
}

const t0 = Date.now();

if (!only || only === 'dps') {
  const [{ dps }] = await work('dps');
  console.log('■ 무기별 초당 피해 (허수아비 40마리, 60초, 레벨 1~5)');
  for (const row of dps) console.log(`  ${row.name.padEnd(8, '　')} ${row.dps.map((d) => d.toFixed(1).padStart(7)).join('')}`);
}

if (!only || only === 'chars') {
  const sum = await sweep(CHARS.map(([id]) => ({ key: id, map: 'field', char: id, upg: 0 })));
  console.log(`\n■ 캐릭터별 생존 시간 (강화 0, 들판, ${runs}판)`);
  const avg = CHARS.map(([id]) => sum.get(id).time / sum.get(id).runs);
  const mean = avg.reduce((a, b) => a + b, 0) / avg.length;
  CHARS.forEach(([id, name], i) => {
    const s = sum.get(id);
    const diff = (avg[i] / mean - 1) * 100;
    console.log(`  ${name.padEnd(4, '　')} 평균 ${mmss(avg[i])} (${diff >= 0 ? '+' : ''}${diff.toFixed(0)}%)  처치 ${(s.kills / s.runs).toFixed(0).padStart(5)}  레벨 ${(s.level / s.runs).toFixed(1).padStart(4)}  엽전 ${(s.coins / s.runs).toFixed(0).padStart(4)}  클리어 ${((s.clears / s.runs) * 100).toFixed(0)}%`);
  });
  console.log(`  전체 평균 ${mmss(mean)}  (가장 긴 캐릭터 ${((Math.max(...avg) / mean - 1) * 100).toFixed(0)}%, 가장 짧은 캐릭터 ${((Math.min(...avg) / mean - 1) * 100).toFixed(0)}%)`);
}

if (!only || only === 'maps') {
  const maps = MAPS.filter(([id]) => !onlyMaps || onlyMaps.includes(id));
  const sum = await sweep(maps.flatMap(([map]) => LEVELS.map((upg) => ({ key: `${map}:${upg}`, map, char: 'tiger', upg }))));
  console.log(`\n■ 맵 × 강화 수준 (호랑이, ${runs}판): 평균 생존 시간 / 클리어 비율 / 평균 엽전   [ ] = 그 맵의 목표 강화 수준`);
  console.log(`  ${'맵'.padEnd(6, '　')}${LEVELS.map((l) => `강화 ${String(l).padStart(2)}`.padStart(22)).join('')}`);
  const table = {};
  for (const [map, name] of maps) {
    table[map] = {};
    const cells = LEVELS.map((upg) => {
      const s = sum.get(`${map}:${upg}`);
      table[map][upg] = { time: s.time / s.runs, clear: s.clears / s.runs, coins: s.coins / s.runs };
      const txt = `${mmss(s.time / s.runs)} ${((s.clears / s.runs) * 100).toFixed(0).padStart(3)}% ${(s.coins / s.runs).toFixed(0).padStart(5)}닢`;
      return (upg === TARGET[map] ? `[${txt}]` : ` ${txt} `).padStart(22);
    });
    console.log(`  ${name.padEnd(6, '　')}${cells.join('')}`);
  }
  // 평균 레벨·처치·떡과, 서버 상한(_survival_const)을 정할 때 보는 실제 최대치
  const top = { coins: 0, coinRate: 0, killRate: 0, levelRate: 0, cakeRate: 0 };
  for (const v of sum.values()) for (const k of Object.keys(top)) top[k] = Math.max(top[k], v.max[k]);
  console.log('');
  console.log(`  평균 레벨 / 처치 / 떡 / 무기 진화가 일어난 판   (전체 최대: 엽전 ${top.coins}닢 · 엽전/초/맵 배율 ${top.coinRate.toFixed(3)} · (처치-100)/초 ${top.killRate.toFixed(2)} · (레벨-5)/초 ${top.levelRate.toFixed(3)} · (떡-5)/초 ${top.cakeRate.toFixed(4)})`);
  for (const [map, name] of maps) {
    const cells = LEVELS.map((upg) => {
      const s = sum.get(`${map}:${upg}`);
      return `Lv${(s.level / s.runs).toFixed(1).padStart(5)} ${(s.kills / s.runs).toFixed(0).padStart(5)} ${(s.cakes / s.runs).toFixed(1).padStart(4)} ${((s.evos / s.runs) * 100).toFixed(0).padStart(3)}%`.padStart(22);
    });
    console.log(`  ${name.padEnd(6, '　')}${cells.join('')}`);
  }
  // 30초 단위로 언제 죽는지 (조정할 때 어느 구간이 고비인지 본다). 마지막 칸은 4분을 채운 판
  console.log('');
  console.log('  30초 단위 사망 (0:00대 … 3:30대 | 4분 도달)');
  for (const [map, name] of maps) {
    for (const upg of LEVELS) {
      const h = new Array(9).fill(0);
      for (const t of sum.get(`${map}:${upg}`).times) h[Math.min(8, Math.floor(t / 30))]++;
      console.log(`  ${name.padEnd(6, '　')} 강화 ${String(upg).padStart(2)}: ${h.slice(0, 8).map((n) => String(n).padStart(3)).join('')} |${String(h[8]).padStart(3)}`);
    }
  }
  // 클리어한 판만의 평균 엽전 (무한 모드의 판당 엽전 상한을 정하는 기준: 약 1.5배)
  console.log('');
  console.log('  클리어한 판의 평균 엽전 (강화 수준별 · 전체)');
  for (const [map, name] of maps) {
    let coins = 0;
    let clears = 0;
    const cells = LEVELS.map((upg) => {
      const s = sum.get(`${map}:${upg}`);
      coins += s.clearCoins;
      clears += s.clears;
      return (s.clears ? `${(s.clearCoins / s.clears).toFixed(0)}닢 (${s.clears}판)` : '-').padStart(16);
    });
    console.log(`  ${name.padEnd(6, '　')}${cells.join('')}   전체 ${clears ? `${(coins / clears).toFixed(0)}닢` : '-'}`);
  }
  if (!onlyMaps) progress(table);
}

if (!only || only === 'endless') {
  // 무한 모드: 4분까지는 4분 모드와 같고, 그 뒤로 죽을 때까지 (data/balance.ts 의 ENDLESS). 그 맵을 클리어해야 열리므로 낮은 강화 수준의 줄은 참고용이다
  const maps = MAPS.filter(([id]) => !onlyMaps || onlyMaps.includes(id));
  const sum = await sweep(maps.flatMap(([map]) => LEVELS.map((upg) => ({ key: `${map}:${upg}`, map, char: 'tiger', upg, mode: 'endless' }))));
  const caps = Object.fromEntries([...readFileSync(join(ROOT, 'src', 'data', 'maps.ts'), 'utf8').matchAll(/id: '(\w+)',.*?endlessCoins: (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  console.log(`
■ 무한 모드: 맵 × 강화 수준 (호랑이, ${runs}판)   평균 생존 / 가장 짧은 판 ~ 가장 긴 판 / 4분을 넘긴 판 (그 판들의 평균 생존)`);
  for (const [map, name] of maps) {
    console.log(`  ${name} (엽전 상한 ${caps[map]}닢)`);
    for (const upg of LEVELS) {
      const s = sum.get(`${map}:${upg}`);
      const past = s.times.filter((t) => t >= 240);
      const pastAvg = past.length ? mmss(past.reduce((a, b) => a + b, 0) / past.length) : '-';
      const capped = s.max.coins >= caps[map] ? ' (상한 닿음)' : '';
      console.log(
        `    강화 ${String(upg).padStart(2)}: 평균 ${mmss(s.time / s.runs).padStart(5)}  ${mmss(Math.min(...s.times)).padStart(5)} ~ ${mmss(Math.max(...s.times)).padStart(5)}  4분 넘김 ${String(past.length).padStart(3)}판 (${pastAvg.padStart(5)})` +
          `  Lv ${(s.level / s.runs).toFixed(1).padStart(5)}  처치 ${(s.kills / s.runs).toFixed(0).padStart(5)}  보스 ${(s.bosses / s.runs).toFixed(1).padStart(4)}  엽전 ${(s.coins / s.runs).toFixed(0).padStart(4)}닢 최대 ${s.max.coins}닢${capped}`,
      );
    }
  }
  // 1분 단위로 언제 죽는지 (마지막 칸은 12분 이상)
  console.log('');
  console.log('  1분 단위 사망 (0분대 … 11분대 | 12분 이상)');
  for (const [map, name] of maps) {
    for (const upg of LEVELS) {
      const h = new Array(13).fill(0);
      for (const t of sum.get(`${map}:${upg}`).times) h[Math.min(12, Math.floor(t / 60))]++;
      console.log(`  ${name.padEnd(6, '　')} 강화 ${String(upg).padStart(2)}: ${h.slice(0, 12).map((n) => String(n).padStart(3)).join('')} |${String(h[12]).padStart(3)}`);
    }
  }
  // 서버 상한(시간 비례)을 무한 모드에서도 넘지 않는지: 실제 최대치
  const top = { coinRate: 0, killRate: 0, levelRate: 0, cakeRate: 0 };
  for (const v of sum.values()) for (const k of Object.keys(top)) top[k] = Math.max(top[k], v.max[k]);
  console.log(`
  전체 최대: (처치-100)/초 ${top.killRate.toFixed(2)} · (레벨-5)/초 ${top.levelRate.toFixed(3)} · (떡-5)/초 ${top.cakeRate.toFixed(4)} · 엽전/초/맵 배율 ${top.coinRate.toFixed(3)}   (서버 상한: 50 · 0.5 · 0.15 · 5)`);
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}초, 일꾼 ${WORKERS}개)`);

/**
 * '몇 판째' 누적 표 (PRD 7장): 엽전 0 · 강화 0 에서 시작해 판마다
 *   · 열린 맵 가운데 그 강화 수준에서 엽전을 가장 많이 주는 맵을 돈다 (새 맵을 깰 가망이 10% 이상이면 그 맵을 돈다)
 *   · 번 엽전으로 값싼 강화부터 산다
 *   · 맵을 깰 확률을 곱해 가며, 깼을 확률이 50%를 넘는 판을 '그 맵을 깬 판'으로 본다
 * 맵×강화 표의 값 사이는 곧은 선으로 잇는다. 평균값으로만 굴리는 어림셈이다.
 */
function progress(table) {
  const src = readFileSync(join(ROOT, 'src', 'data', 'upgrades.ts'), 'utf8');
  const ups = [...src.matchAll(/\{ id: '(\w+)'.*?max: (\d+), baseCost: (\d+), growth: ([\d.]+)/g)].map((m) => ({ id: m[1], max: Number(m[2]), base: Number(m[3]), growth: Number(m[4]), lv: 0 }));
  const cost = (u) => Math.round((u.base * u.growth ** u.lv) / 5) * 5;
  const at = (map, upg, k) => {
    let i = 0;
    while (i < LEVELS.length - 2 && LEVELS[i + 1] <= upg) i++;
    const a = table[map][LEVELS[i]];
    const b = table[map][LEVELS[i + 1]];
    const t = Math.max(0, Math.min(1, (upg - LEVELS[i]) / (LEVELS[i + 1] - LEVELS[i])));
    return a[k] + (b[k] - a[k]) * t;
  };
  let coins = 0;
  let total = 0;
  let spent = 0;
  let open = 1;
  const notCleared = MAPS.map(() => 1);
  const clearedAt = MAPS.map(() => null);
  const levelAt = {};
  for (let run = 1; run <= 400 && (clearedAt.some((c) => c === null) || ups.some((u) => u.lv < u.max)); run++) {
    const upg = ups.reduce((n, u) => n + u.lv, 0);
    // 새 맵을 깰 가망이 있으면 그 맵, 아니면 엽전을 가장 많이 주는 열린 맵
    let pick = 0;
    for (let m = 0; m < open; m++) if (at(MAPS[m][0], upg, 'coins') > at(MAPS[pick][0], upg, 'coins')) pick = m;
    if (clearedAt[open - 1] === null && at(MAPS[open - 1][0], upg, 'clear') >= 0.1) pick = open - 1;
    const id = MAPS[pick][0];
    const gain = at(id, upg, 'coins');
    coins += gain;
    total += gain;
    notCleared[pick] *= 1 - at(id, upg, 'clear');
    if (clearedAt[pick] === null && notCleared[pick] <= 0.5) {
      clearedAt[pick] = { run, upg };
      if (pick === open - 1 && open < MAPS.length) open++;
    }
    for (;;) {
      const next = ups.filter((u) => u.lv < u.max).sort((a, b) => cost(a) - cost(b))[0];
      if (!next || cost(next) > coins) break;
      coins -= cost(next);
      spent += cost(next);
      next.lv++;
      const n = ups.reduce((s, u) => s + u.lv, 0);
      if ([10, 22, 34, 44, 49].includes(n)) levelAt[n] = { run, spent, perRun: total / run };
    }
  }
  console.log('\n■ 몇 판째 (누적 어림셈: 값싼 강화부터, 엽전을 가장 많이 주는 열린 맵을 돈다)   PRD 목표: 들판 10판 안팎 · 대나무 숲 25~30 · 달빛 궁궐 50~60 · 황천길 80~100');
  for (const n of [10, 22, 34, 44, 49]) {
    const v = levelAt[n];
    console.log(`  강화 ${String(n).padStart(2)}레벨 도달: ${v ? `${String(v.run).padStart(3)}판째  (그때까지 쓴 엽전 ${String(v.spent).padStart(6)}닢, 판당 평균 ${v.perRun.toFixed(0)}닢)` : '400판 안에 못 미침'}`);
  }
  MAPS.forEach(([, name], i) => {
    const c = clearedAt[i];
    console.log(`  ${name.padEnd(6, '　')} 클리어(누적 확률 50%): ${c ? `${String(c.run).padStart(3)}판째 (강화 ${c.upg}레벨)` : '400판 안에 못 깸'}`);
  });
}
