import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CALIB } from '../src/data/calib';
import { REGIONS } from '../src/data/regions';
import { GEN_REGIONS, allLayouts, generatedSource } from '../src/data/stagegen';
import { BOSSES, BOSS_IDS, ENEMIES, PORTAL_R, ROOM_H, ROOM_W, STAGES, buildConfig, chiefDef, stagesOf, type FoeSpec, type StageDef } from '../src/sim';

/** 60스테이지 데이터 (1지역 손으로 + 2~12지역 생성) */
const GEN_FILE = new URL('../../../supabase/functions/_shared/finger/stages-gen.ts', import.meta.url);

const radiusOf = (st: StageDef, f: FoeSpec) => (f.k === 'boss' ? BOSSES[BOSS_IDS[st.region - 1]].r : f.k === 'chief' ? chiefDef(st.region).r : ENEMIES[f.k].r);

describe('60스테이지', () => {
  it('id 는 1-1 ~ 12-5, 지역마다 5개 (준비 중인 지역 없음)', () => {
    const want = Array.from({ length: REGIONS * 5 }, (_, i) => `${Math.floor(i / 5) + 1}-${(i % 5) + 1}`);
    expect(STAGES.map((s) => s.id)).toEqual(want);
    for (let r = 1; r <= REGIONS; r++) expect(stagesOf(r).map((s) => s.no)).toEqual([1, 2, 3, 4, 5]);
  });

  it.each(STAGES.map((s) => [s.id, s] as const))('%s: 웨이브 3개 · 마지막은 작은 대장(1~4) 또는 지역 보스(5) · 이름 · 추천 타입 · par', (_, st) => {
    expect(st.waves.length).toBe(3);
    expect(st.name.length).toBeGreaterThan(0);
    expect(['reflect', 'pierce']).toContain(st.tip);
    expect(st.par).toBeGreaterThanOrEqual(12);
    expect(st.par).toBeLessThanOrEqual(30);
    const heads = st.waves[2].filter((f) => f.k === 'chief' || f.k === 'boss').map((f) => f.k);
    expect(heads).toEqual([st.no === 5 ? 'boss' : 'chief']);
    for (const w of st.waves.slice(0, 2)) {
      expect(w.length).toBeGreaterThanOrEqual(2);
      for (const f of w) expect(f.k === 'boss' || f.k === 'chief').toBe(false);
    }
    // 판 설정이 만들어진다 (서버 finger-finish 와 같은 길)
    const cfg = buildConfig({ stage: st.id, party: ['rat'] });
    expect(cfg.waves.flat().every((f) => f.hp > 0 && f.atk > 0)).toBe(true);
  });

  it.each(STAGES.filter((s) => s.region > 1).map((s) => [s.id, s] as const))('%s: 요괴는 방 안 · 서로와 장애물에 겹치지 않음 · 장애물은 대원 출발 줄과 떨어짐', (_, st) => {
    for (const w of st.waves) {
      w.forEach((f, i) => {
        const r = radiusOf(st, f);
        expect(f.x - r).toBeGreaterThan(0);
        expect(f.x + r).toBeLessThan(ROOM_W);
        expect(f.y - r).toBeGreaterThan(0);
        expect(f.y + r).toBeLessThan(700);
        for (const g of w.slice(i + 1)) expect(Math.hypot(f.x - g.x, f.y - g.y)).toBeGreaterThan(r + radiusOf(st, g));
        for (const [px, py, pr] of st.pillars ?? []) expect(Math.hypot(f.x - px, f.y - py)).toBeGreaterThan(r + pr);
        for (const [bx, by, bw, bh] of st.blocks ?? []) {
          const cx = Math.max(bx, Math.min(bx + bw, f.x));
          const cy = Math.max(by, Math.min(by + bh, f.y));
          expect(Math.hypot(f.x - cx, f.y - cy)).toBeGreaterThan(r);
        }
        for (const p of st.portals ?? [])
          for (const [px, py] of [
            [p[0], p[1]],
            [p[2], p[3]],
          ])
            expect(Math.hypot(f.x - px, f.y - py)).toBeGreaterThan(r + PORTAL_R);
      });
    }
    for (const [, py, pr] of st.pillars ?? []) expect(py + pr).toBeLessThan(820);
    for (const [, by, , bh] of st.blocks ?? []) expect(by + bh).toBeLessThan(820);
    for (const z of st.zones ?? []) {
      expect(z.x).toBeGreaterThanOrEqual(0);
      expect(z.x + z.w).toBeLessThanOrEqual(ROOM_W);
      expect(z.y + z.h).toBeLessThan(820);
    }
    for (const p of st.portals ?? []) for (const v of p) expect(v).toBeGreaterThan(PORTAL_R);
    for (const p of st.portals ?? []) expect(Math.max(p[1], p[3])).toBeLessThan(ROOM_H - 120);
  });

  it('장애물: 지역이 올라갈수록 늘고, 가시밭 3지역 · 빨래판 4지역 · 순간이동 5지역부터', () => {
    const count = (r: number) =>
      stagesOf(r).reduce((a, s) => a + (s.blocks?.length ?? 0) + (s.pillars?.length ?? 0) + (s.zones?.length ?? 0) + (s.portals?.length ?? 0), 0);
    const counts = Array.from({ length: REGIONS }, (_, i) => count(i + 1));
    expect(counts[11]).toBeGreaterThan(counts[1] * 2);
    for (let r = 3; r <= REGIONS; r++) expect(counts[r - 1], `지역 ${r}`).toBeGreaterThanOrEqual(counts[r - 3]);
    const has = (r: number, f: (s: StageDef) => boolean) => stagesOf(r).some(f);
    for (let r = 2; r <= REGIONS; r++) {
      expect(has(r, (s) => !!(s.zones ?? []).find((z) => z.k === 'thorn'))).toBe(r >= 3);
      expect(has(r, (s) => !!(s.zones ?? []).find((z) => z.k === 'board'))).toBe(r >= 4);
      expect(has(r, (s) => !!s.portals?.length)).toBe(r >= 5);
    }
  });

  it('지역 요괴는 돌격대와 같은 지도: 새 요괴가 그 지역부터 나온다', () => {
    const first: Record<string, number> = {};
    for (const st of STAGES) for (const w of st.waves) for (const f of w) if (f.k !== 'boss' && f.k !== 'chief') first[f.k] ??= st.region;
    expect(first).toMatchObject({ imp: 1, wisp: 1, club: 1, water: 3, fox: 4, bamboo: 5, guard: 7, skeleton: 10, spirit: 11 });
  });

  it('추천 타입이 한쪽으로 쏠리지 않는다', () => {
    const reflect = STAGES.filter((s) => s.tip === 'reflect').length;
    expect(reflect).toBeGreaterThan(18);
    expect(reflect).toBeLessThan(42);
  });
});

describe('생성 파일 (scripts/gen-stages.ts)', () => {
  it('보정 값(calib.ts)이 55스테이지 모두에 있다', () => {
    expect(Object.keys(CALIB).sort()).toEqual(allLayouts().map((l) => l.id).sort());
    expect(GEN_REGIONS).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('stages-gen.ts 가 최신이다 (다시 만들어도 바뀌지 않음 — 다르면 npm run gen)', () => {
    const now = readFileSync(GEN_FILE, 'utf8').replace(/\r\n/g, '\n');
    expect(now).toBe(generatedSource(CALIB));
    expect(generatedSource(CALIB)).toBe(generatedSource(CALIB));
  });
});
