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
