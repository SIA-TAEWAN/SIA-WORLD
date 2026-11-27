/**
 * PGlite 대조용 기대값: 정해 둔 순서(씨앗이 정해진 무작위 돌보기 400단계 + 둘째 입양)를 기기 규칙(src/game/rules.ts)으로 돌려 단계마다 결과를 낸다.
 *   npx vite-node scripts/pg-expect.ts > <pg 폴더>/nyang-expect.json
 *   node scripts/pg-check.mjs <pg 폴더>
 * (PGlite 는 저장소에 넣지 않는다 — games/twelve/PROGRESS.md 의 'SQL 을 실제로 돌려 보기' 참고)
 */
import { COLOR_IDS, PERSONALITY_IDS, SPOTS, loveAt } from '../src/data/balance';
import { RuleError, adopt, clean, cure, feed, pet, visit, water, newState, type NyangState } from '../src/game/rules';

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
console.log(JSON.stringify(steps));
