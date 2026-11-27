"""
시아집사 그림 → 게임용 사본.

  python art/build.py

1) 고양이 자세 (art/spritecook/poses/*.png + assets.json 의 foot · scale) 와 츄르 핥기 8칸 (art/spritecook/churu/lick-*.png,
   assets-world.json 의 foot · scale) → public/art/cat/<자세>.png + src/data/poses.gen.ts
   모든 자세를 같은 배율(K × scale)로 줄이고 가장자리에 여백(PAD)을 덧댄다. 그래서 화면에서는 모든 자세를 같은 크기로 그리고
   기준점(foot)을 바닥의 같은 자리에 놓으면 자세를 바꿔도 고양이가 튀지 않는다.
2) 방 · 베란다 · 물건 · 식물 · 가구 (art/spritecook/<폴더>/ + assets-world.json) → public/art/world/*.webp + src/data/world.gen.ts
   방 배경은 세 조각으로 나눈다: 벽(줄무늬 한 주기 42px × 9 = 378px 를 가로로 되풀이) · 바닥(늘려 씀) · 창(유리 투명, 뒤에 창밖 풍경).
   그래야 방 화면의 가로세로 비가 그림(9:16)과 달라도 창을 자르지 않고 원하는 자리에 둘 수 있다.
_sheets · _rejected · *.html · lick-sheet · lick.webp · card-original 은 쓰지 않는다 (원본 보관용).
"""
import json
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
SC = HERE / 'spritecook'
SRC = SC / 'poses'
OUT = HERE.parent / 'public' / 'art' / 'cat'
WOUT = HERE.parent / 'public' / 'art' / 'world'
GEN = HERE.parent / 'src' / 'data' / 'poses.gen.ts'
WGEN = HERE.parent / 'src' / 'data' / 'world.gen.ts'
K = 0.36   # sit(1024px) → 약 370px
PAD = 6

# ---------- 1) 고양이 자세 + 츄르 핥기 ----------
meta = json.loads((SRC / 'assets.json').read_text(encoding='utf8'))
world = json.loads((SC / 'assets-world.json').read_text(encoding='utf8'))
OUT.mkdir(parents=True, exist_ok=True)
items = [(name, SRC / p['file'], p['foot'], p['scale'], p['anchor']) for name, p in meta['poses'].items()]
for i in range(8):
    a = world['assets'][f'churu/lick-{i}']
    # 8칸이 모두 같은 자리에 서 있도록 0번 칸의 발 기준점을 같이 쓴다 (칸마다 1px 씩 흔들리지 않게)
    items.append((f'lick-{i}', SC / a['file'], world['assets']['churu/lick-0']['foot'], a['scale'], 'feet'))
rows = []
for name, path, foot, scale, anchor in items:
    im = Image.open(path).convert('RGBA')
    k = K * scale
    w, h = round(im.width * k), round(im.height * k)
    small = im.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (w + PAD * 2, h + PAD * 2), (0, 0, 0, 0))
    canvas.paste(small, (PAD, PAD))
    canvas.save(OUT / f'{name}.png', optimize=True)
    fx, fy = foot
    rows.append(f"  '{name}': {{ w: {w + PAD * 2}, h: {h + PAD * 2}, fx: {round(fx * k) + PAD}, fy: {round(fy * k) + PAD}, anchor: '{anchor}' }},")
    print(name, canvas.size)

GEN.write_text(
    '// art/build.py 가 만든다 — 고치지 말 것. 자세 그림(public/art/cat/<자세>.png)의 크기와 발 바닥 기준점 (px)\n'
    'export const POSE_ART = {\n' + '\n'.join(rows) + '\n} as const;\n', encoding='utf8')
print('->', GEN)

# ---------- 2) 방 · 베란다 · 물건 · 식물 · 가구 ----------
WOUT.mkdir(parents=True, exist_ok=True)
for old in WOUT.glob('*'):
    old.unlink()
sizes = {}


def save(img: Image.Image, name: str, q: int = 88):
    img.save(WOUT / f'{name}.webp', 'WEBP', quality=q, method=6)
    sizes[name] = img.size


def fit(img: Image.Image, max_w: int, max_h: int = 10_000) -> Image.Image:
    k = min(1, max_w / img.width, max_h / img.height)
    return img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS) if k < 1 else img


lay = world['room_layout']
cut = Image.open(SC / 'room' / 'room-window-cut.png').convert('RGBA')
wf = lay['wall_floor_y']
save(cut.crop((2, 0, 380, wf)).convert('RGB'), 'wall', 86)          # 벽 + 걸레받이 (가로로 되풀이)
save(cut.crop((0, wf, cut.width, cut.height)).convert('RGB').resize((640, 573), Image.LANCZOS), 'floor', 84)
fx0, fy0, fx1, fy1 = lay['window_frame_bbox']
gx0, gy0, gx1, gy1 = lay['window_glass_bbox']
win = cut.crop((fx0, fy0, fx1 + 1, fy1 + 1))
save(win, 'window', 90)
glass = [(gx0 - fx0) / win.width, (gy0 - fy0) / win.height, (gx1 - gx0 + 1) / win.width, (gy1 - gy0 + 1) / win.height]
for t in ['morning', 'day', 'sunset', 'night']:
    save(fit(Image.open(SC / 'room' / f'view-{t}.png').convert('RGB'), 300), f'view-{t}', 84)
save(Image.open(SC / 'veranda' / 'veranda.png').convert('RGB'), 'veranda', 84)

# 물건 · 식물 · 가구: 게임에서 쓰는 가장 큰 크기의 2배쯤으로
LIMIT = {'objects': 200, 'plants': 160, 'furniture': 260}
for key, a in world['assets'].items():
    folder, name = key.split('/')
    if folder not in LIMIT:
        continue
    im = Image.open(SC / a['file']).convert('RGBA')
    lim = 460 if name == 'zodiac-shelf' else LIMIT[folder]
    # 식물은 모두 같은 캔버스라 같은 배율로 (화분이 단계마다 움직이지 않게)
    save(fit(im, lim) if folder != 'plants' else im.resize((160, 248), Image.LANCZOS), f'{folder}-{name}', 90)

vl = world['veranda_layout']
WGEN.write_text(
    '// art/build.py 가 만든다 — 고치지 말 것. 방 · 베란다 그림(public/art/world/<이름>.webp)의 크기와 자리\n'
    'export const WORLD_ART = {\n' + '\n'.join(f"  '{k}': [{w}, {h}]," for k, (w, h) in sorted(sizes.items())) + '\n} as const;\n'
    'export type WorldArt = keyof typeof WORLD_ART;\n'
    f'/** 창 그림 안의 유리 자리 (창 그림에 대한 비율: 왼쪽 · 위 · 너비 · 높이) */\nexport const WINDOW_GLASS = [{", ".join(f"{v:.4f}" for v in glass)}] as const;\n'
    f'/** 베란다 그림(가로 {vl["size"][0]} · 세로 {vl["size"][1]})의 선반 윗단 · 아랫단 화분 바닥 · 타일 바닥 시작 (그림 세로에 대한 비율) */\n'
    f'export const VERANDA = {{ w: {vl["size"][0]}, h: {vl["size"][1]}, top: {vl["shelf_top_pot_y"] / vl["size"][1]:.4f}, bottom: {vl["shelf_bottom_pot_y"] / vl["size"][1]:.4f}, floor: {vl["floor_y"] / vl["size"][1]:.4f} }} as const;\n',
    encoding='utf8')
print('->', WGEN, len(sizes), 'world images')
