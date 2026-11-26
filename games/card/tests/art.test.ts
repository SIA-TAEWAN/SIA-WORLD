import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ART_FILES, BOSS_ARTS, HERO_IDS, fxForCard } from '../src/art';
import { CARDS, ENEMIES, EVENTS, HEROES, POTIONS, RELICS, REGIONS, cardOps } from '../src/game/rules';

const files = readdirSync(new URL('../public/art/', import.meta.url))
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''));

describe('그림 목록 (art.ts ART_FILES)', () => {
  it('ART_FILES 와 public/art 폴더가 같다 (없는 이름을 받지 않고, 안 쓰는 파일을 두지 않는다)', () => {
    expect([...ART_FILES].sort()).toEqual([...files].sort());
  });

  it('데이터의 그림 이름은 다 있다 (카드 · 부적 · 물약 · 요괴 · 이야기 · 지역)', () => {
    const names = [
      ...CARDS.map((c) => c.art),
      ...RELICS.map((r) => r.art),
      ...POTIONS.map((p) => p.art),
      ...ENEMIES.map((e) => e.art),
      ...EVENTS.map((e) => e.art),
      ...REGIONS.flatMap((r) => [r.tile, r.bg]),
    ];
    for (const n of names) expect(ART_FILES.has(n), n).toBe(true);
  });

  it('영웅 13명 시트·컷인·아이콘, 보스 12종 그림·공격 동작·맞은 모습', () => {
    expect(HEROES.map((h) => h.id).sort()).toEqual([...HERO_IDS].sort());
    for (const h of HERO_IDS) for (const k of [`hero-${h}`, `cut-${h}`, `ic-u-${h}`]) expect(ART_FILES.has(k), k).toBe(true);
    for (const b of BOSS_ARTS) for (const k of [`b-${b}`, `b-${b}-atk`, `b-${b}-hit`]) expect(ART_FILES.has(k), k).toBe(true);
    for (const e of ENEMIES.filter((x) => x.boss)) expect([...BOSS_ARTS.map((b) => `b-${b}`), 'b-final']).toContain(e.art);
    for (const k of ['b-final', 'b-final-atk']) expect(ART_FILES.has(k), k).toBe(true);
  });

  it('카드를 쓸 때의 효과 그림도 다 있다', () => {
    for (const c of CARDS) expect(ART_FILES.has(fxForCard(c.art, cardOps(c.id))), c.id).toBe(true);
  });
});
