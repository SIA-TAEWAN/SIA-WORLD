import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOSS_IDS, LEADERS } from '../src/data/balance';
import { CALIB } from '../src/data/calib';
import { measureArrivals } from '../src/data/calibrate';
import { REGIONS, unlockedLeaders } from '../src/data/growth';
import { ENDLESS_SEG, STAGES, endlessSegment, stagesOf } from '../src/data/stages';

describe('스테이지 데이터', () => {
  it('12지역 × 5스테이지 = 60, 번호가 겹치지 않는다', () => {
    expect(STAGES).toHaveLength(60);
    expect(new Set(STAGES.map((s) => s.id)).size).toBe(60);
    for (let r = 1; r <= REGIONS; r++) expect(stagesOf(r).map((s) => s.no)).toEqual([1, 2, 3, 4, 5]);
  });

  it('5번째는 그 지역 보스, 나머지는 작은 대장', () => {
    for (const st of STAGES) expect(st.boss.kind).toBe(st.no === 5 ? BOSS_IDS[st.region - 1] : 'chief');
  });

  it('물건은 출발점과 보스 사이에 순서대로, 별 기준은 2개 < 3개', () => {
    for (const st of STAGES) {
      let last = 0;
      for (const it of st.items) {
        const z = it.t === 'rail' ? it.z0 : it.z;
        expect(z, st.id).toBeGreaterThan(last);
        expect(z, st.id).toBeLessThan(st.bossZ - 600);
        last = it.t === 'rail' ? it.z1 : it.z;
      }
      expect(st.stars[0]).toBeLessThan(st.stars[1]);
      expect(st.items.some((it) => it.t === 'gates')).toBe(true);
    }
  });

  it('보정 값(src/data/calib.ts)이 지금 스테이지와 맞다 (다르면 npm run calib)', () => {
    expect(measureArrivals()).toEqual(CALIB);
  }, 60_000);

  it('끝없는 모드 구간은 이어진다', () => {
    for (let k = 0; k < 6; k++) {
      const seg = endlessSegment(k);
      expect(seg.bossZ).toBe((k + 1) * ENDLESS_SEG);
      for (const it of seg.items) {
        const z = it.t === 'rail' ? it.z0 : it.z;
        expect(z).toBeGreaterThan(k * ENDLESS_SEG);
        expect(z).toBeLessThan(seg.bossZ);
      }
    }
  });

  it('대장: 처음 3종, 나머지는 지역 보스를 깨면 하나씩', () => {
    expect(unlockedLeaders(() => false)).toEqual(['rat', 'ox', 'tiger']);
    expect(unlockedLeaders((id) => id === '1-5')).toContain('rabbit');
    expect(unlockedLeaders(() => true)).toHaveLength(12);
  });

  it('고양이: 13번째 대장, 진행으로는 열리지 않는다', () => {
    expect(LEADERS).toHaveLength(13);
    expect(new Set(LEADERS.map((l) => l.id)).size).toBe(13);
    expect(LEADERS.filter((l) => l.extra).map((l) => l.id)).toEqual(['cat']);
    expect(unlockedLeaders(() => true)).not.toContain('cat');
  });

  it('대장 별명이 shared/zodiac.js · shared/characters.js 의 nick 과 같다 (DESIGN.md 6장)', () => {
    const shared = (f: string) => readFileSync(new URL(`../../../shared/${f}`, import.meta.url), 'utf8');
    const nicks = Object.fromEntries(
      [...(shared('zodiac.js') + shared('characters.js')).matchAll(/id: '(\w+)',\s*name: '[^']+',\s*nick: '([^']+)'/g)].map((m) => [m[1], m[2]]),
    );
    for (const l of LEADERS) expect(l.nick, l.id).toBe(nicks[l.id]);
  });
});
