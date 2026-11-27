/**
 * 털 색 바꾸기 (2026-11-27 결정: 흰 고양이 그림의 털 픽셀만 목표 색으로. 외곽선 · 눈 · 분홍 코/볼/귀/젤리는 그대로).
 * 순수 함수 — RGBA 픽셀 배열을 그 자리에서 바꾼다 (화면은 ui/catart.ts 가 canvas 로 읽어 부르고, 시험은 tests/recolor.test.ts).
 *
 *  1. 털 = 불투명하고 min(r,g,b) > 185 이고 r - b < 14 (밝고 푸른 기운 — 흰 털과 청회색 음영)
 *  2. 털 덩어리(이어진 영역) 중 작고 둘레가 거의 어두운 것은 눈의 반짝임이라 그대로 둔다
 *  3. 털: 목표 색 × (원래 색 ÷ 흰 털 색) — 음영이 그대로 남는다
 *  4. 털 바로 옆의 경계 픽셀(외곽선과 섞인 번짐)은 밝기로 털이 섞인 정도를 어림해 그만큼만 바꾼다 — 어두운 색에서 옅은 띠가 생기지 않게
 * 무늬(줄무늬 등)는 나중에 이 뒤에 겹쳐 그리는 층으로 붙인다 (ui/catart.ts 의 patternLayer 자리).
 */

/** 원본 흰 털의 대표 색 (art/spritecook/poses/assets.json 의 fur.white) */
export const FUR_WHITE: [number, number, number] = [243, 254, 255];
/** 이보다 작은 털 덩어리는 눈 반짝임 후보 (게임용 사본 ~400px 기준 넓이, px) */
const SMALL = 220;

const isFur = (r: number, g: number, b: number, a: number) => a > 200 && Math.min(r, g, b) > 185 && r - b < 14;

export function recolorFur(px: Uint8ClampedArray, w: number, h: number, rgb: readonly [number, number, number]): void {
  const n = w * h;
  const fur = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (isFur(px[o], px[o + 1], px[o + 2], px[o + 3])) fur[i] = 1;
  }
  // 2. 이어진 털 덩어리: 작고 둘레가 어두우면 (눈 속 반짝임) 털에서 뺀다
  const label = new Int32Array(n);
  const stack: number[] = [];
  const comp: number[] = [];
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (!fur[s] || label[s]) continue;
    id++;
    comp.length = 0;
    stack.push(s);
    label[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && fur[i - 1] && !label[i - 1]) (label[i - 1] = id), stack.push(i - 1);
      if (x < w - 1 && fur[i + 1] && !label[i + 1]) (label[i + 1] = id), stack.push(i + 1);
      if (y > 0 && fur[i - w] && !label[i - w]) (label[i - w] = id), stack.push(i - w);
      if (y < h - 1 && fur[i + w] && !label[i + w]) (label[i + w] = id), stack.push(i + w);
    }
    if (comp.length >= SMALL) continue;
    // 둘레 2px 의 픽셀 중 어두운 것의 비율
    let dark = 0;
    let all = 0;
    for (const i of comp) {
      const x = i % w;
      const y = (i - x) / w;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (label[j] === id) continue;
          all++;
          const o = j * 4;
          if (px[o + 3] > 128 && Math.max(px[o], px[o + 1], px[o + 2]) < 150) dark++;
        }
    }
    if (all > 0 && dark / all >= 0.7) for (const i of comp) fur[i] = 0;
  }
  // 3 · 4. 색 바꾸기 (경계는 털 옆 2px 안의 픽셀만)
  const near = (i: number) => {
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && fur[yy * w + xx]) return true;
      }
    return false;
  };
  const out = new Uint8ClampedArray(px);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = px[o];
    const g = px[o + 1];
    const b = px[o + 2];
    if (fur[i]) {
      out[o] = (rgb[0] * Math.min(1, r / FUR_WHITE[0]));
      out[o + 1] = (rgb[1] * Math.min(1, g / FUR_WHITE[1]));
      out[o + 2] = (rgb[2] * Math.min(1, b / FUR_WHITE[2]));
      continue;
    }
    if (px[o + 3] === 0 || !near(i)) continue;
    // 외곽선(진한 갈색 약 55)과 흰 털(약 245) 사이의 번짐: 밝기로 털이 섞인 정도 f
    const l = (r + g + b) / 3;
    const f = Math.max(0, Math.min(1, (l - 55) / 190));
    if (f <= 0) continue;
    // 분홍(코 · 볼 · 귀 · 젤리)과 섞인 번짐은 붉은 기운이 갈색 번짐보다 훨씬 세다 → 그대로
    if (r - b > 62 * (1 - f) + 25) continue;
    out[o] = r + f * (rgb[0] - FUR_WHITE[0]);
    out[o + 1] = g + f * (rgb[1] - FUR_WHITE[1]);
    out[o + 2] = b + f * (rgb[2] - FUR_WHITE[2]);
  }
  px.set(out);
}
