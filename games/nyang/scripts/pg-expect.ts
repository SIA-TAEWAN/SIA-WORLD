/**
 * PGlite 대조용 기대값: 정해 둔 순서(씨앗이 정해진 무작위 돌보기 400단계 + 둘째 입양)를 기기 규칙(src/game/rules.ts)으로 돌려 단계마다 결과를 낸다.
 *   npx vite-node scripts/pg-expect.ts > <pg 폴더>/nyang-expect.json
 *   node scripts/pg-check.mjs <pg 폴더>
 * (PGlite 는 저장소에 넣지 않는다 — games/twelve/PROGRESS.md 의 'SQL 을 실제로 돌려 보기' 참고)
 */
import { BEHAVIORS, COLOR_IDS, PERSONALITY_IDS, SPOTS, loveAt } from '../src/data/balance';
import { RuleError, adopt, brush, churu, clean, cure, feed, gift, pet, play, playStart, seen, visit, water, newState, cloneState, type NyangState } from '../src/game/rules';

const H = 3600;
let t = 1767193200 + 330 * 86400 + 9 * H;
let seed = 12345;
const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);

type Step = { op: string; t: number; args: unknown[]; out: Record<string, unknown> };
const steps: Step[] = [];
let s: NyangState = newState();

function run(op: string, args: unknown[], fn: () => { state: NyangState }) {
  try {
    const { state, ...rest } = fn();
    s = state;
    steps.push({ op, t, args, out: { ...rest, state: s } });
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    steps.push({ op, t, args, out: { error: e.message } });
  }
}

run('state', [true], () => visit(s, true, t));
run('adopt', ['pink', 'calm', '나비'], () => adopt(s, 'pink', 'calm', '나비', t));
run('adopt', ['cheese', 'glutton', '  치즈  냥 '], () => adopt(s, 'cheese', 'glutton', '  치즈  냥 ', t));
run('adopt', ['black', 'lazy', '까망'], () => adopt(s, 'black', 'lazy', '까망', t));
for (let i = 0; i < 400; i++) {
  const k = rnd(100);
  t += k < 50 ? 5 + rnd(60) : k < 85 ? rnd(6 * H) : k < 97 ? rnd(30 * H) : 40 * H + rnd(20 * H);
  const op = rnd(9);
  const slot = rnd(10) === 1 ? 2 : 1;
  if (op === 0) run('feed', [slot, 'basic'], () => feed(s, slot, 'basic', t));
  else if (op === 1) run('water', [slot], () => water(s, slot, t));
  else if (op === 2 || op === 3) run('clean', [slot], () => clean(s, slot, t));
  else if (op === 4 || op === 5) {
    const spot = SPOTS[rnd(SPOTS.length)];
    run('pet', [slot, spot], () => pet(s, slot, spot, t));
  } else if (op === 6) run('cure', [slot, 'blanket'], () => cure(s, slot, 'blanket', t));
  else {
    const e = rnd(2) === 0;
    run('state', [e], () => visit(s, e, t));
  }
}
// 정해 둔 순서: 사흘 떠나 있기 → 감기 → 다 채우고 담요 → 2시간 뒤 나음 · 너무 잦은 쓰다듬기 · 없는 고양이
t += 3 * 86400;
run('state', [true], () => visit(s, true, t));
run('feed', [1, 'basic'], () => feed(s, 1, 'basic', t));
run('water', [1], () => water(s, 1, t));
for (let i = 0; i < 5; i++) run('clean', [1], () => clean(s, 1, t));
for (let i = 0; i < 4; i++) {
  t += 8;
  run('pet', [1, 'chin'], () => pet(s, 1, 'chin', t));
}
run('pet', [1, 'chin'], () => pet(s, 1, 'chin', t + 3));
run('cure', [1, 'blanket'], () => cure(s, 1, 'blanket', t));
run('cure', [1, 'blanket'], () => cure(s, 1, 'blanket', t));
t += 7199;
run('state', [false], () => visit(s, false, t));
t += 1;
run('state', [false], () => visit(s, false, t));
t += 600;
run('state', [false], () => visit(s, false, t));
run('feed', [3, 'basic'], () => feed(s, 3, 'basic', t));
// 첫 고양이를 4단계로 올린 뒤 둘째 입양 (서버는 love 를 SQL 로 맞춘다)
steps.push({ op: 'setlove', t, args: [1, loveAt(4)], out: {} });
s = { ...s, cats: s.cats.map((c) => (c.slot === 1 ? { ...c, love: loveAt(4) } : c)) };
t += 10;
run('adopt', [COLOR_IDS[3], PERSONALITY_IDS[4], '회색이'], () => adopt(s, COLOR_IDS[3], PERSONALITY_IDS[4], '회색이', t));
run('adopt', ['white', 'calm', '셋째'], () => adopt(s, 'white', 'calm', '셋째', t));
for (let i = 0; i < 40; i++) {
  t += rnd(5 * H);
  const slot = 1 + rnd(2);
  const op = rnd(3);
  if (op === 0) run('feed', [slot, 'basic'], () => feed(s, slot, 'basic', t));
  else if (op === 1) run('clean', [slot], () => clean(s, slot, t));
  else run('pet', [slot, 'chin'], () => pet(s, slot, 'chin', t));
}
// 3단계: 놀아 주기 · 빗질 · 츄르 · 선물 · 행동 도감 · 약 간식 (보관함은 서버도 SQL 로 맞춘다)
const setItem = (key: string, n: number) => {
  steps.push({ op: 'setitem', t, args: [key, n], out: {} });
  s = cloneState(s);
  s.profile.items[key] = n;
};
setItem('toy:laser', 1);
setItem('churu:tuna', 4);
setItem('medicine', 1);
// 아래쪽 비트가 고른 수를 쓴다 (rnd 의 % 작은 수는 주기가 짧다)
const rnd2 = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), Math.floor(seed / 65536) % n);
const TOYS = ['rod', 'laser', 'ball', 'box', 'yarn'];
const FLAVORS = ['tuna', 'salmon', 'chicken', 'beef'];
const BEH = [...BEHAVIORS.map((b) => b.id), 'dance'];
for (let i = 0; i < 260; i++) {
  const k = rnd2(100);
  t += k < 60 ? 1 + rnd2(40) : k < 90 ? rnd2(5 * H) : rnd2(30 * H);
  const slot = rnd2(6) === 1 ? 2 : 1;
  const op = rnd2(12);
  if (op === 0 || op === 1) {
    const toy = TOYS[rnd2(TOYS.length)];
    run('play_start', [slot, toy], () => playStart(s, slot, toy, t));
  } else if (op === 2 || op === 3) {
    const n = rnd2(22) - 2;
    run('play', [slot, n], () => play(s, slot, n, t));
  } else if (op === 4) run('brush', [slot], () => brush(s, slot, t));
  else if (op === 5) {
    const f = FLAVORS[rnd2(FLAVORS.length)];
    run('churu', [slot, f], () => churu(s, slot, f, t));
  } else if (op === 6) run('gift', [slot], () => gift(s, slot, t));
  else if (op === 7) {
    const b = BEH[rnd2(BEH.length)];
    run('seen', [slot, b], () => seen(s, slot, b, t));
  } else if (op === 8 || op === 9) run('state', [true], () => visit(s, true, t));
  else if (op === 10) run('cure', [slot, 'medicine'], () => cure(s, slot, 'medicine', t));
  else {
    run('feed', [slot, 'basic'], () => feed(s, slot, 'basic', t));
    run('water', [slot], () => water(s, slot, t));
    run('clean', [slot], () => clean(s, slot, t));
  }
}
// 친밀도 10단계 고양이의 선물 (자주) · 같이 자기 도감
steps.push({ op: 'setlove', t, args: [1, loveAt(10)], out: {} });
s = { ...s, cats: s.cats.map((c) => (c.slot === 1 ? { ...c, love: loveAt(10) } : c)) };
for (let i = 0; i < 12; i++) {
  t += 4 * H + rnd2(H);
  run('state', [true], () => visit(s, true, t));
  run('gift', [1], () => gift(s, 1, t));
  run('gift', [2], () => gift(s, 2, t));
  run('feed', [1, 'basic'], () => feed(s, 1, 'basic', t));
  run('water', [1], () => water(s, 1, t));
  for (let k = 0; k < 4; k++) run('clean', [1], () => clean(s, 1, t));
  run('play_start', [1, 'rod'], () => playStart(s, 1, 'rod', t));
  t += 25 + rnd2(20);
  const n = rnd2(18);
  run('play', [1, n], () => play(s, 1, n, t));
  run('churu', [1, 'tuna'], () => churu(s, 1, 'tuna', t));
  run('brush', [1], () => brush(s, 1, t));
}
// 하루 놀이 상한 · 츄르 하루 2개
setItem('churu:chicken', 5);
for (let i = 0; i < 6; i++) {
  run('play_start', [2, 'laser'], () => playStart(s, 2, 'laser', t));
  t += 40;
  run('play', [2, 99], () => play(s, 2, 99, t));
}
for (let i = 0; i < 3; i++) run('churu', [2, 'chicken'], () => churu(s, 2, 'chicken', t));
run('seen', [1, 'together'], () => seen(s, 1, 'together', t));
console.log(JSON.stringify(steps));
