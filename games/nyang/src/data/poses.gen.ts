// art/build.py 가 만든다 — 고치지 말 것. 자세 그림(public/art/cat/<자세>.png)의 크기와 발 바닥 기준점 (px)
export const POSE_ART = {
  'sit': { w: 381, h: 381, fx: 191, fy: 374, anchor: 'feet' },
  'sit-blink': { w: 381, h: 381, fx: 191, fy: 374, anchor: 'feet' },
  'walk-1': { w: 410, h: 410, fx: 199, fy: 386, anchor: 'feet' },
  'walk-2': { w: 412, h: 412, fx: 199, fy: 388, anchor: 'feet' },
  'loaf': { w: 355, h: 355, fx: 199, fy: 348, anchor: 'body' },
  'sleep': { w: 390, h: 390, fx: 213, fy: 359, anchor: 'body' },
  'eat': { w: 508, h: 508, fx: 255, fy: 407, anchor: 'feet' },
  'stretch': { w: 415, h: 415, fx: 224, fy: 378, anchor: 'body' },
  'pounce': { w: 391, h: 391, fx: 206, fy: 384, anchor: 'body' },
  'jump': { w: 447, h: 447, fx: 232, fy: 439, anchor: 'air' },
  'beg': { w: 401, h: 401, fx: 188, fy: 395, anchor: 'feet' },
  'knead': { w: 392, h: 392, fx: 205, fy: 384, anchor: 'feet' },
  'belly': { w: 488, h: 488, fx: 299, fy: 426, anchor: 'body' },
} as const;
