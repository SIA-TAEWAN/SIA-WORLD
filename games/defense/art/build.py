"""SpriteCook 원본(art/*.png) → 게임이 쓰는 그림(public/art/*.png, shared/images/card-defense.png).

쓰는 법 (games/defense 에서):  python art/build.py
- 투사체·이펙트·배치 칸: 투명 여백을 잘라 내고 아래 SIZES 의 칸(너비×높이) 가운데에 FIT 크기로 놓는다.
  칸의 크기는 src/scenes/art.ts 의 코드 그림과 같아야 한다 (화면에는 그 절반 크기로 그려진다).
- 놓인 칸(slotOn)은 따로 만들지 않고 빈 칸 그림을 DESIGN.md 의 노란색(#FFD34D)으로 물들여 만든다.
- 바닥 타일은 512×512 로 줄이고, 캐릭터가 잘 보이게 DESIGN.md 의 바탕색 쪽으로 섞어 무늬를 옅게 한다.
- 256색 팔레트 PNG 로 저장해 용량을 줄인다.

art/ 의 원본은 저장소 용량 때문에 256색으로 줄여 둔 것이다 (크기는 그대로, 약 700~1376px).
처음 받은 그대로의 원본이 필요하면 spritecook-assets.json 의 asset id 로 SpriteCook 에서 다시 받는다.
"""
import hashlib
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'art')
CARD_OUT = os.path.join(HERE, '..', '..', '..', 'shared', 'images', 'card-defense.png')
FIT = 0.94

# 이름 → (너비, 높이): art.ts 의 코드 그림과 같은 크기
SIZES = {
    'p-shuriken': (48, 48), 'p-cake': (64, 64), 'p-venom': (48, 48), 'p-arrow': (64, 32),
    'p-stone': (48, 48), 'p-feather': (48, 48), 'p-puppy': (64, 64),
    'fx-pop': (192, 192), 'fx-wool': (192, 192), 'fx-coin': (64, 64),
    'fx-slash': (256, 256), 'fx-bell': (96, 96),
}
SLOT = 136
# 바닥 타일: 이름 → (섞을 바탕색, 원본의 비율). 바탕색은 DESIGN.md 의 값 (art.ts 의 BG.ground 와 같다)
TILES = {
    'tile-field': ((0x7C, 0xC0, 0x8A), 0.55),
    'tile-bamboo': ((0x6C, 0xC6, 0xB5), 0.38),
    'tile-palace': ((0x7F, 0xB8, 0xE8), 0.5),
    'tile-underworld': ((0xC9, 0xD1, 0xDD), 0.5),
}
TILE = 512


def sha12(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def load(name):
    return Image.open(os.path.join(HERE, name + '.png'))


def save(im, name, colors=256):
    out = os.path.join(OUT, name + '.png')
    method = Image.Quantize.FASTOCTREE if im.mode == 'RGBA' else Image.Quantize.MEDIANCUT
    im.quantize(colors, method=method, dither=Image.Dither.NONE).save(out, optimize=True)
    return out


def trim(src):
    src = src.convert('RGBA')
    return src.crop(src.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())


def fit(src, w, h, k=FIT):
    """알파를 미리 곱해서 줄인다 (가장자리에 배경색이 번지지 않게)"""
    src = trim(src)
    s = min(w * k / src.width, h * k / src.height)
    nw, nh = max(1, round(src.width * s)), max(1, round(src.height * s))
    small = src.convert('RGBa').resize((nw, nh), Image.LANCZOS).convert('RGBA')
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    canvas.paste(small, ((w - nw) // 2, (h - nh) // 2))
    return canvas


def tile(name, base, keep):
    src = load(name).convert('RGB').resize((TILE, TILE), Image.LANCZOS)
    return save(Image.blend(Image.new('RGB', (TILE, TILE), base), src, keep), name, 64)


def slots():
    pad = fit(load('slot'), SLOT, SLOT, 0.97)
    # 빈 칸: 조금 옅게 + 가운데 더하기 표시 (여기에 놓을 수 있다)
    empty = pad.copy()
    d = ImageDraw.Draw(empty)
    c, ink = SLOT // 2, (0x7A, 0x5A, 0x3A, 255)
    d.rounded_rectangle((c - 17, c - 5, c + 17, c + 5), 5, fill=ink)
    d.rounded_rectangle((c - 5, c - 17, c + 5, c + 17), 5, fill=ink)
    a = save(empty, 'slot')
    # 놓인 칸: 노란색으로 물들인다 (밝기는 그대로)
    r, g, b, al = pad.split()
    lum = Image.merge('RGB', (r, g, b)).convert('L')
    yellow = Image.merge('RGB', (lum.point(lambda v: min(255, int(v * 0xFF / 215))), lum.point(lambda v: min(255, int(v * 0xD3 / 215))), lum.point(lambda v: min(255, int(v * 0x4D / 215)))))
    on = Image.merge('RGBA', (*yellow.split(), al))
    return a, save(on, 'slotOn')


def wide(name, out, w, h, colors=256):
    """가운데를 w:h 비율로 잘라 w×h 로 줄인다"""
    src = load(name).convert('RGB')
    if src.width / src.height > w / h:
        cw = round(src.height * w / h)
        x = (src.width - cw) // 2
        src = src.crop((x, 0, x + cw, src.height))
    else:
        ch = round(src.width * h / w)
        y = (src.height - ch) // 2
        src = src.crop((0, y, src.width, y + ch))
    im = src.resize((w, h), Image.LANCZOS)
    im.quantize(colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(out, optimize=True)
    return out


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    made = []
    for name, (w, h) in SIZES.items():
        made.append((name, save(fit(load(name), w, h), name)))
    for name, (base, keep) in TILES.items():
        made.append((name, tile(name, base, keep)))
    a, b = slots()
    made += [('slot', a), ('slotOn', b)]
    made.append(('main', wide('main', os.path.join(OUT, 'main.png'), 540, 960)))
    made.append(('map', wide('map', os.path.join(OUT, 'map.png'), 960, 400)))
    total = 0
    for name, out in made:
        total += os.path.getsize(out)
        src = os.path.join(HERE, name.split(' ')[0] + '.png')
        print(f'{name:22s} {os.path.getsize(out) // 1024:4d} KB  src sha12 {sha12(src) if os.path.exists(src) else "-"}')
    c = wide('card', CARD_OUT, 640, 400)
    print(f'card-defense  640x400 {os.path.getsize(c) // 1024} KB  src sha12 {sha12(os.path.join(HERE, "card.png"))}')
    print(f'public/art new total {total // 1024} KB')
