/**
 * 카드 설명 글자 맞추기: 설명 칸(너비 w × 높이 h, px)에 들어가는 가장 큰 글자 크기와 줄을 고른다.
 * 글자 폭은 Jua 글꼴 기준 어림값(조금 넉넉하게)으로 재고, 줄은 빈칸에서만 나눈다(한국어 단어를 자르지 않음, 너무 긴 낱말만 글자 단위).
 * 전투 캔버스(BattleScene.cardView)와 HTML 카드(cards.ts) 둘 다 이 값으로 시작하고, 화면에서 실제로 넘치면 더 줄인다.
 * tests/fit.test.ts 가 카드 86장(+강화)의 설명이 두 칸 모두에 들어가는지 본다.
 */

/** 설명 칸 안쪽 크기 (px): 전투 카드(100×139, 틀의 흰 칸에서 여백 뺌) · HTML 카드(104×145, .gc-text 의 안쪽) */
export const DESC_BOX = {
  canvas: { w: 78, h: 31 },
  html: { w: 78, h: 31 },
} as const;
/** 큰 것부터 써 보는 글자 크기 */
/** 가장 작은 글자 9px (11-26 사용자 확정: 긴 설명은 짧게 고쳐 9px 안에 들어가게 — tests/fit.test.ts) */
export const DESC_MIN = 9;
export const DESC_SIZES = [11, 10.5, 10, 9.5, 9] as const;
/** 줄 높이 (글자 크기 배) */
export const DESC_LINE = 1.12;

/** 글자 하나의 폭 (em) */
export function charEm(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (ch === ' ') return 0.3;
  if (/[,.'·:]/.test(ch)) return 0.3;
  if (/[()[\]]/.test(ch)) return 0.4;
  if (/[0-9]/.test(ch)) return 0.6;
  if (/[a-zA-Z+\-×%]/.test(ch)) return 0.65;
  // 한글·한자·그 밖
  if (c >= 0x1100) return 1.0;
  return 0.7;
}
export const textEm = (s: string) => [...s].reduce((n, ch) => n + charEm(ch), 0);

/** maxEm 너비로 줄 나누기 (빈칸에서, 너무 긴 낱말은 글자 단위) */
export function wrapLines(text: string, maxEm: number): string[] {
  const lines: string[] = [];
  let cur = '';
  const push = () => {
    if (cur) lines.push(cur);
    cur = '';
  };
  for (const word of text.split(' ')) {
    const tryLine = cur ? `${cur} ${word}` : word;
    if (textEm(tryLine) <= maxEm) {
      cur = tryLine;
      continue;
    }
    push();
    if (textEm(word) <= maxEm) {
      cur = word;
      continue;
    }
    // 긴 낱말: 글자 단위로
    for (const ch of word) {
      if (textEm(cur + ch) > maxEm) push();
      cur += ch;
    }
  }
  push();
  return lines;
}

export interface Fit {
  size: number;
  lines: string[];
  /** 가장 작은 크기로도 넘치면 false */
  ok: boolean;
}

/** 설명 칸에 들어가는 가장 큰 글자 크기 */
export function fitDesc(text: string, w: number, h: number, sizes: readonly number[] = DESC_SIZES, line = DESC_LINE): Fit {
  let last: Fit | null = null;
  for (const size of sizes) {
    const lines = wrapLines(text, w / size);
    const fits = lines.length * size * line <= h + 0.01 && lines.every((l) => textEm(l) * size <= w + 0.01);
    last = { size, lines, ok: fits };
    if (fits) return last;
  }
  return last!;
}

/** HTML 안의 설명 글자가 칸을 넘치면 글자를 줄인다 (어림값이 실제 글꼴과 다를 때를 위한 마지막 안전장치) */
export function shrinkOverflow(root: ParentNode, sel = '.gc-text', min = DESC_MIN - 1) {
  root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
    let size = parseFloat(getComputedStyle(el).fontSize) || 10;
    for (let k = 0; k < 10 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && size > min; k++) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  });
}
