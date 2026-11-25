"""SpriteCook 원본 → 게임이 쓰는 그림(public/art/*.png). 시아돌격대·시아핑거 art/build.py 와 같은 방식.

쓰는 법 (games/twelve 에서):  python art/build.py
- 원본은 저장소에 넣지 않는다 (art/raw 는 .gitignore). 다시 만들려면 art/ids.tsv 의 asset id 로 SpriteCook 에서 받아 art/raw/<이름>.png 로 둔다.
  원본이 없는 그림은 건너뛰고(이미 만든 public/art 파일을 그대로 둔다) 목록만 다시 적는다.
- 낱개 그림(SIZES): 투명 여백을 잘라 칸 가운데에 맞춘다. BODY 에 적은 그림은 가장 큰 덩어리만 남긴다(둘레에 떠 있는 것을 뺀다).
- 시트(SHEETS): 한 장에 여러 칸을 그린 것. 빈 줄을 찾아 칸으로 나눈 뒤 낱개 그림처럼 맞춘다. 이름이 '<이름>@<n>' 이면 같은 이름끼리 가로로 이어 붙인 시트가 된다(exit = 잠김 · 열림).
- 대원(HEROES): 한 줄에 앞 · 옆(오른쪽) · 뒤 세 칸. 세 칸을 같은 배율로 줄여 발끝을 맞춘 가로 시트 hero-<id>.png (칸 HERO×HERO) 를 만든다.
- 장면(SCENES): 배경이 있는 그림. 비율에 맞게 잘라 줄인다. 로비 카드(shared/images/card-twelve.png)도 여기서 만든다.
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
CARD = os.path.join(HERE, '..', '..', '..', 'shared', 'images', 'card-twelve.png')
FIT = 0.97
MODEL = 'gemini-nano-banana-2.1'

SIZES = {'b-final': (512, 512)}
BODY = {'b-final'}
LABEL = {'b-final': '최종보스 어둑시니 (gpt-image-2 low · 화풍 참고 야광귀·염라대왕·저승사자 · 둘레의 열쇠는 build.py 가 뺀다)'}
FLOORS = [f'floor-r{n:02d}' for n in range(1, 13)]

# 대원: 시트 이름 → 줄마다의 대원 id (한 줄 = 앞 · 옆 · 뒤)
HERO = 192
HEROES = {
    'heroA': ['rat', 'ox', 'tiger', 'rabbit'],
    'heroB': ['dragon', 'snake', 'horse', 'sheep'],
    'heroC': ['monkey', 'rooster', 'dog', 'pig'],
    'heroCat': ['cat'],
}

# 시트: 이름 → (열, 행, 칸 이름 — 왼쪽 위부터 가로로. None 은 쓰지 않는 칸)
SHEETS = {
    'enemyA': (2, 2, ['e-mud', 'e-lynx', 'e-shade', 'e-catfish']),
    'enemyB': (2, 2, ['e-toad', 'e-bomber', 'e-sleeper', 'e-acorn']),
    'enemyC': (2, 2, ['e-yaksha', 'e-ferryman', 'e-firecart', 'chest']),
    'icons1': (4, 4, ['ic-sword', 'ic-spear', 'ic-bow', 'ic-fan', 'ic-armor', 'ic-acc-mp', 'ic-acc-speed', 'ic-acc-crit',
                      'ic-acc-potion', 'ic-acc-coin', 'ic-star', 'ic-hp', 'ic-mp', 'ic-stone', 'ic-key', 'ic-coin']),
    'icons2': (4, 4, ['ic-sk-triple', 'ic-sk-dash', 'ic-sk-spin', 'ic-sk-throw', 'ic-sk-rain', 'ic-sk-fork', 'ic-sk-tornado', 'ic-sk-bolt',
                      None, 'exit@0', 'exit@1', 'p-arrow', 'p-spear', 'p-orb', 'p-fire', 'fx-slash']),
}
# 칸 크기 (이름의 앞머리로 찾는다 — 위에서부터 먼저 맞는 것)
CELL = [('e-', (192, 192)), ('chest', (128, 128)), ('ic-', (96, 96)), ('exit', (180, 180)), ('p-arrow', (128, 40)), ('p-spear', (144, 40)),
        ('p-orb', (72, 72)), ('p-fire', (112, 72)), ('fx-slash', (192, 192))]
# 오른쪽(0도)을 보도록 돌려 놓는 그림: 시계 반대 방향 각도
TURN = {'p-fire': 135}
NOTE = {
    'e-mud': '2지형 진흙 요괴', 'e-lynx': '3지형 살쾡이 요괴', 'e-shade': '4지형 그슨대', 'e-catfish': '5지형 메기 요괴',
    'e-toad': '6지형 독두꺼비', 'e-bomber': '7지형 화약 도깨비', 'e-sleeper': '8지형 가위 귀신', 'e-acorn': '9지형 잔나비 요괴',
    'e-yaksha': '10지형 야차', 'e-ferryman': '11지형 뱃사공 망령', 'e-firecart': '12지형 화차', 'chest': '숨은 상자',
    'exit': '출구 봉인 문 (가로 2칸: 잠김 · 열림)', 'p-arrow': '화살', 'p-spear': '던진 창', 'p-orb': '마법 구슬', 'p-fire': '요괴 불', 'fx-slash': '베기 자국',
    'ic-sword': '칼', 'ic-spear': '창', 'ic-bow': '활', 'ic-fan': '부채', 'ic-armor': '갑옷', 'ic-acc-mp': '마력 구슬', 'ic-acc-speed': '바람 방울',
    'ic-acc-crit': '매의 눈', 'ic-acc-potion': '약초 주머니', 'ic-acc-coin': '복주머니', 'ic-star': '지형의 별', 'ic-hp': '체력 물약', 'ic-mp': '마력 물약',
    'ic-stone': '강화석', 'ic-key': '지형 열쇠', 'ic-coin': '엽전', 'ic-sk-triple': '연속 베기', 'ic-sk-dash': '돌진 베기', 'ic-sk-spin': '회전 베기',
    'ic-sk-throw': '창 던지기', 'ic-sk-rain': '화살 비', 'ic-sk-fork': '세 갈래 화살', 'ic-sk-tornado': '회오리바람', 'ic-sk-bolt': '번개',
}

# 장면: 이름 → (원본, 너비, 높이, 가로 맞춤 0~1, 세로 맞춤 0~1, 설명). 원본을 이 비율로 잘라 줄인다
SCENE_W, SCENE_H = 720, 400
SCENES = {
    **{f'story-{i}': (f'story-{i}', SCENE_W, SCENE_H, 0.5, 0.5, t) for i, t in enumerate(['십이지가 요괴를 봉인', '봉인이 풀려 요괴가 쏟아짐', '우두머리 요괴들이 열쇠를 차지', '쥐·소·호랑이가 길을 나섬'], 1)},
    **{f'ending-{i}': (f'ending-{i}', SCENE_W, SCENE_H, 0.5, 0.5, t) for i, t in enumerate(['흩어지는 어둑시니와 열두 열쇠', '아침을 맞은 열두 대원', '다시 흔들리는 봉인', '봉인 아래의 더 깊은 어둠'], 1)},
    **{f'finale-{i}': (f'finale-{i}', SCENE_W, SCENE_H, 0.5, 0.5, t) for i, t in enumerate(['무릎 꿇은 어둑시니', '열두 열쇠로 다시 잠긴 봉인', '제자리로 돌아간 요괴들과 달', '손을 흔드는 열두 대원'], 1)},
    'cat-scene': ('cat-scene', 720, 320, 0.5, 0.42, '쉼터에 헐레벌떡 달려온 고양이'),
    'main': ('card', SCENE_W, SCENE_H, 0.5, 0.75, '메인 화면 그림 (로비 카드와 같은 그림을 9:5 로 자름)'),
}
CARD_BOX = (640, 400, 0.3, 0.5)


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


def trim(src):
    box = src.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    return src.crop(box) if box else src


def shrink(src, s):
    nw, nh = max(1, round(src.width * s)), max(1, round(src.height * s))
    return src.convert('RGBa').resize((nw, nh), Image.LANCZOS).convert('RGBA')


def fit(src, w, h):
    src = trim(src)
    small = shrink(src, min(w * FIT / src.width, h * FIT / src.height))
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    canvas.paste(small, ((w - small.width) // 2, (h - small.height) // 2))
    return canvas


def save(img, out):
    img.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out, optimize=True)


def bands(src, n, vertical):
    """그림이 있는 줄(vertical) 또는 칸의 범위 n 개: 빈 틈으로 나누고, 더 많이 나뉘면 가장 좁은 틈부터 잇는다"""
    a = src.getchannel('A').point(lambda v: 255 if v > 40 else 0)
    if not vertical:
        a = a.transpose(Image.Transpose.TRANSPOSE)
    w, h = a.size
    data = a.tobytes()
    on = [any(data[y * w:(y + 1) * w]) for y in range(h)]
    runs = []
    for y, v in enumerate(on):
        if v and (not runs or runs[-1][1] != y):
            runs.append([y, y + 1])
        elif v:
            runs[-1][1] = y + 1
    runs = [r for r in runs if r[1] - r[0] > 2]
    while len(runs) > n:
        i = min(range(len(runs) - 1), key=lambda k: runs[k + 1][0] - runs[k][1])
        runs[i:i + 2] = [[runs[i][0], runs[i + 1][1]]]
    if len(runs) < n:
        raise SystemExit(f'칸을 {n} 개로 나누지 못했다 ({len(runs)} 개)')
    return runs


def cells(src, cols, rows):
    """시트를 칸으로 나눈다 (왼쪽 위부터 가로로)"""
    out = []
    for y0, y1 in bands(src, rows, True):
        row = src.crop((0, y0, src.width, y1))
        for x0, x1 in bands(row, cols, False):
            out.append(trim(row.crop((x0, 0, x1, row.height))))
    return out


def cell_size(name):
    return next(size for head, size in CELL if name.startswith(head))


def scene(src, w, h, ax, ay):
    """비율에 맞게 잘라(맞춤 ax · ay) 줄인다"""
    s = max(w / src.width, h / src.height)
    cw, ch = min(src.width, round(w / s)), min(src.height, round(h / s))
    x, y = round((src.width - cw) * ax), round((src.height - ch) * ay)
    return src.crop((x, y, x + cw, y + ch)).resize((w, h), Image.LANCZOS)


def save_scene(img, out):
    img.convert('RGB').quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(out, optimize=True)


def main():
    ids = dict(line.strip().split('\t') for line in open(os.path.join(HERE, 'ids.tsv'), encoding='utf-8') if '\t' in line)
    assets = []

    def add(src_name, name, size, text, path=None):
        out = path or os.path.join(OUT, name + '.png')
        where = 'shared/images/card-twelve.png' if path else f'public/art/{name}.png'
        assets.append({'asset_id': ids[src_name], 'sha12': sha12(out), 'label': f'{name} → {where} ({size[0]}x{size[1]}) · {text}'})

    for name, (w, h) in SIZES.items():
        raw = os.path.join(RAW, name + '.png')
        out = os.path.join(OUT, name + '.png')
        if os.path.exists(raw):
            src = Image.open(raw).convert('RGBA')
            if name in BODY:
                src = body(src)
            save(fit(src, w, h), out)
        add(name, name, (w, h), LABEL.get(name, ''))

    # 대원: 앞 · 옆 · 뒤 세 칸을 같은 배율로, 발끝을 칸 아래에 맞춘다
    for sheet, heroes in HEROES.items():
        raw = os.path.join(RAW, sheet + '.png')
        if os.path.exists(raw):
            parts = cells(Image.open(raw).convert('RGBA'), 3, len(heroes))
            for i, hero in enumerate(heroes):
                three = parts[i * 3:i * 3 + 3]
                s = min(HERO * FIT / max(p.width for p in three), HERO * FIT / max(p.height for p in three))
                strip = Image.new('RGBA', (HERO * 3, HERO), (0, 0, 0, 0))
                for k, p in enumerate(three):
                    small = shrink(p, s)
                    strip.paste(small, (k * HERO + (HERO - small.width) // 2, HERO - 3 - small.height))
                save(strip, os.path.join(OUT, f'hero-{hero}.png'))
        for hero in heroes:
            add(sheet, f'hero-{hero}', (HERO * 3, HERO), f'대원 시트 (가로 3칸: 앞 · 옆(오른쪽) · 뒤 · {MODEL} · 디자인 참고 shared/images/zodiac)')

    # 시트: 요괴 · 상자 · 출구 · 날아가는 것 · 아이콘
    for sheet, (cols, rows, names) in SHEETS.items():
        raw = os.path.join(RAW, sheet + '.png')
        made = {}
        if os.path.exists(raw):
            for name, part in zip(names, cells(Image.open(raw).convert('RGBA'), cols, rows)):
                if not name:
                    continue
                base = name.split('@')[0]
                if base in TURN:
                    part = part.rotate(TURN[base], resample=Image.BICUBIC, expand=True)
                made.setdefault(base, []).append(fit(part, *cell_size(base)))
            for base, frames in made.items():
                w, h = cell_size(base)
                strip = Image.new('RGBA', (w * len(frames), h), (0, 0, 0, 0))
                for k, f in enumerate(frames):
                    strip.paste(f, (k * w, 0))
                save(strip, os.path.join(OUT, base + '.png'))
        for base in dict.fromkeys(n.split('@')[0] for n in names if n):
            w, h = cell_size(base)
            n = sum(1 for x in names if x and x.split('@')[0] == base)
            add(sheet, base, (w * n, h), f'{NOTE[base]} ({sheet} 시트 {cols}x{rows} 의 한 칸 · {MODEL})')

    # 장면 · 메인 · 로비 카드
    for name, (src_name, w, h, ax, ay, text) in SCENES.items():
        raw = os.path.join(RAW, src_name + '.png')
        if os.path.exists(raw):
            save_scene(scene(Image.open(raw), w, h, ax, ay), os.path.join(OUT, name + '.png'))
        add(src_name, name, (w, h), f'{text} ({MODEL} 16:9 를 자름)')
    raw = os.path.join(RAW, 'card.png')
    if os.path.exists(raw):
        save_scene(scene(Image.open(raw), *CARD_BOX), CARD)
    add('card', 'card-twelve', CARD_BOX[:2], '로비 카드: 대원 셋이 열쇠를 든 큰 도깨비와 맞서는 장면 (16:9 를 16:10 으로 자름)', CARD)

    finger = {a['label'].split(' ')[0]: a['asset_id'] for a in json.load(open(os.path.join(FINGER, 'spritecook-assets.json'), encoding='utf-8'))['assets'] if 'label' in a}
    for name in FLOORS:
        out = os.path.join(OUT, name + '.png')
        shutil.copyfile(os.path.join(FINGER, 'public', 'art', name + '.png'), out)
        assets.append({'asset_id': finger[name], 'sha12': sha12(out), 'label': f'{name} → public/art/{name}.png (320x320, 이어 붙는 바닥 무늬 · 시아핑거 그림을 복사)'})
    note = ('시아열두길 전용 SpriteCook 그림 목록 (art/build.py 가 적는다). b-final · 대원 시트(hero-*) · 지형 전용 요괴 11종 · 상자 · 출구 · 아이콘(ic-*) · 날아가는 것(p-*) · '
            '장면(story · ending · finale · cat-scene · main) · 로비 카드는 열두길에서 만든 그림이고, floor-r01~r12 는 시아핑거의 지형 바닥을 복사한 것이다. '
            'public/art 의 나머지 요괴 9종(e-imp 등)·보스(b-* 12종)·tile-*·fx-pop 은 시아디펜스(games/defense/public/art)에서 복사한 것이고 asset id 는 games/defense/spritecook-assets.json 에 있다.')
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump({'note': note, 'assets': assets}, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(len(assets), 'assets')


main()
