/**
 * 밸런스 보정: npm run calib [지역 ...]   (예: npm run calib -- 6 7)
 *  1) 2~12지역 판 모양(src/data/stagegen.ts)마다 자동 플레이어(src/game/autopilot.ts)를 지역 testLevel(예상 레벨 - 여유)로 두고,
 *     목표 턴 안에 깨는 가장 큰 요괴 체력 배율과 별 기준 턴을 찾는다 (src/data/calibrate.ts)
 *  2) src/data/calib.ts 에 쓰고, _shared/finger/stages-gen.ts 를 다시 만든다 (npm run gen 과 같은 내용)
 *  3) 새 데이터로 60스테이지를 레벨 1 · testLevel · 예상 레벨로 두어 표를 찍는다
 * npm run calib -- --report 는 3)만. 작업은 프로세스 9개로 나눠 돌린다 (몇 분).
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expectLevel, partyFor, testLevel } from '../src/data/balance';
import { CALIB } from '../src/data/calib';
import { calibrate, report } from '../src/data/calibrate';
import { allLayouts, generatedSource, guessCalib, layoutOf, type Calib } from '../src/data/stagegen';
import { STAGES } from '../src/sim';

const WORKERS = 9;
const args = process.argv.slice(2);

function runWorkers(mode: string, ids: string[]): Promise<string[]> {
  const chunks: string[][] = Array.from({ length: Math.min(WORKERS, ids.length) }, () => []);
  ids.forEach((id, i) => chunks[i % chunks.length].push(id));
  const viteNode = fileURLToPath(new URL('../node_modules/vite-node/vite-node.mjs', import.meta.url));
  const script = fileURLToPath(import.meta.url);
  return Promise.all(
    chunks.map(
      (c) =>
        new Promise<string[]>((res, rej) => {
          const p = spawn(process.execPath, [viteNode, script, mode, c.join(',')], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
          let out = '';
          p.stdout.on('data', (d) => (out += d));
          p.stderr.on('data', (d) => process.stderr.write(d));
          p.on('close', (code) => (code === 0 ? res(out.split('\n').filter((l) => l.startsWith('{'))) : rej(new Error(`worker ${code}`))));
        }),
    ),
  ).then((a) => a.flat());
}

async function main() {
  if (args[0] === '--calib-worker') {
    for (const id of args[1].split(',')) {
      const [r, n] = id.split('-').map(Number);
      const c = calibrate(layoutOf(r, n), CALIB[id] ?? guessCalib(r));
      console.log(JSON.stringify({ id, ...c }));
    }
    return;
  }
  if (args[0] === '--report-worker') {
    for (const id of args[1].split(',')) console.log(JSON.stringify(report(id)));
    return;
  }
  if (args[0] !== '--report') {
    const regions = args.map(Number).filter((n) => n >= 2 && n <= 12);
    const todo = allLayouts().filter((l) => !regions.length || regions.includes(l.region)).map((l) => l.id);
    const t0 = Date.now();
    const rows = (await runWorkers('--calib-worker', todo)).map((l) => JSON.parse(l) as Calib & { id: string; turnsTest: number; turnsExpect: number; evals: number });
    const next: Record<string, Calib> = { ...CALIB };
    for (const r of rows) next[r.id] = r.atk !== undefined ? { hp: r.hp, par: r.par, atk: r.atk } : { hp: r.hp, par: r.par };
    const ordered = allLayouts().filter((l) => next[l.id]);
    const body = ordered.map((l) => `  '${l.id}': { hp: ${next[l.id].hp}, par: ${next[l.id].par}${next[l.id].atk !== undefined ? `, atk: ${next[l.id].atk}` : ''} },`).join('\n');
    writeFileSync(
      new URL('../src/data/calib.ts', import.meta.url),
      `// npm run calib 로 만든 파일 (손으로 고치지 않는다). 스테이지 → 요괴 체력 배율 · 별 기준 턴\nimport type { Calib } from './stagegen';\n\nexport const CALIB: Record<string, Calib> = {\n${body}\n};\n`,
    );
    writeFileSync(new URL('../../../supabase/functions/_shared/finger/stages-gen.ts', import.meta.url), generatedSource(next));
    console.log(`${rows.length}개 스테이지 보정 (${Math.round((Date.now() - t0) / 1000)}초, 시험 ${rows.reduce((a, r) => a + r.evals, 0)}판)`);
    // 새 데이터로 표를 찍으려면 새 프로세스가 stages-gen.ts 를 다시 읽어야 한다
  }
  const ids = STAGES.map((s) => s.id);
  const rep = (await runWorkers('--report-worker', ids)).map((l) => JSON.parse(l) as ReturnType<typeof report>);
  const byId = new Map(rep.map((r) => [r.id, r]));
  const cell = (r: { cleared: boolean; turns: number; fallen: number; stars: number }) => (r.cleared ? `${r.turns}턴${r.fallen ? `(${r.fallen})` : ''} ★${r.stars}` : '실패');
  console.log('\n| 스테이지 | 파티 | 레벨1 | testLv | 예상Lv | par |');
  console.log('|---|---|---|---|---|---|');
  for (const id of ids) {
    const r = byId.get(id)!;
    const region = Number(id.split('-')[0]);
    console.log(`| ${id} | ${partyFor(region).join(',')} | ${cell(r.one)} | Lv${testLevel(region)} ${cell(r.test)} | Lv${expectLevel(region)} ${cell(r.expect)} | ${r.par} |`);
  }
  console.log('\n| 지역 | testLv 클리어 | 예상Lv 클리어 · 별 | 레벨1 클리어 · 별 | 평균 턴(testLv) | 평균 턴(예상Lv) | 평균 par |');
  console.log('|---|---|---|---|---|---|---|');
  const stars = (rs: { stars: number }[]) => rs.reduce((a, r) => a + r.stars, 0);
  for (let region = 1; region <= 12; region++) {
    const rs = ids.filter((id) => id.startsWith(`${region}-`)).map((id) => byId.get(id)!);
    const n = (f: (r: (typeof rs)[number]) => boolean) => `${rs.filter(f).length}/${rs.length}`;
    const avg = (f: (r: (typeof rs)[number]) => number) => (rs.reduce((a, r) => a + f(r), 0) / rs.length).toFixed(1);
    console.log(`| ${region} | ${n((r) => r.test.cleared)} | ${n((r) => r.expect.cleared)} · ★${stars(rs.map((r) => r.expect))} | ${n((r) => r.one.cleared)} · ★${stars(rs.map((r) => r.one))} | ${avg((r) => r.test.turns)} | ${avg((r) => r.expect.turns)} | ${avg((r) => r.par)} |`);
  }
}

void main();
