"""099 에서 더한 기념물 7종과 특별 건물 '열두 지신 문'(모습 3단계)을 손으로 그린다 (SpriteCook 그림이 아니다).

  python art/hand_099.py [비교 그림을 둘 폴더]
    → public/art/b-mon_twelve_keys-1.png · b-mon_twelve_final-1.png · b-mon_twelve_hard-1.png · b-mon_twelve_tower-1.png
      b-mon_daily7-1.png · b-mon_daily_first-1.png · b-mon_race_week-1.png   (192×272)
      b-jisin-1.png · b-jisin-2.png · b-jisin-3.png                           (384×544)

- 기념물의 돌 받침은 다른 기념물과 똑같이 보이도록 b-mon_volley10-1.png 의 받침을 빌린다
  (깃발이 가린 뒤쪽 돌 줄은 b-mon_race2-1.png 에서 — 기념물 받침은 모두 같은 그림이다).
- 나머지는 4배 크기로 그린 뒤 LANCZOS 로 줄인다. 굵은 갈색 외곽선 · 밝은 색 · 두 단계 명암 (DESIGN.md).
- SpriteCook 크레딧을 채우면 다른 기념물과 같은 방법(build.py 의 monE · monF · jisin)으로 다시 그릴 예정
  (art/spritecook/REDRAW-QUEUE.md).
"""
import math
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'art')
K = 4
LINE = (46, 21, 9, 255)
LW = 2.6

STONE, STONE_D, STONE_DD, STONE_L = (178, 166, 145, 255), (135, 121, 105, 255), (107, 89, 73, 255), (204, 192, 168, 255)
GOLD, GOLD_D, GOLD_L = (250, 190, 62, 255), (226, 132, 40, 255), (255, 234, 146, 255)
RED, RED_D, RED_L = (201, 62, 54, 255), (150, 44, 40, 255), (232, 108, 92, 255)
WOOD, WOOD_D, WOOD_L = (140, 90, 54, 255), (102, 62, 38, 255), (174, 122, 78, 255)
TILE, TILE_D, TILE_L, TILE_LL = (87, 85, 80, 255), (62, 59, 56, 255), (118, 116, 112, 255), (150, 148, 141, 255)
CREAM, CREAM_D = (246, 233, 202, 255), (216, 196, 158, 255)
WHITE, CLOUD_D = (255, 253, 244, 255), (206, 222, 234, 255)
GREEN, GREEN_D, TEAL = (58, 142, 104, 255), (38, 104, 78, 255), (60, 150, 170, 255)
LAMP, LAMP_L = (251, 214, 108, 255), (255, 243, 170, 255)
SILVER, SILVER_D, SILVER_L = (192, 198, 206, 255), (146, 152, 164, 255), (228, 232, 238, 255)
BRONZE, BRONZE_D, BRONZE_L = (200, 134, 84, 255), (160, 98, 58, 255), (226, 168, 118, 255)
SHADOW = (148, 132, 112, 255)
# 열두 지신 원판의 색 (쥐 → 돼지)
ZODIAC = [(150, 160, 182), (168, 118, 80), (240, 150, 60), (244, 170, 186), (84, 170, 110), (150, 110, 190),
          (196, 96, 70), (240, 228, 200), (214, 160, 100), (220, 70, 64), (224, 184, 96), (240, 140, 150)]


class Art:
    """4배로 그리는 그림판. 좌표는 줄인 뒤(1배) 기준"""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.im = Image.new('RGBA', (w * K, h * K), (0, 0, 0, 0))

    # ── 모양(마스크) ──
    def _m(self):
        return Image.new('L', self.im.size, 0)

    def poly(self, pts):
        m = self._m()
        ImageDraw.Draw(m).polygon([(x * K, y * K) for x, y in pts], fill=255)
        return m

    def el(self, cx, cy, rx, ry=None):
        ry = rx if ry is None else ry
        m = self._m()
        ImageDraw.Draw(m).ellipse([(cx - rx) * K, (cy - ry) * K, (cx + rx) * K, (cy + ry) * K], fill=255)
        return m

    def rr(self, x0, y0, x1, y1, r=0):
        x0, x1, y0, y1 = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1)
        m = self._m()
        ImageDraw.Draw(m).rounded_rectangle([x0 * K, y0 * K, x1 * K, y1 * K], radius=r * K, fill=255)
        return m

    def ln(self, pts, width):
        m = self._m()
        d = ImageDraw.Draw(m)
        p = [(x * K, y * K) for x, y in pts]
        d.line(p, fill=255, width=max(1, round(width * K)), joint='curve')
        r = width * K / 2
        for x, y in (p[0], p[-1]):
            d.ellipse([x - r, y - r, x + r, y + r], fill=255)
        return m

    def grow(self, mask, r):
        box = mask.getbbox()
        if not box:
            return mask
        pad = int(r * K) + 2
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(mask.width, box[2] + pad), min(mask.height, box[3] + pad))
        part = mask.crop(box).filter(ImageFilter.MaxFilter(int(r * K) * 2 + 1))
        out = self._m()
        out.paste(part, box[:2])
        return out

    # ── 칠하기 ──
    def paint(self, mask, color):
        if color[3] == 255:
            self.im.paste(Image.new('RGBA', self.im.size, color), (0, 0), mask)
        else:
            layer = Image.new('RGBA', self.im.size, color[:3] + (0,))
            layer.putalpha(mask.point(lambda v: v * color[3] // 255))
            self.im.alpha_composite(layer)

    def obj(self, mask, fill, lw=LW):
        """외곽선을 두른 한 덩어리"""
        if lw:
            self.paint(self.grow(mask, lw), LINE)
        self.paint(mask, fill)
        return mask

    def tone(self, mask, region, color):
        """mask 안에서만 region 을 칠한다 (명암 · 무늬)"""
        self.paint(ImageChops.multiply(mask, region), color)

    def ink(self, mask, pts, width=1.3, color=LINE):
        self.tone(mask, self.ln(pts, width), color)

    def small(self):
        return self.im.convert('RGBa').resize((self.w, self.h), Image.LANCZOS).convert('RGBA')


def U(*ms):
    out = ms[0]
    for m in ms[1:]:
        out = ImageChops.lighter(out, m)
    return out


def SUB(a, b):
    return ImageChops.subtract(a, b)


def sparkle(a, x, y, r, lw=1.6):
    k = 0.28
    pts = []
    for i in range(8):
        t = math.pi * i / 4
        rr = r if i % 2 == 0 else r * k
        pts.append((x + math.sin(t) * rr, y - math.cos(t) * rr))
    a.obj(a.poly(pts), WHITE, lw)


def box3(a, x0, y0, x1, y1, r, c, cd, cl, lw=LW, side=0.26):
    """앞에서 본 기둥 · 토막: 오른쪽 그늘, 왼쪽 빛"""
    m = a.obj(a.rr(x0, y0, x1, y1, r), c, lw)
    w = x1 - x0
    a.tone(m, a.rr(x1 - w * side, y0, x1 + 2, y1), cd)
    a.tone(m, a.rr(x0 + w * 0.12, y0 + 2, x0 + w * 0.12 + max(1.6, w * 0.1), y1 - 2, 1), cl)
    return m


def roof(a, cx, yr, ye, wt, we, lift, n, kind='tile', gold=False, lw=LW):
    """앞에서 본 지붕: 용마루(yr) 에서 처마(ye)로 넓어지고 처마 끝이 살짝 들린다. kind: tile 기와 · wood 널"""
    c, cd, cl = (TILE, TILE_D, TILE_L) if kind == 'tile' else (WOOD, WOOD_D, WOOD_L)

    def eave(t, up=0.0):
        return (cx + t * we, ye - lift * abs(t) ** 2.4 - up)

    steps = [i / 20 - 1 for i in range(41)]
    side = lambda s: [(cx + s * (wt + (we - wt) * u), yr + (ye - lift - yr) * u ** 1.5) for u in (0.25, 0.5, 0.75)]
    shape = a.poly([(cx - wt, yr)] + [(cx + wt, yr)] + side(1) + [eave(t) for t in reversed(steps)] + list(reversed(side(-1))))
    a.obj(shape, c, lw)
    h = ye - yr
    # 처마 쪽 그늘
    a.tone(shape, a.poly([eave(t, h * 0.2) for t in steps] + [eave(t, -4) for t in reversed(steps)]), cd)
    for i in range(n + 1):
        t = -1 + 2 * i / n
        top, bot = (cx + t * wt, yr), eave(t)
        if 0 < i < n:
            a.ink(shape, [(top[0] + 1.6, top[1]), (bot[0] + 1.9, bot[1])], 1.7, cl)
            a.ink(shape, [top, bot], 1.25)
    if kind == 'tile':   # 처마 끝 막새
        r = min(3.4, we / n * 0.52)
        for i in range(n):
            t = -1 + 2 * (i + 0.5) / n
            x, y = eave(t)
            a.obj(a.el(x, y - r * 0.2, r), GOLD if gold else TILE_L, 1.3)
    else:
        a.tone(shape, a.poly([eave(t, 3.5) for t in steps] + [eave(t, -4) for t in reversed(steps)]), WOOD_D)
    # 용마루
    rh = max(3.5, h * 0.11)
    rc, rcd, rcl = (GOLD, GOLD_D, GOLD_L) if gold else (TILE_L, TILE, TILE_LL) if kind == 'tile' else (WOOD_L, WOOD, WOOD_L)
    ridge = a.obj(U(a.rr(cx - wt - rh * 1.2, yr - rh, cx + wt + rh * 1.2, yr + rh * 0.7, rh * 0.8),
                    a.el(cx - wt - rh * 0.9, yr - rh * 1.1, rh * 1.05), a.el(cx + wt + rh * 0.9, yr - rh * 1.1, rh * 1.05)), rc, lw)
    a.tone(ridge, a.rr(cx - wt - rh * 3, yr - rh * 0.05, cx + wt + rh * 3, yr + rh * 2), rcd)
    a.tone(ridge, a.rr(cx - wt * 0.8, yr - rh * 0.72, cx + wt * 0.5, yr - rh * 0.42, 1), rcl)
    return shape


def lantern(a, x, y, rx, ry, lw=2.0):
    """노란 종이 등 (붉은 뚜껑 · 받침). (x, y) = 등의 가운데"""
    a.paint(a.el(x, y, rx * 2.1, ry * 1.8), (255, 226, 130, 46))
    a.paint(a.el(x, y, rx * 1.55, ry * 1.4), (255, 226, 130, 60))
    body = a.obj(a.rr(x - rx, y - ry, x + rx, y + ry, rx * 0.8), LAMP, lw)
    a.tone(body, a.el(x - rx * 0.2, y, rx * 0.55, ry * 0.8), LAMP_L)
    a.tone(body, a.rr(x + rx * 0.5, y - ry, x + rx + 1, y + ry), (240, 180, 80, 255))
    for dx in (-0.45, 0.45):
        a.ink(body, [(x + rx * dx, y - ry), (x + rx * dx * 1.25, y), (x + rx * dx, y + ry)], 0.9, (206, 140, 60, 255))
    for yy, hh in ((y - ry - 1.5, 3.4), (y + ry - 1.6, 3.2)):
        cap = a.obj(a.rr(x - rx * 0.72, yy, x + rx * 0.72, yy + hh, 1.4), RED, lw * 0.8)
        a.tone(cap, a.rr(x + rx * 0.2, yy, x + rx, yy + hh), RED_D)


# ───────────────────────── 기념물 받침 ─────────────────────────

def plinth(gold=False):
    """다른 기념물과 같은 돌 받침 (우승 깃발 그림에서 깃발을 지운 것)"""
    im = Image.open(os.path.join(OUT, 'b-mon_volley10-1.png')).convert('RGBA')
    back = Image.open(os.path.join(OUT, 'b-mon_race2-1.png')).convert('RGBA')
    px = im.load()
    for y in range(0, 182):
        for x in range(192):
            px[x, y] = (0, 0, 0, 0)
    im.paste(back.crop((62, 178, 130, 199)), (62, 178))       # 깃발이 가리던 뒤쪽 돌 줄
    floor = (184, 168, 142, 255)
    for y in range(197, 224):                                   # 깃대 · 그림자 · 깃발 끝
        for x in range(60, 132):
            r, g, b, al = px[x, y]
            if al < 200 or abs(r - 184) + abs(g - 168) + abs(b - 142) > 14:
                px[x, y] = floor
    if gold:                                                    # 금빛 받침: 밝은 돌만 금빛으로 물들인다
        for y in range(272):
            for x in range(192):
                r, g, b, al = px[x, y]
                if al > 40 and r + g + b > 210:
                    v = (r + g + b) / 3 / 150
                    px[x, y] = (min(255, round(232 * v)), min(255, round(172 * v)), min(255, round(74 * v)), al)
    return im


def ground_shadow(a, cx, cy, rx, ry, gold=False):
    a.paint(a.el(cx, cy, rx, ry), (176, 122, 46, 255) if gold else SHADOW)


def key(a, x, y, s):
    """매달린 금 열쇠. (x, y) = 고리 가운데, s = 이가 향하는 쪽"""
    m = U(a.el(x, y, 5.6), a.rr(x - 1.9, y + 4, x + 1.9, y + 21, 1), a.rr(x, y + 12.5, x + s * 6.2, y + 15.4, 0.8), a.rr(x, y + 17.4, x + s * 5, y + 20.6, 0.8))
    a.obj(m, GOLD, 2.0)
    a.tone(m, a.rr(x + (0.4 if s > 0 else -1.9), y + 4, x + (1.9 if s > 0 else -0.4), y + 21), GOLD_D)
    a.tone(m, SUB(a.el(x, y, 5.6), a.el(x - 1.2, y - 1.2, 5.4)), GOLD_D)
    a.tone(m, a.el(x - 2.6, y - 2.8, 1.5, 1.2), GOLD_L)
    a.obj(a.el(x, y, 1.9), (92, 52, 28, 255), 1.1)


def mon_twelve_keys(a):
    """열쇠 돌기둥: 돌기둥에 금 열쇠 여섯 개"""
    ground_shadow(a, 96, 215, 38, 7)
    # 열쇠를 거는 나무못 (기둥 뒤에서 양옆으로)
    rows = [(-1, 126), (1, 136), (-1, 152), (1, 162), (-1, 178), (1, 188)]
    for s, y in rows:
        a.obj(a.rr(96 + s * 8, y - 8.4, 96 + s * 30, y - 4.4, 1.6), WOOD, 2.0)
    foot = a.obj(a.rr(72, 202, 120, 218, 4), STONE, LW)
    a.tone(foot, a.rr(72, 211, 120, 219), STONE_D)
    a.tone(foot, a.rr(106, 202, 121, 219), STONE_D)
    shaft = box3(a, 81, 112, 111, 206, 3, STONE, STONE_D, STONE_L)
    for pts in ([(86, 140), (92, 146), (90, 153)], [(98, 176), (103, 181)], [(88, 192), (94, 190)]):
        a.ink(shaft, pts, 1.2, STONE_DD)
    # 붉은 띠와 금 문양
    for y in (119, 198):
        band = a.rr(80, y, 112, y + 5)
        a.tone(shaft, band, RED)
        a.tone(shaft, a.rr(103, y, 112, y + 5), RED_D)
        a.ink(shaft, [(80, y), (112, y)], 1.2)
        a.ink(shaft, [(80, y + 5), (112, y + 5)], 1.2)
    cap = a.obj(a.poly([(76, 114), (80, 102), (112, 102), (116, 114)]), STONE_L, LW)
    a.tone(cap, a.rr(74, 109, 118, 116), STONE)
    a.tone(cap, a.poly([(106, 100), (118, 100), (118, 116), (109, 116)]), STONE_D)
    knob = a.obj(a.el(96, 95, 8), GOLD, LW)
    a.tone(knob, SUB(a.el(96, 95, 8), a.el(94, 93, 7.4)), GOLD_D)
    a.tone(knob, a.el(93, 92, 2.4, 2), GOLD_L)
    for s, y in rows:
        key(a, 96 + s * 27, y, s)
    sparkle(a, 121, 100, 6)


def mon_twelve_final(a):
    """열두길 비석: 글씨 새긴 둥근 비석, 붉은 꼭지"""
    ground_shadow(a, 96, 215, 42, 7)
    foot = a.obj(a.rr(60, 199, 132, 219, 5), STONE, LW)
    a.tone(foot, a.rr(58, 199, 134, 206), STONE_L)
    a.tone(foot, a.rr(114, 199, 134, 220), STONE_D)
    a.ink(foot, [(60, 206.5), (132, 206.5)], 1.2, STONE_DD)
    body = U(a.rr(69, 116, 123, 204, 2), a.el(96, 117, 27, 25))
    a.obj(body, STONE, LW)
    a.tone(body, a.rr(111, 80, 126, 206), STONE_D)
    a.tone(body, SUB(a.el(96, 117, 27, 25), a.el(98, 120, 27, 25)), STONE_L)
    a.tone(body, a.rr(72, 118, 75, 196, 1), STONE_L)
    panel = a.obj(a.rr(79, 112, 113, 194, 9), STONE_L, 1.5)
    a.tone(panel, a.rr(79, 112, 113, 116), STONE)
    # 새긴 글씨 (세로 두 줄)
    glyphs = [(88, 122, [(-4, 0, 4, 0), (0, 0, 0, 7), (-4, 7, 4, 7)]), (88, 136, [(-4, 0, 4, 0), (-4, 0, -4, 7), (-4, 7, 4, 7), (0, 3.5, 4, 3.5)]),
              (88, 150, [(-4, 0, 4, 0), (4, 0, 4, 7), (-4, 4, 4, 4)]), (88, 164, [(0, 0, 0, 8), (-4, 3, 4, 3), (-4, 8, 4, 8)]), (88, 178, [(-4, 0, 4, 0), (-3, 4, 3, 4), (-4, 8, 4, 8)]),
              (104, 126, [(-4, 0, 4, 0), (0, 0, 0, 8), (-4, 8, 4, 8), (-4, 4, 0, 4)]), (104, 141, [(-4, 0, -4, 8), (4, 0, 4, 8), (-4, 4, 4, 4)]),
              (104, 156, [(-4, 0, 4, 0), (4, 0, -4, 8), (-4, 8, 4, 8)]), (104, 171, [(-4, 1, 4, 1), (0, 1, 0, 9), (-3, 5, 3, 5)])]
    for gx, gy, strokes in glyphs:
        for x0, y0, x1, y1 in strokes:
            a.ink(panel, [(gx + x0, gy + y0), (gx + x1, gy + y1)], 1.7, STONE_DD)
    # 붉은 꼭지와 매듭 끈
    for s in (-1, 1):
        a.obj(a.poly([(96 + s * 2, 92), (96 + s * 13, 99), (96 + s * 15, 109), (96 + s * 9, 106), (96 + s * 6, 98)]), RED_D if s > 0 else RED, 2.0)
    knob = a.obj(a.el(96, 88, 8.5), RED, LW)
    a.tone(knob, SUB(a.el(96, 88, 8.5), a.el(94, 86, 8)), RED_D)
    a.tone(knob, a.el(93, 85, 2.6, 2.1), RED_L)
    # 발치의 이끼
    for x, y, r in ((66, 200, 5), (72, 202, 4), (127, 201, 4.5)):
        a.obj(a.el(x, y, r, r * 0.8), (112, 160, 92, 255), 1.6)


def mon_twelve_hard(a):
    """금빛 열두길 문: 금빛 받침 위 금 문짝과 기와지붕, 반짝임"""
    ground_shadow(a, 96, 215, 46, 7, True)
    doors = a.obj(a.rr(66, 140, 126, 213, 1), GOLD, LW)
    a.tone(doors, a.rr(66, 140, 126, 146), GOLD_D)
    for x0, x1 in ((70, 93), (99, 122)):
        for y0, y1 in ((150, 176), (181, 208)):
            a.obj(a.rr(x0, y0, x1, y1, 2), GOLD_L, 1.2)
            a.paint(a.rr(x0 + 2.4, y0 + 2.4, x1 - 1, y1 - 1, 1.4), GOLD)
    a.ink(doors, [(96, 140), (96, 213)], 1.8)
    for x in (90.5, 101.5):
        k = a.obj(a.el(x, 178.5, 3.6), RED, 1.4)
        a.tone(k, a.el(x - 1, 177.5, 1.1), RED_L)
    for x in (56, 124):
        box3(a, x, 132, x + 12, 213, 2, GOLD, GOLD_D, GOLD_L)
        ft = a.obj(a.rr(x - 3, 207, x + 15, 218, 3), GOLD_D, 2.2)
        a.tone(ft, a.rr(x - 3, 207, x + 15, 210.5), GOLD)
    beam = a.obj(a.rr(50, 127, 142, 141, 2), RED, LW)
    a.tone(beam, a.rr(50, 136, 142, 142), RED_D)
    for i in range(7):
        x = 56 + i * 12.5
        a.tone(beam, a.rr(x, 129.5, x + 7, 134.5, 1.2), (GREEN, GOLD, TEAL)[i % 3])
    roof(a, 96, 100, 131, 33, 56, 7, 9, gold=True)
    tip = a.obj(a.poly([(96, 80), (100, 90), (96, 95), (92, 90)]), GOLD, 2.0)
    a.tone(tip, a.poly([(96, 80), (100, 90), (96, 95)]), GOLD_D)
    sparkle(a, 150, 106, 8)
    sparkle(a, 42, 124, 5.5)
    sparkle(a, 140, 172, 4.5, 1.3)


def cloud(a, cx, cy, s, lw=2.2):
    puffs = [(-13, 2, 8), (-4, -4, 10), (8, -2, 9), (16, 3, 6.5), (2, 4, 9)]
    m = U(*[a.el(cx + x * s, cy + y * s, r * s, r * s * 0.86) for x, y, r in puffs], a.rr(cx - 19 * s, cy + 2 * s, cx + 21 * s, cy + 9.5 * s, 4 * s))
    a.obj(m, WHITE, lw)
    a.tone(m, a.rr(cx - 24 * s, cy + 5.5 * s, cx + 24 * s, cy + 12 * s), CLOUD_D)
    return m


def mon_twelve_tower(a):
    """구름 탑 등불: 구름 위 3층 탑 꼭대기의 등불"""
    ground_shadow(a, 96, 216, 44, 7)
    cloud(a, 66, 196, 1.05)
    cloud(a, 128, 198, 0.95)
    base = a.obj(a.rr(68, 198, 124, 214, 3), STONE, LW)
    a.tone(base, a.rr(68, 198, 124, 203), STONE_L)
    a.tone(base, a.rr(110, 198, 126, 215), STONE_D)
    tiers = [(196, 20, 20, 31, 22), (164, 17, 16, 26, 18), (135, 15, 12.5, 21, 14)]   # 몸 아래 y, 높이, 반 너비, 처마 반 너비, 용마루 반 너비
    for i, (yb, h, hw, ew, tw) in enumerate(tiers):
        body = a.obj(a.rr(96 - hw, yb - h, 96 + hw, yb, 1), CREAM, 2.3)
        a.tone(body, a.rr(96 + hw * 0.45, yb - h, 96 + hw + 1, yb), CREAM_D)
        for s in (-1, 1):
            p = a.obj(a.rr(96 + s * hw - 2.2, yb - h, 96 + s * hw + 2.2, yb, 1), RED, 1.6)
            a.tone(p, a.rr(96 + s * hw + 0.4, yb - h, 96 + s * hw + 3, yb), RED_D)
        a.obj(a.rr(96 - hw * 0.34, yb - h * 0.62, 96 + hw * 0.34, yb, 1.5), (92, 58, 40, 255), 1.5)
    for i, (yb, h, hw, ew, tw) in enumerate(tiers):
        roof(a, 96, yb - h - 9, yb - h + 5, tw, ew, 4.5, 6 - i, lw=2.3)
    a.obj(a.rr(94.4, 94, 97.6, 108, 1), WOOD, 1.8)
    lantern(a, 96, 82, 10.5, 12.5, 2.2)
    cloud(a, 55, 172, 0.7, 2.0)
    cloud(a, 140, 150, 0.62, 2.0)
    cloud(a, 96, 212, 0.9)
    cloud(a, 62, 212, 0.75)
    cloud(a, 134, 214, 0.7)


def mon_daily7(a):
    """도전 달력: 돌 받침 위 붉은 머리 달력 판, 일곱 칸 중 한 칸이 노랑"""
    ground_shadow(a, 96, 215, 44, 7)
    for x in (63, 122):
        box3(a, x, 176, x + 7.5, 213, 1.5, WOOD, WOOD_D, WOOD_L, 2.2)
        ft = a.obj(a.rr(x - 5, 207, x + 12.5, 218, 3.5), STONE, 2.2)
        a.tone(ft, a.rr(x - 5, 213, x + 12.5, 219), STONE_D)
    board = a.obj(a.rr(51, 100, 141, 188, 7), CREAM, LW)
    a.tone(board, a.rr(51, 181, 141, 189), CREAM_D)
    a.tone(board, a.rr(133, 100, 142, 189), CREAM_D)
    a.tone(board, a.rr(51, 100, 141, 123), RED)
    a.tone(board, a.rr(128, 100, 142, 123), RED_D)
    a.tone(board, a.rr(57, 103.5, 110, 106, 1.2), RED_L)
    a.ink(board, [(51, 123.5), (141, 123.5)], 1.6)
    # 머리글: 흰 해 동그라미와 줄
    a.obj(a.el(96, 112.5, 5.2), GOLD, 1.5)
    for x0, x1 in ((62, 82), (110, 130)):
        a.paint(a.ln([(x0, 113), (x1, 113)], 2.6), WHITE)
    # 고리
    for x in (72, 120):
        ring = a.obj(a.rr(x - 3, 92, x + 3, 106, 3), SILVER, 1.8)
        a.tone(ring, a.rr(x + 0.4, 92, x + 4, 106), SILVER_D)
    # 일곱 칸 (4 + 3), 마지막 칸이 노랑
    for i in range(7):
        x = 58 + (i % 4) * 19.5 + (9.75 if i >= 4 else 0)
        y = 131 + (i // 4) * 25
        last = i == 6
        cell = a.obj(a.rr(x, y, x + 16, y + 19, 3), GOLD if last else WHITE, 1.5)
        a.tone(cell, a.rr(x, y + 15, x + 16, y + 20), GOLD_D if last else CREAM_D)
        if last:
            sparkle(a, x + 8, y + 8.5, 6, 1.2)
        else:   # 다녀간 날의 붉은 도장
            a.paint(a.ln([(x + 4.2, y + 8.5), (x + 7, y + 11.8), (x + 12, y + 5)], 2.4), RED)


def mon_daily_first(a):
    """장원 깃발: 금빛 받침, 붉은 깃발에 금 동그라미 (깃대 끝에는 어사화)"""
    ground_shadow(a, 92, 215, 40, 7, True)
    # 어사화: 깃대 끝에서 휘어 나온 가지와 종이꽃
    stems = [[(64, 82), (58, 66), (46, 56), (34, 54)], [(64, 82), (68, 62), (80, 50), (94, 48)]]
    flowers = [((240, 150, 170), (255, 205, 215)), (WHITE[:3], (255, 240, 200)), ((126, 190, 226), (190, 226, 244)), ((250, 200, 80), (255, 234, 146))]
    for si, st in enumerate(stems):
        a.obj(a.ln(st, 1.8), GREEN, 1.5)
        for j, (x, y) in enumerate(st[1:]):
            c, cl = flowers[(si * 2 + j) % 4]
            f = a.obj(a.el(x, y, 5), c + (255,), 1.6)
            a.tone(f, a.el(x, y, 1.9), cl + (255,) if c != WHITE[:3] else GOLD)
    # 깃발 (오른쪽으로 날린다)
    n = 24
    wave = lambda u: 3.2 * math.sin(u * math.pi * 1.7 + 0.4) * u
    top = [(69 + 70 * i / n, 92 + 6 * i / n + wave(i / n)) for i in range(n + 1)]
    bot = [(69 + 70 * i / n, 142 + 2 * i / n + wave(i / n)) for i in range(n + 1)]
    notch = (124, 119 + wave(0.8))
    flag = a.poly(top + [notch] + list(reversed(bot)))
    a.obj(flag, RED, LW)
    inner = a.poly([(x, y + 6.5) for x, y in top] + [(notch[0] - 9, notch[1])] + [(x, y - 6.5) for x, y in reversed(bot)])
    a.tone(flag, SUB(flag, inner), GOLD)
    a.tone(flag, SUB(a.grow(SUB(flag, inner), 1.1), SUB(flag, inner)), LINE)
    a.tone(inner, a.poly([(109, 80), (117, 80), (114, 160), (106, 160)]), RED_D)
    a.tone(flag, a.rr(69, 80, 74, 160), RED_D)
    disc = a.obj(a.el(94, 118.5, 12), GOLD, 1.8)
    a.tone(disc, SUB(a.el(94, 118.5, 12), a.el(92.5, 117, 11.4)), GOLD_D)
    a.tone(disc, a.el(90, 114, 3.6, 2.8), GOLD_L)
    # 깃대와 금빛 꼭지 · 받침
    box3(a, 61, 86, 68, 212, 2, WOOD, WOOD_D, WOOD_L, 2.3)
    for y in (94, 138):
        a.obj(a.rr(59.5, y, 69.5, y + 4.5, 1.5), GOLD, 1.5)
    ft = a.obj(a.rr(52, 205, 77, 218, 4), GOLD, 2.3)
    a.tone(ft, a.rr(52, 212, 77, 219), GOLD_D)
    tip = a.obj(U(a.el(64.5, 81, 6.5), a.poly([(61, 77), (64.5, 66), (68, 77)])), GOLD, 2.2)
    a.tone(tip, a.rr(65.5, 60, 74, 90), GOLD_D)
    a.tone(tip, a.el(62.4, 79, 1.7), GOLD_L)
    # 두루마리 (급제 방)
    sc = a.obj(a.rr(96, 203, 132, 214, 5), CREAM, 2.2)
    a.tone(sc, a.rr(96, 209.5, 132, 215), CREAM_D)
    for x in (99, 129):
        a.obj(a.el(x, 208.5, 4, 6.4), CREAM_D, 1.8)
    band = a.rr(111, 203, 117, 214)
    a.tone(sc, band, RED)
    sparkle(a, 146, 96, 6)


def digit(a, x, y, n, s=1.0):
    P = {1: [[(-2, -4), (0.6, -6), (0.6, 6)], [(-2.6, 6), (3.6, 6)]],
         2: [[(-3.4, -3.6), (-1, -6), (2.4, -5.4), (3.2, -2.6), (-3.4, 6), (3.8, 6)]],
         3: [[(-3.4, -5), (0, -6.2), (3, -4), (0.4, -0.6), (3.4, 2.6), (0.4, 6.2), (-3.6, 4.8)]]}[n]
    m = U(*[a.ln([(x + px * s, y + py * s) for px, py in st], 2.6 * s) for st in P])
    a.obj(m, WHITE, 1.5)


def mon_race_week(a):
    """주간 시상대: 1·2·3 시상대 위 금 트로피, 뒤에 체크 깃발"""
    ground_shadow(a, 96, 216, 52, 7)
    # 체크 깃발 (오른쪽 뒤)
    box3(a, 131, 130, 135, 200, 1.5, WOOD, WOOD_D, WOOD_L, 2.0)
    fl = a.obj(a.poly([(135, 132), (163, 136), (161, 158), (135, 154)]), WHITE, 2.0)
    for r in range(3):
        for c in range(4):
            if (r + c) % 2 == 0:
                a.tone(fl, a.poly([(135 + c * 7, 131 + r * 7.5 + c), (142 + c * 7, 132 + r * 7.5 + c), (142 + c * 7, 139.5 + r * 7.5 + c), (135 + c * 7, 138.5 + r * 7.5 + c)]), (52, 44, 44, 255))
    blocks = [(48, 186, 80, SILVER, SILVER_D, SILVER_L, 2), (112, 194, 144, BRONZE, BRONZE_D, BRONZE_L, 3), (78, 168, 114, GOLD, GOLD_D, GOLD_L, 1)]
    for x0, y0, x1, c, cd, cl, n in blocks:
        b = a.obj(a.rr(x0, y0, x1, 217, 2.5), c, LW)
        a.tone(b, a.rr(x0, y0, x1, y0 + 6), cl)
        a.tone(b, a.rr(x1 - 6, y0 + 6, x1 + 1, 218), cd)
        a.tone(b, a.rr(x0, 211, x1, 218), cd)
        a.ink(b, [(x0, y0 + 6.5), (x1, y0 + 6.5)], 1.2)
        digit(a, (x0 + x1) / 2 - 0.5, y0 + (217 - y0) / 2 + 3.5, n, 1.15 if n == 1 else 0.95)
    # 트로피
    for s in (-1, 1):
        a.obj(SUB(a.el(96 + s * 15, 132, 8, 9), a.el(96 + s * 15, 132, 4.2, 5.2)), GOLD_D, 2.0)
    stand = a.obj(a.rr(86, 160, 106, 168.5, 2), WOOD_D, 2.2)
    a.tone(stand, a.rr(86, 160, 106, 163), WOOD)
    stem = a.obj(a.poly([(92.5, 148), (99.5, 148), (101, 161), (91, 161)]), GOLD_D, 2.2)
    cup = a.obj(a.poly([(80, 116), (112, 116), (110.5, 134), (105, 146), (99, 151), (93, 151), (87, 146), (81.5, 134)]), GOLD, LW)
    a.tone(cup, a.poly([(104, 110), (114, 110), (112, 136), (104, 152), (98, 152), (104, 140)]), GOLD_D)
    a.tone(cup, a.rr(84.5, 121, 88, 136, 1.6), GOLD_L)
    rim = a.obj(a.rr(78, 113, 114, 120, 3.4), GOLD_L, 2.2)
    a.tone(rim, a.rr(104, 113, 115, 121), GOLD)
    st = a.obj(a.poly([(96 + math.sin(math.pi * i / 5) * (6.2 if i % 2 == 0 else 2.7), 134 - math.cos(math.pi * i / 5) * (6.2 if i % 2 == 0 else 2.7)) for i in range(10)]), RED, 1.4)
    sparkle(a, 121, 108, 6)


# ───────────────────────── 열두 지신 문 (2×2) ─────────────────────────

def jisin(look):
    a = Art(384, 544)
    fancy = look >= 2
    n = (4, 8, 12)[look - 1]
    cx = 192
    # 지신 원판을 받치는 반달 틀 (지붕 뒤)
    ax, ay, arx, ary = cx, (206 if look == 1 else 194), 140, 102   # 양 끝이 용마루에 얹힌다
    arc = lambda t, d=0: (ax - math.cos(t) * (arx + d), ay - math.sin(t) * (ary + d))
    ts = [math.pi * i / 60 for i in range(61)]
    rail_c, rail_d = ((WOOD, WOOD_D), (RED, RED_D), (GOLD, GOLD_D))[look - 1]
    rail = a.obj(a.ln([arc(t) for t in ts], 7), rail_c, LW)
    a.tone(rail, a.ln([arc(t, -2.2) for t in ts], 2.4), rail_d)
    R = 15.5 if n < 12 else 13.6
    for i in range(n):
        t = math.pi * (0.05 + 0.9 * (i + 0.5) / n)
        x, y = arc(t)
        zi = i * 12 // n if n < 12 else i
        c = ZODIAC[zi] + (255,)
        cd = tuple(round(v * 0.78) for v in ZODIAC[zi]) + (255,)
        cl = tuple(min(255, round(v * 1.12 + 26)) for v in ZODIAC[zi]) + (255,)
        rim = a.obj(a.el(x, y, R), GOLD if fancy else WOOD_L, LW)
        a.tone(rim, SUB(a.el(x, y, R), a.el(x - 1.2, y - 1.2, R - 0.4)), GOLD_D if fancy else WOOD)
        face = a.obj(a.el(x, y, R - 4.2), c, 1.4)
        a.tone(face, SUB(a.el(x, y, R - 4.2), a.el(x - 1.6, y - 1.6, R - 4.6)), cd)
        a.tone(face, a.el(x - 2.6, y - 3.2, 3.2, 2.4), cl)
        a.tone(face, a.el(x + 1, y + 1.4, 2.6), cd)
    # 돌 기단
    if look == 1:
        slab = a.obj(a.rr(22, 470, 362, 534, 12), STONE_D, LW)
        a.tone(slab, a.rr(22, 470, 362, 492, 10), STONE)
        a.tone(slab, a.rr(30, 474, 300, 478, 2), STONE_L)
        for x, y in ((70, 492), (132, 498), (206, 493), (268, 499), (326, 493)):
            a.ink(slab, [(x - 30, y), (x, y + 2), (x + 30, y)], 1.4)
            a.ink(slab, [(x, y + 2), (x + 2, 534)], 1.4)
    else:
        slab = a.obj(a.rr(10, 462, 374, 534, 5), STONE, LW)
        a.tone(slab, a.rr(10, 462, 374, 492), STONE_L)
        a.tone(slab, a.rr(10, 524, 374, 536), STONE_D)
        a.ink(slab, [(10, 492.5), (374, 492.5)], 1.6)
        for i in range(1, 8):
            a.ink(slab, [(10 + i * 45.5, 493), (10 + i * 45.5, 534)], 1.3)
        a.ink(slab, [(10, 513), (374, 513)], 1.2, STONE_D)
        # 계단
        for j, (x0, x1, y0) in enumerate(((144, 240, 496), (134, 250, 513))):
            st = a.obj(a.rr(x0, y0, x1, y0 + 20, 3), STONE_L, 2.2)
            a.tone(st, a.rr(x0, y0 + 9, x1, y0 + 21), STONE)
    # 문짝
    dx0, dx1, dy0, dy1 = 108, 276, 304, 470
    dc, dcd = ((WOOD, WOOD_D), ((152, 62, 48, 255), (118, 44, 36, 255)), ((152, 62, 48, 255), (118, 44, 36, 255)))[look - 1]
    doors = a.obj(a.rr(dx0, dy0, dx1, dy1, 1), dc, LW)
    a.tone(doors, a.rr(dx0, dy0, dx1, dy0 + 12), dcd)
    for s in (0, 1):
        x0 = dx0 + 6 + s * 86
        x1 = x0 + 70
        if look == 1:
            for k in range(1, 4):
                a.ink(doors, [(x0 - 4 + k * 19.5, dy0), (x0 - 4 + k * 19.5, dy1)], 1.3, WOOD_D)
            for y in (332, 436):
                bar = a.obj(a.rr(x0 - 3, y, x1 + 3, y + 9, 1.5), WOOD_D, 1.5)
        else:
            frame = GOLD if look == 3 else (196, 92, 70, 255)
            for y0, y1 in ((322, 382), (392, 458)):
                a.obj(a.rr(x0 + 2, y0, x1 - 2, y1, 3), frame, 1.4)
                a.paint(a.rr(x0 + 6, y0 + 4, x1 - 6, y1 - 4, 2), dcd if look == 2 else (176, 76, 56, 255))
            for y in (332, 352, 372, 404, 425, 446):
                for k in range(3):
                    a.obj(a.el(x0 + 17 + k * 18, y, 2.8), GOLD, 1.1)
    a.ink(doors, [(cx, dy0), (cx, dy1)], 2.0)
    for s in (-1, 1):
        if look == 1:
            a.obj(a.el(cx + s * 11, 388, 4.2), TILE_D, 1.4)
        else:
            a.obj(a.el(cx + s * 13, 387, 7), GOLD, 1.6)
            a.obj(SUB(a.el(cx + s * 13, 393, 6.4), a.el(cx + s * 13, 393, 3.4)), GOLD_D, 1.5)
    # 기둥
    for x in (92, 292):
        p = box3(a, x - 14, 268, x + 14, 472, 3, RED, RED_D, RED_L)
        if fancy:
            for y in (286, 446):
                a.tone(p, a.rr(x - 14, y, x + 14, y + 9), GOLD)
                a.tone(p, a.rr(x + 7, y, x + 15, y + 9), GOLD_D)
                a.ink(p, [(x - 14, y), (x + 14, y)], 1.3)
                a.ink(p, [(x - 14, y + 9), (x + 14, y + 9)], 1.3)
        ft = a.obj(a.rr(x - 21, 460, x + 21, 482, 5), STONE if look > 1 else STONE_L, LW)
        a.tone(ft, a.rr(x - 21, 472, x + 21, 483), STONE_D)
        a.tone(ft, a.rr(x + 10, 460, x + 22, 483), STONE_D)
    # 창방 (가로 들보) — 모습 2부터 단청
    low = a.obj(a.rr(72, 290, 312, 306, 2), WOOD_D if look == 1 else RED_D, LW)
    beam = a.obj(a.rr(56, 262, 328, 292, 3), WOOD if look == 1 else GREEN, LW)
    a.tone(beam, a.rr(56, 283, 328, 293), WOOD_D if look == 1 else GREEN_D)
    if fancy:
        cols = [RED, GOLD, TEAL, (240, 150, 170, 255)]
        for i in range(13):
            x = 64 + i * 20
            a.obj(a.rr(x, 267, x + 13, 280, 3), cols[i % 4], 1.2)
            a.paint(a.el(x + 6.5, 273.5, 2.6), WHITE if i % 2 else GOLD_L)
    else:
        for i in range(1, 6):
            a.ink(beam, [(56 + i * 45, 262), (56 + i * 45, 292)], 1.2, WOOD_D)
    # 등불 (모습 2부터, 밤에 빛난다)
    if fancy:
        for s in (-1, 1):
            x = cx + s * 152
            a.obj(a.rr(min(cx + s * 106, x) - 0, 300, max(cx + s * 106, x), 305, 2), WOOD_D, 1.8)
            a.obj(a.rr(x - 1.2, 303, x + 1.2, 318, 1), WOOD_D, 1.4)
            lantern(a, x, 338, 14, 18, 2.2)
    # 지붕
    if look == 1:
        roof(a, cx, 204, 268, 112, 170, 7, 13, kind='wood')
    else:
        roof(a, cx, 192, 270, 118, 184, 17, 19, gold=look == 3)
    # 현판
    if look == 3:
        pl = a.obj(a.rr(cx - 40, 248, cx + 40, 290, 4), RED, LW)
        a.obj(a.rr(cx - 34, 254, cx + 34, 284, 2), GOLD, 1.5)
        marks = [(-22, GOLD_D), (0, GOLD_D), (22, GOLD_D)]
        for mx, _ in marks:
            for x0, y0, x1, y1 in ((-6, -8, 6, -8), (0, -8, 0, 8), (-6, 0, 6, 0), (-6, 8, 6, 8)):
                a.paint(a.ln([(cx + mx + x0, 269 + y0), (cx + mx + x1, 269 + y1)], 2.6), (120, 60, 30, 255))
        # 금빛 처마 끝 · 용마루 꼭지
        for s in (-1, 1):
            e = a.obj(a.poly([(cx + s * 168, 262), (cx + s * 182, 238), (cx + s * 185, 256), (cx + s * 178, 268)]), GOLD, 2.2)
            a.tone(e, a.poly([(cx + s * 168, 262), (cx + s * 185, 256), (cx + s * 178, 268)]), GOLD_D)
        fin = a.obj(U(a.el(cx, 176, 9), a.poly([(cx - 5, 170), (cx, 154), (cx + 5, 170)])), GOLD, LW)
        a.tone(fin, a.rr(cx + 1.5, 150, cx + 12, 188), GOLD_D)
        a.tone(fin, a.el(cx - 3, 173, 2.2), GOLD_L)
        sparkle(a, 40, 214, 8)
        sparkle(a, 350, 196, 6.5)
    else:
        pl = a.obj(a.rr(cx - 32, 252, cx + 32, 286, 3), WOOD_D if look == 1 else (60, 50, 60, 255), LW)
        a.obj(a.rr(cx - 27, 257, cx + 27, 281, 2), CREAM if look == 1 else (44, 40, 52, 255), 1.3)
        for mx in (-16, 0, 16):
            for x0, y0, x1, y1 in ((-5, -6, 5, -6), (0, -6, 0, 6), (-5, 6, 5, 6)):
                a.paint(a.ln([(cx + mx + x0, 269 + y0), (cx + mx + x1, 269 + y1)], 2.2), WOOD_D if look == 1 else GOLD)
    return a.small()


# ───────────────────────── 저장 ─────────────────────────

MONS = [('mon_twelve_keys', mon_twelve_keys, False), ('mon_twelve_final', mon_twelve_final, False), ('mon_twelve_hard', mon_twelve_hard, True),
        ('mon_twelve_tower', mon_twelve_tower, False), ('mon_daily7', mon_daily7, False), ('mon_daily_first', mon_daily_first, True),
        ('mon_race_week', mon_race_week, False)]


def save(im, name):
    path = os.path.join(OUT, f'{name}.png')
    im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)
    return path


def build():
    for name, draw, gold in MONS:
        a = Art(192, 272)
        draw(a)
        out = plinth(gold)
        out.alpha_composite(a.small())
        print(save(out, f'b-{name}-1'))
    for look in (1, 2, 3):
        print(save(jisin(look), f'b-jisin-{look}'))


def compare(folder):
    """기존 기념물 · 사당과 나란히 놓은 확인용 그림 (마을 마당 색 위)"""
    op = lambda n: Image.open(os.path.join(OUT, f'{n}.png')).convert('RGBA')
    S = 2
    top = ['b-mon_tank10-1', 'b-mon_volley10-1', 'b-mon_def12-1'] + [f'b-{n}-1' for n, _, _ in MONS]
    low = ['b-shrine-2', 'b-shrine-3', 'b-jisin-1', 'b-jisin-2', 'b-jisin-3']
    sheet = Image.new('RGBA', (len(top) * 192 * S, 272 * S + 544), (227, 192, 138, 255))
    for i, n in enumerate(top):
        sheet.alpha_composite(op(n).resize((192 * S, 272 * S), Image.LANCZOS), (i * 192 * S, 0))
    for i, n in enumerate(low):
        sheet.alpha_composite(op(n), (i * 384, 272 * S))
    dst = os.path.join(folder, 'village-art-compare.png')
    sheet.convert('RGB').save(dst, optimize=True)
    return dst


if __name__ == '__main__':
    build()
    if len(sys.argv) > 1:
        print(compare(sys.argv[1]))
