import { describe, expect, it } from 'vitest';
import { PASSIVES } from '../src/data/passives';
import { UPGRADES } from '../src/data/upgrades';
import { WEAPONS } from '../src/data/weapons';
import { ICON_KEYS, icon } from '../src/ui/icons';

describe('아이콘', () => {
  it('무기 19종 · 패시브 8종 · 강화 9종에 모두 코드로 그린 아이콘이 있다', () => {
    for (const w of WEAPONS) expect(ICON_KEYS, w.id).toContain(`w-${w.id}`);
    for (const p of PASSIVES) expect(ICON_KEYS, p.id).toContain(`p-${p.id}`);
    for (const u of UPGRADES) expect(ICON_KEYS, u.id).toContain(`u-${u.id}`);
  });

  it('아이콘은 SVG 이고, 색은 테마 변수만 쓴다 (색 코드를 직접 쓰지 않는다)', () => {
    for (const key of ICON_KEYS) {
      const [kind, id] = [key[0] as 'w', key.slice(2)];
      const html = icon(kind, id);
      expect(html.startsWith('<svg class="ico"')).toBe(true);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}/);
      expect(html).toContain('var(--outline)');
    }
    // 모르는 이름은 물음표 그림
    expect(icon('w', 'nope')).toBe(icon('x', 'unknown'));
  });
});
