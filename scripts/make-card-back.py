# 카지노 트럼프 뒷면 (shared/images/cards/back.png) 그리기. 저장소 루트에서: python scripts/make-card-back.py
# 11-26 C안: 먹색 바탕 + 흐린 작은 마름모 + 흰 테두리 띠 + 가운데 흰 원 + 주황 발바닥 (A·B안도 back() 인자로 다시 그릴 수 있다)
import os, math
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, SS = 360, 512, 4

def rgb(n, a=255): return ((n >> 16) & 255, (n >> 8) & 255, n & 255, a)
OUTLINE = rgb(0x2a1a10); INK = rgb(0x1f1c1a); WHITE = rgb(0xffffff)
PAW = (206, 139, 73, 255)          # 지금 뒷면의 발바닥 주황 (그림에서 읽은 값)
FELTS = [rgb(0x468c59), rgb(0x4b7fb4)]

def paw(d, cx, cy, s, fill, edge=None, ew=0):
    """발바닥: 큰 볼록살 + 발가락 4개. s = 전체 폭. edge 가 있으면 먼저 조금 크게 그려 테두리로."""
    def shapes(g, col):
        e = lambda x, y, rx, ry: d.ellipse([cx + (x - rx) * s - g, cy + (y - ry) * s - g, cx + (x + rx) * s + g, cy + (y + ry) * s + g], fill=col)
        # 볼록살 (둥근 세모: 원 셋 + 가운데)
        e(0, 0.14, 0.2, 0.17); e(-0.15, 0.25, 0.15, 0.13); e(0.15, 0.25, 0.15, 0.13); e(0, 0.24, 0.2, 0.13)
        # 발가락
        e(-0.37, -0.03, 0.105, 0.135); e(0.37, -0.03, 0.105, 0.135)
        e(-0.14, -0.25, 0.11, 0.15); e(0.14, -0.25, 0.11, 0.15)
    if edge: shapes(ew, edge)
    shapes(0, fill)

def flower(d, cx, cy, s, fill, hole):
    for i in range(5):
        a = -math.pi / 2 + i * 2 * math.pi / 5
        x, y = cx + math.cos(a) * s * 0.27, cy + math.sin(a) * s * 0.27
        d.ellipse([x - s * 0.22, y - s * 0.22, x + s * 0.22, y + s * 0.22], fill=fill)
    d.ellipse([cx - s * 0.13, cy - s * 0.13, cx + s * 0.13, cy + s * 0.13], fill=hole)

def diamond(d, cx, cy, s, fill):
    d.polygon([(cx, cy - s), (cx + s * 0.72, cy), (cx, cy + s), (cx - s * 0.72, cy)], fill=fill)

def back(pattern, R=104, soft=255):
    """pattern: 'none' | 'paws' | 'diamonds' | 'ring'.  R = 가운데 원 반지름"""
    k = SS
    img = Image.new('RGBA', (W * k, H * k), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    rr = lambda m, r, col: d.rounded_rectangle([m * k, m * k, (W - m) * k - 1, (H - m) * k - 1], r * k, fill=col)
    rr(0, 34, OUTLINE)          # 굵은 갈색 테두리
    rr(7, 28, WHITE)            # 흰 테두리 띠
    rr(24, 16, INK)             # 먹색 바탕
    cx, cy = W * k / 2, H * k / 2
    pc = (255, 255, 255, soft)
    lay = Image.new('RGBA', img.size, (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
    far = lambda x, y, m: math.hypot(x - W / 2, y - H / 2) > R + m
    if pattern == 'paws':
        # 화투 뒷면처럼: 4칸 × 8줄, 발자국과 꽃이 번갈아
        xs = [66, 142, 218, 294]; ys = [61 + i * 55.7 for i in range(8)]
        for j, y in enumerate(ys):
            for i, x in enumerate(xs):
                if not far(x, y, 22): continue
                if (i + j) % 2 == 0: paw(ld, x * k, y * k, 34 * k, pc)
                else: flower(ld, x * k, y * k, 30 * k, pc, INK)
    elif pattern == 'diamonds':
        # 엇갈린 작은 마름모
        row = 0; y = 52
        while y < H - 40:
            x = 54 + (21 if row % 2 else 0)
            while x < W - 44:
                if far(x, y, 14): diamond(ld, x * k, y * k, 7.5 * k, pc)
                x += 42
            y += 34; row += 1
    elif pattern == 'ring':
        # 안쪽에 흰 가는 줄 하나 (무늬 없이 액자만)
        ld.rounded_rectangle([38 * k, 38 * k, (W - 38) * k, (H - 38) * k], 10 * k, outline=pc, width=int(4 * k))
    img.alpha_composite(lay)
    d = ImageDraw.Draw(img)
    circ = lambda r, col: d.ellipse([cx - r * k, cy - r * k, cx + r * k, cy + r * k], fill=col)
    circ(R + 7, OUTLINE)        # 원 바깥 갈색 선 (화투 뒷면처럼 원이 또렷하게)
    circ(R, WHITE)
    circ(R - 13, OUTLINE); circ(R - 19, WHITE)   # 안쪽 고리
    paw(d, cx, cy + 4 * k, (R * 1.28) * k, PAW, OUTLINE, 6 * k)
    return img.resize((W, H), Image.LANCZOS)

back('diamonds', R=104, soft=150).save(os.path.join(REPO, 'shared', 'images', 'cards', 'back.png'))
