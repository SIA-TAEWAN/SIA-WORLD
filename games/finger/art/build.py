"""SpriteCook 원본(art/raw/*.png) → 게임이 쓰는 그림(public/art/*.png). 시아돌격대 art/build.py 와 같은 방식.

쓰는 법 (games/finger 에서):  python art/build.py
- 원본은 저장소에 넣지 않는다 (art/raw 는 .gitignore). 다시 만들려면 art/ids.tsv 의 asset id 로 SpriteCook 에서 받아
  art/raw/<이름>.png 로 둔다 (art/get.sh).
- 낱개 그림(SIZES): 투명 여백을 잘라 칸 가운데에 맞춘다.
- 이어 붙이는 9칸 그림(SLICES · 방 테두리와 네모 장애물): 모서리 4 · 변 4 · 가운데 1칸을 한 장에 모은다.
  변과 가운데는 반쪽을 거울처럼 뒤집어 붙여 이어 붙여도 이음매가 없다. 판은 src/scenes/art.ts 의 tiled9 가 그린다.
  칸 배치: [모서리 b][틈 GAP][변 E][틈 GAP][모서리 b] (가로세로 같다). b·E 는 src/artlist.ts 의 ART_SLICE 와 같아야 한다.
- 배경이 있는 그림(WIDE): 가운데를 비율대로 잘라 줄인다. 로비 카드는 main 을 16:10 으로 자른 것.
- 256색 팔레트 PNG 로 저장하고 spritecook-assets.json 을 새로 적는다.
"""
import hashlib
import json
import os
from PIL import Image, ImageDraw, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
OUT = os.path.join(HERE, '..', 'public', 'art')
MANIFEST = os.path.join(HERE, '..', 'spritecook-assets.json')
CARD_OUT = os.path.join(HERE, '..', '..', '..', 'shared', 'images', 'card-finger.png')
FIT = 0.97
GAP = 4

HEROES = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig']
FOES = ['e-imp', 'e-wisp', 'e-club', 'e-water', 'e-fox', 'e-bamboo', 'e-guard', 'e-skeleton', 'e-spirit']
# 보스: 맞는 표정을 원래 그림(public/art/b-*.png, 512 / 640)과 같은 크기·같은 자리에
BOSSES = ['b-bigDokkaebi', 'b-dueoksini', 'b-bulgasal', 'b-jangsanbeom', 'b-centipede', 'b-gumiho',
          'b-guardCaptain', 'b-yagwanggwi', 'b-imugi', 'b-reaper', 'b-gangcheori', 'b-yeomra']
# 지역 12곳의 방 바닥: 이어 붙는(seamless) 1024 원본 → FLOOR px. 채도·대비를 조금 낮추고(요괴·대원이 잘 보이게), 어두운 바닥은 조금 밝힌다
FLOOR = 320
FLOOR_TUNE = {'floor-r06': 1.12, 'floor-r11': 1.08, 'floor-r12': 1.06}

SIZES = {
    'o-pillar': (160, 160),
    'o-portal': (160, 160),
    'fx-boom': (256, 256),
    'fx-heal': (96, 96),
    'fx-shield': (96, 96),
    'fx-poison': (96, 96),
    'fx-fang': (96, 96),
    'fx-ball': (96, 96),
    # 판 밖 화면: 메뉴 버튼 아이콘
    'ui-go': (128, 128),
    'ui-heroes': (128, 128),
    'ui-up': (128, 128),
    'ui-tower': (128, 128),
    'ui-rank': (128, 128),
}
for _h in HEROES:
    SIZES[f'h-{_h}'] = (192, 192)
    SIZES[f'cut-{_h}'] = (400, 400)
# 오른쪽(필살기 이름 쪽)을 보게 좌우를 뒤집는 컷인
FLIP = {'cut-rat', 'cut-pig'}
# 배경 지우기가 안쪽까지 지운 그림: 바깥과 이어지지 않은 투명한 곳을 다시 채운다
SOLID = {'o-block', 'o-pillar', 'fx-heal', 'fx-ball', 'fx-shield'} | {f'h-{h}' for h in HEROES}

# 9칸 그림: 이름 → (모서리 b, 변 E, 원본에서 모서리로 볼 비율, 가운데 비움?)
SLICES = {
    'wall-field': (88, 128, None, True),
    'wall-bamboo': (88, 128, None, True),
    'wall-palace': (88, 128, None, True),
    'wall-underworld': (88, 128, None, True),
    'o-block': (28, 72, 0.14, False),
    'o-thorn': (40, 160, 0.085, False),
    'o-board': (48, 128, 0.12, False),
}
# 방 테두리: 벽 안쪽 선이 그림 가장자리에서 이만큼 (그림 px) 떨어지게 맞춘다 = src/artlist.ts 의 WALL_INSET
WALL_INSET = 64

# 배경 포함 그림: 이름 → (너비, 높이)
WIDE = {
    'main': (1080, 600),
    'bg-field': (480, 270),
    'bg-bamboo': (480, 270),
    'bg-palace': (480, 270),
    'bg-underworld': (480, 270),
    'bg-tower': (720, 405),
}


def sha12(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def trim(src):
    src = src.convert('RGBA')
    box = src.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    return src.crop(box) if box else src


def solid(im):
    """바깥에서 이어지지 않은 (반)투명한 곳을 불투명하게"""
    im = im.convert('RGBA')
    a = im.getchannel('A')
    pad = Image.new('L', (im.width + 2, im.height + 2), 0)
    pad.paste(a.point(lambda v: 255 if v > 40 else 0), (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128)
    inside = pad.crop((1, 1, im.width + 1, im.height + 1)).point(lambda v: 0 if v == 128 else 255)
    rgb = Image.composite(im.convert('RGB'), Image.new('RGB', im.size, (255, 255, 255)), a.point(lambda v: 255 if v > 0 else 0))
    # 투명했던 안쪽은 흰색에 원래 색을 알파만큼 섞어 채운다
    flat = Image.composite(im.convert('RGB'), Image.new('RGB', im.size, (236, 232, 222)), a)
    out = Image.composite(flat, rgb, inside).convert('RGBA')
    out.putalpha(Image.composite(Image.new('L', im.size, 255), a, inside))
    return out


def rs(im, w, h):
    return im.convert('RGBa').resize((max(1, w), max(1, h)), Image.LANCZOS).convert('RGBA')


def fit(src, w, h):
    src = trim(src)
    s = min(w * FIT / src.width, h * FIT / src.height)
    small = rs(src, round(src.width * s), round(src.height * s))
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    canvas.paste(small, ((w - small.width) // 2, (h - small.height) // 2))
    return canvas


def wide(src, w, h, ay=0.5):
    src = src.convert('RGB')
    if src.width / src.height > w / h:
        cw = round(src.height * w / h)
        x = (src.width - cw) // 2
        src = src.crop((x, 0, x + cw, src.height))
    else:
        ch = round(src.width * h / w)
        y = round((src.height - ch) * ay)
        src = src.crop((0, y, src.width, y + ch))
    return src.resize((w, h), Image.LANCZOS)


def save(im, path, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE):
    im.quantize(256, method=method, dither=dither).save(path, optimize=True)


def mirror_h(half):
    out = Image.new('RGBA', (half.width * 2, half.height), (0, 0, 0, 0))
    out.paste(half, (0, 0))
    out.paste(half.transpose(Image.FLIP_LEFT_RIGHT), (half.width, 0))
    return out


def mirror_v(half):
    out = Image.new('RGBA', (half.width, half.height * 2), (0, 0, 0, 0))
    out.paste(half, (0, 0))
    out.paste(half.transpose(Image.FLIP_TOP_BOTTOM), (0, half.height))
    return out


def band(src):
    """방 테두리 원본에서 네 변 가운데의 (벽 시작, 벽 끝) 을 잰다 (가장자리에서 px). 위 · 오른쪽 · 아래 · 왼쪽"""
    a = src.getchannel('A')
    W, H = src.size
    out = []
    for side in range(4):
        runs = []
        for k in range(-3, 4):
            if side in (0, 2):
                x = W // 2 + k * 9
                line = [a.getpixel((x, y if side == 0 else H - 1 - y)) for y in range(H // 3)]
            else:
                y = H // 2 + k * 9
                line = [a.getpixel((W - 1 - x if side == 1 else x, y)) for x in range(W // 3)]
            o = next((i for i, v in enumerate(line) if v > 128), 0)
            i = next((j for j in range(o, len(line)) if line[j] < 128), len(line))
            runs.append((o, i))
        runs.sort(key=lambda r: r[1])
        out.append(runs[len(runs) // 2])
    return out


# 배경 지우기가 안쪽에 흰 얼룩을 남긴 방 테두리: 가장자리 12% 안쪽의 거의 흰 곳을 지운다 (얼룩이 벽 띠에 붙어 있어 band 를 늘이므로 band 전에)
WHITE_SPOTS = {'wall-palace'}


def unwhite(src):
    src = src.copy()
    W, H = src.size
    px = src.load()
    m = 0.12
    for y in range(int(H * m), int(H * (1 - m))):
        for x in range(int(W * m), int(W * (1 - m))):
            r, g, b, a = px[x, y]
            if a and min(r, g, b) > 232:
                px[x, y] = (0, 0, 0, 0)
    return src


def clear_inside(src, inner):
    """방 테두리 가운데(벽 안쪽)에 남은 배경 찌꺼기를 지운다"""
    W, H = src.size
    t, r, b, l = inner
    src = src.copy()
    src.paste((0, 0, 0, 0), (l + 2, t + 2, W - r - 2, H - b - 2))
    return src


def slice9(name, b, E, cfrac, hollow):
    src = trim(Image.open(os.path.join(RAW, name + '.png')))
    if name in SOLID:
        src = solid(src)
    N = 2 * b + E + 2 * GAP
    half = E // 2
    if hollow:
        if name in WHITE_SPOTS:
            src = unwhite(src)
        bands = band(src)
        inner = [i for _, i in bands]
        src = clear_inside(src, inner)
        # 벽 안쪽 선이 WALL_INSET 에 오도록 변마다 배율을 맞춘다 (가로·세로 따로)
        sx = WALL_INSET / ((inner[1] + inner[3]) / 2)
        sy = WALL_INSET / ((inner[0] + inner[2]) / 2)
        src = rs(src, round(src.width * sx), round(src.height * sy))
        c = b
    else:
        s = b / (cfrac * src.width)
        src = rs(src, round(src.width * s), round(src.height * s))
        c = b
    W, H = src.size
    atlas = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    p0, p1, p2 = 0, b + GAP, b + GAP + E + GAP
    # 모서리
    atlas.paste(src.crop((0, 0, c, c)), (p0, p0))
    atlas.paste(src.crop((W - c, 0, W, c)), (p2, p0))
    atlas.paste(src.crop((0, H - c, c, H)), (p0, p2))
    atlas.paste(src.crop((W - c, H - c, W, H)), (p2, p2))
    # 변: 가운데에서 반 칸을 잘라 거울처럼 붙인다
    cx, cy = W // 2, H // 2
    atlas.paste(mirror_h(src.crop((cx - half, 0, cx, c))), (p1, p0))
    atlas.paste(mirror_h(src.crop((cx - half, H - c, cx, H))), (p1, p2))
    atlas.paste(mirror_v(src.crop((0, cy - half, c, cy))), (p0, p1))
    atlas.paste(mirror_v(src.crop((W - c, cy - half, W, cy))), (p2, p1))
    if not hollow:
        atlas.paste(mirror_v(mirror_h(src.crop((cx - half, cy - half, cx, cy)))), (p1, p1))
    # 틈으로 가장자리 색을 2px 번지게 (줄여 그릴 때 옆 칸 색이 섞이지 않게)
    px = atlas.load()
    for lo, hi in ((p0, p0 + b), (p1, p1 + E), (p2, p2 + b)):
        for q0, q1 in ((p0, p0 + b), (p1, p1 + E), (p2, p2 + b)):
            for k in range(1, 3):
                for x in range(lo, hi):
                    if q0 - k >= 0 and (q0 - k) not in range(p0, p0 + b) and (q0 - k) not in range(p1, p1 + E):
                        px[x, q0 - k] = px[x, q0]
                    if q1 - 1 + k < N and (q1 - 1 + k) not in range(p1, p1 + E) and (q1 - 1 + k) not in range(p2, p2 + b):
                        px[x, q1 - 1 + k] = px[x, q1 - 1]
                for y in range(q0, q1):
                    if lo - k >= 0 and (lo - k) not in range(p0, p0 + b) and (lo - k) not in range(p1, p1 + E):
                        px[lo - k, y] = px[lo, y]
                    if hi - 1 + k < N and (hi - 1 + k) not in range(p1, p1 + E) and (hi - 1 + k) not in range(p2, p2 + b):
                        px[hi - 1 + k, y] = px[hi - 1, y]
    return atlas


def laser():
    """레이저 한 토막: 줄만 잘라 256x64 로. 배경 지우기가 지운 흰 심을 다시 채운다. 세로 레이저용 파랑(fx-laser-v)도 만든다"""
    src = trim(Image.open(os.path.join(RAW, 'fx-laser.png')))
    W, H = src.size
    strip = src.crop((W // 4, 0, W * 3 // 4, H))
    white = Image.new('RGBA', strip.size, (255, 255, 255, 255))
    a = strip.getchannel('A')
    rows = [y for y in range(H) if a.getpixel((strip.width // 2, y)) > 128]
    core = Image.new('RGBA', strip.size, (0, 0, 0, 0))
    if rows:
        core.paste(white.crop((0, rows[0], strip.width, rows[-1] + 1)), (0, rows[0]))
    core.alpha_composite(strip)
    pink = core.resize((256, 64), Image.LANCZOS)
    # 분홍 → 파랑 (R 과 B 를 바꾼다. 흰 심과 갈색 테두리는 거의 그대로)
    r, g, bl, al = pink.split()
    blue = Image.merge('RGBA', (bl, g.point(lambda v: min(255, int(v * 1.25) + 20)), r, al))
    return pink, blue


def hit(name):
    """맞는 표정: 원래 그림(public/art/<요괴>.png)과 같은 크기·같은 자리에 놓는다"""
    base = Image.open(os.path.join(OUT, name + '.png')).convert('RGBA')
    box = base.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    src = trim(Image.open(os.path.join(RAW, name + '-hit.png')))
    bw, bh = box[2] - box[0], box[3] - box[1]
    s = min(bw / src.width, bh / src.height)
    small = rs(src, round(src.width * s), round(src.height * s))
    canvas = Image.new('RGBA', base.size, (0, 0, 0, 0))
    canvas.paste(small, (box[0] + (bw - small.width) // 2, box[3] - small.height))
    return canvas


def floor(name):
    """이어 붙는 바닥: 3×3 으로 붙여 줄인 뒤 가운데를 잘라 가장자리도 이어지게 줄인다"""
    src = Image.open(os.path.join(RAW, name + '.png')).convert('RGB')
    W, H = src.size
    big = Image.new('RGB', (W * 3, H * 3))
    for i in range(3):
        for j in range(3):
            big.paste(src, (i * W, j * H))
    small = big.resize((FLOOR * 3, FLOOR * 3), Image.LANCZOS).crop((FLOOR, FLOOR, FLOOR * 2, FLOOR * 2))
    small = ImageEnhance.Contrast(ImageEnhance.Color(small).enhance(0.85)).enhance(0.88)
    if name in FLOOR_TUNE:
        small = ImageEnhance.Brightness(small).enhance(FLOOR_TUNE[name])
    return small


def main():
    ids = dict(line.rstrip('\n').split('\t') for line in open(os.path.join(HERE, 'ids.tsv'), encoding='utf-8') if line.strip())
    made = {}

    def raw(n):
        return os.path.join(RAW, n + '.png')

    for name, (w, h) in SIZES.items():
        if not os.path.exists(raw(name)):
            continue
        im = Image.open(raw(name))
        if name in SOLID:
            im = solid(trim(im))
        im = fit(im, w, h)
        if name in FLIP:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        if name == 'o-portal':
            # 코드가 짝마다 물들이므로 색을 뺀다
            a = im.getchannel('A')
            im = im.convert('L').convert('RGBA')
            im.putalpha(a)
        save(im, os.path.join(OUT, name + '.png'))
        made[name] = (name, f'{w}x{h}')
    for name, (b, E, cfrac, hollow) in SLICES.items():
        if not os.path.exists(raw(name)):
            continue
        im = slice9(name, b, E, cfrac, hollow)
        save(im, os.path.join(OUT, name + '.png'))
        made[name] = (name, f'{im.width}x{im.height}, 9칸 이어 붙임: 모서리 {b} · 변 {E}')
    if os.path.exists(raw('fx-laser')):
        pink, blue = laser()
        save(pink, os.path.join(OUT, 'fx-laser.png'))
        save(blue, os.path.join(OUT, 'fx-laser-v.png'))
        made['fx-laser'] = ('fx-laser', '256x64, 가로로 늘여 씀')
        made['fx-laser-v'] = ('fx-laser', '256x64, fx-laser 를 파랑으로 바꾼 것')
    for foe in FOES + BOSSES:
        if os.path.exists(raw(foe + '-hit')):
            im = hit(foe)
            save(im, os.path.join(OUT, foe + '-hit.png'))
            made[foe + '-hit'] = (foe + '-hit', f'{im.width}x{im.height}, 원래 그림과 같은 자리')
    for r in range(1, 13):
        name = f'floor-r{r:02d}'
        if os.path.exists(raw(name)):
            save(floor(name), os.path.join(OUT, name + '.png'), Image.Quantize.MEDIANCUT, Image.Dither.FLOYDSTEINBERG)
            made[name] = (name, f'{FLOOR}x{FLOOR}, 이어 붙는 바닥 무늬')
    for name, (w, h) in WIDE.items():
        if not os.path.exists(raw(name)):
            continue
        save(wide(Image.open(raw(name)), w, h), os.path.join(OUT, name + '.png'), Image.Quantize.MEDIANCUT, Image.Dither.FLOYDSTEINBERG)
        made[name] = (name, f'{w}x{h}')
    assets = []
    if os.path.exists(raw('main')):
        save(wide(Image.open(raw('main')), 640, 400), CARD_OUT, Image.Quantize.MEDIANCUT, Image.Dither.FLOYDSTEINBERG)
        assets.append({'asset_id': ids['main'], 'sha12': sha12(raw('main')), 'label': '로비 카드 → shared/images/card-finger.png (640x400, main 과 같은 그림을 16:10 으로 자름)'})
        print('로비 카드: shared/images/card-finger.png (640x400)')
    for out_name, (src_name, note) in made.items():
        assets.append({'asset_id': ids[src_name], 'sha12': sha12(raw(src_name)), 'label': f'{out_name} → public/art/{out_name}.png ({note})'})
    refs = os.path.join(HERE, 'refs.tsv')
    if os.path.exists(refs):
        for line in open(refs, encoding='utf-8'):
            if line.strip():
                n, i = line.rstrip('\n').split('\t')
                assets.append({'asset_id': i, 'label': f'참고(올린 그림): 십이지 전신 {n} = shared/images/zodiac/full/{n}.png — h-{n} · cut-{n} 의 reference'})
    manifest = json.load(open(MANIFEST, encoding='utf-8'))
    manifest['assets'] = assets
    json.dump(manifest, open(MANIFEST, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    open(MANIFEST, 'a', encoding='utf-8').write('\n')
    names = sorted(made)
    print(f'만듦 {len(names)}장:', ', '.join(names))
    total = sum(os.path.getsize(os.path.join(OUT, n + '.png')) for n in names)
    print(f'합계 {total / 1024:.0f} KB')


if __name__ == '__main__':
    main()
