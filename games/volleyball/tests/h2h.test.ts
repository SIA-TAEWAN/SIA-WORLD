import { describe, expect, it } from 'vitest';
import { h2hText, h2hView, parseH2h, parseH2hParam, withParticle } from '../src/net/h2h';

describe('맞대결 전적: 서버 답 확인', () => {
  it('바른 답', () => {
    expect(parseH2h({ wins: 7, losses: 4, streak: 2, streak_won: true })).toEqual({ wins: 7, losses: 4, streak: 2, streakWon: true });
    expect(parseH2h({ wins: 0, losses: 3, streak: 3, streak_won: false })).toEqual({ wins: 0, losses: 3, streak: 3, streakWon: false });
  });
  it('경기가 없으면 0승 0패 (streak_won 은 null)', () => {
    expect(parseH2h({ wins: 0, losses: 0, streak: 0, streak_won: null })).toEqual({ wins: 0, losses: 0, streak: 0, streakWon: false });
  });
  it('모양이 다르면 null', () => {
    for (const bad of [null, undefined, 'x', 3, [], {}, { wins: 1 }, { wins: '1', losses: 0, streak: 1, streak_won: true },
      { wins: -1, losses: 0, streak: 0, streak_won: true }, { wins: 1.5, losses: 0, streak: 1, streak_won: true },
      { wins: 2, losses: 1, streak: 1, streak_won: null }]) {
      expect(parseH2h(bad)).toBeNull();
    }
  });
  it('이어진 판 수가 그 결과의 판 수를 넘으면 null', () => {
    expect(parseH2h({ wins: 2, losses: 5, streak: 3, streak_won: true })).toBeNull();
    expect(parseH2h({ wins: 2, losses: 5, streak: 0, streak_won: true })).toBeNull();
    expect(parseH2h({ wins: 2, losses: 0, streak: 1, streak_won: false })).toBeNull();
  });
});

describe('맞대결 전적: 글', () => {
  it('와/과', () => {
    expect(withParticle('시아')).toBe('와');
    expect(withParticle('곰돌')).toBe('과');
    expect(withParticle('호랑이 ')).toBe('와');
    expect(withParticle('user2')).toBe('와');
    expect(withParticle('user1')).toBe('과');
    expect(withParticle('user0')).toBe('과');
    expect(withParticle('Sia')).toBe('와');
    expect(withParticle('')).toBe('와');
  });
  it('승패와 연승·연패', () => {
    expect(h2hText('시아', { wins: 7, losses: 4, streak: 2, streakWon: true })).toBe('시아와 7승 4패 · 최근 2연승');
    expect(h2hText('곰돌', { wins: 1, losses: 5, streak: 3, streakWon: false })).toBe('곰돌과 1승 5패 · 최근 3연패');
  });
  it('한 판만 이어졌으면 연승을 붙이지 않는다', () => {
    expect(h2hText('시아', { wins: 7, losses: 4, streak: 1, streakWon: true })).toBe('시아와 7승 4패');
  });
  it('경기가 없으면 첫 맞대결', () => {
    expect(h2hText('시아', { wins: 0, losses: 0, streak: 0, streakWon: false })).toBe('시아와 첫 맞대결');
  });
  it('이름이 비면 상대', () => {
    expect(h2hView('  ', { wins: 1, losses: 0, streak: 1, streakWon: true })).toEqual({ name: '상대', particle: '와', record: '1승 0패', streak: '' });
  });
});

describe('테스트 모드 ?h2h=', () => {
  it('승,패,이어진 판 수', () => {
    expect(parseH2hParam('7,4,2')).toEqual({ wins: 7, losses: 4, streak: 2, streakWon: true });
    expect(parseH2hParam('1,5,-3')).toEqual({ wins: 1, losses: 5, streak: 3, streakWon: false });
    expect(parseH2hParam('0,0')).toEqual({ wins: 0, losses: 0, streak: 0, streakWon: false });
  });
  it('모양이 다르면 null', () => {
    expect(parseH2hParam(null)).toBeNull();
    expect(parseH2hParam('')).toBeNull();
    expect(parseH2hParam('a,b')).toBeNull();
    expect(parseH2hParam('2,1,5')).toBeNull();
  });
});
