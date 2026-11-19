"""SpriteCook 원본(art/*.png) → 게임이 쓰는 그림(public/art/*.png, shared/images/card-survival.png).

쓰는 법 (games/survival 에서):  python art/build.py
- 투명 여백을 잘라 내고, ASSETS.md 의 '만들 크기' 정사각 칸 가운데에 FIT(칸의 몇 %) 크기로 놓는다.
- 줄일 때는 알파를 미리 곱해서 가장자리에 배경색이 번지지 않게 한다.
- 256색 팔레트 PNG 로 저장해 용량을 줄인다.

art/ 의 원본은 저장소 용량 때문에 256색으로 줄여 둔 것이다 (크기는 그대로, 약 900~1024px).
처음 받은 그대로의 원본이 필요하면 spritecook-assets.json 의 asset id 로 SpriteCook 에서 다시 받는다.
지금 public/art 의 파일은 처음 받은 원본으로 만든 것이라, 다시 돌리면 색이 아주 조금 달라질 수 있다.
"""
import hashlib
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'art')
CARD_OUT = os.path.join(HERE, '..', '..', '..', 'shared', 'images', 'card-survival.png')
FIT = 0.9

SIZES = {
    'e-imp': 128, 'e-wisp': 128, 'e-club': 192, 'e-water': 128, 'e-fox': 128,
    'e-bamboo': 128, 'e-guard': 192, 'e-skeleton': 128, 'e-spirit': 128,
    'b-bigDokkaebi': 512, 'b-dueoksini': 512, 'b-bulgasal': 640,
    'b-jangsanbeom': 512, 'b-centipede': 512, 'b-gumiho': 640,
    'b-guardCaptain': 512, 'b-yagwanggwi': 512, 'b-imugi': 640,
    'b-reaper': 512, 'b-gangcheori': 640, 'b-yeomra': 640,
}


def sha12(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def sprite(name, size):
    src = Image.open(os.path.join(HERE, name + '.png')).convert('RGBA')
    src = src.crop(src.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())
    k = size * FIT / max(src.size)
    w, h = max(1, round(src.width * k)), max(1, round(src.height * k))
    small = src.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(small, ((size - w) // 2, (size - h) // 2))
    out = os.path.join(OUT, name + '.png')
    canvas.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out, optimize=True)
    return out


def card():
    src = Image.open(os.path.join(HERE, 'card.png')).convert('RGB')
    w = round(src.height * 1.6)
    x = (src.width - w) // 2
    im = src.crop((x, 0, x + w, src.height)).resize((640, 400), Image.LANCZOS)
    im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(CARD_OUT, optimize=True)
    return CARD_OUT


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name, size in SIZES.items():
        out = sprite(name, size)
        total += os.path.getsize(out)
        print(f'{name:16s} {size:4d}  {os.path.getsize(out) // 1024:4d} KB  src sha12 {sha12(os.path.join(HERE, name + ".png"))}')
    c = card()
    print(f'card-survival     640x400 {os.path.getsize(c) // 1024} KB  src sha12 {sha12(os.path.join(HERE, "card.png"))}')
    print(f'public/art total {total // 1024} KB')
