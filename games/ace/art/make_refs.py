"""SpriteCook 참조용 합성 그림 (얼굴 줄 3장 + 보스 그림체 1장). python games/ace/art/make_refs.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "refs"
FACE = ROOT / "shared/images/zodiac/face"
SHEETS = {
    "faces-a": ["rat", "ox", "tiger", "rabbit"],
    "faces-b": ["dragon", "snake", "horse", "sheep"],
    "faces-c": ["monkey", "rooster", "dog", "pig", "cat"],
}

def font(size):
    try:
        return ImageFont.truetype("arialbd.ttf", size)
    except OSError:
        return ImageFont.load_default()

def row(paths, labels, cell, name):
    w = cell * len(paths)
    im = Image.new("RGB", (w, cell + 60), "#FFF6E0")
    d = ImageDraw.Draw(im)
    for i, (p, lab) in enumerate(zip(paths, labels)):
        src = Image.open(p).convert("RGBA")
        src.thumbnail((cell - 40, cell - 40), Image.LANCZOS)
        im.paste(src, (i * cell + (cell - src.width) // 2, 20 + (cell - 40 - src.height) // 2), src)
        tw = d.textlength(lab, font=font(36))
        d.text((i * cell + (cell - tw) / 2, cell), lab, fill="#2A1A10", font=font(36))
    OUT.mkdir(exist_ok=True)
    im.save(OUT / f"{name}.png")
    print(name, im.size)

for name, ids in SHEETS.items():
    row([FACE / f"{i}.png" for i in ids], [i.upper() for i in ids], 384, name)
row([ROOT / "games/survival/public/art/b-gumiho.png", ROOT / "games/twelve/public/art/b-final.png"],
    ["STYLE", "STYLE"], 640, "style-boss")
