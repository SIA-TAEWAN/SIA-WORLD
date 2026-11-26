"""시아팡팡 챕터 카드 배경 10장.
art/spritecook/ch01~ch10.png (SpriteCook 원본 1376x768) -> public/art/maps/ch01~ch10.webp (912x560, 품질 92. 게임은 WebP 만 쓴다)
+ 검토용 모음 그림 (.playwright-mcp/pang-maps-sheet.png, 인자로 경로를 주면 그곳에).
쓰는 법: python games/pang/art/build_maps.py [모음 그림 경로]
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'spritecook')
OUT = os.path.join(HERE, '..', 'public', 'art', 'maps')
W, H = 912, 560
NAMES = ['정령의 숲', '얼음 호수', '바위 언덕', '구름 계곡', '얼음 동굴', '덩굴 숲', '번개 산', '빛의 신전', '어둠 숲', '정령왕의 성']
INK = (42, 26, 16)

def fit(im):
    w, h = im.size
    cw = round(h * W / H)
    x = (w - cw) // 2
    return im.crop((x, 0, x + cw, h)).resize((W, H), Image.LANCZOS)

def font(size):
    for p in ('C:/Windows/Fonts/malgunbd.ttf', 'C:/Windows/Fonts/malgun.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def mock(im, n):
    """카드에 얹었을 때 모습 (456x280, 제목 줄 + 5x2 둥근 버튼)."""
    c = im.resize((456, 280), Image.LANCZOS).convert('RGBA')
    veil = Image.new('RGBA', c.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(veil)
    d.rounded_rectangle((10, 10, 446, 74), 12, fill=(255, 248, 232, 190))
    c = Image.alpha_composite(c, veil)
    d = ImageDraw.Draw(c)
    d.text((20, 14), f'{n}. {NAMES[n-1]}', font=font(20), fill=INK)
    d.text((20, 46), '설명 한 줄이 여기에 들어가요', font=font(13), fill=(138, 106, 74))
    cols = [(255, 255, 255), (255, 211, 77), (255, 143, 163)]
    for r in range(2):
        for k in range(5):
            cx, cy = 68 + k * 80, 122 + r * 70
            d.ellipse((cx - 25, cy - 25, cx + 25, cy + 25), fill=cols[(k + r * 5) % 3 if (k + r * 5) < 7 else 0], outline=INK, width=3)
            d.text((cx, cy), str(k + r * 5 + 1), font=font(18), fill=INK, anchor='mm')
    return c.convert('RGB')

def main():
    os.makedirs(OUT, exist_ok=True)
    sheet = Image.new('RGB', (20 + 2 * (456 + 20) * 2, 20 + 5 * (280 + 44)), (255, 248, 232))
    d = ImageDraw.Draw(sheet)
    for n in range(1, 11):
        im = fit(Image.open(os.path.join(SRC, f'ch{n:02d}.png')).convert('RGB'))
        webp = os.path.join(OUT, f'ch{n:02d}.webp')
        im.save(webp, 'WEBP', quality=92, method=6)
        print(f'ch{n:02d}', 'webp', os.path.getsize(webp))
        back = Image.open(webp).convert('RGB')
        col, row = (n - 1) % 2, (n - 1) // 2
        x, y = 20 + col * 2 * 476, 20 + row * 324
        d.text((x, y), f'{n}. {NAMES[n-1]}  (왼쪽: 그림 · 오른쪽: 카드에 얹은 모습)', font=font(18), fill=INK)
        sheet.paste(back.resize((456, 280), Image.LANCZOS), (x, y + 30))
        sheet.paste(mock(back, n), (x + 476, y + 30))
    dst = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', '..', '..', '..', '.playwright-mcp', 'pang-maps-sheet.png')
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    sheet.save(dst, optimize=True)
    print('sheet', os.path.abspath(dst))

main()
