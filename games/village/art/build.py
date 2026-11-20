"""SpriteCook 원본 시트(art/sheets/*.png) → 게임이 쓰는 그림(public/art/*.png, shared/images/card-village.png).

쓰는 법 (games/village 에서):  python art/build.py
- 시트를 칸(가로 3칸 한 줄 · 3×2 · 2×2)으로 나눠 칸마다 투명 여백을 잘라 낸다.
- 건물 그림의 크기(ASSETS.md): 1×1 = 192×272, 2×2 = 384×544. 그림은 아래쪽 가운데에 붙여 놓는다 (칸의 아래 변 = 건물 바닥).
- 줄일 때는 알파를 미리 곱해서 가장자리에 배경색이 번지지 않게 한다. 256색 팔레트 PNG 로 저장해 용량을 줄인다.
- 수확 방울(bubble-*)은 흰 말풍선(코드 그림과 같은 모양)에 자원 아이콘을 얹어 만든다.
art/sheets 의 원본은 저장소 용량 때문에 256색으로 줄여 둔 것이다 (처음 받은 그대로는 spritecook-assets.json 의 asset id 로 다시 받는다).
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SHEETS = os.path.join(HERE, 'sheets')
OUT = os.path.join(HERE, '..', 'public', 'art')
CARD_OUT = os.path.join(HERE, '..', '..', '..', 'shared', 'images', 'card-village.png')
OUTLINE = (42, 26, 16, 255)

# 시트 → 칸마다 이름 (None = 쓰지 않는 칸). row3: 가로 3칸, g32: 3×2, g22: 2×2
B = lambda t: [f'b-{t}-1', f'b-{t}-2', f'b-{t}-3']
SHEET = {
    'hall2': ('row3', B('hall')), 'house2': ('row3', B('house')), 'paddy': ('row3', B('paddy')), 'lumber': ('row3', B('lumber')),
    'storage': ('row3', B('storage')), 'market': ('row3', B('market')), 'quarry': ('row3', B('quarry')), 'mill': ('row3', B('mill')),
    'jar': ('row3', B('jar')), 'pavilion': ('row3', B('pavilion')), 'feast': ('row3', B('feast')), 'shrine': ('row3', B('shrine')),
    'decoA': ('g32', ['b-tree-1', 'b-haystack-1', 'b-flower-1', 'b-scarecrow-1', 'b-bench-1', 'b-stonewall-1']),
    'decoB': ('g32', ['b-lantern-1', 'b-well-1', 'b-jangseung-1', 'b-sotdae-1', 'b-pond-1', 'b-stonetower-1']),
    'giftA': ('g32', ['b-gift_rat-1', 'b-gift_ox-1', 'b-gift_tiger-1', 'b-gift_rabbit-1', 'b-gift_dragon-1', 'b-gift_snake-1']),
    'giftB': ('g32', ['b-gift_horse-1', 'b-gift_sheep-1', 'b-gift_monkey-1', 'b-gift_rooster-1', 'b-gift_dog-1', 'b-gift_pig-1']),
    'monA': ('g32', ['b-mon_tank1-1', 'b-mon_tank10-1', 'b-mon_volley1-1', 'b-mon_volley10-1', 'b-mon_race1-1', 'b-mon_race2-1']),
    'monB': ('g32', ['b-mon_surv_field-1', 'b-mon_surv_bamboo-1', 'b-mon_surv_palace-1', 'b-mon_surv_underworld-1', 'b-mon_def3-1', 'b-mon_def6-1']),
    'monC': ('g22', ['b-mon_def9-1', 'b-mon_def12-1', 'b-mon_matgo-1', 'b-mon_casino-1']),
    'icons': ('g32', ['icon-rice', 'icon-wood', 'icon-stone', 'icon-cake', 'icon-coin', 'icon-special']),
    'misc': ('row3', ['site-1', 'site-2', 'b-road-1']),
    # 땅 밖 자연물 (숲 무늬 · 땅 둘레에 섞어 찍는다)
    'nature': ('g32', ['n-pine', 'n-tree', 'n-bamboo', 'n-bush', 'n-rocks', 'n-flowers']),
    # 아래 메뉴 아이콘 (마지막 초가집 칸은 쓰지 않는다)
    'menu': ('g32', ['menu-build', 'menu-residents', 'menu-requests', 'menu-monuments', 'menu-ranking', None]),
    # 마을 땅 둘레의 돌담 (앞에서 본 토막 둘 · 모퉁이 돌무더기. 기울어진 둘째 칸은 쓰지 않는다)
    'doldam': ('g22', ['w-wall-1', None, 'w-wall-2', 'w-post']),
    # 돌담 발치에 찍는 풀포기 · 들꽃 · 조약돌 (윗줄의 비스듬한 돌담 시안은 쓰지 않는다)
    'yardbits': ('g32', [None, None, None, 'g-tuft', 'g-flowers', 'g-pebbles']),
}
BIG = {'hall', 'pavilion', 'feast', 'shrine'}


def cells(kind, im):
    cols, rows = {'row3': (3, 1), 'g32': (3, 2), 'g22': (2, 2)}[kind]
    w, h = im.width / cols, im.height / rows
    for r in range(rows):
        for c in range(cols):
            yield im.crop((round(c * w), round(r * h), round((c + 1) * w), round((r + 1) * h)))


def clean(im):
    """옆 칸에서 넘어온 조각 · 작은 티끌을 지운다: 알파 덩어리(1/4 크기에서 셈) 가운데 가장 큰 것의 3% 보다 작거나,
    칸 가장자리에 닿은 작은(25% 미만) 덩어리는 버린다"""
    import numpy as np
    from collections import deque
    q = 4
    a = np.array(im.getchannel('A').resize((max(1, im.width // q), max(1, im.height // q)), Image.BOX)) > 24
    h, w = a.shape
    lab = np.zeros((h, w), np.int32)
    comps = []
    for y0 in range(h):
        for x0 in range(w):
            if not a[y0, x0] or lab[y0, x0]:
                continue
            n = len(comps) + 1
            lab[y0, x0] = n
            dq = deque([(y0, x0)])
            area, edge = 0, False
            while dq:
                y, x = dq.popleft()
                area += 1
                if x == 0 or y == 0 or x == w - 1 or y == h - 1:
                    edge = True
                for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= yy < h and 0 <= xx < w and a[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n
                        dq.append((yy, xx))
            comps.append((area, edge))
    if not comps:
        return im
    big = max(c[0] for c in comps)
    keep = np.zeros(len(comps) + 1, bool)
    for i, (area, edge) in enumerate(comps):
        keep[i + 1] = area >= big * 0.03 and not (edge and area < big * 0.25)
    m = Image.fromarray((keep[lab] * 255).astype(np.uint8)).resize(im.size, Image.NEAREST)
    # 덩어리 둘레를 조금 넓혀 외곽선이 잘리지 않게
    from PIL import ImageFilter
    m = m.filter(ImageFilter.MaxFilter(9))
    out = im.copy()
    out.putalpha(Image.fromarray(np.minimum(np.array(im.getchannel('A')), np.array(m))))
    return out


def trim(im):
    im = clean(im)
    box = im.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
    return im.crop(box) if box else im


def shrink(src, w, h):
    return src.convert('RGBa').resize((max(1, w), max(1, h)), Image.LANCZOS).convert('RGBA')


def save(im, name):
    out = os.path.join(OUT, name + '.png')
    im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out, optimize=True)
    return out


def place(src, W, H, fit_w, fit_h, bottom):
    """W×H 칸의 아래쪽 가운데에 (가로 fit_w · 세로 fit_h 비율 안에서) 놓는다"""
    k = min(W * fit_w / src.width, H * fit_h / src.height)
    small = shrink(src, round(src.width * k), round(src.height * k))
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.paste(small, ((W - small.width) // 2, H - bottom - small.height))
    return canvas


def sprite(name, src):
    src = trim(src)
    if name.startswith('icon-') or name.startswith('menu-'):
        return place(src, 96, 96, 0.92, 0.92, 4)
    if name.startswith('n-'):
        return place(src, 192, 272, 0.92, 0.96, 6)
    if name.startswith('w-wall-'):
        # 돌담 토막: 가로를 꽉 채운다 (장면에서 옆 토막과 맞닿게)
        return place(src, 192, 104, 1.0, 1.0, 0)
    if name == 'w-post':
        return place(src, 96, 112, 1.0, 1.0, 0)
    if name.startswith('g-'):
        return place(src, 96, 96, 0.96, 0.96, 2)
    if name == 'b-road-1':
        # 길: 칸을 꽉 채우는 바닥 (위로 솟지 않는다)
        tile = shrink(src, 192, 192)
        canvas = Image.new('RGBA', (192, 272), (0, 0, 0, 0))
        canvas.paste(tile, (0, 80))
        return canvas
    t = name.split('-')[1] if name.startswith('b-') else ''
    big = t in BIG or name == 'site-2'
    W, H = (384, 544) if big else (192, 272)
    if name.startswith('site-'):
        return place(src, W, H, 0.98, 0.72, 6)
    if t in ('paddy',):
        return place(src, W, H, 0.98, 0.72, 8)
    if name.startswith('b-gift_') or name.startswith('b-mon_'):
        return place(src, W, H, 0.84, 0.9, 10)
    kind_deco = t in ('tree', 'haystack', 'flower', 'scarecrow', 'stonewall', 'bench', 'lantern', 'well', 'jangseung', 'sotdae', 'pond', 'stonetower')
    if kind_deco:
        return place(src, W, H, 0.86, 0.92, 10)
    return place(src, W, H, 0.98, 0.96, 8)


def bubble(res, icon):
    """수확 방울 128×148: 흰 동그라미 + 아래 꼬리 + 굵은 갈색 외곽선, 가운데에 자원 아이콘"""
    S = 4
    W, H = 128 * S, 148 * S
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy, r = W // 2, 60 * S, 54 * S
    tail = [(cx - 18 * S, cy + r - 22 * S), (cx + 18 * S, cy + r - 22 * S), (cx, H - 6 * S)]
    lw = 6 * S
    d.ellipse((cx - r - lw, cy - r - lw, cx + r + lw, cy + r + lw), fill=OUTLINE)
    d.polygon([(x, y + (lw if i == 2 else 0)) for i, (x, y) in enumerate(tail)], fill=OUTLINE)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 255))
    d.polygon(tail, fill=(255, 255, 255, 255))
    im = shrink(im, 128, 148)
    ic = shrink(icon, 80, 80)
    im.alpha_composite(ic, (64 - 40, 60 - 40))
    return im


def card():
    src = Image.open(os.path.join(SHEETS, 'card.png')).convert('RGB')
    w = round(src.height * 1.6)
    x = (src.width - w) // 2
    im = src.crop((x, 0, x + w, src.height)).resize((640, 400), Image.LANCZOS)
    im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(CARD_OUT, optimize=True)
    return CARD_OUT


def grass():
    """땅 바닥 무늬: 이어 붙는 풀밭 192×192 (마을 담요 초록 쪽으로 색을 맞춘다)"""
    src = Image.open(os.path.join(SHEETS, 'grass.png')).convert('RGB').resize((192, 192), Image.LANCZOS)
    tone = Image.new('RGB', src.size, (124, 192, 138))
    return Image.blend(src, tone, 0.45).convert('RGBA')


def yard():
    """마을 땅 바닥 무늬: 다져진 마당 흙, 이어 붙는 640×640 (장면 5칸).
    원본의 짙은 흙 얼룩은 가장자리에서 잘려 이음새가 보이므로 바탕색으로 메운다 (풀포기 · 조약돌 · 잔금은 남긴다)"""
    import numpy as np
    from PIL import ImageFilter
    a = np.asarray(Image.open(os.path.join(SHEETS, 'yard.png')).convert('RGB')).astype(np.float32)
    d = np.array([227, 192, 138], np.float32) - a
    dark = d.sum(2) / 3.0                           # 바탕보다 어두운 정도
    off = np.abs(d - dark[..., None]).max(2)        # 흙빛 축에서 벗어난 정도 (풀 · 돌은 크다)
    m = Image.fromarray((((dark > 1) & (dark < 30) & (off < 9)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    out = a + d * (np.asarray(m).astype(np.float32) / 255)[..., None]
    return Image.fromarray(out.clip(0, 255).astype(np.uint8)).resize((640, 640), Image.LANCZOS).convert('RGBA')


def meadow():
    """땅 밖 들판 무늬: 이어 붙는 384×384 (장면 4칸). 마을 밖 초록(MATGO.matDark #5FA772) 쪽으로 색을 맞춰 땅보다 차분하게"""
    src = Image.open(os.path.join(SHEETS, 'meadow.png')).convert('RGB').resize((384, 384), Image.LANCZOS)
    tone = Image.new('RGB', src.size, (95, 167, 114))
    return Image.blend(src, tone, 0.3).convert('RGBA')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    made = []
    icons = {}
    for sheet, (kind, names) in SHEET.items():
        im = Image.open(os.path.join(SHEETS, sheet + '.png')).convert('RGBA')
        for name, cell in zip(names, cells(kind, im)):
            if not name:
                continue
            sp = sprite(name, cell)
            if name.startswith('icon-'):
                icons[name[5:]] = sp
            made.append(save(sp, name))
    for res in ['rice', 'wood', 'stone', 'cake', 'special']:
        made.append(save(bubble(res, trim(icons[res])), f'bubble-{res}'))
    made.append(save(grass(), 'tile-grass'))
    made.append(save(meadow(), 'tile-meadow'))
    made.append(save(yard(), 'tile-yard'))
    made.append(card())
    total = sum(os.path.getsize(f) for f in made)
    print(f'{len(made)} files, {total // 1024} KB')
