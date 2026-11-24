"""
로비 카드 그림 shared/images/card-tower.png (640x400) 을 코드로 그린다 (임시 — 전용 그림은 ASSETS.md).
  python games/tower/scripts/make-card.py      (저장소 최상위에서, Pillow 필요)
다른 카드와 같은 하늘색 바탕 + 돌탑(층마다 창) + 꼭대기의 소원 구슬 + 탑 앞의 도트 대원과 문지기 골렘.
색은 shared/theme.css 값만 쓴다 (DESIGN.md).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'shared/images/card-tower.png'
W, H = 640, 400

OUTLINE = (0x2A, 0x1A, 0x10, 255)   # --outline
INK_SOFT = (0x8A, 0x6A, 0x4A, 255)  # --ink-soft (탑 벽)
EMPTY = (0xC9, 0xB4, 0x8E, 255)     # --empty-line (벽 윗면)
STONE = (0xC9, 0xD1, 0xDD, 255)     # --roulette-winter (돌 바닥)
LINE_SOFT = (0xE2, 0xD3, 0xB5, 255) # --line-soft
PRIMARY = (0xFF, 0xD3, 0x4D, 255)   # --primary
DEEP = (0xF0, 0xA5, 0x00, 255)      # --primary-deep
PANEL = (0xFF, 0xF8, 0xE8, 255)     # --panel
PINK = (0xFF, 0x4D, 0x6D, 255)      # --pink
TEAM_A = (0x3D, 0x8B, 0xFF, 255)    # --team-a
SKY_DEEP = (0x1F, 0x6F, 0xD1, 255)  # --sky-deep
DRAW = (0x9A, 0x8C, 0x7E, 255)      # --draw
GREEN = (0x7C, 0xC0, 0x8A, 255)     # --table-matgo
WHITE = (255, 255, 255, 255)
SKIN = (0xFF, 0xD9, 0xB8, 255)
HAIR = (0x6B, 0x42, 0x26, 255)

# 바탕: 다른 카드와 같은 하늘색 (있으면 그 색)
try:
    sky = Image.open(ROOT / 'shared/images/card-finger.png').convert('RGBA').getpixel((4, 4))
except Exception:
    sky = (0x9F, 0xD6, 0xFF, 255)
card = Image.new('RGBA', (W, H), sky)
d = ImageDraw.Draw(card)

# 언덕 (풀밭)
d.ellipse((-120, 300, 760, 560), fill=GREEN, outline=OUTLINE, width=6)

# 탑: 아래가 넓은 층 5개
cx = 400
tiers = [(150, 330, 290), (130, 290, 245), (112, 245, 200), (96, 200, 158), (80, 158, 118)]
for i, (half, bottom, top) in enumerate(tiers):
    d.rectangle((cx - half, top, cx + half, bottom), fill=INK_SOFT, outline=OUTLINE, width=5)
    d.rectangle((cx - half + 3, top + 3, cx + half - 3, top + 12), fill=EMPTY)
    # 돌 줄눈
    for y in range(top + 18, bottom - 4, 14):
        d.line((cx - half + 5, y, cx + half - 5, y), fill=OUTLINE, width=2)
    # 창 (불빛)
    for k in (-1, 0, 1):
        if i >= 3 and k != 0:
            continue
        wx = cx + k * half * 0.55
        d.rounded_rectangle((wx - 9, top + 16, wx + 9, bottom - 8), radius=8, fill=PRIMARY, outline=OUTLINE, width=3)
# 지붕
d.polygon([(cx - 100, 118), (cx, 52), (cx + 100, 118)], fill=PINK, outline=OUTLINE)
d.line([(cx - 100, 118), (cx, 52), (cx + 100, 118), (cx - 100, 118)], fill=OUTLINE, width=5)
# 문
d.rounded_rectangle((cx - 26, 292, cx + 26, 334), radius=20, fill=OUTLINE)
d.rectangle((cx - 40, 330, cx + 40, 340), fill=STONE, outline=OUTLINE, width=3)

# 꼭대기 구슬 (빛)
glow = Image.new('RGBA', (W, H))
ImageDraw.Draw(glow).ellipse((cx - 48, -8, cx + 48, 88), fill=(255, 224, 102, 150))
card.alpha_composite(glow.filter(ImageFilter.GaussianBlur(14)))
d = ImageDraw.Draw(card)
d.ellipse((cx - 22, 14, cx + 22, 58), fill=PRIMARY, outline=OUTLINE, width=5)
d.ellipse((cx - 11, 22, cx - 2, 31), fill=WHITE)
for sx, sy in ((cx - 58, 30), (cx + 56, 20), (cx + 70, 64)):
    d.polygon([(sx, sy - 9), (sx + 3, sy - 3), (sx + 9, sy), (sx + 3, sy + 3), (sx, sy + 9), (sx - 3, sy + 3), (sx - 9, sy), (sx - 3, sy - 3)], fill=WHITE, outline=OUTLINE)


def pixels(rows, palette, ox, oy, s):
    """글자 그리드 → s 배 도트 (외곽선은 그리드 '#')"""
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in palette:
                d.rectangle((ox + x * s, oy + y * s, ox + x * s + s - 1, oy + y * s + s - 1), fill=palette[ch])


# 도트 대원 (게임 플레이스홀더와 같은 모양: 갈색 머리 · 파랑 도포 · 칼)
HERO = [
    '...######.....',
    '..#hhhhhh#....',
    '.#hhhhhhhh#...',
    '.#hssssssh#...',
    '.#s#ss#sss#...',
    '.#ssssssss#..w',
    '.#pssssssp#.w.',
    '..#ssssss#.w..',
    '.#bbbcbbbb#w..',
    '#sbbbcbbbbs#..',
    '#sbbbcbbbbs#..',
    '.#bbbbbbbb#...',
    '..#dd##dd#....',
    '..#ss##ss#....',
    '..#ee##ee#....',
    '..####.####...',
]
pal = {'#': OUTLINE, 'h': HAIR, 's': SKIN, 'p': PINK, 'b': TEAM_A, 'c': PANEL, 'd': SKY_DEEP, 'e': INK_SOFT, 'w': WHITE}
pixels(HERO, pal, 92, 196, 8)

# 문지기 골렘 (오른쪽 아래, 작게)
GOLEM = [
    '...######...',
    '..#gggggg#..',
    '..#gyggyg#..',
    '.##gggggg##.',
    '#rr#rrrr#rr#',
    '#rr#rrrr#rr#',
    '#rr#rrrr#rr#',
    '.#.#rrrr#.#.',
    '...#rr#rr#..',
    '...###.###..',
]
pixels(GOLEM, {'#': OUTLINE, 'g': STONE, 'y': PRIMARY, 'r': DRAW}, 548, 250, 7)

card.save(OUT)
print(f'saved {OUT.relative_to(ROOT)}')
