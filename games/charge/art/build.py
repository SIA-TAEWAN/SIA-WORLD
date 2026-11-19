"""SpriteCook 원본(art/*.png) → 게임이 쓰는 그림(public/art/*.png). 시아디펜스 art/build.py 와 같은 방식.

쓰는 법 (games/charge 에서):  python art/build.py
- 투명 여백을 잘라 내고 아래 SIZES 의 칸(너비×높이, 화면 크기의 2배) 가운데에 맞춰 놓는다.
  칸의 크기는 src/scenes/art.ts 의 ART_SIZE × 2 와 같아야 한다.
- 문 틀(gate)은 늘여 쓰므로 칸을 꽉 채운다 (비율 무시).
- 256색 팔레트 PNG 로 저장해 용량을 줄이고, spritecook-assets.json 의 sha12 를 새로 적는다.
- 만든 다음 src/scenes/art.ts 의 ART_FILES 에 이름을 적어야 게임이 쓴다.
"""
import hashlib
import json
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'art')
MANIFEST = os.path.join(HERE, '..', 'spritecook-assets.json')
FIT = 0.96

SIZES = {
    'gate': (256, 140),
    'o-log': (280, 104),
    'o-blade': (240, 240),
    'o-pit': (360, 140),
    'crate': (184, 148),
    'h-water': (400, 140),
    'h-bamboo': (400, 100),
    'main': (1080, 600),
}
STRETCH = {'gate'}


def sha12(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def trim(src):
    src = src.convert('RGBA')
    box = src.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    return src.crop(box) if box else src


def fit(src, w, h, stretch):
    src = trim(src)
    if stretch:
        return src.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    s = min(w * FIT / src.width, h * FIT / src.height)
    nw, nh = max(1, round(src.width * s)), max(1, round(src.height * s))
    small = src.convert('RGBa').resize((nw, nh), Image.LANCZOS).convert('RGBA')
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    canvas.paste(small, ((w - nw) // 2, (h - nh) // 2))
    return canvas


def main():
    manifest = json.load(open(MANIFEST, encoding='utf-8'))
    made = []
    for name, (w, h) in SIZES.items():
        path = os.path.join(HERE, name + '.png')
        if not os.path.exists(path):
            continue
        im = fit(Image.open(path), w, h, name in STRETCH)
        out = os.path.join(OUT, name + '.png')
        im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out, optimize=True)
        for a in manifest['assets']:
            if a.get('label', '').startswith(name + ' '):
                a['sha12'] = sha12(path)
        made.append(name)
    json.dump(manifest, open(MANIFEST, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(MANIFEST, 'a', encoding='utf-8').write('\n')
    print('만듦:', ', '.join(made) or '(원본 없음)')
    print("src/scenes/art.ts 의 ART_FILES 에 적을 것:", made)


if __name__ == '__main__':
    main()
