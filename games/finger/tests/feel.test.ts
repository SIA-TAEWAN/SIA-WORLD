import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ART_FILES, ART_SLICE, SLICE_GAP, artFor, hasArt, type OptionalArt } from '../src/artlist';
import { BUZZ_GAP, CHAIN_MAX, chainRate, makeBuzzer } from '../src/ui/feel';

describe('튕김 소리 높이', () => {
  it('한 발사 안에서 이어질수록 높아지고, 두 옥타브에서 멈춘다', () => {
    expect(chainRate(1)).toBe(1);
    for (let n = 2; n <= CHAIN_MAX + 1; n++) expect(chainRate(n)).toBeGreaterThan(chainRate(n - 1));
    expect(chainRate(CHAIN_MAX + 1)).toBeCloseTo(4, 5);
    expect(chainRate(99)).toBe(chainRate(CHAIN_MAX + 1));
    expect(chainRate(0)).toBe(1);
  });
});

describe('진동', () => {
  it('vibrate 가 없으면(아이폰 사파리) 아무 일도 없다', () => {
    expect(makeBuzzer({})(20)).toBe(false);
    expect(makeBuzzer(undefined)(20)).toBe(false);
  });

  it('간격 안에서는 다시 울리지 않는다', () => {
    const calls: number[] = [];
    let t = 1000;
    const buzz = makeBuzzer({ vibrate: (ms) => (calls.push(ms as number), true) }, () => t);
    expect(buzz(20)).toBe(true);
    t += BUZZ_GAP - 1;
    expect(buzz(20)).toBe(false);
    t += 1;
    expect(buzz(500)).toBe(true);
    expect(calls).toEqual([20, 60]);
  });

  it('화면을 누르기 전이거나 vibrate 가 오류를 내도 넘어간다', () => {
    let n = 0;
    expect(makeBuzzer({ vibrate: () => (n++, true), userActivation: { hasBeenActive: false } })(20)).toBe(false);
    expect(n).toBe(0);
    expect(
      makeBuzzer({
        vibrate: () => {
          throw new Error('no');
        },
      })(20),
    ).toBe(false);
  });
});

describe('전용 그림 자리', () => {
  const ART = fileURLToPath(new URL('../public/art/', import.meta.url));

  it('ART_FILES 에 적은 그림은 public/art 에 파일이 있다 (없는 파일을 부르지 않는다)', () => {
    for (const n of ART_FILES) expect(existsSync(`${ART}${n}.png`), n).toBe(true);
    expect(new Set(ART_FILES).size).toBe(ART_FILES.length);
  });

  it('판은 목록에 있는 것 중 이번 판에 쓰는 것만 받는다', () => {
    const got = artFor(['rat', 'ox'], ['e-imp'], ['field']);
    for (const n of got) expect(hasArt(n)).toBe(true);
    expect(got).not.toContain('main');
    expect(got.some((n) => n.startsWith('bg-') || n.startsWith('ui-'))).toBe(false);
    expect(got.filter((n) => n.startsWith('wall-'))).toEqual(['wall-field']);
    expect(got.filter((n) => n.endsWith('-hit'))).toEqual(['e-imp-hit']);
    expect(got.filter((n) => n.startsWith('h-')).every((n) => n === 'h-rat' || n === 'h-ox')).toBe(true);
  });

  it('늘여 쓰는 그림 · spritecook-assets.json 모양', () => {
    // 9칸 그림 파일은 [모서리 b][틈][변 E][틈][모서리 b] 정사각형 (PNG 머리의 너비·높이)
    for (const [n, v] of Object.entries(ART_SLICE)) {
      const [b, E] = v!;
      expect(b, n).toBeGreaterThan(0);
      expect(E, n).toBeGreaterThan(0);
      if (!hasArt(n as OptionalArt)) continue;
      const png = readFileSync(`${ART}${n}.png`);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], n).toEqual([2 * b + E + 2 * SLICE_GAP, 2 * b + E + 2 * SLICE_GAP]);
    }
    const json = JSON.parse(readFileSync(fileURLToPath(new URL('../spritecook-assets.json', import.meta.url)), 'utf8')) as { note: string; assets: { asset_id: string; label: string }[] };
    expect(typeof json.note).toBe('string');
    expect(Array.isArray(json.assets)).toBe(true);
    // 목록에 넣은 전용 그림은 asset id 가 적혀 있어야 한다 (label 은 그림 이름으로 시작)
    for (const n of ART_FILES) expect(json.assets.some((a) => a.label.startsWith(`${n} `)), n).toBe(true);
  });
});
