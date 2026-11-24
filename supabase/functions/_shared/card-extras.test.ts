/**
 * 카드 게임 화면 곁들이 기능의 순수 계산 검사 (games/lib/extras.ts · emote.ts).
 * 화면 쪽 파일이지만 vitest 가 이 폴더의 테스트만 돌리므로 여기에 둔다 (엔진 동작은 건드리지 않는다).
 */
import { describe, expect, it } from 'vitest';
import { EMOTES, EMOTE_GAP_MS, emoteReady, parseEmote } from '../../../games/lib/emote.ts';
import {
  bjDayKey,
  bjLoad,
  bjRecord,
  bjStrip,
  holdemAdvice,
  holdemAdviceText,
  nextStreak,
  pokerHint,
  potRealWinners,
  potRefundOnly,
  rouletteNotes,
  rouletteStats,
  seasonOfCell,
  share,
  streakCutin,
} from '../../../games/lib/extras.ts';
import { MATGO_MANUAL } from '../../../games/lib/manuals.ts';
import { draws } from './poker.ts';
import { PPEOK_BONUS, SAM_PPEOK_SCORE, applyGo, scoreCards } from './matgo.ts';

describe('한마디(이모티콘)', () => {
  it('문구는 여섯 가지', () => {
    expect([...EMOTES]).toEqual(['ㅋㅋ', '나이스!', '아깝다', '한 판 더!', '헉', 'ㅠㅠ']);
  });
  it('보내기는 1.5초 간격', () => {
    expect(EMOTE_GAP_MS).toBe(1500);
    expect(emoteReady(1000, 2499)).toBe(false);
    expect(emoteReady(1000, 2500)).toBe(true);
    expect(emoteReady(-EMOTE_GAP_MS, 0)).toBe(true);
  });
  it('받은 한마디: 사람이 앉은 다른 자리의 맞는 번호만', () => {
    expect(parseEmote({ seat: 1, i: 0 }, [0, 1], 0)).toEqual({ seat: 1, text: 'ㅋㅋ' });
    expect(parseEmote({ seat: 1, i: 5 }, [0, 1], null)).toEqual({ seat: 1, text: 'ㅠㅠ' });
    // 내 자리라고 우기는 것 · 빈자리(AI) · 없는 번호 · 엉뚱한 모양
    expect(parseEmote({ seat: 0, i: 0 }, [0, 1], 0)).toBeNull();
    expect(parseEmote({ seat: 2, i: 0 }, [0, 1], 0)).toBeNull();
    expect(parseEmote({ seat: 1, i: 6 }, [0, 1], 0)).toBeNull();
    expect(parseEmote({ seat: 1, i: -1 }, [0, 1], 0)).toBeNull();
    expect(parseEmote({ seat: 1, i: 1.5 }, [0, 1], 0)).toBeNull();
    expect(parseEmote({ seat: '1', i: 0 }, [0, 1], 0)).toBeNull();
    expect(parseEmote({ seat: 1, text: '<b>아무 글</b>' }, [0, 1], 0)).toBeNull();
    expect(parseEmote(null, [0, 1], 0)).toBeNull();
    expect(parseEmote([1, 0], [0, 1], 0)).toBeNull();
    expect(parseEmote('ㅋㅋ', [0, 1], 0)).toBeNull();
  });
});

describe('세븐포커 힌트', () => {
  it('엔진의 draws 는 그대로다 (같은 무늬 4장 · 이어진 숫자 4개)', () => {
    expect(draws(['2S', '5S', '9S', 'KS', '3D'])).toEqual({ flush4: true, straight4: false });
    expect(draws(['4S', '5D', '6H', '7C', 'KD'])).toEqual({ flush4: false, straight4: true });
    expect(draws(['AS', '2D', '3H', '4C'])).toEqual({ flush4: false, straight4: true });
    expect(draws(['2S', '7D', '9H', 'KC'])).toEqual({ flush4: false, straight4: false });
  });
  it('한 장만 더 오면 되는 족보를 말한다', () => {
    expect(pokerHint(['2S', '5S', '9S', 'KS', '3D'])).toBe('플러시까지 1장');
    expect(pokerHint(['4S', '5D', '6H', '7C', 'KD'])).toBe('스트레이트까지 1장');
    expect(pokerHint(['4S', '5S', '6S', '7S', 'KD'])).toBe('플러시·스트레이트까지 1장');
    expect(pokerHint(['4S', '4D', '9H', '9C', 'KD'])).toBe('풀하우스까지 1장');
    expect(pokerHint(['4S', '4D', '4H', '9C'])).toBe('포카드까지 1장');
  });
  it('이미 된 족보 · 가망 없는 패 · 더 받을 카드가 없을 때는 말하지 않는다', () => {
    // 이미 플러시
    expect(pokerHint(['2S', '5S', '9S', 'KS', '3S'])).toBeNull();
    // 이미 스트레이트 (플러시 가망도 없다)
    expect(pokerHint(['4S', '5D', '6H', '7C', '8D'])).toBeNull();
    // 스트레이트인데 같은 무늬 4장이면 플러시만 말한다
    expect(pokerHint(['4S', '5S', '6S', '7S', '8D'])).toBe('플러시까지 1장');
    expect(pokerHint(['2S', '7D', '9H', 'KC'])).toBeNull();
    // 7장을 다 받았다
    expect(pokerHint(['2S', '5S', '9S', 'KS', '3D', '4D', '8C'])).toBeNull();
    expect(pokerHint(['2S', '5S'])).toBeNull();
  });
});

describe('홀덤 도우미', () => {
  it('같은 상황이면 늘 같은 값 (다시 그려도 숫자가 흔들리지 않는다)', () => {
    const i = { hole: ['AS', 'AD'], board: ['2C', '7H', '9D'], opponents: 2, pot: 600, call: 200 };
    expect(holdemAdvice(i)).toEqual(holdemAdvice(i));
  });
  it('센 패는 높게, 약한 패는 낮게 어림한다', () => {
    const strong = holdemAdvice({ hole: ['AS', 'AD'], board: [], opponents: 1, pot: 300, call: 100 })!;
    const weak = holdemAdvice({ hole: ['2S', '7D'], board: [], opponents: 1, pot: 300, call: 100 })!;
    expect(strong.equity).toBeGreaterThan(0.75);
    expect(weak.equity).toBeLessThan(0.45);
    // 이미 끝난 판: 넛(로열 플러시)이면 100%
    const nuts = holdemAdvice({ hole: ['AS', 'KS'], board: ['QS', 'JS', 'TS', '2D', '3C'], opponents: 3, pot: 0, call: 0 })!;
    expect(nuts.equity).toBe(1);
    // 상대가 많을수록 낮다
    const many = holdemAdvice({ hole: ['AS', 'AD'], board: [], opponents: 3, pot: 300, call: 100 })!;
    expect(many.equity).toBeLessThan(strong.equity);
  });
  it('팟 오즈: 콜 금액 ÷ (판돈 + 콜 금액)', () => {
    expect(holdemAdvice({ hole: ['AS', 'AD'], board: [], opponents: 1, pot: 300, call: 100 })!.need).toBeCloseTo(0.25);
    expect(holdemAdvice({ hole: ['AS', 'AD'], board: [], opponents: 1, pot: 300, call: 0 })!.need).toBeNull();
  });
  it('내 패가 2장이 아니면 셈하지 않는다', () => {
    expect(holdemAdvice({ hole: [], board: [], opponents: 1, pot: 0, call: 0 })).toBeNull();
    expect(holdemAdvice({ hole: ['AS'], board: [], opponents: 1, pot: 0, call: 0 })).toBeNull();
  });
  it('한 줄 문구', () => {
    expect(holdemAdviceText({ equity: 0.62, need: 0.25 })).toBe('이길 확률 약 62% · 콜하려면 25% 이상');
    expect(holdemAdviceText({ equity: 0.4, need: null })).toBe('이길 확률 약 40% · 돈을 내지 않고 체크할 수 있어요');
  });
});

describe('블랙잭 오늘 기록 · 연승', () => {
  const day = '2026-11-23';
  it('날짜 열쇠는 기기 날짜', () => {
    expect(bjDayKey(new Date(2026, 10, 23, 23, 59))).toBe('2026-11-23');
    expect(bjDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
  it('연승: 딴 판 +1 · 잃은 판 0 · 무승부는 그대로', () => {
    expect(nextStreak(2, 500)).toBe(3);
    expect(nextStreak(2, -500)).toBe(0);
    expect(nextStreak(2, 0)).toBe(2);
  });
  it('판을 적는다 (같은 판은 한 번만)', () => {
    let s = bjLoad(null, day);
    expect(s).toEqual({ day, rounds: 0, net: 0, bj: 0, streak: 0, last: '' });
    s = bjRecord(s, { key: 'r:1', delta: 150, blackjacks: 1 });
    s = bjRecord(s, { key: 'r:2', delta: 100, blackjacks: 0 });
    const again = bjRecord(s, { key: 'r:2', delta: 100, blackjacks: 0 });
    expect(again).toBe(s);
    s = bjRecord(s, { key: 'r:3', delta: 0, blackjacks: 0 });
    expect(s).toEqual({ day, rounds: 3, net: 250, bj: 1, streak: 2, last: 'r:3' });
    s = bjRecord(s, { key: 'r:4', delta: -400, blackjacks: 0 });
    expect(s).toMatchObject({ rounds: 4, net: -150, streak: 0 });
  });
  it('날이 바뀌면 오늘 칸만 비운다 (연승은 이어 간다)', () => {
    const saved = JSON.stringify({ day: '2026-11-22', rounds: 9, net: 1200, bj: 2, streak: 4, last: 'r:9' });
    expect(bjLoad(saved, '2026-11-22')).toEqual({ day: '2026-11-22', rounds: 9, net: 1200, bj: 2, streak: 4, last: 'r:9' });
    expect(bjLoad(saved, day)).toEqual({ day, rounds: 0, net: 0, bj: 0, streak: 4, last: 'r:9' });
  });
  it('깨진 저장값은 빈 기록으로', () => {
    expect(bjLoad('{', day)).toEqual({ day, rounds: 0, net: 0, bj: 0, streak: 0, last: '' });
    expect(bjLoad('[1,2]', day)).toEqual({ day, rounds: 0, net: 0, bj: 0, streak: 0, last: '' });
    expect(bjLoad(JSON.stringify({ day, rounds: 'x', net: null, bj: -3, streak: 2.7 }), day)).toEqual({ day, rounds: 0, net: 0, bj: 0, streak: 2, last: '' });
  });
  it('띠 문구', () => {
    const fmt = (n: number) => n.toLocaleString('ko-KR');
    expect(bjStrip({ day, rounds: 3, net: 1200, bj: 1, streak: 0, last: '' }, fmt)).toBe('오늘 3판 · +1,200칩 · 블랙잭 1번');
    expect(bjStrip({ day, rounds: 2, net: -500, bj: 0, streak: 0, last: '' }, fmt)).toBe('오늘 2판 · -500칩 · 블랙잭 0번');
    expect(bjStrip({ day, rounds: 0, net: 0, bj: 0, streak: 0, last: '' }, fmt)).toBe('오늘 0판 · ±0칩 · 블랙잭 0번');
  });
  it('컷인은 3 · 5연승 때만', () => {
    expect([1, 2, 3, 4, 5, 6].map(streakCutin)).toEqual([null, null, '3연승!', null, '5연승!', null]);
  });
});

describe('룰렛 흐름 통계', () => {
  const NAMES = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
  const SEASONS = ['봄', '여름', '가을', '겨울'];
  it('칸 → 계절', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(seasonOfCell)).toEqual([3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
  });
  it('빈 기록', () => {
    const s = rouletteStats([]);
    expect(s.n).toBe(0);
    expect(s.cold).toBeNull();
    expect(s.yyRun).toBeNull();
    expect(rouletteNotes(s, NAMES, SEASONS)).toEqual([]);
    expect(share(0, 0)).toBe(0);
  });
  it('띠별 횟수 · 계절 · 음양 · 마지막으로 나온 뒤 지난 판 수', () => {
    // 쥐 쥐 호랑이 소 말 (최신이 뒤)
    const s = rouletteStats([0, 0, 2, 1, 6]);
    expect(s.n).toBe(5);
    expect(s.counts).toEqual([2, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(s.seasons).toEqual([1, 1, 0, 3]);
    expect([s.yang, s.yin]).toEqual([4, 1]);
    expect(s.gaps.slice(0, 3)).toEqual([3, 1, 2]);
    expect(s.gaps[6]).toBe(0);
    // 한 번도 안 나온 띠는 기록 길이만큼
    expect(s.gaps[4]).toBe(5);
    expect(share(s.yang, s.n)).toBe(80);
    expect(s.cellRun).toEqual({ cell: 6, len: 1 });
    expect(s.yyRun).toEqual({ side: 0, len: 1 });
  });
  it('눈에 띄는 흐름: 연속 · 오래 안 나온 띠', () => {
    // 용(4)이 맨 앞에 한 번 나온 뒤 14판 동안 없다 · 끝의 네 판은 모두 양 · 끝의 두 판은 같은 띠
    const h = [4, 1, 3, 5, 7, 9, 11, 8, 10, 5, 7, 0, 2, 6, 6];
    const s = rouletteStats(h);
    expect(s.gaps[4]).toBe(14);
    expect(s.cold).toEqual({ cell: 4, gap: 14 });
    expect(s.yyRun).toEqual({ side: 0, len: 4 });
    expect(rouletteNotes(s, NAMES, SEASONS)).toEqual(['말 2연속', '양 4연속', '용 14판째 안 나옴']);
  });
  it('계절 연속 · 잘못된 값은 버린다', () => {
    const s = rouletteStats([9, 2, 3, 4, 99, -1, 2.5]);
    expect(s.n).toBe(4);
    expect(s.seasonRun).toEqual({ season: 0, len: 3 });
    expect(rouletteNotes(s, NAMES, SEASONS)).toEqual(['봄 3연속']);
  });
});

describe('맞고 게임 방법 (설명서의 숫자가 엔진과 같은가)', () => {
  it('점수: 광 · 열끗 · 띠 · 피', () => {
    expect(scoreCards(['m01-gwang', 'm03-gwang', 'm08-gwang']).total).toBe(3);
    expect(scoreCards(['m01-gwang', 'm03-gwang', 'm12-gwang']).total).toBe(2);
    expect(scoreCards(['m01-gwang', 'm03-gwang', 'm08-gwang', 'm11-gwang']).total).toBe(4);
    expect(scoreCards(['m01-gwang', 'm03-gwang', 'm08-gwang', 'm11-gwang', 'm12-gwang']).total).toBe(15);
    expect(scoreCards(['m02-yeol', 'm04-yeol', 'm08-yeol']).total).toBe(5);
    expect(scoreCards(['m01-tti', 'm02-tti', 'm03-tti']).total).toBe(3);
    expect(MATGO_MANUAL).toContain('3장 3점 (비광이 끼면 2점) · 4장 4점 · 5장 15점');
    expect(MATGO_MANUAL).toContain('고도리</b>(2·4·8월 열끗 3장) 5점');
  });
  it('고: 1고 +1 · 2고 +2 · 3고부터 ×2', () => {
    expect([1, 2, 3, 4].map((go) => applyGo(7, go))).toEqual([8, 9, 18, 36]);
    expect(MATGO_MANUAL).toContain('1고 +1점, 2고 +2점, 3고부터는 고 하나마다 점수 ×2 (3고 ×2, 4고 ×4 …)');
  });
  it('뻑 보너스 · 삼뻑', () => {
    expect([...PPEOK_BONUS]).toEqual([2, 3]);
    expect(SAM_PPEOK_SCORE).toBe(7);
    expect(MATGO_MANUAL).toContain('기본 금액 ×2를 받아요');
    expect(MATGO_MANUAL).toContain('기본 금액 ×3을 더 받아요');
    expect(MATGO_MANUAL).toContain('세 번 뻑을 내면 그 자리에서 7점');
  });
});

// ---- 전체검사 뒤 고친 것 ----
import { bjSeenAdd, bjSeenLoad, bjStripHtml, BJ_SEEN_MAX, potOddsNeed } from '../../../games/lib/extras.ts';
import { emoteSpread } from '../../../games/lib/emote.ts';

describe('전체검사 고침', () => {
  it('포커 힌트는 높은 족보부터', () => {
    expect(pokerHint(['4S', '4D', '9S', '9C', 'KS', '2S'])).toBe('풀하우스·플러시까지 1장');
    expect(pokerHint(['4S', '4D', '4H', '9S', 'KS', '2S'])).toBe('포카드·플러시까지 1장');
  });
  it('홀덤 문구: 올인 콜은 약, 체크는 짧게', () => {
    expect(holdemAdviceText({ equity: 0.62, need: 0.25 } as never, { allIn: true })).toBe('이길 확률 약 62% · 콜하려면 약 25% 이상');
    expect(holdemAdviceText({ equity: 0.4, need: null } as never, { short: true })).toBe('이길 확률 약 40% · 체크 가능');
  });
  it('팟 오즈', () => {
    expect(potOddsNeed(300, 100)).toBeCloseTo(0.25);
    expect(potOddsNeed(300, 0)).toBeNull();
  });
  it('블랙잭 본 판 기억은 최근 것만, 중복은 그대로', () => {
    let seen: readonly string[] = bjSeenLoad(null);
    for (let i = 0; i < BJ_SEEN_MAX + 3; i++) seen = bjSeenAdd(seen, `r:${i}`);
    expect(seen.length).toBe(BJ_SEEN_MAX);
    expect(seen).toContain(`r:${BJ_SEEN_MAX + 2}`);
    expect(bjSeenAdd(seen, `r:${BJ_SEEN_MAX + 2}`)).toBe(seen);
    expect(bjSeenLoad('not json')).toEqual([]);
  });
  it('블랙잭 띠는 손익을 b 로 감싼다', () => {
    const day = bjRecord(bjLoad(null, '2026-11-23'), { key: 'a', delta: -500, blackjacks: 0 });
    expect(bjStripHtml(day, (n) => String(n))).toMatch(/<b class="minus">/);
  });
  it('기준점 없는 한마디는 자리마다 벌어진다', () => {
    const a = emoteSpread([0, 1, 2], 0, 300);
    const b = emoteSpread([0, 1, 2], 1, 300);
    expect(a.x).not.toBe(b.x);
  });
});

// ---- 기능 묶음 3: 맞고 고/스톱 도우미 · 족보 칸 · 포커 한 줄 · 홀덤 예약 · 블랙잭 베팅/힌트 · 룰렛 배치 ----
import {
  bjAddBet,
  bjClampBet,
  bjDoubleBet,
  bjHint,
  holdemBookAction,
  holdemBookKeep,
  holdemToCall,
  matgoChips,
  matgoMulText,
  matgoRiskText,
  matgoStopPreview,
  pokerStory,
  rlDouble,
  rlFollow,
  rlFromPreset,
  rlPresetsLoad,
  rlPush,
  rlToPreset,
  rlUndo,
  RL_UNDO_MAX,
} from '../../../games/lib/extras.ts';
import { seededRng } from './engine.ts';
import { makeTestState, matgo, type MatgoPlayerPublic, type MatgoSummary } from './matgo.ts';
import { basicStrategy } from './blackjack.ts';
import { poker, type PokerAction, type PokerState, type PokerSummary } from './poker.ts';
import type { RBet } from './roulette.ts';

describe('맞고 고/스톱 도우미', () => {
  const seats = [
    { seat: 0, kind: 'ai' as const, name: 'AI 쥐', stack: null },
    { seat: 1, kind: 'ai' as const, name: 'AI 소', stack: null },
  ];
  it('미리 보기 금액은 실제로 스톱한 결과(summarize)와 같다 — 여러 판', () => {
    let checked = 0;
    const withMul = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const rng = seededRng(seed);
      let s = matgo.newRound({ seats, baseUnit: 100, carry: seed % 5 === 0 ? { first: 0, nagari: 2 } : null, rng });
      for (let step = 0; step < 400 && !matgo.done(s); step++) {
        const seat = matgo.pending(s)[0];
        const v = matgo.view(s);
        if (v.public.choice?.kind === 'goStop') {
          const pre = matgoStopPreview(v.public, seat, 100)!;
          const r = matgo.view(matgo.apply(s, seat, { type: 'stop' }, rng)).public.result as MatgoSummary;
          expect(r.winner).toBe(seat);
          expect(pre.score).toBe(r.score);
          expect(pre.multiplier).toBe(r.multiplier);
          expect(pre.amount).toBe(r.amount);
          expect(pre.multipliers).toEqual(r.multipliers.filter((m) => !/^\d+고 ×/.test(m)));
          // 가진 돈 제한이 없는 자리(AI)끼리라 실제 증감 = 미리 보기 합계
          expect(pre.total).toBe(r.net[seat]);
          pre.multipliers.forEach((m) => withMul.add(m));
          checked++;
        }
        s = matgo.apply(s, seat, matgo.ai(v.public, v.private[seat], seat, rng), rng);
      }
    }
    expect(checked).toBeGreaterThan(100);
    // 배수가 붙은 경우도 실제로 지나갔다
    expect(withMul.has('피박')).toBe(true);
    expect(withMul.has('고박')).toBe(true);
  });
  it('뻑 보너스는 합계에만 들어간다', () => {
    const s = makeTestState({
      hands: [['m10-pi1'], ['m05-pi1']],
      floor: ['m10-pi2'],
      pile: ['m07-pi1'],
      captured: [['m01-gwang', 'm03-gwang', 'm08-gwang', 'm01-tti', 'm02-tti', 'm03-tti', 'm04-tti', 'm05-tti'], ['m11-gwang']],
      ppeokCount: [0, 1],
      ppeokUnits: [0, 2],
    });
    const pre = matgoStopPreview(matgo.view(s).public, 0, 100)!;
    // 3광 3 + 홍단 3 + 띠 5장 1 = 7점
    expect(pre.score).toBe(7);
    expect(pre.amount).toBe(700);
    expect(pre.total).toBe(500);
    expect(matgoStopPreview(matgo.view(s).public, 5, 100)).toBeNull();
  });
  it('배수 글 · 상대 위험 한 줄', () => {
    expect(matgoMulText([])).toBe('');
    expect(matgoMulText(['피박', '흔들기', '흔들기', '나가리 ×2'])).toBe('피박 ×2 · 흔들기 ×4 · 나가리 ×2');
    expect(matgoRiskText({ score: 2, handCount: 4, bombFill: 0, go: 0 })).toBe('상대 2점 · 손패 4장');
    expect(matgoRiskText({ score: 6, handCount: 2, bombFill: 1, go: 1 })).toBe('상대 6점 (1고) · 손패 3장 · 위험!');
    expect(matgoRiskText({ score: 6, handCount: 0, bombFill: 0, go: 0 })).toBe('상대 6점 · 손패 0장 · 더 못 내요');
  });
});

describe('맞고 족보 진행 · 박 경고 칸', () => {
  const pl = (cap: Partial<MatgoPlayerPublic['captured']>, piCount = 0): MatgoPlayerPublic =>
    ({ captured: { gwang: [], yeol: [], tti: [], pi: [], ...cap }, piCount }) as MatgoPlayerPublic;
  const texts = (a: MatgoPlayerPublic, b: MatgoPlayerPublic) => matgoChips(a, b).map((c) => c.text);
  it('두 장 모은 세 장 족보 · 광 2장', () => {
    const me = pl({ yeol: ['m02-yeol', 'm04-yeol'], tti: ['m06-tti', 'm09-tti'], gwang: ['m01-gwang', 'm03-gwang'] });
    expect(texts(me, pl({}))).toEqual(['고도리 2/3', '청단 2/3', '광 2장']);
  });
  it('남은 한 장을 상대가 먹었으면 말하지 않는다 · 다 모은 족보도', () => {
    const me = pl({ yeol: ['m02-yeol', 'm04-yeol'], tti: ['m01-tti', 'm02-tti', 'm03-tti'] });
    expect(texts(me, pl({ yeol: ['m08-yeol'] }))).toEqual([]);
  });
  it('박 경고가 먼저', () => {
    const me = pl({ tti: ['m04-tti', 'm05-tti'] }, 6);
    const opp = pl({ gwang: ['m01-gwang', 'm03-gwang'], yeol: ['m02-yeol', 'm04-yeol', 'm05-yeol', 'm06-yeol', 'm07-yeol', 'm10-yeol'] }, 9);
    const chips = matgoChips(me, opp);
    expect(chips.map((c) => c.text)).toEqual(['피 6장 · 피박 위험', '광박 위험', '멍박 위험', '초단 2/3']);
    expect(chips.map((c) => !!c.warn)).toEqual([true, true, true, false]);
    // 피가 한 장도 없으면 피박이 아니다 · 상대 피가 아직 적으면 경고하지 않는다
    expect(texts(pl({}, 0), pl({}, 12))).toEqual([]);
    expect(texts(pl({}, 3), pl({}, 7))).toEqual([]);
  });
});

/** 실제 엔진으로 2명 판: 칩이 적은 0번은 콜만, 1번은 가장 크게 올린다 → 0번이 모자란 올인 콜로 이긴 판을 찾아 돌려준다 */
function shortAllInRound(): PokerSummary {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seededRng(seed);
    let s: PokerState = poker.newRound({
      seats: [
        { seat: 0, kind: 'human', name: 'P0', stack: 3000 },
        { seat: 1, kind: 'human', name: 'P1', stack: 100000 },
      ],
      baseUnit: 1000,
      carry: null,
      rng,
    });
    for (let step = 0; step < 200 && !poker.done(s); step++) {
      const st = poker.pending(s)[0];
      if (s.phase === 'choose') {
        s = poker.apply(s, st, poker.timeout(s, st, rng), rng);
        continue;
      }
      const acts = poker.view(s).public.actions.filter((a) => a.type !== 'die');
      const pick = st === 0 ? (acts.find((a) => a.type === 'call') ?? acts.find((a) => a.type === 'check') ?? acts[0]) : acts.slice().sort((a, b) => b.amount - a.amount)[0];
      s = poker.apply(s, st, { type: pick.type } as PokerAction, rng);
    }
    const r = s.result;
    if (r && !r.cancelled && !r.uncontested && r.winners.length === 2 && r.pots.some((p) => p.eligible.length === 1) && r.pots.some((p) => p.eligible.length === 2 && p.winners.length === 1 && p.winners[0] === 0)) return r;
  }
  throw new Error('모자란 올인 콜로 이긴 판을 찾지 못했다');
}

describe('세븐포커 판 요약 한 줄', () => {
  const nameOf = (s: number) => ['나', '어흥이', '깡총이', '여의룡'][s];
  const sum = (
    o: Partial<{ cancelled: boolean; uncontested: boolean; winners: number[]; hands: Record<number, { name: string }>; pots: { amount: number; eligible: number[]; winners: number[] }[] }>,
  ) => ({ cancelled: false, uncontested: false, winners: [] as number[], hands: {}, ...o });
  it('무혈 승리: 마지막 올림 뒤에 다이한 사람 수', () => {
    const events = [
      { t: 'die', seat: 3 },
      { t: 'half', seat: 1, amount: 400 },
      { t: 'die', seat: 0 },
      { t: 'die', seat: 2 },
      { t: 'win', seat: 1, amount: 900 },
    ];
    expect(pokerStory({ events, summary: sum({ uncontested: true, winners: [1] }), nameOf })).toBe('어흥이의 하프에 2명 다이');
    expect(pokerStory({ events, summary: sum({ uncontested: true, winners: [1] }), nameOf, bluff: true })).toBe('어흥이의 뻥카에 2명 다이');
    expect(pokerStory({ events: [{ t: 'die', seat: 0 }], summary: sum({ uncontested: true, winners: [1] }), nameOf })).toBe('모두 다이! 어흥이의 무혈 승리');
    expect(pokerStory({ events: [], summary: sum({ uncontested: true, winners: [1] }), nameOf })).toBe('어흥이의 무혈 승리');
  });
  it('7구 역전: 6구까지 지던 사람이 히든으로 이겼다', () => {
    // 카드 순서 = 비공개 2장 · 7구 히든 · 공개 4장
    const showdown = [
      { seat: 0, cards: ['2S', '5S', 'KS', '9S', 'JS', '3D', '4C'] }, // 6구까지 플러시 4장 → 7구 KS 로 플러시
      { seat: 1, cards: ['AS', 'AD', '2C', '7H', '7C', '9D', 'QC'] }, // 투페어
    ];
    const summary = sum({ winners: [0], hands: { 0: { name: 'K 플러시' }, 1: { name: 'A 투페어' } } });
    expect(pokerStory({ events: [], summary, showdown, nameOf })).toBe('7구 역전! 나의 K 플러시');
    // 처음부터 앞서 있었으면 역전이 아니다
    const summary2 = sum({ winners: [1], hands: { 0: { name: 'K 하이' }, 1: { name: 'A 투페어' } } });
    const sd2 = [{ seat: 0, cards: ['2S', '5S', 'KD', '9S', 'JS', '3D', '4C'] }, showdown[1]];
    expect(pokerStory({ events: [], summary: summary2, showdown: sd2, nameOf })).toBe('2명 쇼다운 · 어흥이의 A 투페어 승리');
    expect(pokerStory({ events: [{ t: 'allin', seat: 0 }], summary: summary2, showdown: sd2, nameOf })).toBe('올인 승부! 어흥이의 A 투페어 승리');
  });
  it('사이드팟·남는 팟 승자는 동점이 아니다 — 주인공은 메인팟 승자', () => {
    const hands = { 0: { name: 'K 하이' }, 1: { name: 'A 투페어' }, 2: { name: '9 원페어' } };
    const events = [{ t: 'allin', seat: 1 }];
    // 칩이 적은 어흥이(1)가 올인으로 메인팟을, 깡총이(2)가 사이드팟을 가져갔다 → winners 는 합집합 [1, 2]
    const side = sum({
      winners: [1, 2],
      hands,
      pots: [
        { amount: 900, eligible: [0, 1, 2], winners: [1] },
        { amount: 400, eligible: [0, 2], winners: [2] },
      ],
    });
    expect(pokerStory({ events, summary: side, nameOf })).toBe('올인 승부! 어흥이의 A 투페어 승리');
    // 2명 판: 더 많이 건 나(0)만 자격인 남는 팟이 돌아온다 → winners [0, 1] 이어도 이긴 사람은 어흥이
    const rest = sum({
      winners: [0, 1],
      hands,
      pots: [
        { amount: 600, eligible: [0, 1], winners: [1] },
        { amount: 200, eligible: [0], winners: [0] },
      ],
    });
    expect(pokerStory({ events, summary: rest, nameOf })).toBe('올인 승부! 어흥이의 A 투페어 승리');
    // 메인팟을 실제로 나눠 가졌을 때만 동점 (사이드팟 승자는 이름에 넣지 않는다)
    const tie = sum({
      winners: [0, 1, 2],
      hands,
      pots: [
        { amount: 900, eligible: [0, 1, 2], winners: [2, 1] },
        { amount: 200, eligible: [0], winners: [0] },
      ],
    });
    expect(pokerStory({ events, summary: tie, nameOf })).toBe('동점! 어흥이 · 깡총이 판돈 나눔');
  });
  it('실제 엔진: 모자란 올인 콜로 이긴 2명 판을 동점이라 하지 않는다', () => {
    const r = shortAllInRound();
    expect(r.winners.length).toBe(2);
    const main = r.pots.find((p) => p.eligible.length >= 2)!;
    expect(main.winners.length).toBe(1);
    const story = pokerStory({ events: [{ t: 'allin', seat: main.winners[0] }], summary: r, nameOf });
    expect(story).not.toContain('동점');
    expect(story).toContain(nameOf(main.winners[0]));
  });
  it('동점 · 취소 · 결과 없음', () => {
    expect(pokerStory({ events: [], summary: sum({ winners: [1, 2] }), nameOf })).toBe('동점! 어흥이 · 깡총이 판돈 나눔');
    expect(pokerStory({ events: [], summary: sum({ cancelled: true, winners: [1] }), nameOf })).toBeNull();
    expect(pokerStory({ events: [], summary: null, nameOf })).toBeNull();
  });
});

describe('포커·홀덤 진짜 승자 (혼자만 받는 남는 팟은 돌려받음)', () => {
  it('실제 엔진: 모자란 올인 콜로 진 사람이 돌려받은 차액은 승리가 아니다', () => {
    const r = shortAllInRound();
    const main = r.pots.find((p) => p.eligible.length >= 2)!;
    const rest = r.pots.find((p) => p.eligible.length === 1)!;
    expect(potRealWinners(r)).toEqual([0]);
    expect(main.winners).toEqual([0]);
    // 남는 팟은 더 많이 건 1번에게만 돌아간다 → 🏆·코인 소리·컷인 없이 '돌려받음'
    expect(rest.eligible).toEqual([1]);
    expect(potRefundOnly(1, r)).toBe(true);
    expect(potRefundOnly(0, r)).toBe(false);
  });
  it('메인팟도 이기고 남는 팟도 받으면 승자 · 사이드팟 승자는 승자', () => {
    const pots = [
      { amount: 900, eligible: [0, 1, 2], winners: [1] },
      { amount: 400, eligible: [0, 2], winners: [2] },
      { amount: 200, eligible: [2], winners: [2] },
    ];
    expect(potRealWinners({ uncontested: false, winners: [1, 2], pots })).toEqual([1, 2]);
    expect(potRefundOnly(2, { uncontested: false, winners: [1, 2], pots })).toBe(false);
  });
  it('무혈 승리 · 결과 모름', () => {
    const pots = [{ amount: 500, eligible: [3], winners: [3] }];
    expect(potRealWinners({ uncontested: true, winners: [3], pots })).toEqual([3]);
    expect(potRefundOnly(3, { uncontested: true, winners: [3], pots })).toBe(false);
    expect(potRealWinners(null)).toEqual([]);
    expect(potRefundOnly(1, null)).toBe(false);
    expect(potRefundOnly(1, undefined)).toBe(false);
  });
});

import { holdem, type HoldemAction, type HoldemState } from './holdem.ts';
import { computeSidePots } from './pots.ts';
import { potRefundOf, sidePotCount } from '../../../games/lib/extras.ts';

describe('포커·홀덤 돌려받음은 혼자 낸 몫(refund 팟)만 — 다이한 사람 돈은 딴 것', () => {
  it('홀덤 재현: A 100 올인 · B·C 콜, 플롭 B 200 · C 콜, 턴 B 500 · C 폴드, A 가 메인 승리', () => {
    // 시드 8: A(0) 가 메인 팟을 이긴다
    const seed = 8;
    let s: HoldemState = holdem.newRound({
      seats: [
        { seat: 0, kind: 'human', name: 'A', stack: 100 },
        { seat: 1, kind: 'human', name: 'B', stack: 10000 },
        { seat: 2, kind: 'human', name: 'C', stack: 10000 },
      ],
      baseUnit: 10,
      carry: null,
      rng: seededRng(seed),
    });
    const rng = seededRng(seed + 100);
    for (let k = 0; k < 40 && s.phase !== 'done'; k++) {
      const seat = s.turn!;
      const owe = s.curBet > s.players.find((q) => q.seat === seat)!.betRound;
      let a: HoldemAction;
      if (seat === 0) a = { type: 'allin' };
      else if (s.phase === 'flop' && seat === 1 && s.curBet === 0) a = { type: 'raise', to: 200 };
      else if (s.phase === 'turn' && seat === 1 && s.curBet === 0) a = { type: 'raise', to: 500 };
      else if (s.phase === 'turn' && seat === 2 && owe) a = { type: 'fold' };
      else a = { type: owe ? 'call' : 'check' };
      s = holdem.apply(s, seat, a, rng);
    }
    const r = s.result!;
    expect(s.players.map((p) => p.total)).toEqual([100, 800, 300]);
    expect(r.pots).toEqual([
      { amount: 300, eligible: [0, 1], winners: [0] },
      { amount: 400, eligible: [1], winners: [1] },
      { amount: 500, eligible: [1], winners: [1], refund: true },
    ]);
    // 정산은 그대로: B 는 C 의 300 중 200 을 따서 +100
    expect(r.deltas).toEqual({ 0: 200, 1: 100, 2: -300 });
    expect(potRealWinners(r)).toEqual([0, 1]);
    expect(potRefundOnly(1, r)).toBe(false);
    expect(potRefundOf(1, r)).toBe(500);
    expect(potRefundOf(0, r)).toBe(0);
  });
  it('세븐포커 꼴: 자리0 300 올인, 1·2 가 800까지, 2 다이 → 1 은 2 의 돈을 딴 것', () => {
    const pots = computeSidePots(
      [
        { seat: 0, total: 300, folded: false, allIn: true },
        { seat: 1, total: 800, folded: false, allIn: false },
        { seat: 2, total: 800, folded: true, allIn: false },
      ],
      { refund: true },
    );
    expect(pots).toEqual([
      { amount: 900, eligible: [0, 1] },
      { amount: 1000, eligible: [1] },
    ]);
    const r = { refundPots: true, uncontested: false, winners: [0, 1], pots: [{ ...pots[0], winners: [0] }, { ...pots[1], winners: [1] }] };
    expect(potRealWinners(r)).toEqual([0, 1]);
    expect(potRefundOnly(1, r)).toBe(false);
    expect(potRefundOf(1, r)).toBe(0);
  });
  it('예전 공개 상태 (refundPots 표시·refund 팟 없음, 대상 1명 팟 있음): 예전 규칙 — 대상 2명 이상 팟의 승자만', () => {
    const pots = [
      { amount: 300, eligible: [0, 1], winners: [0] },
      { amount: 900, eligible: [1], winners: [1] },
    ];
    const old = { uncontested: false, winners: [0, 1], pots };
    expect(potRealWinners(old)).toEqual([0]);
    expect(potRefundOnly(1, old)).toBe(true);
    expect(potRefundOf(1, old)).toBe(900);
    expect(potRefundOf(0, old)).toBe(0);
    // 같은 팟이라도 새 엔진 결과(refundPots)면 대상 1명 팟은 딴 것
    const now = { ...old, refundPots: true };
    expect(potRealWinners(now)).toEqual([0, 1]);
    expect(potRefundOf(1, now)).toBe(0);
    // refund 팟이 하나라도 있으면 새 규칙
    const withRefund = { uncontested: false, winners: [0, 1], pots: [...pots, { amount: 100, eligible: [1], winners: [1], refund: true }] };
    expect(potRealWinners(withRefund)).toEqual([0, 1]);
    expect(potRefundOf(1, withRefund)).toBe(100);
  });
  it('실제 엔진 결과에는 refundPots 표시가 있다', () => {
    expect(shortAllInRound().refundPots).toBe(true);
  });
  it('실제 세븐포커 엔진: 다이한 사람이 올인한 사람보다 많이 냈으면 남는 팟을 받은 사람도 승자', () => {
    let found = false;
    for (let seed = 1; seed <= 400 && !found; seed++) {
      const rng = seededRng(seed);
      let s: PokerState = poker.newRound({
        seats: [
          { seat: 0, kind: 'human', name: 'P0', stack: 3000 },
          { seat: 1, kind: 'human', name: 'P1', stack: 100000 },
          { seat: 2, kind: 'human', name: 'P2', stack: 100000 },
        ],
        baseUnit: 1000,
        carry: null,
        rng,
      });
      for (let step = 0; step < 300 && !poker.done(s); step++) {
        const st = poker.pending(s)[0];
        if (s.phase === 'choose') {
          s = poker.apply(s, st, poker.timeout(s, st, rng), rng);
          continue;
        }
        const acts = poker.view(s).public.actions;
        const me = s.players.find((p) => p.seat === st)!;
        const zero = s.players.find((p) => p.seat === 0)!;
        const noDie = acts.filter((a) => a.type !== 'die');
        let pick;
        if (st === 0) pick = noDie.find((a) => a.type === 'call') ?? noDie.find((a) => a.type === 'check') ?? noDie[0];
        else if (st === 2 && zero.allIn && me.total > zero.total) pick = acts.find((a) => a.type === 'die') ?? noDie[0];
        else pick = noDie.slice().sort((a, b) => b.amount - a.amount)[0];
        s = poker.apply(s, st, { type: pick.type } as PokerAction, rng);
      }
      const r = s.result;
      if (!r || r.cancelled || r.uncontested) continue;
      const p2 = s.players.find((p) => p.seat === 2)!;
      const main = r.pots.find((p) => p.eligible.length >= 2);
      if (!p2.folded || !main || main.winners.join() !== '0') continue;
      found = true;
      // 1 은 다이한 2 의 돈이 든 팟을 받았다 → 돌려받음만이 아니다. 정산 합계는 0
      expect(Object.values(r.deltas).reduce((a, b) => a + b, 0)).toBe(0);
      expect(potRefundOnly(1, r)).toBe(false);
      expect(potRealWinners(r)).toEqual([0, 1]);
      const p1 = s.players.find((p) => p.seat === 1)!;
      expect(potRefundOf(1, r)).toBe(p1.total - p2.total);
    }
    expect(found).toBe(true);
  });
});

describe("'사이드 팟 N' 수 (아무도 받지 못한 차액은 빼고)", () => {
  const P = (seat: number, total: number, o: { folded?: boolean; allIn?: boolean; excluded?: boolean } = {}) => ({ seat, total, folded: !!o.folded, allIn: !!o.allIn, excluded: o.excluded });
  it('1위 혼자 낸 마지막 팟(차액뿐)은 세지 않는다', () => {
    // A 100 올인, B 500, C 100 → 팟 [300 (A·B·C), 400 (B 혼자)] 인데 400 은 B 가 돌려받을 몫
    expect(sidePotCount([P(0, 100, { allIn: true }), P(1, 500), P(2, 100)])).toBe(0);
  });
  it('다이한 사람 돈이 든 대상 1명 팟은 센다', () => {
    expect(sidePotCount([P(0, 300, { allIn: true }), P(1, 800), P(2, 800, { folded: true })])).toBe(1);
    // 차액(500)을 빼도 다이한 사람 돈(200)이 남는다
    expect(sidePotCount([P(0, 100, { allIn: true }), P(1, 800), P(2, 300, { folded: true })])).toBe(1);
  });
  it('두 사람 이상이 겨루는 사이드 팟 · 빠진 자리', () => {
    expect(sidePotCount([P(0, 100, { allIn: true }), P(1, 500), P(2, 500)])).toBe(1);
    expect(sidePotCount([P(0, 100), P(1, 100), P(2, 0, { excluded: true })])).toBe(0);
  });
});

describe('홀덤 미리 고르기', () => {
  it('체크/폴드: 체크할 수 있으면 체크, 아니면 폴드', () => {
    expect(holdemBookAction({ kind: 'checkfold' }, { canCheck: true, call: 0 }, 0)).toBe('check');
    expect(holdemBookAction({ kind: 'checkfold' }, { canCheck: false, call: 200 }, 400)).toBe('fold');
  });
  it('콜: 베팅 금액이 그대로면 콜, 바뀌면 취소', () => {
    expect(holdemBookAction({ kind: 'call', curBet: 400 }, { canCheck: false, call: 200 }, 400)).toBe('call');
    expect(holdemBookAction({ kind: 'call', curBet: 400 }, { canCheck: false, call: 600 }, 800)).toBeNull();
    expect(holdemBookKeep({ kind: 'call', curBet: 400 }, 800)).toBeNull();
    expect(holdemBookKeep({ kind: 'call', curBet: 400 }, 400)).toEqual({ kind: 'call', curBet: 400 });
    expect(holdemBookKeep({ kind: 'checkfold' }, 800)).toEqual({ kind: 'checkfold' });
    expect(holdemBookAction(null, { canCheck: true, call: 0 }, 0)).toBeNull();
    // 낼 돈이 없으면 체크
    expect(holdemBookAction({ kind: 'call', curBet: 200 }, { canCheck: true, call: 0 }, 200)).toBe('check');
  });
  it('낼 칩은 남은 칩까지만', () => {
    expect(holdemToCall(400, 100, 5000)).toBe(300);
    expect(holdemToCall(400, 100, 120)).toBe(120);
    expect(holdemToCall(400, 400, 5000)).toBe(0);
  });
});

describe('블랙잭 베팅 금액 · 기본 전략 힌트', () => {
  it('금액은 기본 단위의 배수로 상한·잔액 안', () => {
    expect(bjClampBet(250, 100, 10_000)).toBe(200);
    expect(bjClampBet(0, 100, 10_000)).toBe(100);
    expect(bjClampBet(99_999, 100, 10_000)).toBe(10_000);
    // 잔액이 350 이면 300 까지
    expect(bjAddBet(200, 500, 100, 350)).toBe(300);
    expect(bjAddBet(200, 500, 100, 10_000)).toBe(700);
    expect(bjDoubleBet(600, 100, 1_000)).toBe(1_000);
    expect(bjDoubleBet(300, 100, 10_000)).toBe(600);
    expect(bjDoubleBet(0, 100, 10_000)).toBe(100);
  });
  it('힌트는 엔진의 기본 전략표를 그대로 쓴다', () => {
    const all = ['hit', 'stand', 'double', 'split'] as const;
    expect(basicStrategy(['8S', '8D'], 10, true)).toBe('P');
    expect(bjHint(['8S', '8D'], 'KS', all)).toBe('split');
    expect(bjHint(['8S', '8D'], 'KS', ['hit', 'stand'])).toBe('hit');
    expect(bjHint(['5S', '6D'], '6H', all)).toBe('double');
    // 더블을 못 하면: 11 은 히트, 소프트 18(딜러 5)은 스탠드
    expect(bjHint(['5S', '4D', '2C'], '6H', ['hit', 'stand'])).toBe('hit');
    expect(bjHint(['AS', '7D'], '5H', ['hit', 'stand'])).toBe('stand');
    expect(bjHint(['AS', '7D'], '5H', ['hit', 'stand', 'double'])).toBe('double');
    expect(bjHint(['10S', '6D'], 'AH', ['hit', 'stand'])).toBe('hit');
    // 소프트 12 (A,A 인데 스플릿 못 함): 딜러 6 이어도 더블이 아니라 히트
    expect(bjHint(['AS', 'AD'], '6H', ['hit', 'stand', 'double'])).toBe('hit');
    expect(bjHint(['10S', '7D'], 'AH', ['hit', 'stand'])).toBe('stand');
    expect(bjHint(['10S', '7D'], null, ['hit', 'stand'])).toBeNull();
    expect(bjHint(['10S', '7D'], 'AH', [])).toBeNull();
  });
});

describe('룰렛 되돌리기 · 2배 · 자주 쓰는 배치 · 따라 걸기', () => {
  const a: RBet[] = [
    { kind: 'zodiac', target: 3, amount: 200 },
    { kind: 'season', target: 1, amount: 500 },
  ];
  it('2배는 한도 안에서만', () => {
    expect(rlDouble(a, 10_000)).toEqual([
      { kind: 'zodiac', target: 3, amount: 400 },
      { kind: 'season', target: 1, amount: 1000 },
    ]);
    expect(rlDouble(a, 1_300)).toBeNull();
    expect(rlDouble([], 10_000)).toBeNull();
    // 원래 목록은 그대로
    expect(a[0].amount).toBe(200);
  });
  it('되돌리기: 바꾸기 직전 배치로 한 번씩', () => {
    let log = rlPush([], []);
    log = rlPush(log, [a[0]]);
    const u1 = rlUndo(log)!;
    expect(u1.bets).toEqual([a[0]]);
    const u2 = rlUndo(u1.log)!;
    expect(u2.bets).toEqual([]);
    expect(rlUndo(u2.log)).toBeNull();
    // 기록은 복사본이다 (뒤에 금액을 고쳐도 기록은 그대로)
    const live: RBet[] = [{ kind: 'pair', target: 0, amount: 100 }];
    const l2 = rlPush([], live);
    live[0].amount = 900;
    expect(rlUndo(l2)!.bets[0].amount).toBe(100);
    let big: RBet[][] = [];
    for (let i = 0; i < RL_UNDO_MAX + 5; i++) big = rlPush(big, a);
    expect(big.length).toBe(RL_UNDO_MAX);
  });
  it('따라 걸기: 확정 배치를 복사 (한도 넘으면 안 함)', () => {
    const copy = rlFollow(a, 10_000)!;
    expect(copy).toEqual(a);
    expect(copy[0]).not.toBe(a[0]);
    expect(rlFollow(a, 600)).toBeNull();
    expect(rlFollow([], 600)).toBeNull();
    expect(rlFollow(undefined, 600)).toBeNull();
  });
  it('자주 쓰는 배치: 기본 단위의 배수로 저장해 다른 방에서도 쓴다', () => {
    const p = rlToPreset(a, 100)!;
    expect(p).toEqual([
      { kind: 'zodiac', target: 3, units: 2 },
      { kind: 'season', target: 1, units: 5 },
    ]);
    expect(rlFromPreset(p, 500, 50_000)).toEqual([
      { kind: 'zodiac', target: 3, amount: 1000 },
      { kind: 'season', target: 1, amount: 2500 },
    ]);
    expect(rlFromPreset(p, 500, 3_000)).toBeNull();
    expect(rlFromPreset(null, 100, 10_000)).toBeNull();
    expect(rlToPreset([], 100)).toBeNull();
    expect(rlToPreset([{ kind: 'zodiac', target: 0, amount: 150 }], 100)).toBeNull();
    const raw = JSON.stringify([p, null, [{ kind: 'zodiac', target: 12, units: 1 }]]);
    expect(rlPresetsLoad(raw)).toEqual([p, null, null]);
    expect(rlPresetsLoad('깨진 글')).toEqual([null, null, null]);
    expect(rlPresetsLoad(null)).toEqual([null, null, null]);
    expect(rlPresetsLoad(JSON.stringify([[{ kind: '__proto__', target: 0, units: 1 }], [{ kind: 'pair', target: 1, units: 0.5 }], 'x']))).toEqual([null, null, null]);
  });
});

import { pokerWeak } from '../../../games/lib/extras.ts';

describe('세븐포커 뻥카 판정', () => {
  it('원페어 이하면 약한 패', () => {
    expect(pokerWeak(['2S', '7D', '9H', 'KC'])).toBe(true);
    expect(pokerWeak(['2S', '2D', '9H', 'KC', '5D', '8C'])).toBe(true);
    expect(pokerWeak(['2S', '2D', '9H', '9C', '5D'])).toBe(false);
    expect(pokerWeak(['2S', '5S', '9S', 'KS', '3S', '4D'])).toBe(false);
    expect(pokerWeak([])).toBe(false);
  });
});
