"""
시아집사 고양이 자세 그림 → 게임용 사본 (public/art/cat/<자세>.png) + 자세 표 (src/data/poses.gen.ts).

  python art/build.py

art/spritecook/poses/assets.json 의 foot(발 바닥 기준점) · scale(sit = 1 기준 배율) 을 써서,
모든 자세를 같은 배율(K × scale)로 줄이고 가장자리에 여백(PAD)을 덧댄다. 그래서 화면에서는 모든 자세를 같은 크기로 그리고
기준점(foot)을 바닥의 같은 자리에 놓으면 자세를 바꿔도 고양이가 튀지 않는다.
_rejected · _recolor-test.png · index.html 은 쓰지 않는다.
"""
import json
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / 'spritecook' / 'poses'
OUT = HERE.parent / 'public' / 'art' / 'cat'
GEN = HERE.parent / 'src' / 'data' / 'poses.gen.ts'
K = 0.36   # sit(1024px) → 약 370px
PAD = 6

meta = json.loads((SRC / 'assets.json').read_text(encoding='utf8'))
OUT.mkdir(parents=True, exist_ok=True)
rows = []
for name, p in meta['poses'].items():
    im = Image.open(SRC / p['file']).convert('RGBA')
    k = K * p['scale']
    w, h = round(im.width * k), round(im.height * k)
    small = im.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (w + PAD * 2, h + PAD * 2), (0, 0, 0, 0))
    canvas.paste(small, (PAD, PAD))
    canvas.save(OUT / f'{name}.png', optimize=True)
    fx, fy = p['foot']
    rows.append(f"  '{name}': {{ w: {w + PAD * 2}, h: {h + PAD * 2}, fx: {round(fx * k) + PAD}, fy: {round(fy * k) + PAD}, anchor: '{p['anchor']}' }},")
    print(name, canvas.size)

GEN.write_text(
    '// art/build.py 가 만든다 — 고치지 말 것. 자세 그림(public/art/cat/<자세>.png)의 크기와 발 바닥 기준점 (px)\n'
    'export const POSE_ART = {\n' + '\n'.join(rows) + '\n} as const;\n', encoding='utf8')
print('->', GEN)
