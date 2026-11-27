"""SpriteCook 원본 시트(art/spritecook/*.webp) → 게임이 쓰는 그림(public/art/*.png).

쓰는 법 (games/ace 에서):  python art/build.py
- 시트 한 장에 여러 그림이 빈 틈을 두고 놓여 있다. 투명한 줄(가로) → 투명한 칸(세로) 순서로
  가장 넓은 빈 틈을 골라 나누고, 각 그림의 투명 여백을 잘라 낸 뒤 BOX(너비, 높이) 안에 맞춰 줄인다.
- 원본은 저장소 용량 때문에 2048×2048 WebP(품질 95, 알파 그대로)로 바꿔 둔 것이다.
  처음 받은 PNG 가 필요하면 spritecook-assets.json 의 asset id 로 SpriteCook 에서 다시 받는다.
- 끝에 art/preview.png (밝은 바탕 + 파일 이름, 보스에는 boss-parts.json 의 부위 점)를 만든다.
"""
import json
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'spritecook')
OUT = os.path.join(HERE, '..', 'public', 'art')
ALPHA = 24      # 이보다 옅은 알파는 빈 곳으로 본다

# 시트 → (줄마다의 그림 이름, (최대 너비, 최대 높이))
SHEETS = {
    'ships-a': ([['ship-rat', 'ship-ox'], ['ship-tiger', 'ship-rabbit']], (200, 230)),
    'ships-b': ([['ship-dragon', 'ship-snake'], ['ship-horse', 'ship-sheep']], (200, 230)),
    'ships-c': ([['ship-monkey', 'ship-rooster', 'ship-dog'], ['ship-pig', 'ship-cat']], (200, 230)),
    'boss-1-2': ([['boss-1', 'boss-2']], (480, 620)),
    'boss-3-5': ([['boss-3', 'boss-5']], (480, 620)),
    'boss-7-8': ([['boss-7', 'boss-8']], (480, 620)),
    'boss-9-10': ([['boss-9', 'boss-10']], (480, 620)),
    'boss-11-12': ([['boss-11', 'boss-12']], (480, 620)),
    'ground': ([['ground-bamboo', 'ground-sandtank', 'ground-gunboat'],
                ['ground-harbor', 'ground-ice', 'ground-ruin'],
                ['ground-lava', 'ground-swamp', 'ground-castle']], (120, 132)),
    'items': ([['item-p', 'item-b', 'item-coin'],
               ['item-coinbig', 'item-option', 'item-life'],
               ['item-clock', 'item-shield', 'item-star']], (64, 64)),
}
# 칸보다 작게 둘 것 (작은 엽전 < 큰 엽전)
SCALE = {'item-coin': 0.82}


def spans(filled, n):
    """filled(1차원 bool)를 가장 넓은 빈 틈 n-1 개로 나눈 (시작, 끝) n 개."""
    idx = np.flatnonzero(filled)
    lo, hi = int(idx[0]), int(idx[-1]) + 1
    gaps, start = [], None
    for i in range(lo, hi):
        if not filled[i]:
            start = i if start is None else start
        elif start is not None:
            gaps.append((i - start, start, i))
            start = None
    cuts = sorted((g[1] + g[2]) // 2 for g in sorted(gaps, reverse=True)[:n - 1])
    if len(cuts) != n - 1:
        raise SystemExit(f'빈 틈이 모자란다: {n} 개로 나눌 수 없음')
    edges = [lo] + cuts + [hi]
    return list(zip(edges[:-1], edges[1:]))


def shrink(im, box, k=1.0):
    """알파를 곱한 채로 줄여 가장자리에 밝은 테가 생기지 않게 한다."""
    s = min(box[0] / im.width, box[1] / im.height, 1.0) * k
    size = (max(1, round(im.width * s)), max(1, round(im.height * s)))
    a = np.asarray(im, dtype=np.float32) / 255.0
    a[..., :3] *= a[..., 3:4]
    small = np.asarray(Image.fromarray((a * 255).round().astype(np.uint8), 'RGBa').resize(size, Image.LANCZOS),
                       dtype=np.float32)
    alpha = small[..., 3:4]
    rgb = np.where(alpha > 0, small[..., :3] * 255.0 / np.maximum(alpha, 1), 0)
    out = np.concatenate([rgb, alpha], axis=-1).clip(0, 255).round().astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def build():
    os.makedirs(OUT, exist_ok=True)
    made = []
    for sheet, (rows, box) in SHEETS.items():
        im = Image.open(os.path.join(SRC, sheet + '.webp')).convert('RGBA')
        mask = np.asarray(im)[..., 3] > ALPHA
        for (y0, y1), names in zip(spans(mask.any(axis=1), len(rows)), rows):
            for (x0, x1), name in zip(spans(mask[y0:y1].any(axis=0), len(names)), names):
                cell = mask[y0:y1, x0:x1]
                ys, xs = np.flatnonzero(cell.any(axis=1)), np.flatnonzero(cell.any(axis=0))
                crop = im.crop((x0 + int(xs[0]), y0 + int(ys[0]), x0 + int(xs[-1]) + 1, y0 + int(ys[-1]) + 1))
                out = shrink(crop, box, SCALE.get(name, 1.0))
                out.save(os.path.join(OUT, name + '.png'), optimize=True)
                made.append(name)
                print(f'{name}.png  {out.width}x{out.height}  (원본 {crop.width}x{crop.height})')
    return made


def font(size):
    try:
        return ImageFont.truetype('malgun.ttf', size)
    except OSError:
        return ImageFont.load_default()


def preview(names):
    with open(os.path.join(HERE, 'boss-parts.json'), encoding='utf-8') as f:
        parts = json.load(f) if os.path.getsize(f.name) else {}
    groups = [[n for n in names if n.startswith(p)] for p in ('ship-', 'boss-', 'ground-', 'item-')]
    cols = {0: 7, 1: 3, 2: 9, 3: 9}
    pad, label, width = 16, 22, 1640
    rows = []
    for gi, g in enumerate(groups):
        for i in range(0, len(g), cols[gi]):
            rows.append([(n, Image.open(os.path.join(OUT, n + '.png'))) for n in g[i:i + cols[gi]]])
    height = pad + sum(max(im.height for _, im in r) + label + pad for r in rows)
    sheet = Image.new('RGB', (width, height), '#FFF6E0')
    d = ImageDraw.Draw(sheet)
    y = pad
    for r in rows:
        rh = max(im.height for _, im in r)
        cw = (width - pad) // len(r)
        for i, (n, im) in enumerate(r):
            x = pad + i * cw + (cw - pad - im.width) // 2
            # 투명한 곳이 보이도록 체크 무늬 대신 옅은 하늘색 칸
            d.rectangle((pad + i * cw, y, pad + (i + 1) * cw - pad, y + rh), fill='#CFE9F7')
            sheet.paste(im, (x, y + (rh - im.height) // 2), im)
            for p in parts.get(n, []):
                px, py = x + p['x'] * im.width, y + (rh - im.height) // 2 + p['y'] * im.height
                d.ellipse((px - 9, py - 9, px + 9, py + 9), outline='#FF2D6F', width=3)
            d.text((pad + i * cw, y + rh + 2), f'{n}.png {im.width}x{im.height}', fill='#2A1A10', font=font(12))
        y += rh + label + pad
    sheet.save(os.path.join(HERE, 'preview.png'))
    print('preview.png', sheet.size)


if __name__ == '__main__':
    if not os.path.exists(os.path.join(HERE, 'boss-parts.json')):
        open(os.path.join(HERE, 'boss-parts.json'), 'w').close()
    preview(build())
