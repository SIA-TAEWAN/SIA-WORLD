"""SpriteCook 원본 → 게임이 쓰는 그림(public/art/*.png). 시아돌격대·시아핑거 art/build.py 와 같은 방식.

쓰는 법 (games/twelve 에서):  python art/build.py
- 원본은 저장소에 넣지 않는다 (art/raw 는 .gitignore). 다시 만들려면 art/ids.tsv 의 asset id 로 SpriteCook 에서 받아 art/raw/<이름>.png 로 둔다.
- 낱개 그림(SIZES): 투명 여백을 잘라 칸 가운데에 맞춘다. BODY 에 적은 그림은 가장 큰 덩어리만 남긴다(둘레에 떠 있는 것을 뺀다).
- 지형 바닥(floor-r01~r12)은 시아핑거가 만든 것(games/finger/public/art)을 그대로 복사한다 — 같은 열두 지형이다. asset id 는 핑거의 목록에서 옮겨 적는다.
- 256색 팔레트 PNG 로 저장하고 spritecook-assets.json 을 새로 적는다.
- 만든 다음 src/scenes/art.ts 의 ART_FILES 에 이름을 적어야 게임이 쓴다.
"""
import hashlib
import json
import os
import shutil
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
OUT = os.path.join(HERE, '..', 'public', 'art')
MANIFEST = os.path.join(HERE, '..', 'spritecook-assets.json')
FINGER = os.path.join(HERE, '..', '..', 'finger')
FIT = 0.97

SIZES = {'b-final': (512, 512)}
BODY = {'b-final'}
LABEL = {'b-final': '최종보스 어둑시니 (gpt-image-2 low · 화풍 참고 야광귀·염라대왕·저승사자 · 둘레의 열쇠는 build.py 가 뺀다)'}
FLOORS = [f'floor-r{n:02d}' for n in range(1, 13)]


def sha12(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def body(src):
    """바깥 투명한 곳에서 떨어져 있는 작은 덩어리를 지운다: 가운데 점에서 이어진 불투명한 곳만 남긴다"""
    a = src.getchannel('A').point(lambda v: 255 if v > 8 else 0)
    ImageDraw.floodfill(a, (a.width // 2, a.height // 2), 128)
    keep = a.point(lambda v: 255 if v == 128 else 0)
    out = src.copy()
    out.putalpha(Image.composite(src.getchannel('A'), Image.new('L', src.size, 0), keep))
    return out


def fit(src, w, h):
    box = src.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    src = src.crop(box) if box else src
    s = min(w * FIT / src.width, h * FIT / src.height)
    nw, nh = max(1, round(src.width * s)), max(1, round(src.height * s))
    small = src.convert('RGBa').resize((nw, nh), Image.LANCZOS).convert('RGBA')
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    canvas.paste(small, ((w - nw) // 2, (h - nh) // 2))
    return canvas


def main():
    ids = dict(line.strip().split('\t') for line in open(os.path.join(HERE, 'ids.tsv'), encoding='utf-8') if '\t' in line)
    assets = []
    for name, (w, h) in SIZES.items():
        raw = os.path.join(RAW, name + '.png')
        out = os.path.join(OUT, name + '.png')
        if os.path.exists(raw):
            src = Image.open(raw).convert('RGBA')
            if name in BODY:
                src = body(src)
            fit(src, w, h).quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out, optimize=True)
        assets.append({'asset_id': ids[name], 'sha12': sha12(out), 'label': f'{name} → public/art/{name}.png ({w}x{h}) · {LABEL.get(name, "")}'})
    finger = {a['label'].split(' ')[0]: a['asset_id'] for a in json.load(open(os.path.join(FINGER, 'spritecook-assets.json'), encoding='utf-8'))['assets'] if 'label' in a}
    for name in FLOORS:
        out = os.path.join(OUT, name + '.png')
        shutil.copyfile(os.path.join(FINGER, 'public', 'art', name + '.png'), out)
        assets.append({'asset_id': finger[name], 'sha12': sha12(out), 'label': f'{name} → public/art/{name}.png (320x320, 이어 붙는 바닥 무늬 · 시아핑거 그림을 복사)'})
    note = ('시아열두길 전용 SpriteCook 그림 목록 (art/build.py 가 적는다). b-final 은 열두길에서 만든 그림, floor-r01~r12 는 시아핑거의 지형 바닥을 복사한 것이다. '
            'public/art 의 요괴(e-*)·보스(b-* 12종)·tile-*·fx-pop 은 시아디펜스(games/defense/public/art)에서 복사한 것이고 asset id 는 games/defense/spritecook-assets.json 에 있다.')
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump({'note': note, 'assets': assets}, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(len(assets), 'assets')


main()
