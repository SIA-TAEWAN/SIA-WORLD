/**
 * 봇 밸런스 측정 (6단계). 영웅마다 N판을 '그럴듯한 사람' 봇(scripts/smart-bot.ts)으로 끝까지 돌린다. 9개 프로세스로 나눠 돌림.
 *   npm run bot                      # 영웅마다 100판, 숙련 0
 *   npm run bot -- 300               # 영웅마다 300판
 *   npm run bot -- 200 tiger,dog     # 고른 영웅만
 *   npm run bot -- 200 --mastery=all # 숙련 0~5 추세 (영웅 모두 합쳐)
 *   npm run bot -- 100 --endless     # 끝없는 모드: 평균 몇 칸·몇 막
 *   npm run bot -- 200 --simple      # 예전 단순 봇(tests/bot.ts)으로
 *   --workers=4                      # 프로세스 수
 * 출력: 영웅별 1·2·3막 클리어율 · 4막 열림 · 어둑시니 · 1막 지역별(대나무숲/들판) 3막 클리어율 · 한 판 전투·턴 수와 예상 시간 · 많이 쓰러진 곳.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { HEROES, enemyDef, genMap, heroDef, newRun, regionDef, type RunState } from '../src/game/rules';
import { playRun } from '../tests/bot';
import { smartPlayRun } from './smart-bot';

const args = process.argv.slice(2);
const flag = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? (args.includes(`--${k}`) ? 'true' : undefined);
const pos = args.filter((a) => !a.startsWith('--'));
const N = Math.max(1, Number(pos[0]) || 100);
const only = (pos[1] ?? '').split(',').filter(Boolean);
const endless = !!flag('endless');
const simple = !!flag('simple');
const diag = !!flag('diag');
const masteryArg = flag('mastery') ?? '0';
const masteries = masteryArg === 'all' ? [0, 1, 2, 3, 4, 5] : masteryArg.split(',').map(Number);
const workerArg = flag('worker');
const W = Math.max(1, Number(flag('workers') ?? 9));
const heroes = HEROES.filter((h) => !only.length || only.includes(h.id));

interface Res {
  hero: string;
  m: number;
  region: string;
  cleared: number;
  open4: boolean;
  final: boolean;
  floors: number;
  acts: number;
  battles: number;
  turns: number;
  plays: number;
  inputs: number;
  nodes: number;
  death?: string;
  fights?: [number, string, string, number][];
}

/** 판 하나 (씨앗은 영웅·번호로 정함 — 숙련이 달라도 같은 씨앗) */
function one(hero: string, s: number, m: number): Res {
  const seed = (hero.length * 100003 + s * 7919 + hero.charCodeAt(0) * 31) >>> 0;
  const run: RunState = newRun({ seed, hero, mode: endless ? 'endless' : 'normal', mastery: m });
  const region = genMap(seed, 1, 0, run.mode).region;
  let tr: { battles: number; turns: number; plays: number; inputs: number; nodes: number; fights?: [number, string, string, number][] } = { battles: 0, turns: 0, plays: 0, inputs: 0, nodes: 0 };
  if (simple) tr.inputs = playRun(run);
  else tr = smartPlayRun(run);
  const cleared = run.phase === 'won' ? (run.ending ? 3 : run.act) : run.act - 1;
  let death: string | undefined;
  if (run.phase === 'dead' && run.battle) {
    const f = run.battle.foes.find((x) => !x.minion) ?? run.battle.foes[0];
    death = `${run.act}막 ${regionDef(run.map.region).name} · ${run.battle.kind === 'battle' ? '일반' : run.battle.kind === 'elite' ? '정예' : '보스'} ${enemyDef(f.id).name}`;
  }
  return { hero, m, region, cleared, open4: run.act === 4, final: run.ending === 'true', floors: run.stats.floors, acts: cleared, ...tr, fights: diag ? tr.fights : undefined, death };
}

function jobs(): [string, number, number][] {
  const out: [string, number, number][] = [];
  for (const m of masteries) for (const h of heroes) for (let s = 0; s < N; s++) out.push([h.id, s, m]);
  return out;
}

if (workerArg) {
  const [k, n] = workerArg.split('/').map(Number);
  const list = jobs().filter((_, i) => i % n === k);
  const res = list.map(([h, s, m]) => one(h, s, m));
  process.stdout.write('@@' + JSON.stringify(res) + '\n');
} else {
  const t0 = Date.now();
  const all: Res[] = [];
  if (W <= 1) all.push(...jobs().map(([h, s, m]) => one(h, s, m)));
  else {
    const require = createRequire(import.meta.url);
    const bin = require.resolve('vite-node/vite-node.mjs');
    const script = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const outs = await Promise.all(
      Array.from({ length: W }, (_, k) =>
        new Promise<Res[]>((ok, bad) => {
          const p = spawn(process.execPath, [bin, script, ...args, `--worker=${k}/${W}`], { stdio: ['ignore', 'pipe', 'inherit'] });
          let buf = '';
          p.stdout.on('data', (d) => (buf += d));
          p.on('exit', (code) => {
            const line = buf.split('\n').find((l) => l.startsWith('@@'));
            if (code !== 0 || !line) bad(new Error(`worker ${k} failed (${code})`));
            else ok(JSON.parse(line.slice(2)));
          });
        }),
      ),
    );
    for (const o of outs) all.push(...o);
  }
  report(all, (Date.now() - t0) / 1000);
}

function report(all: Res[], sec: number) {
  const pct = (a: number, n: number) => (n ? `${((a / n) * 100).toFixed(0)}%` : '-').padStart(4);
  const avg = (list: Res[], f: (r: Res) => number) => (list.length ? list.reduce((s, r) => s + f(r), 0) / list.length : 0);
  console.log(`봇 ${simple ? '(단순)' : '(사람 흉내)'} — ${endless ? '끝없는 모드' : '보통'} · 영웅마다 ${N}판 · ${all.length}판 (${sec.toFixed(1)}초)`);
  if (endless) {
    console.log('영웅          평균 칸  평균 깬 막  최고 칸');
    for (const h of heroes) {
      const list = all.filter((r) => r.hero === h.id);
      const name = `${heroDef(h.id).name}(${heroDef(h.id).animal})`.padEnd(9, '　');
      console.log(`${name}  ${avg(list, (r) => r.floors).toFixed(1).padStart(6)}  ${avg(list, (r) => r.acts).toFixed(2).padStart(8)}  ${Math.max(...list.map((r) => r.floors))}`);
    }
    console.log(`전체 평균 칸 ${avg(all, (r) => r.floors).toFixed(1)} · 평균 깬 막 ${avg(all, (r) => r.acts).toFixed(2)}`);
    return;
  }
  for (const m of masteries) {
    const ms = all.filter((r) => r.m === m);
    console.log(`\n[숙련 ${m}]`);
    console.log('영웅          1막  2막  3막 4막열림 어둑시니 | 대나무숲3막 들판3막 | 칸');
    for (const h of heroes) {
      const list = ms.filter((r) => r.hero === h.id);
      const n = list.length;
      const bam = list.filter((r) => r.region === 'bamboo');
      const fld = list.filter((r) => r.region === 'field');
      const c = (k: number, l = list) => l.filter((r) => r.cleared >= k).length;
      const name = `${heroDef(h.id).name}(${heroDef(h.id).animal})`.padEnd(9, '　');
      console.log(
        `${name} ${pct(c(1), n)} ${pct(c(2), n)} ${pct(c(3), n)}  ${pct(list.filter((r) => r.open4).length, n)}    ${pct(list.filter((r) => r.final).length, n)}  |    ${pct(c(3, bam), bam.length)}     ${pct(c(3, fld), fld.length)} | ${avg(list, (r) => r.floors).toFixed(1)}`,
      );
    }
    const n = ms.length;
    const bam = ms.filter((r) => r.region === 'bamboo');
    const fld = ms.filter((r) => r.region === 'field');
    const c = (k: number, l = ms) => l.filter((r) => r.cleared >= k).length;
    console.log(
      `전체          ${pct(c(1), n)} ${pct(c(2), n)} ${pct(c(3), n)}  ${pct(ms.filter((r) => r.open4).length, n)}    ${pct(ms.filter((r) => r.final).length, n)}  |    ${pct(c(3, bam), bam.length)}     ${pct(c(3, fld), fld.length)} | 1막 클리어 대나무숲 ${pct(c(1, bam), bam.length)} · 들판 ${pct(c(1, fld), fld.length)}`,
    );
    if (!simple) {
      // 한 판 시간 추정: 전투 턴 12초 + 카드 한 장 3초 + 전투 밖 칸 20초 (사람이 읽고 고르는 시간)
      const won = ms.filter((r) => r.cleared >= 3);
      const est = (l: Res[]) => avg(l, (r) => r.turns * 12 + r.plays * 3 + (r.nodes - r.battles) * 20) / 60;
      console.log(
        `한 판(3막 깬 판): 전투 ${avg(won, (r) => r.battles).toFixed(1)} · 턴 ${avg(won, (r) => r.turns).toFixed(0)} · 카드·물약 ${avg(won, (r) => r.plays).toFixed(0)} · 칸 ${avg(won, (r) => r.nodes).toFixed(0)} → 약 ${est(won).toFixed(0)}분 (전체 판 평균 ${est(ms).toFixed(0)}분)`,
      );
    }
  }
  if (diag) {
    const g = new Map<string, { n: number; dead: number; lost: number }>();
    for (const r of all)
      for (const [act, reg, kind, lost] of r.fights ?? []) {
        const k = `${act}막 ${regionDef(reg).name} ${kind}`;
        const e = g.get(k) ?? { n: 0, dead: 0, lost: 0 };
        e.n++;
        if (lost < 0) e.dead++;
        else e.lost += lost;
        g.set(k, e);
      }
    console.log('\n전투별 (판 수 · 쓰러짐 · 평균 잃은 체력 — 보스는 승리 회복 뒤 값):');
    for (const [k, e] of [...g].sort()) console.log(`  ${k.padEnd(16)} ${String(e.n).padStart(6)}  ${pct(e.dead, e.n)}  ${(e.lost / Math.max(1, e.n - e.dead)).toFixed(1)}`);
  }
  const deaths = new Map<string, number>();
  for (const r of all) if (r.death) deaths.set(r.death, (deaths.get(r.death) ?? 0) + 1);
  console.log('\n많이 쓰러진 곳 (상위 15):');
  for (const [k, n] of [...deaths].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${k}: ${n}`);
}
