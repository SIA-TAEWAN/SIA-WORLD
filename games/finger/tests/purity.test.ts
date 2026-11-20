import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 판 시뮬레이션(supabase/functions/_shared/finger)은 서버(Deno)와 아이폰 Safari 에서 비트 단위로 같아야 한다.
 * 엔진마다 다를 수 있는 함수 · 무작위 · 시계 · DOM 을 쓰지 않는지 소스를 읽어 확인한다.
 */
const DIR = fileURLToPath(new URL('../../../supabase/functions/_shared/finger/', import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

/** 주석을 지운 소스 */
const code = (f: string) =>
  readFileSync(DIR + f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('시뮬레이션 소스 검사', () => {
  it('파일이 있다', () => {
    expect(files).toContain('sim.ts');
    expect(files).toContain('math.ts');
  });

  it.each(files)('%s: 금지 함수가 없다', (f) => {
    const src = code(f);
    const banned = [
      /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|hypot|pow|exp|expm1|log|log2|log10|log1p|cbrt|random|fround)\b/,
      /\*\*/,
      /\bDate\b/,
      /\bperformance\b/,
      /\bcrypto\b/,
      /\b(window|document|navigator|localStorage)\b/,
      /\bDeno\b|\bprocess\./,
    ];
    for (const re of banned) expect(src, `${f}: ${re}`).not.toMatch(re);
  });

  it.each(files)('%s: 상대 경로 .ts import 만 쓴다 (Deno 규칙)', (f) => {
    const src = code(f);
    for (const m of src.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g)) {
      expect(m[1], `${f}: ${m[1]}`).toMatch(/^\.\/[\w-]+\.ts$/);
    }
  });

  it('_shared/finger 안에 테스트 파일이 없다 (games 패키지 vitest 가 집어 간다)', () => {
    expect(readdirSync(DIR).filter((f) => f.endsWith('.test.ts'))).toEqual([]);
  });
});
