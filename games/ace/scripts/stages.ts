// 스테이지 JSON 도구.
//   npm run stages -- gen [n,n]   테마 규칙으로 등장표를 만들어 src/data/stages/stage<n>.json 에 쓴다 (stage1 은 손으로 만든 것이라 건너뜀)
//   npm run stages -- check       모든 스테이지 JSON 검사 (패턴·보스 이름, 시간 순서, 화면 안 위치)
//   npm run stages -- show <n>    등장표를 10초 단위로 요약해 보여 준다
// 같은 씨앗이면 같은 결과라 다시 만들어도 바뀌지 않는다. 손으로 고친 뒤에는 gen 을 다시 돌리지 말 것.
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PATTERNS, type PatternName } from '../src/game/patterns';
import { BOSSES } from '../src/data/bosses';
import { rng } from '../src/game/sim';
import type { StageDef, Wave } from '../src/data/waves';

const DIR = fileURLToPath(new URL('../src/data/stages/', import.meta.url));

/** 스테이지마다 다른 것: 이름 · 바닥 · 특징 · 중형기 패턴 · 보스 */
interface Theme {
  id: number; name: string; animal: string; floor: string; ground: string;
  sea?: StageDef['sea']; sky?: boolean; fog?: boolean; snow?: boolean; lava?: boolean; wind?: number;
  mid: string; boss: string;
  medium: PatternName[];
  /** 특징 */
  rise?: boolean; groundMany?: boolean; bolts?: boolean; curve?: boolean; popup?: boolean; pillars?: boolean;
}
export const THEMES: Theme[] = [
  { id: 2, name: '넓은 바다', animal: 'ox', floor: 'floor-r04', ground: 'gunboat', sea: 'full', mid: 'diver', boss: 'carrier', medium: ['aim3', 'rise8', 'ring16'], rise: true },
  { id: 3, name: '대나무 숲', animal: 'tiger', floor: 'floor-r05', ground: 'bamboo', mid: 'kites', boss: 'tanuki', medium: ['aim3', 'fan9', 'medMix'], groundMany: true },
  { id: 4, name: '벚꽃 계곡', animal: 'rabbit', floor: 'floor-r08', ground: 'castle', mid: 'petals', boss: 'gumiho', medium: ['petal', 'petalFan', 'aim3'], curve: true },
  { id: 5, name: '구름 위', animal: 'dragon', floor: 'floor-r01', ground: 'castle', sky: true, mid: 'cloudship', boss: 'raijin', medium: ['aim3', 'ring16', 'aim5'], bolts: true },
  { id: 6, name: '독안개 늪', animal: 'snake', floor: 'floor-r06', ground: 'swamp', fog: true, mid: 'fogfort', boss: 'imugi', medium: ['slowRing', 'aim5', 'medMix'], rise: true },
  { id: 7, name: '사막 협곡', animal: 'horse', floor: 'floor-r03', ground: 'sandtank', mid: 'tanks', boss: 'sandworm', medium: ['aim5', 'fan9', 'bigAim'], groundMany: true },
  { id: 8, name: '바람 고원', animal: 'sheep', floor: 'floor-r02', ground: 'castle', wind: 3, mid: 'windmill', boss: 'tornado', medium: ['ring16', 'aim5', 'spiral4'] },
  { id: 9, name: '얼음 산맥', animal: 'monkey', floor: 'floor-r11', ground: 'ice', snow: true, mid: 'snowfog', boss: 'yeti', medium: ['slowRing', 'aim5', 'ring16'] },
  { id: 10, name: '폐허 성곽', animal: 'rooster', floor: 'floor-r07', ground: 'ruin', mid: 'riders', boss: 'skeleton', medium: ['aim5', 'medMix', 'bigAim'], popup: true, groundMany: true },
  { id: 11, name: '불타는 화산', animal: 'dog', floor: 'floor-r10', ground: 'lava', lava: true, mid: 'lavaship', boss: 'volcano', medium: ['fan9', 'aim5', 'ring16'], pillars: true },
  { id: 12, name: '요괴 하늘성', animal: 'pig', floor: 'floor-r12', ground: 'castle', mid: 'generals', boss: 'king', medium: ['petal', 'medMix', 'aim5', 'slowRing', 'spiral4'], rise: true, bolts: true, curve: true },
];

/** 테마로 등장표 만들기. 잡몹 편대 → 중간 보스(약 52초) → 탄이 더 많은 잡몹 → 보스 */
export function generate(th: Theme, seed = th.id * 7919): StageDef {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const waves: Wave[] = [];
  const length = 112 + th.id * 2, midAt = 52;
  const dense = (t: number) => (t > midAt ? 0.78 : 1) * (1 - (th.id - 2) * 0.05);
  const fe = (base: number, t: number) => Math.round(base * dense(t));
  let carrier = 0;
  for (let t = 2; t < length - 4; t += 2.6 + r() * 1.4) {
    const at = Math.round(t * 10) / 10;
    if (at > midAt - 4 && at < midAt + 2) continue;
    const roll = r();
    if ((th.bolts || th.pillars) && roll < (th.id === 12 ? 0.1 : 0.2)) {
      waves.push({ at, kind: th.pillars ? 'pillar' : 'bolt', path: 'dive', x: 0.15 + r() * 0.7, w: 80 });
    } else if (th.rise && roll < 0.3) {
      const n = 2 + Math.floor(r() * 2);
      waves.push({ at, kind: 'medium', path: 'rise', x: 0.2 + r() * 0.2, dx: 170, count: n, y: 0.18 + r() * 0.25, fire: th.id === 6 ? 'slowRing' : 'rise8', fireEvery: fe(70, at), hp: 0.5 });
    } else if (roll < (th.groundMany ? 0.42 : 0.3)) {
      const two = r() < 0.5;
      const x = two ? 0.2 : 0.15 + r() * 0.7;
      waves.push({ at, kind: 'ground', path: th.popup ? 'popup' : 'ground', x, count: two ? 2 : 1, dx: 430, fire: pick(['aim1', 'aim3'] as PatternName[]), fireEvery: th.popup ? fe(60, at) : fe(110, at) });
    } else if (roll < 0.48) {
      waves.push({ at, kind: 'medium', path: 'hover', x: 0.25 + r() * 0.5, fire: pick(th.medium), fireEvery: fe(th.medium.includes('spiral4') ? 10 : 70, at) });
    } else if (at - carrier > 22 && roll < 0.56) {
      carrier = at;
      waves.push({ at, kind: 'carrier', path: 'cross', x: r() < 0.5 ? 0 : 1, drop: r() < 0.5 ? 'B' : 'P' });
    } else {
      const path = pick(['dive', 'swoopL', 'swoopR', 'dive'] as const);
      const wide = path === 'dive' && r() < 0.4;
      const fire: PatternName = th.curve && r() < 0.4 ? 'petalFan' : 'aim1';
      waves.push({
        at, kind: 'small', path, x: wide ? 0.12 : 0.2 + r() * 0.6, count: wide ? 6 : 5 + Math.floor(r() * 4),
        ...(wide ? { dx: 96 } : { gap: 10 + Math.floor(r() * 4) }),
        ...(at > 6 ? { fire, fireEvery: fe(fire === 'petalFan' ? 220 : 150, at) } : {}),
      });
    }
  }
  return {
    id: th.id, name: th.name, animal: th.animal, floor: th.floor, ground: th.ground,
    ...(th.sea ? { sea: th.sea } : {}), ...(th.sky ? { sky: true } : {}), ...(th.fog ? { fog: true } : {}),
    ...(th.snow ? { snow: true } : {}), ...(th.lava ? { lava: true } : {}), ...(th.wind ? { wind: th.wind } : {}),
    bulletSpeed: Math.round((0.85 + th.id * 0.03) * 100) / 100, length, midboss: { at: midAt, id: th.mid }, boss: th.boss, waves,
  };
}

/** 스테이지 하나 검사. 문제 목록을 돌려준다 */
export function check(st: StageDef): string[] {
  const bad: string[] = [];
  let last = 0;
  if (st.midboss && !BOSSES[st.midboss.id]) bad.push(`중간 보스 없음: ${st.midboss.id}`);
  if (st.boss && !BOSSES[st.boss]) bad.push(`보스 없음: ${st.boss}`);
  for (const w of st.waves) {
    if (w.at < last) bad.push(`시간 순서가 거꾸로: ${w.at}`);
    last = w.at;
    if (w.fire && !(w.fire in PATTERNS)) bad.push(`패턴 없음: ${w.fire} (${w.at}초)`);
    const xs = [w.x, w.x + ((w.count ?? 1) - 1) * (w.dx ?? 0) / 720];
    if (w.path !== 'cross' && xs.some(x => x < 0 || x > 1)) bad.push(`화면 밖 위치: ${w.at}초 x=${xs.map(v => v.toFixed(2))}`);
    if (w.at > st.length) bad.push(`길이보다 늦음: ${w.at}`);
  }
  return bad;
}

function load(n: number): StageDef { return JSON.parse(readFileSync(DIR + `stage${n}.json`, 'utf8')); }

function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'gen') {
    const only = arg ? arg.split(',').map(Number) : null;
    for (const th of THEMES) {
      if (only && !only.includes(th.id)) continue;
      const st = generate(th);
      writeFileSync(DIR + `stage${th.id}.json`, JSON.stringify(st, null, 2).replace(/\n {6,}/g, ' ').replace(/\{ /g, '{ ') + '\n');
      console.log(`stage${th.id}.json  ${st.waves.length}줄  ${st.length}초  중간 ${st.midboss!.id} · 보스 ${st.boss}`);
    }
  } else if (cmd === 'show') {
    const st = load(Number(arg));
    console.log(`${st.id}. ${st.name}  (${st.length}초, 탄 속도 ×${st.bulletSpeed})`);
    for (let t = 0; t < st.length; t += 10) {
      const ws = st.waves.filter(w => w.at >= t && w.at < t + 10);
      const mid = st.midboss && st.midboss.at >= t && st.midboss.at < t + 10 ? `  ★중간 보스 ${BOSSES[st.midboss.id].name}` : '';
      console.log(`${String(t).padStart(3)}s  ${ws.map(w => `${w.kind}${(w.count ?? 1) > 1 ? '×' + w.count : ''}${w.fire ? ':' + w.fire : ''}`).join(', ')}${mid}`);
    }
    console.log(`끝   보스 ${st.boss ? BOSSES[st.boss].name : '-'}`);
  } else {
    let ok = true;
    for (const f of readdirSync(DIR).filter(f => /^stage\d+\.json$/.test(f)).sort()) {
      const bad = check(JSON.parse(readFileSync(DIR + f, 'utf8')));
      console.log(`${f}  ${bad.length ? '✗ ' + bad.join(' / ') : '✓'}`);
      if (bad.length) ok = false;
    }
    if (!ok) process.exit(1);
  }
}

// 테스트(vitest)에서 불러올 때는 실행하지 않는다
if (!process.env.VITEST) main();
