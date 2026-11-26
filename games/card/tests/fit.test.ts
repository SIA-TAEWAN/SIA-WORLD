/**
 * 카드 설명이 설명 칸 안에 들어가는지 (글자 크기 자동 줄이기 + 줄바꿈, src/ui/fit.ts).
 * 브라우저에서 실제 글꼴로 확인: ?local=1 전투 화면에서 개발자 도구 콘솔에 window.__cardFit() → 빈 목록이면 통과.
 */
import { describe, expect, it } from 'vitest';
import { CARDS, cardText } from '../src/game/rules';
import { DESC_BOX, DESC_LINE, DESC_SIZES, fitDesc, textEm, wrapLines } from '../src/ui/fit';

/** 너무 작으면 휴대폰에서 못 읽는다 */
const MIN_SIZE = 7.5;

describe('카드 설명 맞추기', () => {
  it('줄은 빈칸에서 나누고, 각 줄은 너비 안', () => {
    expect(wrapLines('모든 적 10, 화상2', 7)).toEqual(['모든 적 10,', '화상2']);
    for (const l of wrapLines('이번 턴 뽑은 카드 1장당 모든 적 피해 2', 8)) expect(textEm(l)).toBeLessThanOrEqual(8);
  });

  it('카드 86장 + 강화 모두 전투 카드·HTML 카드 설명 칸에 들어간다', () => {
    const sizes: number[] = [];
    for (const c of CARDS) {
      for (const up of [false, true]) {
        const text = cardText(c.id, up);
        for (const box of [DESC_BOX.canvas, DESC_BOX.html]) {
          const f = fitDesc(text, box.w, box.h);
          expect(f.ok, `${c.name}${up ? '+' : ''}: ${text}`).toBe(true);
          expect(f.size).toBeGreaterThanOrEqual(MIN_SIZE);
          expect(f.lines.length * f.size * DESC_LINE).toBeLessThanOrEqual(box.h + 0.01);
          for (const l of f.lines) expect(textEm(l) * f.size).toBeLessThanOrEqual(box.w + 0.01);
          // 줄을 이으면 원래 글
          expect(f.lines.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
        }
        sizes.push(fitDesc(text, DESC_BOX.canvas.w, DESC_BOX.canvas.h).size);
      }
    }
    // 대부분은 큰 글자 그대로
    expect(sizes.filter((s) => s >= 10).length).toBeGreaterThan(sizes.length / 2);
    expect(DESC_SIZES[DESC_SIZES.length - 1]).toBeGreaterThanOrEqual(MIN_SIZE);
  });

  it('용의 숨결(모든 적 10, 화상2)은 줄여서 두 줄', () => {
    const f = fitDesc(cardText('dragonBreath'), DESC_BOX.canvas.w, DESC_BOX.canvas.h);
    expect(f.ok).toBe(true);
    expect(f.lines.length).toBeLessThanOrEqual(2);
  });
});
