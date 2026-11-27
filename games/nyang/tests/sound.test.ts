import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('소리 (shared/sound.js)', () => {
  it('화면이 부르는 소리 이름이 모두 공용 소리 목록에 있고, PRD 11장 효과음이 다 있다', async () => {
    const mod = (await import(/* @vite-ignore */ new URL('../../../shared/sound.js', import.meta.url).href)) as { SOUNDS: Record<string, number[]>; _buildSamples(name: string): number[] };
    const names = new Set<string>();
    const dir = new URL('../src/ui/', import.meta.url);
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      for (const m of src.matchAll(/sfx\('([A-Za-z]+)'/g)) names.add(m[1]);
    }
    for (const n of names) expect(mod.SOUNDS[n], n).toBeDefined();
    // 사료 붓기 · 물 · 모래 퍼내기 · 골골송 · 야옹 · 츄르 핥기 · 낚싯대 · 물뿌리개 · 수확 · 엽전
    for (const n of ['nyangPour', 'nyangWater', 'nyangScoop', 'nyangPurr', 'nyangMeow', 'nyangLick', 'nyangSwish', 'nyangSprinkle', 'nyangHarvest', 'nyangCoin']) {
      expect(names.has(n), n).toBe(true);
      const b = mod._buildSamples(n);
      expect(b.length).toBeGreaterThan(1000);
      expect(b.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});
