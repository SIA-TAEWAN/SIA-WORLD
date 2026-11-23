import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSSES, FINAL_BOSS } from '../src/data/bosses';
import { ALL_MAPS } from '../src/data/maps';
import { ART_FILES, artFor, floorArt, floorOf } from '../src/scenes/art';

const file = (name: string) => new URL(`../public/art/${name}.png`, import.meta.url);

describe('그림 목록', () => {
  it('ART_FILES 에 적은 이름마다 파일이 있고 asset id 가 적혀 있다', () => {
    const manifest = JSON.parse(readFileSync(new URL('../spritecook-assets.json', import.meta.url), 'utf8')) as { assets: { asset_id: string; sha12: string; label: string }[] };
    for (const name of ART_FILES) {
      expect(existsSync(file(name)), name).toBe(true);
      const row = manifest.assets.find((a) => a.label.startsWith(`${name} `));
      expect(row?.asset_id, name).toMatch(/^[0-9a-f-]{36}$/);
      expect(row?.sha12, name).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it('맵이 받는 그림은 모두 파일이 있다 (지형 바닥은 지형마다 하나만)', () => {
    for (const m of ALL_MAPS) {
      const names = artFor(m);
      for (const n of names) expect(existsSync(file(n)), `${m.id} ${n}`).toBe(true);
      expect(names).toContain(floorArt(m.region));
      expect(names.filter((n) => n.startsWith('floor-') || n.startsWith('tile-'))).toHaveLength(1);
    }
    expect(floorOf(3)).toEqual({ key: 'floor-r03', size: 320, alpha: 1 });
  });

  it('최종보스는 전용 그림을 쓴다', () => {
    expect(BOSSES[FINAL_BOSS].art).toBe('b-final');
    expect(ART_FILES).toContain('b-final');
  });
});
