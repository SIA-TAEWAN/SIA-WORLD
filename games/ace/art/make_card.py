"""로비 카드 그림 shared/images/card-ace.png (640×400) — 받은 SpriteCook 그림(기체 · 보스)을 하늘 위에 배치한다.
python games/ace/art/make_card.py  (games/ace 밖에서 실행해도 됨)
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ART = HERE.parent / 'public' / 'art'
OUT = HERE.parent.parent.parent / 'shared' / 'images' / 'card-ace.png'
W, H = 640, 400
INK = (42, 26, 16)
SKY_TOP, SKY_MID, SKY_BOTTOM = (74, 168, 255), (159, 214, 255), (255, 233, 184)
PINK, WHITE, GOLD = (255, 77, 109), (255, 255, 255), (255, 211, 77)

img = Image.new('RGB', (W, H))
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / H
    a, b, k = (SKY_TOP, SKY_MID, t / 0.6) if t < 0.6 else (SKY_MID, SKY_BOTTOM, (t - 0.6) / 0.4)
    d.line([(0, y), (W, y)], fill=tuple(round(a[i] + (b[i] - a[i]) * k) for i in range(3)))

def cloud(cx, cy, s):
    for dx, dy, r in [(-1.0, 0.2, 0.55), (0, 0, 0.75), (1.0, 0.2, 0.55), (0.5, -0.35, 0.5)]:
        x, y, rr = cx + dx * s, cy + dy * s, r * s
        d.ellipse([x - rr - 3, y - rr - 3, x + rr + 3, y + rr + 3], fill=INK)
    for dx, dy, r in [(-1.0, 0.2, 0.55), (0, 0, 0.75), (1.0, 0.2, 0.55), (0.5, -0.35, 0.5)]:
        x, y, rr = cx + dx * s, cy + dy * s, r * s
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=WHITE)

cloud(90, 300, 46); cloud(560, 330, 40); cloud(150, 80, 30)

def paste(name, w, cx, cy, rot=0):
    im = Image.open(ART / f'{name}.png').convert('RGBA')
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    if rot:
        im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
    img.paste(im, (round(cx - im.width / 2), round(cy - im.height / 2)), im)

# 보스 (요괴왕 모함) 오른쪽 위, 적 탄
paste('boss-12', 250, 520, 95)
for x, y in [(400, 150), (430, 185), (455, 220), (380, 205), (470, 160), (350, 175)]:
    d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=INK)
    d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=PINK)
    d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=WHITE)
# 내 탄
for x, y in [(282, 190), (298, 160), (282, 130), (298, 100), (232, 230), (352, 230)]:
    d.rounded_rectangle([x - 5, y - 14, x + 5, y + 14], radius=5, fill=INK)
    d.rounded_rectangle([x - 3, y - 12, x + 3, y + 12], radius=3, fill=GOLD)
# 기체 셋 (청룡호 가운데, 백호호 · 옥토끼호 양옆)
paste('ship-tiger', 110, 175, 300, 6)
paste('ship-rabbit', 105, 410, 305, -6)
paste('ship-dragon', 150, 290, 280)

img.save(OUT, optimize=True)
print('saved', OUT)
