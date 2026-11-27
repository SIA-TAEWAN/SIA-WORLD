import { describe, expect, it } from 'vitest';
import { CONST, LOVE_NEED, PERSONALITIES, PERSONALITY, kstDay, loveAt, loveLevel, shelterKittens } from '../src/data/balance';
import {
  RuleError, adopt, clean, cleanOf, cure, feed, fullOf, levelsOf, lin, linHalfAt, linZeroAt, moodOf, newState, pet, poopsOf, settle, spotKind, visit, water, waterOf,
  type NyangState,
} from '../src/game/rules';

const H = 3600;
/** 2026-11-27 09:00 (한국 시간) */
const T0 = 1767193200 + 330 * 86400 + 9 * H;

function start(personality = 'calm', t = T0): NyangState {
  return adopt(newState(), 'white', personality, '나비', t).state;
}
const cat = (s: NyangState, slot = 1) => s.cats.find((c) => c.slot === slot)!;
const err = (fn: () => unknown, msg: string) => expect(fn).toThrowError(new RuleError(msg));

describe('상태 4가지의 시간 계산', () => {
  it('lin · 절반 · 바닥의 때가 한 초씩 셈과 같다', () => {
    for (const [amount, dur] of [[10000, 28800], [7321, 23400], [5000, 36000], [4999, 21600], [10000, 50400], [1, 14400]]) {
      const half = linHalfAt(amount, 100, dur);
      const zero = linZeroAt(amount, 100, dur);
      for (let t = 100; t < 100 + dur + 10; t += 1) {
        const v = lin(amount, 100, dur, t);
        expect(v >= 5000, `${amount}/${dur}@${t}`).toBe(t < half);
        expect(v === 0, `${amount}/${dur}@${t} 바닥`).toBe(t >= zero);
      }
    }
  });

  it('입양하면 배부름 · 물 가득, 똥 없음, 기분 80 %', () => {
    const s = start();
    const l = levelsOf(cat(s), T0);
    expect(l).toEqual({ full: 10000, water: 10000, clean: 10000, mood: CONST.start_mood, poops: 0, spoiled: false, sick: false, curing: false });
  });

  it('성격마다 줄어드는 시간 (PRD 3장: 밥 약 8시간 · 물 약 6시간 · 똥 4~6시간 · 기분 약 12시간)', () => {
    for (const p of PERSONALITIES) {
      expect(p.full_sec / H).toBeGreaterThanOrEqual(6.5);
      expect(p.full_sec / H).toBeLessThanOrEqual(9.5);
      expect(p.water_sec / H).toBeGreaterThanOrEqual(6);
      expect(p.water_sec / H).toBeLessThanOrEqual(7);
      expect(p.poop_sec / H).toBeGreaterThanOrEqual(4);
      expect(p.poop_sec / H).toBeLessThanOrEqual(6);
      expect(p.mood_sec / H).toBeGreaterThanOrEqual(10);
      expect(p.mood_sec / H).toBeLessThanOrEqual(14);
      // 물은 비고 나서 상한다 · 감기를 낫게 하는 동안 다시 바닥이 되지 않는다
      expect(CONST.spoil_sec).toBeGreaterThan(p.water_sec);
      const least = Math.min(p.full_sec, p.water_sec, p.mood_sec, p.poop_sec * 2);
      expect((CONST.cure_need * least) / CONST.max).toBeGreaterThan(CONST.cure_sec);
      // 싫어하는 곳은 배가 꼭 있다 (냥펀치)
      expect(p.dislikes).toContain('belly');
    }
    const s = start('calm');
    const c = cat(s);
    const p = PERSONALITY.calm;
    expect(fullOf(c, T0 + p.full_sec)).toBe(0);
    expect(fullOf(c, T0 + p.full_sec / 2)).toBe(5000);
    expect(waterOf(c, T0 + p.water_sec)).toBe(0);
    expect(poopsOf(c, T0 + p.poop_sec - 1)).toBe(0);
    expect(poopsOf(c, T0 + p.poop_sec)).toBe(1);
    expect(poopsOf(c, T0 + p.poop_sec * 9)).toBe(4);
    expect(cleanOf(c, T0 + p.poop_sec * 2)).toBe(5000);
    expect(moodOf(c, T0 + p.mood_sec)).toBe(0);
    expect(levelsOf(c, T0 + CONST.spoil_sec).spoiled).toBe(true);
  });
});

describe('친밀도', () => {
  it('네 상태가 모두 절반 이상인 시간만큼 (1초 = 1점) · 몇 번에 나눠 계산해도 같다', () => {
    const s = start('calm');
    const c = cat(s);
    // calm: 물 23400초 → 절반은 11700초 뒤 (가장 먼저 절반 아래로), 기분 8000 → 절반까지 (3000 × 50400 / 10000) = 15120초
    const once = settle(c, T0 + 20 * H);
    expect(once.love).toBe(linHalfAt(10000, T0, PERSONALITY.calm.water_sec) - T0);
    let step = c;
    for (let t = T0 + 77; t <= T0 + 20 * H; t += 977) step = settle(step, t);
    step = settle(step, T0 + 20 * H);
    expect(step.love).toBe(once.love);
  });

  it('절대 내려가지 않는다 · 단계 표', () => {
    let s = start();
    let last = 0;
    for (let h = 1; h < 24 * 5; h++) {
      s = visit(s, false, T0 + h * H).state;
      expect(cat(s).love).toBeGreaterThanOrEqual(last);
      last = cat(s).love;
    }
    expect(loveLevel(0)).toEqual({ level: 1, have: 0, need: LOVE_NEED[0] });
    expect(loveLevel(loveAt(7)).level).toBe(7);
    expect(loveLevel(loveAt(10)).level).toBe(10);
    expect(loveLevel(loveAt(10) + 1e9)).toEqual({ level: 10, have: 0, need: 0 });
  });

  it('쓰다듬기: 좋아하는 곳 · 보통 · 싫어하는 곳(냥펀치), 간격, 하루 상한', () => {
    let s = start('calm');
    let t = T0 + 100;
    const r1 = pet(s, 1, 'chin', t);
    expect(r1.kind).toBe('like');
    expect(r1.love).toBe(CONST.pet_love_like);
    err(() => pet(r1.state, 1, 'chin', t + CONST.pet_gap_sec - 1), 'too soon');
    const r2 = pet(r1.state, 1, 'head', t + CONST.pet_gap_sec);
    expect(r2.kind).toBe('ok');
    expect(r2.love).toBe(CONST.pet_love);
    const r3 = pet(r2.state, 1, 'belly', t + 2 * CONST.pet_gap_sec);
    expect(r3.kind).toBe('hate');
    expect(r3.love).toBe(0);
    expect(cat(r3.state).moodVal).toBe(cat(r2.state).moodVal);
    err(() => pet(r3.state, 1, 'tail', t + 100), 'bad spot');
    // 하루 상한
    s = r3.state;
    t += 100;
    let got = 0;
    for (let i = 0; i < 20; i++, t += CONST.pet_gap_sec) {
      const r = pet(s, 1, 'chin', t);
      s = r.state;
      got += r.love;
    }
    expect(cat(s).petLove).toBe(CONST.pet_love_day);
    expect(got).toBe(CONST.pet_love_day - CONST.pet_love_like - CONST.pet_love);
    // 다음 날이면 다시
    const next = 1767193200 + (kstDay(t) + 1) * 86400 + 9 * H;
    expect(pet(s, 1, 'chin', next).love).toBe(CONST.pet_love_like);
  });

  it('단계가 오르면 좋아하는 곳이 늘고, 9단계부터 배를 만져도 괜찮다', () => {
    const s = start('timid');
    const c = cat(s);
    expect(spotKind(c, 'back')).toBe('hate');
    expect(spotKind({ ...c, love: loveAt(5) }, 'back')).toBe('ok');
    expect(spotKind({ ...c, love: loveAt(6) }, 'chin')).toBe('like');
    expect(spotKind({ ...c, love: loveAt(8) }, 'belly')).toBe('hate');
    expect(spotKind({ ...c, love: loveAt(9) }, 'belly')).toBe('ok');
  });
});

describe('돌보기', () => {
  it('밥: 거의 찼으면 거절, 절반 아래에서 채우면 시아코인 · 하루 첫 돌보기 엽전', () => {
    const s = start('calm');
    err(() => feed(s, 1, 'basic', T0 + 10), 'bowl full');
    err(() => feed(s, 1, 'gold', T0 + 6 * H), 'bad food');
    const r1 = feed(s, 1, 'basic', T0 + 3 * H);
    expect(r1.sia).toBe(false);
    expect(r1.bonus).toBe(CONST.day_bonus);
    expect(r1.state.profile.coins).toBe(CONST.day_bonus);
    expect(fullOf(cat(r1.state), T0 + 3 * H)).toBe(10000);
    const r2 = feed(r1.state, 1, 'basic', T0 + 3 * H + PERSONALITY.calm.full_sec * 0.6);
    expect(r2.sia).toBe(true);
    expect(r2.bonus).toBe(0);
    expect(r2.state.profile.siaDue).toBe(1);
    err(() => feed(s, 2, 'basic', T0), 'no cat');
  });

  it('물: 상하면 갈 수 있고 시아코인', () => {
    const s = start('calm');
    err(() => water(s, 1, T0 + 60), 'water fresh');
    const r = water(s, 1, T0 + 13 * H);
    expect(r.sia).toBe(true);
    expect(waterOf(cat(r.state), T0 + 13 * H)).toBe(10000);
    expect(levelsOf(cat(r.state), T0 + 13 * H).spoiled).toBe(false);
  });

  it('똥: 하나씩 퍼낸다, 다음 똥까지 남은 시간은 그대로, 가득이면 지금부터 센다, 3 → 2 에서 시아코인', () => {
    const p = PERSONALITY.calm;
    const s = start('calm');
    err(() => clean(s, 1, T0 + 10), 'no poop');
    const t = T0 + p.poop_sec * 3 + 500; // 3개 + 500초
    const a = clean(s, 1, t);
    expect(a.poops).toBe(2);
    expect(a.sia).toBe(true);
    expect(poopsOf(cat(a.state), t + p.poop_sec - 501)).toBe(2);
    expect(poopsOf(cat(a.state), t + p.poop_sec - 500)).toBe(3);
    const b = clean(a.state, 1, t + 5);
    expect(b.sia).toBe(false);
    expect(b.poops).toBe(1);
    // 가득 찬 뒤 오래 지나 퍼내면 다음 똥은 지금부터
    const t2 = T0 + p.poop_sec * 10;
    const c = clean(s, 1, t2);
    expect(c.poops).toBe(3);
    expect(poopsOf(cat(c.state), t2 + p.poop_sec - 1)).toBe(3);
    expect(poopsOf(cat(c.state), t2 + p.poop_sec)).toBe(4);
    // 모래 속 선물은 정해진 번호로 (약 20 %)
    let st = s;
    let gifts = 0;
    let tt = T0 + p.poop_sec * 10;
    for (let i = 0; i < 400; i++) {
      tt += p.poop_sec;
      const r = clean(st, 1, tt);
      st = r.state;
      if (r.gift) {
        gifts++;
        expect(r.gift).toBeGreaterThanOrEqual(CONST.gift_min);
        expect(r.gift).toBeLessThan(CONST.gift_min + CONST.gift_span);
      }
    }
    expect(gifts).toBeGreaterThan(50);
    expect(gifts).toBeLessThan(110);
  });

  it('시아코인은 하루 최대 5개', () => {
    let s = start('glutton');
    let t = T0;
    let n = 0;
    for (let i = 0; i < 8; i++) {
      t += PERSONALITY.glutton.full_sec * 0.6;
      if (kstDay(t) !== kstDay(T0)) break;
      const r = feed(s, 1, 'basic', t);
      s = r.state;
      if (r.sia) n++;
    }
    expect(s.profile.siaToday).toBeLessThanOrEqual(CONST.sia_day_max);
    expect(n).toBe(s.profile.siaToday);
  });
});

describe('감기 기운', () => {
  it('상태 하나가 바닥인 채로 24시간 → 걸림, 그동안 친밀도가 쌓이지 않음, 다 채우고 담요 → 2시간 뒤 나음', () => {
    const p = PERSONALITY.calm;
    let s = start('calm');
    const waterZero = linZeroAt(10000, T0, p.water_sec);
    // 물만 바닥 (나머지는 계속 채운다고 해도 물이 먼저)
    const sickAt = waterZero + CONST.sick_sec;
    expect(levelsOf(cat(s), sickAt - 1).sick).toBe(false);
    s = visit(s, true, sickAt + 5 * H).state;
    expect(cat(s).sickAt).toBe(sickAt);
    const love0 = cat(s).love;
    s = visit(s, false, sickAt + 8 * H).state;
    expect(cat(s).love).toBe(love0);
    // 아픈 동안 쓰다듬어도 친밀도는 안 오른다
    const t = sickAt + 8 * H;
    const pr = pet(s, 1, 'chin', t);
    expect(pr.love).toBe(0);
    err(() => cure(s, 1, 'blanket', t), 'need care');
    s = feed(s, 1, 'basic', t).state;
    s = water(s, 1, t).state;
    for (let i = 0; i < 4; i++) s = clean(s, 1, t).state;
    for (let i = 0; i < 4; i++) s = pet(s, 1, 'chin', t + i * CONST.pet_gap_sec).state;
    const tc = t + 4 * CONST.pet_gap_sec;
    err(() => cure(s, 1, 'medicine', tc), 'bad cure');
    s = cure(s, 1, 'blanket', tc).state;
    err(() => cure(s, 1, 'blanket', tc + 1), 'already curing');
    expect(levelsOf(cat(s), tc + CONST.cure_sec - 1)).toMatchObject({ sick: true, curing: true });
    expect(levelsOf(cat(s), tc + CONST.cure_sec).sick).toBe(false);
    // 나은 뒤부터 다시 쌓인다
    const after = settle(cat(s), tc + CONST.cure_sec + 600);
    expect(after.love - love0).toBe(600);
    err(() => cure(visit(s, false, tc + CONST.cure_sec).state, 1, 'blanket', tc + CONST.cure_sec + 1), 'not sick');
  });

  it('하루 2번만 와서 돌봐 주면 감기에 걸리지 않는다', () => {
    let s = start('glutton');
    for (let d = 0; d < 10; d++)
      for (const h of [9, 21]) {
        const t = T0 + d * 86400 + (h - 9) * H;
        s = visit(s, true, t).state;
        try { s = feed(s, 1, 'basic', t).state; } catch { /* 찼으면 */ }
        try { s = water(s, 1, t).state; } catch { /* 새 물 */ }
        for (let i = 0; i < 4; i++) try { s = clean(s, 1, t).state; } catch { break; }
        for (let i = 0; i < 2; i++) s = pet(s, 1, 'chin', t + i * CONST.pet_gap_sec).state;
        expect(cat(s).sickAt).toBeNull();
      }
  });
});

describe('입양', () => {
  it('이름 · 털 색 · 성격 검사, 첫 고양이 친밀도 4 · 7 · 10 에 한 마리씩 (최대 4마리)', () => {
    const s0 = newState();
    err(() => adopt(s0, 'pink', 'calm', '나비', T0), 'bad color');
    err(() => adopt(s0, 'white', 'grumpy', '나비', T0), 'bad personality');
    err(() => adopt(s0, 'white', 'calm', '  ', T0), 'bad name');
    err(() => adopt(s0, 'white', 'calm', '아주아주긴고양이이름', T0), 'bad name');
    err(() => adopt(s0, 'white', 'calm', '<b>', T0), 'bad name');
    const a = adopt(s0, 'cheese', 'playful', '  치즈  냥 ', T0);
    expect(a.slot).toBe(1);
    expect(cat(a.state)).toMatchObject({ name: '치즈 냥', color: 'cheese', pattern: null, personality: 'playful' });
    err(() => adopt(a.state, 'black', 'calm', '까망', T0), 'no room');
    let s = a.state;
    for (const [lv, slot] of [[4, 2], [7, 3], [10, 4]] as const) {
      s = { ...s, cats: s.cats.map((c) => (c.slot === 1 ? { ...c, love: loveAt(lv) } : c)) };
      const r = adopt(s, 'gray', 'lazy', '회색이', T0);
      expect(r.slot).toBe(slot);
      s = r.state;
    }
    err(() => adopt(s, 'gray', 'lazy', '다섯째', T0), 'no room');
  });

  it('보호소: 날마다 털 색 6가지 한 마리씩', () => {
    const k = shelterKittens(330);
    expect(k.map((x) => x.color)).toEqual(['white', 'cream', 'cheese', 'gray', 'choco', 'black']);
    expect(new Set([...Array(10)].flatMap((_, d) => shelterKittens(d).map((x) => x.personality))).size).toBe(5);
  });

  it('들어올 때 떠나 있던 시간', () => {
    const s = start();
    const a = visit(s, true, T0 + 100);
    expect(a.away).toBe(0);
    const b = visit(a.state, true, T0 + 100 + 7 * H);
    expect(b.away).toBe(7 * H);
  });
});
