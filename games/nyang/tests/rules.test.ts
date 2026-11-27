import { describe, expect, it } from 'vitest';
import { CONST, LOVE_NEED, PERSONALITIES, PERSONALITY, POT_PRICES, kstDay, loveAt, loveLevel, shelterKittens } from '../src/data/balance';
import {
  RuleError, adopt, brush, buy, churu, exchange, expandPots, harvest, plant, potGrown, potReadyAt, potStage, sell, treat, waterPot, clean, cleanOf, cure, feed, gift, play, playStart, seen, fullOf, levelsOf, lin, linHalfAt, linZeroAt, moodOf, newState, pet, poopsOf, settle, spotKind, visit, water, waterOf,
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
  it('상태 하나가 바닥인 채로 28시간(sick_sec) → 걸림, 그동안 친밀도가 쌓이지 않음, 다 채우고 담요 → 2시간 뒤 나음', () => {
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
    err(() => cure(s, 1, 'pill', tc), 'bad cure');
    err(() => cure(s, 1, 'medicine', tc), 'no medicine');
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

describe('3단계: 놀아 주기 · 빗질 · 츄르 · 선물 · 행동 도감', () => {
  it('놀아 주기: 낚싯대는 처음부터, 다른 장난감은 보관함에 있어야 · 잡은 수 상한(15개 · 2초에 하나) · 하루 친밀도 상한', () => {
    let s = start('calm'); // calm 은 낚싯대를 좋아한다
    err(() => playStart(s, 1, 'yarn', T0), 'bad toy');
    err(() => playStart(s, 1, 'laser', T0), 'no toy');
    err(() => play(s, 1, 5, T0 + 30), 'no play');
    s = playStart(s, 1, 'rod', T0).state;
    // 10초 뒤 끝내면 5개까지만
    let r = play(s, 1, 12, T0 + 10);
    expect(r.catches).toBe(5);
    expect(r.liked).toBe(true);
    expect(r.love).toBe(5 * CONST.play_love_like);
    s = r.state;
    err(() => play(s, 1, 5, T0 + 12), 'no play');
    // 시작하고 너무 오래 지나면 받지 않는다
    s = playStart(s, 1, 'rod', T0 + 100).state;
    err(() => play(s, 1, 5, T0 + 100 + CONST.play_max_sec + 1), 'no play');
    // 하루 상한
    let t = T0 + 1000;
    let total = r.love;
    for (let i = 0; i < 10; i++) {
      s = playStart(s, 1, 'rod', t).state;
      t += 40;
      r = play(s, 1, 99, t);
      expect(r.catches).toBe(CONST.play_catch_max);
      total += r.love;
      s = r.state;
    }
    expect(total).toBe(CONST.play_love_day);
    expect(cat(s).playLove).toBe(CONST.play_love_day);
    // 다른 장난감은 보관함에 있으면
    s.profile.items['toy:laser'] = 1;
    s = playStart(s, 1, 'laser', t).state;
    expect(cat(s).playToy).toBe('laser');
  });

  it('빗질: 하루 한 번, 털 뭉치는 보관함으로', () => {
    let s = start('lazy');
    const r = brush(s, 1, T0);
    expect(r.love).toBe(CONST.brush_love);
    expect(r.fur).toBeGreaterThanOrEqual(CONST.fur_min);
    expect(r.state.profile.items.fur).toBe(r.fur);
    s = r.state;
    err(() => brush(s, 1, T0 + 3 * H), 'brushed today');
    const next = 1767193200 + (kstDay(T0) + 1) * 86400;
    expect(brush(s, 1, next).state.profile.items.fur).toBeGreaterThan(r.fur);
  });

  it('츄르: 첫 입양에 좋아하는 맛 3개, 하루 2개까지, 없으면 못 줌, 아플 때 주면 낫기 시작', () => {
    let s = start('glutton');
    expect(s.profile.items).toEqual({ 'churu:salmon': CONST.start_churu });
    err(() => churu(s, 1, 'beef', T0), 'bad flavor');
    err(() => churu(s, 1, 'tuna', T0), 'no churu');
    let r = churu(s, 1, 'salmon', T0);
    expect(r.liked).toBe(true);
    expect(r.love).toBe(CONST.churu_love_like);
    s = churu(r.state, 1, 'salmon', T0 + 60).state;
    expect(s.profile.items['churu:salmon']).toBe(CONST.start_churu - 2);
    err(() => churu(s, 1, 'salmon', T0 + 120), 'churu full');
    // 다 쓰면 열쇠가 지워진다
    const next = 1767193200 + (kstDay(T0) + 1) * 86400 + 9 * H;
    s = churu(s, 1, 'salmon', next).state;
    expect(s.profile.items['churu:salmon']).toBeUndefined();
    // 아플 때
    let sk = start('glutton');
    sk = visit(sk, true, T0 + 5 * 86400).state;
    expect(cat(sk).sickAt).not.toBeNull();
    r = churu(sk, 1, 'salmon', T0 + 5 * 86400);
    expect(r).toMatchObject({ love: 0, cured: true });
    expect(cat(r.state).cureAt).toBe(T0 + 5 * 86400 + CONST.cure_sec);
  });

  it('선물: 들어올 때 4시간에 한 번 굴리고, 친밀도가 높을수록 자주 · 주우면 보관함 · 엽전 · 가구', () => {
    const count = (love: number) => {
      let s = start('calm');
      s.cats[0].love = love;
      let got = 0;
      const kinds: Record<string, number> = {};
      for (let i = 1; i <= 400; i++) {
        const t = T0 + i * CONST.present_gap_sec;
        // 아프지 않게 기록을 새로
        s.cats[0] = { ...s.cats[0], fedAt: t, waterAt: t, poopAt: t, poopBase: 0, moodAt: t, moodVal: 10000, sickAt: null, cureAt: null, calcAt: t };
        s = visit(s, true, t).state;
        const g = s.cats[0].present;
        if (g) {
          got++;
          kinds[g.kind] = (kinds[g.kind] ?? 0) + 1;
          const before = s.profile.coins;
          s = gift(s, 1, t).state;
          if (g.kind === 'coin') expect(s.profile.coins).toBe(before + g.n);
          if (g.kind === 'furniture') expect(s.profile.furniture.at(-1)).toBe(g.id);
          if (g.kind === 'seed') expect(s.profile.items[`seed:${g.id}`]).toBeGreaterThan(0);
        }
      }
      return { got, kinds, s };
    };
    const low = count(0);
    const high = count(loveAt(10));
    expect(low.got).toBeGreaterThan(400 * 0.15);
    expect(high.got).toBeGreaterThan(low.got * 2);
    expect(Object.keys(high.kinds).sort()).toEqual(['coin', 'furniture', 'seed', 'toy']);
    // 장난감은 가지고 있지 않은 것만 (셋 다 생기면 엽전)
    expect(['laser', 'ball', 'box'].every((t) => (high.s.profile.items[`toy:${t}`] ?? 0) <= 1)).toBe(true);
    // 가구도 가지고 있지 않은 것만 (같은 가구가 두 번 오지 않는다)
    expect(new Set(high.s.profile.furniture).size).toBe(high.s.profile.furniture.length);
    // 4시간이 안 지났으면 다시 굴리지 않는다
    let s = start('calm');
    const p0 = s.profile.pseq;
    s = visit(s, true, T0 + CONST.present_gap_sec - 1).state;
    expect(s.profile.pseq).toBe(p0);
    s = visit(s, true, T0 + CONST.present_gap_sec).state;
    expect(s.profile.pseq).toBe(p0 + 1);
    s = visit(s, false, T0 + 3 * CONST.present_gap_sec).state;
    expect(s.profile.pseq).toBe(p0 + 1);
    if (!s.cats[0].present) err(() => gift(s, 1, T0 + 3 * CONST.present_gap_sec), 'no present');
  });

  it('행동 도감: 처음 본 것만 남기고, 친밀도 단계가 모자라면 거절', () => {
    let s = start('calm');
    err(() => seen(s, 1, 'dance', T0), 'bad behavior');
    err(() => seen(s, 1, 'toString', T0), 'bad behavior');
    err(() => seen(s, 1, 'together', T0), 'too early');
    let r = seen(s, 1, 'loaf', T0);
    expect(r.added).toBe(true);
    r = seen(r.state, 1, 'loaf', T0 + 1);
    expect(r.added).toBe(false);
    s = r.state;
    s.cats[0].love = loveAt(10);
    expect(seen(s, 1, 'together', T0 + 2).state.cats[0].seen).toEqual(['loaf', 'together']);
  });

  it('약 간식: 보관함에서 하나 쓰고, 채우지 않아도 낫기 시작', () => {
    let s = start('glutton');
    s = visit(s, true, T0 + 5 * 86400).state;
    s.profile.items.medicine = 1;
    s = cure(s, 1, 'medicine', T0 + 5 * 86400).state;
    expect(s.profile.items.medicine).toBeUndefined();
    expect(levelsOf(cat(s), T0 + 5 * 86400 + 1).curing).toBe(true);
  });

  it('약 간식으로 나은 뒤에는 바닥인 채 sick_sec 를 나은 때부터 다시 센다 (바로 다시 걸리지 않는다)', () => {
    let s = start('glutton');
    const t1 = T0 + 50 * H;
    s = visit(s, true, t1).state;
    expect(cat(s).sickAt).not.toBeNull();
    s.profile.items.medicine = 1;
    s = cure(s, 1, 'medicine', t1).state;
    const well = t1 + CONST.cure_sec;
    s = visit(s, false, well + 5).state;
    expect(cat(s)).toMatchObject({ sickAt: null, cureAt: null, wellAt: well });
    // 몇 번에 나눠 불러도 같고, 나은 때 + sick_sec 에 다시 걸린다
    s = visit(s, false, well + 10 * H).state;
    expect(cat(s).sickAt).toBeNull();
    expect(levelsOf(cat(s), well + CONST.sick_sec - 1).sick).toBe(false);
    expect(settle(cat(s), well + CONST.sick_sec + 60).sickAt).toBe(well + CONST.sick_sec);
  });

  it('시각이 거꾸로 가도 하루 상한이 풀리지 않는다 (빗질 · 츄르 · 하루 첫 돌보기)', () => {
    let s = start();
    s.profile.items['churu:tuna'] = 5;
    const t = T0 + 3 * H;
    s = brush(s, 1, t).state;
    s = churu(s, 1, 'tuna', t).state;
    s = churu(s, 1, 'tuna', t).state;
    // 다음 날로 갔다가 되돌아온 시각 (전날)
    s = { ...s, cats: s.cats.map((c) => ({ ...c, brushDay: c.brushDay + 1, churuDay: c.churuDay + 1 })), profile: { ...s.profile, bonusDay: s.profile.bonusDay + 1 } };
    err(() => brush(s, 1, t + 1), 'brushed today');
    err(() => churu(s, 1, 'tuna', t + 1), 'churu full');
    expect(feed(s, 1, 'basic', t + 2 * H).bonus).toBe(0);
  });
});

describe('4단계: 베란다 정원', () => {
  it('물을 준 뒤 water_sec 동안만 자라고, 마르면 멈출 뿐 시들지 않는다 (장미 8시간 · 물 한 번 4시간)', () => {
    let s = start();
    s.profile.items['seed:rose'] = 1;
    err(() => plant(s, 5, 'rose', T0), 'bad pot');
    err(() => plant(s, 1, 'tulip', T0), 'bad seed');
    s = plant(s, 1, 'rose', T0).state;
    err(() => plant(s, 1, 'rose', T0), 'pot busy');
    err(() => plant(s, 2, 'rose', T0), 'no seed');
    const pot = () => s.pots[0];
    expect(potStage(pot(), T0 + 99 * H)).toBe(0); // 물을 안 주면 그대로
    s = waterPot(s, 1, T0 + H).state;
    err(() => waterPot(s, 1, T0 + 2 * H), 'pot wet');
    expect(potGrown(pot(), T0 + 3 * H)).toBe(2 * H);
    expect(potGrown(pot(), T0 + 30 * H)).toBe(4 * H); // 말라서 멈춤
    expect(potStage(pot(), T0 + 30 * H)).toBe(1);
    err(() => harvest(s, 1, T0 + 30 * H), 'not ready');
    s = waterPot(s, 1, T0 + 30 * H).state;
    expect(potReadyAt(pot(), T0 + 30 * H)).toBe(T0 + 34 * H);
    expect(potStage(pot(), T0 + 34 * H - 1)).toBe(2);
    expect(potStage(pot(), T0 + 34 * H)).toBe(3);
    err(() => waterPot(s, 1, T0 + 40 * H), 'pot ready');
    const r = harvest(s, 1, T0 + 40 * H);
    expect(r.plant).toBe('rose');
    expect(r.state.pots).toEqual([]);
    expect(r.state.profile.items['plant:rose']).toBe(1);
    err(() => harvest(r.state, 1, T0 + 40 * H), 'no plant');
  });

  it('화분 늘리기 · 팔기 · 보름달 등 바꾸기', () => {
    let s = start();
    err(() => expandPots(s, T0), 'no coins');
    s.profile.coins = 10000;
    for (let i = 0; i < 8; i++) s = expandPots(s, T0).state;
    expect(s.profile.pots).toBe(12);
    expect(s.profile.coins).toBe(10000 - POT_PRICES.reduce((a, b) => a + b, 0));
    err(() => expandPots(s, T0), 'max pots');
    s.profile.items['plant:daisy'] = 3;
    err(() => sell(s, 'plant:moonflower', 1, T0), 'bad item');
    err(() => sell(s, 'plant:daisy', 4, T0), 'no item');
    const r = sell(s, 'plant:daisy', 3, T0);
    expect(r.coins).toBe(3 * 8);
    s = r.state;
    s.profile.items['plant:moonflower'] = 3;
    s = exchange(s, 'moon_lamp', T0).state;
    expect(s.profile.furniture).toContain('moon_lamp');
    err(() => exchange(s, 'moon_lamp', T0), 'have it');
  });

  it('상점: 엽전 · 시아코인 · 하나만 · 친밀도로 열리는 씨앗', () => {
    let s = start();
    err(() => buy(s, 'seed:daisy', 1, T0), 'no coins');
    s.profile.coins = 100;
    err(() => buy(s, 'seed:rose', 1, T0), 'locked');
    err(() => buy(s, 'seed:daisy', 0, T0), 'bad amount');
    s = buy(s, 'seed:daisy', 5, T0).state;
    expect([s.profile.coins, s.profile.items['seed:daisy']]).toEqual([80, 5]);
    s = buy(s, 'food:tasty', 1, T0).state;
    expect(s.profile.items['food:tasty']).toBe(5);
    err(() => buy(s, 'churu:tuna', 1, T0), 'not enough coin');
    s.profile.sia = 12;
    s = buy(s, 'churu:salmon', 2, T0).state;
    expect([s.profile.sia, s.profile.buySeq, s.profile.items['churu:salmon']]).toEqual([2, 1, 2]);
    s = buy(s, 'toy:box', 1, T0).state;
    err(() => buy(s, 'toy:box', 1, T0), 'have it');
    err(() => buy(s, 'furniture:vase', 2, T0), 'bad amount');
    s = buy(s, 'furniture:vase', 1, T0).state;
    expect(s.profile.furniture).toEqual(['vase']);
    s.cats[0].love = loveAt(5);
    s.profile.coins = 30;
    expect(buy(s, 'seed:rose', 1, T0).state.profile.items['seed:rose']).toBe(1);
  });

  it('상점 사료: 보관함에서 하나 쓰고 기분도 오른다 · 기본 사료는 공짜', () => {
    let s = start();
    const t = T0 + 6 * H;
    err(() => feed(s, 1, 'tasty', t), 'no food');
    s.profile.items['food:tasty'] = 1;
    const m0 = moodOf(cat(s), t);
    s = feed(s, 1, 'tasty', t).state;
    expect(s.profile.items['food:tasty']).toBeUndefined();
    expect(moodOf(cat(s), t)).toBe(Math.min(10000, m0 + 1500));
    expect(s.profile.coins).toBeGreaterThanOrEqual(0);
  });

  it('캣그라스 · 캣닢: 하루 2번 · 기분 크게 · 캣닢은 nipAt', () => {
    let s = start();
    s.profile.items['plant:catnip'] = 3;
    err(() => treat(s, 1, 'catgrass', T0), 'no item');
    err(() => treat(s, 1, 'rose', T0), 'bad treat');
    const r = treat(s, 1, 'catnip', T0 + 10);
    expect(r.love).toBe(2000);
    s = r.state;
    expect(cat(s).nipAt).toBe(T0 + 10);
    s = treat(s, 1, 'catnip', T0 + 20).state;
    err(() => treat(s, 1, 'catnip', T0 + 30), 'treat full');
    expect(treat(s, 1, 'catnip', T0 + 86400).state.profile.items['plant:catnip']).toBeUndefined();
  });
});

describe('5단계: 꾸미기 · 꽃병 · 앨범 · 추가 입양', () => {
  it('꾸미기: 가진 것만 · 격자 안 · 안 겹침 · 기본 배치', async () => {
    const { place, vase, layoutItems, layoutStyle } = await import('../src/game/rules');
    let s = start();
    // 한 번도 저장하지 않았으면 기본 배치 중 가진 것 (상자는 장난감이 있어야)
    expect(layoutItems(s.profile).map((i) => i.id)).toEqual(['desk', 'cushion']);
    expect(layoutStyle(s.profile, 'wall')).toBe('wall_cream');
    err(() => place(s, { items: [{ id: 'cat_tower', x: 3, y: 1 }] }, T0), 'not owned');
    err(() => place(s, { items: [{ id: 'desk', x: 7, y: 0 }] }, T0), 'bad layout'); // 격자 밖 (2칸)
    err(() => place(s, { items: [{ id: 'desk', x: 0, y: 2 }] }, T0), 'bad layout'); // 밥 자리
    err(() => place(s, { items: [{ id: 'desk', x: 3, y: 1 }, { id: 'cushion', x: 4, y: 1 }] }, T0), 'bad layout'); // 겹침
    err(() => place(s, { items: [{ id: 'desk', x: 3, y: 1 }, { id: 'desk', x: 5, y: 1 }] }, T0), 'bad layout'); // 두 번
    err(() => place(s, { items: [{ id: 'desk', x: 1.5, y: 1 }] }, T0), 'bad layout');
    err(() => place(s, { wall: 'floor_maple' }, T0), 'bad layout');
    err(() => place(s, { wall: 'wall_mint' }, T0), 'not owned');
    s.profile.furniture.push('zodiac_shelf');
    err(() => place(s, { items: [{ id: 'zodiac_shelf', x: 2, y: 0 }] }, T0), 'bad layout'); // 창
    s.profile.items['style:wall_mint'] = 1;
    s = place(s, { items: [{ id: 'zodiac_shelf', x: 0, y: 1 }, { id: 'desk', x: 6, y: 0 }], wall: 'wall_mint' }, T0).state;
    expect(s.profile.layout).toEqual({ items: [{ id: 'zodiac_shelf', x: 0, y: 1 }, { id: 'desk', x: 6, y: 0 }], wall: 'wall_mint', floor: 'floor_wood', window: 'window_basic' });
    // 꽃병
    err(() => vase(s, 'rose', T0), 'no vase');
    s.profile.furniture.push('vase');
    err(() => vase(s, 'daisy', T0), 'bad flower');
    err(() => vase(s, 'rose', T0), 'no item');
    s.profile.items['plant:rose'] = 1;
    s = vase(s, 'rose', T0).state;
    expect(s.profile.layout.vase).toBe('rose');
    expect(s.profile.items['plant:rose']).toBeUndefined();
    // 다시 배치해도 꽃은 그대로
    expect(place(s, {}, T0).state.profile.layout.vase).toBe('rose');
    expect(vase(s, '', T0).state.profile.layout.vase).toBeUndefined();
  });

  it('사진: 앨범 상한 · 도감 · 같이 찍힌 고양이 · 지우기', async () => {
    const { photo, deletePhoto } = await import('../src/game/rules');
    let s = start();
    err(() => photo(s, 1, 'dance', 'sit', 1, 0, '', T0), 'bad behavior');
    err(() => photo(s, 1, 'knead', 'knead', 1, 0, '', T0), 'too early');
    err(() => photo(s, 1, 'loaf', 'fly', 1, 0, '', T0), 'bad pose');
    err(() => photo(s, 1, 'groom', 'lick2', 1, 2, 'blink', T0), 'no cat');
    const r = photo(s, 1, 'loaf', 'loaf', -5, 0, '', T0);
    expect(r.added).toBe(true);
    expect(r.state.album[0]).toEqual({ id: 1, slot: 1, name: '나비', color: 'white', behavior: 'loaf', pose: 'loaf', face: -1, mate: null, at: T0 });
    expect(cat(r.state).seen).toContain('loaf');
    s = r.state;
    for (let i = 1; i < CONST.album_max; i++) s = photo(s, 1, 'sit', 'sit', 1, 0, '', T0 + i).state;
    err(() => photo(s, 1, 'sit', 'sit', 1, 0, '', T0), 'album full');
    s = deletePhoto(s, 1, T0).state;
    err(() => deletePhoto(s, 1, T0), 'no photo');
    expect(photo(s, 1, 'sit', 'blink', 1, 0, '', T0).id).toBe(CONST.album_max + 1);
  });

  it('추가 입양: 첫 고양이 친밀도 4 · 7 · 10 단계', () => {
    let s = start();
    err(() => adopt(s, 'gray', 'lazy', '회색이', T0), 'no room');
    for (const [lv, n] of [[4, 2], [7, 3], [10, 4]]) {
      s.cats[0].love = loveAt(lv);
      s = adopt(s, 'gray', 'lazy', `냥${n}`, T0).state;
      expect(s.cats.length).toBe(n);
      err(() => adopt(s, 'gray', 'lazy', '또', T0), 'no room');
    }
  });
});
