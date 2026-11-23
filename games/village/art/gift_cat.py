"""고양이 선물 장식물 '야옹이의 금관 방석' 을 손으로 그린다 (SpriteCook 그림이 아니다).

  python art/gift_cat.py     → public/art/b-gift_cat-1.png (192×272)

- 돌 받침은 다른 선물과 똑같이 보이도록 b-gift_dragon-1.png 의 받침을 빌린다 (여의주와 구름 받침은 지우고 방석으로 덮는다).
- 방석 · 금관은 4배 크기로 그린 뒤 LANCZOS 로 줄인다.
- SpriteCook 크레딧을 채우면 다른 선물과 같은 방법(build.py 의 giftA · giftB)으로 다시 그릴 예정.
"""
import math
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'art')
K = 4                      # 크게 그리는 배율
W, H = 192, 272
LINE = (46, 22, 8, 255)    # 굵은 갈색 외곽선
LW = 2.9                   # 외곽선 굵기 (1배 기준)

PURPLE = (128, 82, 170, 255)
PURPLE_D = (93, 56, 132, 255)
PURPLE_L = (166, 122, 204, 255)
GOLD = (244, 199, 92, 255)
GOLD_D = (207, 150, 70, 255)
GOLD_L = (255, 232, 156, 255)
GEM = (150, 88, 208, 255)
GEM_L = (214, 176, 246, 255)
RED = (228, 68, 64, 255)


def P(pts):
    return [(x * K, y * K) for x, y in pts]


def new_mask():
    return Image.new('L', (W * K, H * K), 0)


def grow(mask, r):
    """모양을 r(1배 기준)만큼 부풀린다"""
    size = int(r * K) * 2 + 1
    return mask.filter(ImageFilter.MaxFilter(size))


def paint(canvas, mask, color):
    canvas.paste(Image.new('RGBA', canvas.size, color), (0, 0), mask)


def solid(canvas, mask, fill, line=True):
    """외곽선을 두른 한 덩어리"""
    if line:
        paint(canvas, grow(mask, LW), LINE)
    paint(canvas, mask, fill)


def clip(a, b):
    return ImageChops.multiply(a, b)


def poly(pts):
    m = new_mask()
    ImageDraw.Draw(m).polygon(P(pts), fill=255)
    return m


def ellipse(cx, cy, rx, ry):
    m = new_mask()
    ImageDraw.Draw(m).ellipse([(cx - rx) * K, (cy - ry) * K, (cx + rx) * K, (cy + ry) * K], fill=255)
    return m


def stroke(pts, width):
    m = new_mask()
    d = ImageDraw.Draw(m)
    d.line(P(pts), fill=255, width=int(width * K), joint='curve')
    r = width * K / 2
    for x, y in (P(pts)[0], P(pts)[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    return m


def pillow(cx, cy, rx, ry, n=2.7, pinch=0.1):
    """통통한 방석: 모서리가 살짝 뾰족한 둥근 네모"""
    pts = []
    for i in range(240):
        t = 2 * math.pi * i / 240
        c, s = math.cos(t), math.sin(t)
        x = abs(c) ** (2 / n) * (1 if c >= 0 else -1)
        y = abs(s) ** (2 / n) * (1 if s >= 0 else -1)
        k = 1 + pinch * (abs(math.sin(2 * t)) ** 3)      # 네 모서리를 조금 잡아당긴다
        pts.append((cx + x * rx * k, cy + y * ry * k))
    return pts


def base():
    """다른 선물과 같은 돌 받침 (여의주 그림에서 빌린다)"""
    im = Image.open(os.path.join(OUT, 'b-gift_dragon-1.png')).convert('RGBA')
    px = im.load()
    for y in range(0, 184):
        for x in range(W):
            if 40 < x < 160:
                px[x, y] = (0, 0, 0, 0)
    # 구름 받침이 가리던 자리: 뒤쪽 돌 줄은 왼쪽 끝의 한 줄을 옆으로 늘이고, 모래 바닥은 한 가지 색으로 메운다
    for y in range(183, 194):
        for x in range(49, 152):
            px[x, y] = px[48, y]
    for jx in (72, 98, 124):           # 돌 사이 금
        for y in range(185, 193):
            px[jx, y] = LINE
    for y in range(194, 223):
        for x in range(46, 151):
            px[x, y] = (176, 160, 135, 255)
    return im


def tassel(canvas, x, y, lean):
    """금빛 술: 매듭 구슬 + 아래로 늘어진 술"""
    body = poly([(x - 3.2, y + 3), (x + 3.2, y + 3), (x + 5 + lean, y + 19), (x - 5 + lean, y + 19)])
    solid(canvas, body, GOLD)
    paint(canvas, clip(body, poly([(x + 0.5, y), (x + 8, y), (x + 9 + lean, y + 22), (x + 1.5 + lean, y + 22)])), GOLD_D)
    for dx in (-1.6, 1.4):
        paint(canvas, clip(body, stroke([(x + dx, y + 8), (x + dx * 1.6 + lean, y + 19)], 0.9)), LINE)
    paint(canvas, clip(body, stroke([(x - 4, y + 7.2), (x + 4, y + 7.2)], 1.6)), GOLD_D)
    ball = ellipse(x, y + 1.5, 4.2, 4.2)
    solid(canvas, ball, GOLD)
    paint(canvas, clip(ball, ellipse(x - 1.4, y, 1.6, 1.4)), GOLD_L)


def cushion(canvas):
    cx, ty, th = 96, 183, 14                       # 가운데 · 윗면 높이 · 두께
    shape = dict(n=2.0, pinch=0.2)
    top = poly(pillow(cx, ty, 51, 19, **shape))
    low = poly(pillow(cx, ty + th, 51, 19, **shape))
    body = ImageChops.lighter(ImageChops.lighter(top, low), poly([(cx - 51, ty), (cx + 51, ty), (cx + 51, ty + th), (cx - 51, ty + th)]))

    # 바닥 그림자
    sh = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    paint(sh, ellipse(cx, ty + th + 16, 55, 8), (70, 48, 30, 105))
    canvas.alpha_composite(sh)

    solid(canvas, body, PURPLE_D)
    # 옆면 아래쪽의 반사빛
    paint(canvas, clip(body, ImageChops.subtract(poly(pillow(cx, ty + th - 3, 47, 19, **shape)), poly(pillow(cx, ty + th - 6, 50, 19, **shape)))), (112, 70, 154, 255))
    paint(canvas, top, PURPLE)
    # 윗면: 왼쪽 위의 빛 · 금관이 누른 자리 · 모서리 주름
    light = ImageChops.subtract(poly(pillow(cx - 2, ty - 2, 45, 15, **shape)), poly(pillow(cx + 4, ty + 3, 46, 15, **shape)))
    paint(canvas, clip(top, light), PURPLE_L)
    paint(canvas, clip(top, ellipse(cx + 1, ty - 1, 36, 9.5)), PURPLE_D)
    paint(canvas, clip(top, ellipse(cx + 1, ty - 2.5, 33, 7.5)), (112, 70, 154, 255))
    for sx in (-1, 1):
        paint(canvas, clip(top, stroke([(cx + sx * 42, ty + 14), (cx + sx * 34, ty + 8)], 1.3)), PURPLE_D)
        paint(canvas, clip(top, stroke([(cx + sx * 42, ty - 14), (cx + sx * 36, ty - 9)], 1.3)), PURPLE_D)
    paint(canvas, clip(top, stroke([(cx - 33, ty + 12.5), (cx - 12, ty + 15)], 2.0)), (196, 160, 226, 255))
    # 금빛 테두리 끈 (윗면의 앞쪽 가장자리)
    front = poly([(0, ty + 7), (W, ty + 7), (W, H), (0, H)])
    paint(canvas, clip(clip(ImageChops.subtract(top, poly(pillow(cx, ty, 47.6, 16.2, **shape))), front), body), LINE)
    cord = clip(ImageChops.subtract(top, poly(pillow(cx, ty, 48.8, 17.2, **shape))), front)
    paint(canvas, cord, GOLD)
    paint(canvas, clip(cord, poly([(cx + 12, 0), (W, 0), (W, H), (cx + 24, H)])), GOLD_D)
    paint(canvas, clip(cord, poly([(cx - 30, 0), (cx - 18, 0), (cx - 14, H), (cx - 26, H)])), GOLD_L)
    # 앞 모서리의 금빛 술
    tassel(canvas, cx - 44, ty + 15, -2)
    tassel(canvas, cx + 44, ty + 15, 2)


def crown():
    """작은 금관 (보라 보석). 따로 그려서 살짝 기울여 얹는다"""
    global LW
    S = 1.25                   # 그린 뒤 키우는 배율 (외곽선 굵기는 그만큼 줄여 둔다)
    keep, LW = LW, LW / S
    layer = Image.new('RGBA', (W * K, H * K), (0, 0, 0, 0))
    cx, by = 96, 182           # 밑변 가운데
    hw = 27

    def rim(yoff, bulge, n=24):  # 아래로 볼록한 띠 곡선
        return [(cx - hw + 2 * hw * i / n, by + yoff + bulge * (1 - ((i / n) * 2 - 1) ** 2)) for i in range(n + 1)]

    # 안쪽(뒤) 테: 관의 입구
    back = ellipse(cx, by - 17, hw - 1, 6.5)
    solid(layer, back, GOLD_D)
    paint(layer, clip(back, ellipse(cx, by - 15, hw - 5, 4.5)), (150, 96, 44, 255))

    tips = [(-hw - 4, -33), (-14, -31), (0, -40), (14, -31), (hw + 4, -33)]
    xs = [-hw, -13.5, 0, 13.5, hw]
    top = [(cx - hw, by - 15)]
    for i, (tx, ty) in enumerate(tips):
        top.append((cx + tx, by + ty))
        if i < 4:
            top.append((cx + (xs[i] + xs[i + 1]) / 2, by - 17 + (1.5 if i in (1, 2) else 0)))
    top.append((cx + hw, by - 15))
    shape = poly(top + list(reversed(rim(-1, 6.5))))
    solid(layer, shape, GOLD)
    # 오른쪽 그늘 · 왼쪽 빛
    paint(layer, clip(shape, poly([(cx + 13, by - 50), (cx + 40, by - 50), (cx + 40, by + 10), (cx + 18, by + 10)])), GOLD_D)
    paint(layer, clip(shape, poly([(cx - 22, by - 30), (cx - 17, by - 30), (cx - 15, by + 2), (cx - 20, by + 2)])), GOLD_L)
    # 띠
    band = ImageChops.subtract(poly(rim(-12, 6.5) + [(cx + hw + 9, by + 20), (cx - hw - 9, by + 20)]), poly(rim(-10.2, 6.5) + [(cx + hw + 9, by + 20), (cx - hw - 9, by + 20)]))
    paint(layer, clip(shape, band), LINE)
    low = ImageChops.subtract(poly(rim(-4.6, 6.5) + [(cx + hw + 9, by + 20), (cx - hw - 9, by + 20)]), poly(rim(-3.2, 6.5) + [(cx + hw + 9, by + 20), (cx - hw - 9, by + 20)]))
    paint(layer, clip(shape, low), GOLD_D)
    # 끝 구슬
    for tx, ty in tips:
        b = ellipse(cx + tx, by + ty, 3.6, 3.6)
        solid(layer, b, GOLD)
        paint(layer, clip(b, ellipse(cx + tx - 1.1, by + ty - 1.1, 1.3, 1.3)), GOLD_L)
    # 보석: 가운데 보라, 양옆 작은 빨강
    gem = poly([(cx, by - 9.5), (cx + 5.6, by - 2.6), (cx, by + 4.2), (cx - 5.6, by - 2.6)])
    solid(layer, gem, GEM)
    paint(layer, clip(gem, poly([(cx, by - 9.5), (cx + 5.6, by - 2.6), (cx, by + 4.2)])), (116, 62, 176, 255))
    paint(layer, clip(gem, ellipse(cx - 1.8, by - 4.6, 1.5, 1.9)), GEM_L)
    for sx in (-16.5, 16.5):
        g = ellipse(cx + sx, by - 5.2, 2.7, 2.9)
        solid(layer, g, RED)
        paint(layer, clip(g, ellipse(cx + sx - 0.8, by - 6.2, 0.9, 0.9)), (255, 196, 190, 255))
    LW = keep
    layer = layer.rotate(9, resample=Image.BICUBIC, center=(cx * K, by * K))
    big = layer.resize((round(W * K * S), round(H * K * S)), Image.LANCZOS)
    out = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    out.alpha_composite(big, (0, 0), (round(cx * K * (S - 1)), round(by * K * (S - 1)), round(cx * K * (S - 1)) + W * K, round(by * K * (S - 1)) + H * K))
    return out


def build():
    canvas = Image.new('RGBA', (W * K, H * K), (0, 0, 0, 0))
    cushion(canvas)
    canvas.alpha_composite(crown())
    small = canvas.convert('RGBa').resize((W, H), Image.LANCZOS).convert('RGBA')
    out = base()
    out.alpha_composite(small)
    path = os.path.join(OUT, 'b-gift_cat-1.png')
    out.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)
    return path


def compare():
    """기존 선물 3개 + 고양이 선물을 마을 땅 색 위에 나란히 놓은 확인용 그림"""
    names = ['rat', 'dragon', 'pig', 'cat']
    S = 2
    sheet = Image.new('RGBA', (len(names) * W * S + 40, 200 * S + 40), (227, 192, 138, 255))
    for i, n in enumerate(names):
        im = Image.open(os.path.join(OUT, f'b-gift_{n}-1.png')).convert('RGBA').crop((0, 72, W, H))
        sheet.alpha_composite(im.resize((W * S, 200 * S), Image.LANCZOS), (20 + i * W * S, 20))
    dst = os.path.join(HERE, '..', '..', '..', 'art', 'spritecook', 'cat', 'village-gift-compare.png')
    sheet.convert('RGB').save(dst, optimize=True)
    return dst


if __name__ == '__main__':
    print(build())
    print(compare())
