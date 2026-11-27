"""
시아의탑 타일 시트의 `chestOpen` 칸(연 상자)을 같은 시트의 `chest` 칸(닫힌 상자)에서 만든다.

  python games/tower/art/chest_open.py            # public/art/tiles*.png 열 장의 chestOpen 칸을 다시 그린다
  python games/tower/art/chest_open.py <폴더>      # 닫힌 칸 · 연 칸을 8배로 나란히 붙인 확인용 그림(chests.png)도 그 폴더에 만든다

닫힌 상자의 색 · 테두리 · 바닥을 그대로 쓴다 (새 색은 넣지 않는다 — 닫힌 칸에 있는 색과 --charge-pit · --charge-pit-inner 만 고른다).
  뚜껑: 뒤로 젖혀져 몸통 위에 서 있다 (안쪽 면이라 어두운 판 + 테 + 위 끝에 풀린 걸쇠)
  속:   몸통 윗부분이 어두운 빈 속 (닫힌 상자의 뚜껑 자리)
  몸통: 닫힌 상자의 아랫부분 그대로 (폭 · 바닥 줄이 같다)
build.py(1~5구역) 와 draw.py(6~10구역) 가 시트를 만들 때 `open_cell` 을 부르므로 다시 만들어도 이 그림이 나온다. Pillow 만 쓴다.
"""
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

ART = Path(__file__).resolve().parents[1] / 'public/art'
CHEST, CHEST_OPEN = 14, 15          # TILE_ORDER 의 칸 번호 (src/art/sheets.ts)
OUT = (42, 26, 16)                  # --outline
PIT = (58, 42, 28)                  # --charge-pit
PIT_I = (90, 64, 48)                # --charge-pit-inner
FILES = ['tiles.png'] + [f'tiles-{t}.png' for t in 'moss frost cloud ember thunder galaxy flower storm wish'.split()]


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def near(pal, want):
    return min(pal, key=lambda c: sum((a - b) ** 2 for a, b in zip(c, want)))


def open_cell(closed):
    """닫힌 상자 칸(16×16 PIL 그림) → 연 상자 칸"""
    src = closed.convert('RGBA')
    sp = src.load()
    edge = [(x, y) for y in range(16) for x in range(16) if sp[x, y][:3] == OUT]
    if len(edge) < 20:
        raise SystemExit('chest 칸에서 테두리(--outline)를 찾지 못했다')
    x0, x1 = min(x for x, _ in edge), max(x for x, _ in edge)
    top, bot = min(y for _, y in edge), max(y for _, y in edge)
    inside = [sp[x, y][:3] for y in range(top + 1, bot) for x in range(x0 + 1, x1) if sp[x, y][:3] != OUT]
    pal = sorted(set(inside), key=lum)
    mean = [sum(c[i] for c in inside) / len(inside) for i in range(3)]
    side = Counter(sp[x, y][:3] for y in range(top + 1, bot) for x in (x0 + 1, x1 - 1) if sp[x, y][:3] != OUT)
    frame = side.most_common(1)[0][0]                                      # 상자 옆 테 색
    darker = [c for c in pal if lum(c) < lum(frame) - 8] or [c for c in pal if c != frame]
    panel = near(darker + [PIT_I], [v * 0.5 for v in mean])                          # 뚜껑 안쪽 판 (테보다 어둡게)
    wall = near(pal + [PIT], [v * 0.3 for v in mean])                      # 속의 뒷벽
    if lum(wall) > 90:
        wall = PIT
    light = pal[-1]                                                        # 걸쇠

    lid0 = max(0, top - 5)              # 뚜껑 윗줄
    hinge = max(top, lid0 + 4)          # 몸통 윗줄 (뚜껑이 붙은 줄)
    rim = hinge + 4                     # 몸통 앞쪽 테
    out = src.copy()
    op = out.load()

    def put(x, y, c):
        if 0 <= x < 16 and 0 <= y < 16:
            op[x, y] = (*c, 255)

    # 뚜껑 (몸통보다 양쪽 1px 좁게)
    lx0, lx1 = x0 + 1, x1 - 1
    for y in range(lid0, hinge):
        for x in range(lx0, lx1 + 1):
            if y == lid0:
                if x in (lx0, lx1):
                    continue                                   # 모서리는 둥글게 (바닥이 보인다)
                put(x, y, OUT)
            elif x in (lx0, lx1):
                put(x, y, OUT)
            elif y == lid0 + 1 or x in (lx0 + 1, lx1 - 1):
                put(x, y, frame)
            else:
                put(x, y, panel)
    cx = (x0 + x1) // 2
    for x in (cx, cx + 1):                                     # 풀린 걸쇠: 뚜껑 끝(위)에 매달려 있다
        put(x, lid0 + 1, light)
        put(x, lid0 + 2, OUT)
    # 빈 속
    for x in range(x0, x1 + 1):
        put(x, hinge, OUT)
    for y in range(hinge + 1, rim):
        for x in range(x0, x1 + 1):
            if x in (x0, x1):
                put(x, y, OUT)
            elif x in (x0 + 1, x1 - 1):
                put(x, y, frame)
            else:
                put(x, y, wall if y == hinge + 1 else OUT)
    # 몸통 앞쪽 테 — 그 아래는 닫힌 상자 그대로
    for x in range(x0, x1 + 1):
        put(x, rim, OUT if x in (x0, x1) else frame)
    return out


def apply(sheet):
    """시트(PIL 그림)의 chestOpen 칸을 chest 칸에서 다시 그린다"""
    cell = open_cell(sheet.crop((CHEST * 16, 0, CHEST * 16 + 16, 16)))
    sheet.paste(cell.convert(sheet.mode), (CHEST_OPEN * 16, 0))
    return sheet


def main():
    cells = []
    for f in FILES:
        im = Image.open(ART / f)
        im.load()
        apply(im).save(ART / f)
        cells.append(im.crop((CHEST * 16, 0, CHEST_OPEN * 16 + 16, 16)).convert('RGBA'))
    print(f'chestOpen {len(FILES)}장')
    if len(sys.argv) > 1:
        out = Path(sys.argv[1])
        out.mkdir(parents=True, exist_ok=True)
        view = Image.new('RGBA', (5 * 36 * 8 + 32, 2 * 20 * 8 + 32), (40, 40, 40, 255))
        for i, c in enumerate(cells):
            view.paste(c.resize((256, 128), Image.NEAREST), (32 + (i % 5) * 288, 32 + (i // 5) * 160))
        view.convert('RGB').save(out / 'chests.png')


if __name__ == '__main__':
    main()
