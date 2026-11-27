import { describe, expect, it } from 'vitest';
import { recolorFur } from '../src/game/recolor';

/** w × h 그림: 모두 흰 털, 가운데 사각형은 갈색 외곽선(눈), 그 안 2×2 는 흰 반짝임, 오른쪽 아래 분홍 */
function make(w = 40, h = 40) {
  const px = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, c: number[]) => px.set(c, (y * w + x) * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, [243, 254, 255, 255]);
  for (let y = 10; y < 18; y++) for (let x = 10; x < 18; x++) set(x, y, [65, 29, 3, 255]);
  for (let y = 13; y < 15; y++) for (let x = 13; x < 15; x++) set(x, y, [250, 255, 255, 255]);
  for (let y = 30; y < 36; y++) for (let x = 30; x < 36; x++) set(x, y, [255, 190, 188, 255]);
  set(0, 39, [0, 0, 0, 0]);
  return { px, at: (x: number, y: number) => [...px.slice((y * w + x) * 4, (y * w + x) * 4 + 4)] };
}

describe('털 색 바꾸기', () => {
  it('털만 목표 색, 외곽선 · 눈 반짝임 · 분홍 · 투명은 그대로', () => {
    const { px, at } = make();
    recolorFur(px, 40, 40, [92, 90, 104]);
    expect(at(2, 2)).toEqual([92, 90, 104, 255]);
    expect(at(11, 11)).toEqual([65, 29, 3, 255]);
    expect(at(13, 13)).toEqual([250, 255, 255, 255]);
    expect(at(32, 32)).toEqual([255, 190, 188, 255]);
    expect(at(0, 39)).toEqual([0, 0, 0, 0]);
  });
  it('음영은 밝기 비율을 따른다', () => {
    const { px, at } = make();
    px.set([213, 222, 231, 255], (5 * 40 + 5) * 4);
    recolorFur(px, 40, 40, [255, 186, 102]);
    const [r, g, b] = at(5, 5);
    expect(r).toBeCloseTo((255 * 213) / 243, -1);
    expect(g).toBeLessThan(186);
    expect(b).toBeLessThan(102);
  });
});
