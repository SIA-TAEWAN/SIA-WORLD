/**
 * 친밀도 곡선 · 감기 (PRD 7장: 하루 2~3번 돌보면 10단계까지 약 2달).
 *   npm run pace              → 성격 5종 × (하루 1 · 2 · 3번) × 츄르 (하루 0 · 2개), 120일까지
 *   npm run pace -- 2         → 하루 2번만
 * 가정 (들를 때마다): 선물 줍기 · 밥 · 물 · 똥 전부 · 놀아 주기 한 판(낚싯대, 10마리) · 쓰다듬기 3번(좋아하는 곳) ·
 *   하루 첫 방문에 빗질 · 츄르는 하루 정한 개수만큼(좋아하는 맛) · 아프면 담요.
 * 들르는 시각은 HOURS 에 ±JITTER 시간을 정해진 무작위로 흔든다 (하루 1번은 8 ~ 23시 아무 때나) — 사람은 매일 같은 시각에 오지 않는다.
 * 규칙은 게임과 같은 함수(src/game/rules.ts)를 그대로 쓴다.
 */
import { CONST, LOVE_NEED, PERSONALITIES, itemKey, kstDay, type PersonalityId } from '../src/data/balance';
import {
  RuleError, addItem, adopt, brush, churu, clean, cure, feed, gift, pet, play, playStart, visit, water, type NyangState,
} from '../src/game/rules';

const H = 3600;
const T0 = 1767193200 + 330 * 86400; // 한국 시간 자정
const HOURS: Record<number, number[]> = { 1: [15.5], 2: [8.5, 21], 3: [8, 13.5, 21.5] };
const JITTER: Record<number, number> = { 1: 7.5, 2: 1.5, 3: 1.25 };
const DAYS = 120;
const CATCHES = 10;
const PETS = 3;

const tryDo = <R>(fn: () => R): R | null => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RuleError) return null;
    throw e;
  }
};

function run(personality: PersonalityId, visits: number, churuPerDay: number, seed0 = 7) {
  let seed = seed0 * 7919 + visits * 104729 + personality.length;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
  const p = PERSONALITIES.find((x) => x.id === personality)!;
  let s = adopt(newStateAt(), 'white', personality, '나비', T0 + 8 * H).state;
  const reached: number[] = [0];
  let sickEp = 0;
  let wasSick = false;
  let sia = 0;
  let presents = 0;
  const count = (r: { sia?: boolean }) => r.sia && sia++;
  for (let d = 0; d < DAYS; d++) {
    // 츄르는 산 것으로 친다 (상점은 4단계)
    if (churuPerDay) addItem(s.profile, itemKey.churu(p.churu), churuPerDay);
    const hours = HOURS[visits].map((h) => h + (rnd() * 2 - 1) * JITTER[visits]).sort((a, b) => a - b);
    let churuLeft = churuPerDay;
    hours.forEach((h, vi) => {
      let t = Math.floor(T0 + d * 86400 + h * H);
      if (d === 0 && t < T0 + 8 * H) t = T0 + 8 * H + 60;
      s = visit(s, true, t).state;
      const sick = s.cats[0].sickAt != null;
      if (sick && !wasSick) sickEp++;
      wasSick = sick;
      const g = tryDo(() => gift(s, 1, t));
      if (g) (s = g.state), presents++;
      const step = <R extends { state: NyangState }>(fn: () => R) => {
        const r = tryDo(fn);
        if (r) {
          s = r.state;
          count(r as { sia?: boolean });
        }
        return r;
      };
      step(() => feed(s, 1, 'basic', t));
      step(() => water(s, 1, t));
      while (step(() => clean(s, 1, t)));
      // 놀아 주기 한 판 (30초)
      step(() => playStart(s, 1, 'rod', t));
      t += 32;
      step(() => play(s, 1, CATCHES, t));
      for (let i = 0; i < PETS; i++) {
        t += CONST.pet_gap_sec;
        step(() => pet(s, 1, p.likes[0], t));
      }
      if (vi === 0 || kstDay(t) !== s.cats[0].brushDay) step(() => brush(s, 1, t));
      if (churuLeft > 0 && step(() => churu(s, 1, p.churu, t))) churuLeft--;
      step(() => cure(s, 1, 'blanket', t));
      const lv = levelOfLove(s.cats[0].love);
      while (reached.length < lv) reached.push(d + 1);
    });
  }
  return { reached, sickEp, sia, presents, coins: s.profile.coins, love: s.cats[0].love };
}

function newStateAt(): NyangState {
  return { profile: { coins: 0, seq: 0, visitAt: 0, bonusDay: -1, careDays: 0, siaDay: -1, siaToday: 0, siaDue: 0, siaPaid: 0, sia: 0, items: {}, furniture: [], pseq: 0 }, cats: [] };
}
function levelOfLove(love: number) {
  let rest = love;
  for (let i = 0; i < LOVE_NEED.length; i++) {
    if (rest < LOVE_NEED[i]) return i + 1;
    rest -= LOVE_NEED[i];
  }
  return LOVE_NEED.length + 1;
}

const only = Number(process.argv[2]) || 0;
const visitsList = only ? [only] : [1, 2, 3];
console.log(`친밀도 단계표 LOVE_NEED = ${LOVE_NEED.join(', ')} (합 ${LOVE_NEED.reduce((a, b) => a + b, 0)})`);
console.log('단계마다 처음 닿은 날 (입양한 날 = 1일째). — 는 120일 안에 못 닿음. 감기 = 걸린 횟수 (120일, 들르는 시각 3가지 무작위의 합)\n');
console.log(`${'성격'.padEnd(8)} 하루 츄르 ${[...Array(9)].map((_, i) => `Lv${i + 2}`.padStart(5)).join('')}   감기  시아/일 선물/일 엽전/일`);
const summary: string[] = [];
for (const visits of visitsList)
  for (const ch of visits === 1 ? [0, 1] : [0, 2]) {
    const lv10: number[] = [];
    let sickAll = 0;
    for (const p of PERSONALITIES) {
      // 들르는 시각의 무작위 3가지로 돌려 감기는 합, 단계는 첫 번째 것
      const runs = [7, 8, 9].map((sd) => run(p.id, visits, ch, sd));
      const r = runs[0];
      const sick = runs.reduce((a, x) => a + x.sickEp, 0);
      sickAll += sick;
      if (r.reached[9]) lv10.push(r.reached[9]);
      const cells = [...Array(9)].map((_, i) => String(r.reached[i + 1] ?? '—').padStart(5)).join('');
      console.log(`${p.name.padEnd(8)} ${visits}번  ${ch}개 ${cells}   ${String(sick).padStart(4)}  ${(r.sia / DAYS).toFixed(1).padStart(6)}  ${(r.presents / DAYS).toFixed(2).padStart(6)}  ${(r.coins / DAYS).toFixed(1).padStart(6)}`);
    }
    summary.push(`하루 ${visits}번 · 츄르 ${ch}개: 10단계 ${lv10.length ? `${Math.min(...lv10)}~${Math.max(...lv10)}일` : '—'} · 감기 ${sickAll}번 (성격 5 × 120일 × 3가지 = 1800일)`);
  }
console.log(`\n${summary.join('\n')}`);
