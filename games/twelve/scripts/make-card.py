"""
로비 카드 그림 shared/images/card-twelve.png (640x400) 을 기존 그림을 모아 만든다 (임시 — 전용 그림은 ASSETS.md).
  python games/twelve/scripts/make-card.py      (저장소 최상위에서, Pillow 필요)
다른 카드와 같은 하늘색 바탕 + 들판 바닥 위에 대원 셋(쥐·소·호랑이)과 1지형 요괴·보스, 그리고 열쇠.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
ART = ROOT / 'games/twelve/public/art'
FULL = ROOT / 'shared/images/zodiac/full'
OUT = ROOT / 'shared/images/card-twelve.png'
W, H = 640, 400
OUTLINE = (58, 42, 26, 255)  # DESIGN.md --outline #3a2a1a
GOLD = (255, 201, 60, 255)  # --primary #ffc93c
GOLD_DARK = (240, 160, 0, 255)  # --primary-dark #f0a000

# 바탕: 다른 카드와 같은 하늘색
sky = Image.open(ROOT / 'shared/images/card-finger.png').convert('RGBA').getpixel((4, 4))
card = Image.new('RGBA', (W, H), sky)

# 들판: 둥근 땅 (바닥 타일을 깔고 둥글게 오려 낸다) + 두꺼운 테두리 + 아래 흙
tile = Image.open(ART / 'tile-field.png').convert('RGBA').resize((256, 256), Image.LANCZOS)
ground = Image.new('RGBA', (W, H))
for x in range(0, W, 256):
    for y in range(0, H, 256):
        ground.paste(tile, (x, y))
box = (36, 96, W - 36, H - 44)
mask = Image.new('L', (W, H), 0)
ImageDraw.Draw(mask).rounded_rectangle(box, radius=90, fill=255)
d = ImageDraw.Draw(card)
d.rounded_rectangle((box[0], box[1] + 22, box[2], box[3] + 22), radius=90, fill=(126, 84, 44, 255), outline=OUTLINE, width=6)
card.paste(ground, (0, 0), mask)
d.rounded_rectangle(box, radius=90, outline=OUTLINE, width=6)


def put(img: Image.Image, cx: int, bottom: int, h: int, flip: bool = False):
    """그림을 높이 h 로 줄여 (cx, bottom) 에 발이 오게 놓는다. 발밑에 그림자"""
    im = img.convert('RGBA')
    im = im.crop(im.getbbox())
    w = round(im.width * h / im.height)
    im = im.resize((w, h), Image.LANCZOS)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    sh = Image.new('RGBA', (W, H))
    ImageDraw.Draw(sh).ellipse((cx - w * 0.38, bottom - h * 0.07, cx + w * 0.38, bottom + h * 0.06), fill=(0, 0, 0, 70))
    card.alpha_composite(sh.filter(ImageFilter.GaussianBlur(2)))
    card.alpha_composite(im, (cx - w // 2, bottom - h))


# 요괴 쪽 (오른쪽): 뒤에서 앞으로
put(Image.open(ART / 'e-wisp.png'), 370, 196, 62)
put(Image.open(ART / 'b-bigDokkaebi.png'), 478, 262, 190)
put(Image.open(ART / 'e-imp.png'), 388, 300, 84)
put(Image.open(ART / 'e-fox.png'), 566, 318, 78)
# 대원 쪽 (왼쪽): 소 · 호랑이 · 쥐
put(Image.open(FULL / 'ox.png'), 112, 262, 128)
put(Image.open(FULL / 'tiger.png'), 196, 306, 132)
put(Image.open(FULL / 'rat.png'), 286, 332, 118)


def key(cx: int, cy: int, s: float):
    """열쇠 (금색 + 테두리): 고리 · 자루 · 이"""
    k = Image.new('RGBA', (W, H))
    kd = ImageDraw.Draw(k)
    r = 20 * s
    ow = round(5 * s)
    shaft = (cx - 5 * s, cy + r - 4 * s, cx + 5 * s, cy + r + 46 * s)
    for teeth in ((cx + 5 * s, cy + r + 20 * s, cx + 20 * s, cy + r + 29 * s), (cx + 5 * s, cy + r + 34 * s, cx + 16 * s, cy + r + 43 * s)):
        kd.rectangle(teeth, fill=GOLD_DARK, outline=OUTLINE, width=ow)
    kd.rectangle(shaft, fill=GOLD, outline=OUTLINE, width=ow)
    kd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=GOLD, outline=OUTLINE, width=ow)
    kd.ellipse((cx - r * 0.42, cy - r * 0.42, cx + r * 0.42, cy + r * 0.42), fill=sky, outline=OUTLINE, width=ow)
    card.alpha_composite(k.rotate(-28, center=(cx, cy + 20 * s), resample=Image.BICUBIC))


def spark(cx: int, cy: int, r: int):
    d.polygon([(cx, cy - r), (cx + r * 0.3, cy - r * 0.3), (cx + r, cy), (cx + r * 0.3, cy + r * 0.3), (cx, cy + r), (cx - r * 0.3, cy + r * 0.3), (cx - r, cy), (cx - r * 0.3, cy - r * 0.3)], fill=(255, 255, 255, 255), outline=OUTLINE)


key(322, 34, 1.0)
for x, y, r in ((270, 44, 12), (378, 70, 9), (356, 22, 7)):
    spark(x, y, r)

card.convert('RGB').quantize(256, method=Image.MEDIANCUT, dither=Image.NONE).save(OUT, optimize=True)
print(OUT, OUT.stat().st_size)
