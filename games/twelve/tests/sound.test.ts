import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEROES } from '../src/data/heroes';
import { WEAPONS } from '../src/data/weapons';

describe('소리 (shared/sound.js)', () => {
  it('무기·고유 스킬·화면이 내는 소리 이름이 공용 소리 목록에 있다', async () => {
    const mod = (await import(/* @vite-ignore */ new URL('../../../shared/sound.js', import.meta.url).href)) as { SOUNDS: Record<string, number[]>; _buildSamples(name: string): number[] };
    const names = new Set<string>();
    for (const w of Object.values(WEAPONS)) for (const sk of [w.basic, ...w.skills]) names.add(sk.sound);
    for (const h of Object.values(HEROES)) names.add(h.unique.sound);
    // 화면 코드가 이름으로 부르는 소리: sfx('…') · play('…') · sound: '…'
    for (const f of ['../src/scenes/GameScene.ts', '../src/ui/app.ts', '../src/game/sim.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      for (const m of src.matchAll(/(?:sfx|play)\('([A-Za-z]+)'|name: '([A-Za-z]+)' \}\)/g)) names.add(m[1] ?? m[2]);
    }
    for (const n of names) expect(mod.SOUNDS[n], n).toBeDefined();
    for (const n of ['twelveSlash', 'twelveBow', 'twelveMagic', 'twelveHurt', 'twelveRare', 'twelveLevel']) {
      expect(names.has(n), n).toBe(true);
      const b = mod._buildSamples(n);
      expect(b.length).toBeGreaterThan(2000);
      expect(b.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});
