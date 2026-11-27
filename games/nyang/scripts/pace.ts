/**
 * 친밀도 곡선 (PRD 7장: 하루 2~3번 돌보면 10단계까지 약 2달).
 *   npm run pace              → 성격 5종 × 하루 2 · 3 · 4번, 120일까지
 *   npm run pace -- 3         → 하루 3번만, 단계마다 걸린 날
 * 가정: 들를 때마다 밥 · 물 · 똥 전부 · 쓰다듬기(좋아하는 곳, 기분이 찰 때까지 최대 4번). 들르는 시각은 아래 HOURS.
 * 아직 없는 것(놀아 주기 · 츄르 · 빗질 — 3단계)은 셈하지 않는다 → 3단계 뒤에 다시 맞춘다.
 * 규칙은 게임과 같은 함수(src/game/rules.ts)를 그대로 쓴다.
 */
import { CONST, LOVE_NEED, PERSONALITIES, loveLevel, type PersonalityId } from '../src/data/balance';
import { RuleError, adopt, clean, feed, moodOf, newState, pet, visit, water, type NyangState } from '../src/game/rules';

const H = 3600;
const T0 = 1767193200 + 330 * 86400; // 한국 시간 자정
const HOURS: Record<number, number[]> = { 1: [20], 2: [8, 21], 3: [8, 13, 21], 4: [8, 12, 17, 22] };
const DAYS = 120;

const tryDo = (fn: () => NyangState): NyangState | null => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RuleError) return null;
    throw e;
  }
};

function run(personality: PersonalityId, visits: number) {
  let s = adopt(newState(), 'white', personality, '나비', T0 + HOURS[visits][0] * H).state;
  const reached: number[] = [0];
  const likes = PERSONALITIES.find((p) => p.id === personality)!.likes[0];
  let sick = 0;
  let sia = 0;
  let coins = 0;
  for (let d = 0; d < DAYS; d++) {
    const hours = HOURS[visits];
    for (const h of hours) {
      let t = T0 + d * 86400 + h * H;
      s = visit(s, true, t).state;
      if (s.cats[0].sickAt != null) sick++;
      const f = tryDo(() => {
        const r = feed(s, 1, 'basic', t);
        if (r.sia) sia++;
        return r.state;
      });
      if (f) s = f;
      const w = tryDo(() => {
        const r = water(s, 1, t);
        if (r.sia) sia++;
        return r.state;
      });
      if (w) s = w;
      for (;;) {
        const c = tryDo(() => {
          const r = clean(s, 1, t);
          if (r.sia) sia++;
          return r.state;
        });
        if (!c) break;
        s = c;
      }
      // 쓰다듬기: 기분이 거의 찰 때까지 (좋아하는 곳, 한 번에 최대 4번)
      for (let i = 0; i < 4 && moodOf(s.cats[0], t) < CONST.max - CONST.pet_mood_like; i++) {
        t += CONST.pet_gap_sec;
        const r = pet(s, 1, likes, t);
        if (r.sia) sia++;
        s = r.state;
      }
      const lv = loveLevel(s.cats[0].love).level;
      while (reached.length < lv) reached.push(d + 1);
    }
  }
  coins = s.profile.coins;
  return { reached, sick, sia, coins, love: s.cats[0].love };
}

const only = Number(process.argv[2]) || 0;
const visitsList = only ? [only] : [2, 3, 4];
console.log(`친밀도 단계표 LOVE_NEED = ${LOVE_NEED.join(', ')} (합 ${LOVE_NEED.reduce((a, b) => a + b, 0)})`);
console.log('단계마다 처음 닿은 날 (입양한 날 = 1일째). — 는 120일 안에 못 닿음\n');
console.log(`${'성격'.padEnd(10)} 하루  ${[...Array(9)].map((_, i) => `Lv${i + 2}`.padStart(5)).join('')}   감기  시아코인/일  엽전/일`);
for (const visits of visitsList)
  for (const p of PERSONALITIES) {
    const r = run(p.id, visits);
    const cells = [...Array(9)].map((_, i) => String(r.reached[i + 1] ?? '—').padStart(5)).join('');
    console.log(`${p.name.padEnd(10)} ${visits}번  ${cells}   ${String(r.sick).padStart(4)}  ${(r.sia / DAYS).toFixed(1).padStart(10)}  ${(r.coins / DAYS).toFixed(1).padStart(7)}`);
  }
