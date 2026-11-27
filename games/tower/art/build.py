"""
시아의탑 1~5구역 그림 (SpriteCook, 2026-11-25): art/spritecook/*.png (SpriteCook 에서 받은 시트) → public/art/** 의 1배 도트.

  python games/tower/art/build.py            # 캐릭터 레이어 18장 · 타일 5장 · 적 32종 · 구슬 16개 · 로비 카드를 다시 만든다
  python games/tower/art/build.py <폴더>      # 확인용 확대 그림(contact-*.png)도 그 폴더에 만든다

받은 시트는 모두 자홍(#ff00ff) 바탕이다. 여기서 하는 일: 배경 지우기 → 칸 나누기 → 칸 크기에 맞추기 → 색 다듬기(shared/theme.css 값에 가까운 색은 그 값으로)
→ 진한 갈색 1px 테두리. 캐릭터 레이어만 64×80 칸(화면에는 0.5배)이고 나머지는 1배 도트다. 무작위가 없어 몇 번을 돌려도 같은 파일이 나온다. Pillow · numpy 필요.
6~10구역은 아직 손그림(draw.py)이다 — 같은 방식으로 넣으려면 시트를 art/spritecook/ 에 두고 ENEMY_SHEETS · TILE_THEMES 에 줄을 더하면 된다.
asset id 는 games/tower/spritecook-assets.json.
"""
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
import chest_open  # noqa: E402
ROOT = HERE.parents[2]
SRC = HERE / 'spritecook'
ART = ROOT / 'games/tower/public/art'
CARD = ROOT / 'shared/images/card-tower.png'


def hx(h):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16))


OUT = hx('#2a1a10')            # --outline
OUTC = np.array(OUT)
SKIN = hx('#ffd9b8')
# shared/theme.css 의 색 + 살색
THEME = [hx(c) for c in (
    '#2a1a10 #8a6a4a #e2d3b5 #c9b48e #ffd34d #ffe066 #f0a500 #ff4d6d #eee2c8 #ffffff #fff8e8 #fff4c2 '
    '#3d8bff #1f6fd1 #4aa8ff #9fd6ff #ffe9b8 #7fb8e8 #9cc7f2 #4cb86a #e86a5a #9a8c7e #8fcc9b #5fa772 '
    '#7cc08a #6cc6b5 #f7c1a8 #a9ddc6 #c9d1dd #f9a873 #e08a4f #9a6a3a #c89a5a #cfd6de #3a2a1c #5a4030 '
    '#d9a05b #9fb6ff #ffd9b8').split()]
# 캐릭터(64×80)의 음영에만 쓰는 몇 가지 (테마 색의 한 단계 어두운 값): 살 그늘 · 짙은 파랑 · 황금 · 짙은 분홍 · 짙은 초록 · 머리 갈색
EXTRA = [hx(c) for c in '#f2b48c #e39a72 #1553a8 #d9a520 #c93a58 #3f8a52 #6b4226 #b9772e #a85a34'.split()]
SKINS = {SKIN, hx('#f7c1a8'), hx('#ffe9b8'), hx('#f9a873'), hx('#fff4c2'), hx('#fff8e8'), hx('#f2b48c'), hx('#e39a72')}
GREENS = {hx(c) for c in ('#4cb86a', '#5fa772', '#7cc08a', '#8fcc9b', '#6cc6b5', '#a9ddc6')}
BLUES = {hx('#3d8bff'), hx('#1f6fd1'), hx('#4aa8ff'), hx('#1553a8')}


# =====================================================================
# 공용: 읽기 · 배경 지우기 · 조각 · 색 · 테두리
# =====================================================================
def load(path):
    return np.array(Image.open(path).convert('RGBA')).astype(np.int32)


def key(im):
    """자홍 배경(과 그 번진 가장자리) → 투명"""
    im = im.copy()
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    m = (r > 110) & (b > 110) & (g < 0.5 * np.minimum(r, b)) & (abs(r - b) < 56)
    m |= im[..., 3] < 128
    im[m] = 0
    im[~m, 3] = 255
    return im


def components(mask):
    """8방향으로 이어진 조각들 → (번호 그림, [{id, area, x0, x1, y0, y1, cx, cy}])"""
    H, W = mask.shape
    lab = np.zeros((H, W), np.int32)
    out = []
    n = 0
    for y in range(H):
        for x in range(W):
            if mask[y, x] and not lab[y, x]:
                n += 1
                q = deque([(y, x)])
                lab[y, x] = n
                ys, xs = [], []
                while q:
                    cy, cx = q.popleft()
                    ys.append(cy)
                    xs.append(cx)
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            yy, xx = cy + dy, cx + dx
                            if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                                lab[yy, xx] = n
                                q.append((yy, xx))
                out.append({'id': n, 'area': len(ys), 'x0': min(xs), 'x1': max(xs), 'y0': min(ys), 'y1': max(ys),
                            'cx': sum(xs) / len(xs), 'cy': sum(ys) / len(ys)})
    return lab, out


def grid_cells(im, cols, rows, min_area=12):
    """조각을 cols×rows 칸에 나눠 담는다 → {(row, col): (x0, y0, x1, y1)}"""
    H, W = im.shape[:2]
    _, comps = components(im[..., 3] > 0)
    boxes = {}
    for c in comps:
        if c['area'] < min_area:
            continue
        k = (min(rows - 1, int(c['cy'] / (H / rows))), min(cols - 1, int(c['cx'] / (W / cols))))
        b = boxes.get(k)
        boxes[k] = (c['x0'], c['y0'], c['x1'], c['y1']) if b is None else (min(b[0], c['x0']), min(b[1], c['y0']), max(b[2], c['x1']), max(b[3], c['y1']))
    return boxes


def lum(c):
    return 0.299 * c[..., 0] + 0.587 * c[..., 1] + 0.114 * c[..., 2]


def snap(im, tol=None, dark=38, edge_dark=62, extra=()):
    """색을 theme.css 의 가장 가까운 값으로. tol 을 주면 그보다 먼 색(보라 · 짙은 빨강 …)은 8 단계로만 다듬어 둔다.
    아주 어두운 색과 가장자리의 어두운 색은 테두리색"""
    pal = np.array(THEME + list(extra), np.float64)
    out = im.copy()
    px = im[..., :3].astype(np.float64)
    w = np.array([0.30, 0.59, 0.11]) ** 0.5 * 1.7
    d = (((px[..., None, :] - pal[None, None]) * w) ** 2).sum(-1)
    out[..., :3] = pal[d.argmin(-1)].astype(np.int32)
    if tol is not None:
        far = d.min(-1) > tol * tol
        out[far, :3] = (im[far, :3] // 8) * 8 + 4
    out[lum(px) < dark, :3] = OUT
    a = np.pad(im[..., 3] > 0, 1)
    edge = ~(a[:-2, 1:-1] & a[2:, 1:-1] & a[1:-1, :-2] & a[1:-1, 2:])
    out[edge & (lum(px) < edge_dark), :3] = OUT
    out[im[..., 3] == 0] = 0
    return out


def outline(im):
    """가장자리가 테두리색이 아닌 곳 바깥에 1px 테두리 (4방향)"""
    a = im[..., 3] > 0
    p = np.pad(a & ~(im[..., :3] == OUTC).all(-1), 1)
    add = (p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]) & ~a
    out = im.copy()
    out[add] = (*OUT, 255)
    return out


def put(dst, src, x, y):
    h, w = src.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(dst.shape[1], x + w), min(dst.shape[0], y + h)
    if x1 <= x0 or y1 <= y0:
        return
    s = src[y0 - y:y1 - y, x0 - x:x1 - x]
    m = s[..., 3] > 0
    dst[y0:y1, x0:x1][m] = s[m]


def shrink(g, s):
    """도트 그림을 s 배(<1)로 줄인다 (가까운 점 뽑기)"""
    h, w = g.shape[:2]
    nh, nw = max(1, int(round(h * s))), max(1, int(round(w * s)))
    ys = np.minimum(h - 1, ((np.arange(nh) + 0.5) / s).astype(int))
    xs = np.minimum(w - 1, ((np.arange(nw) + 0.5) / s).astype(int))
    return g[ys][:, xs]


def to_img(im):
    return Image.fromarray(im.clip(0, 255).astype(np.uint8), 'RGBA')


def col_in(im, cols):
    m = np.zeros(im.shape[:2], bool)
    for c in cols:
        m |= (im[..., :3] == np.array(c)).all(-1)
    return m & (im[..., 3] > 0)


# =====================================================================
# 캐릭터 레이어 (64×80 칸, 가로 8 × 세로 4 = 512×320 — 화면에는 0.5배로 그린다)
#   char2-base.png      파랑 도포를 입은 민머리 대원 8칸 × 3줄(아래 · 오른쪽 · 위) — 자세의 기준. 여기서 몸과 옷 0 을 나눈다
#   char2-outfit1~3     기준 시트의 옷만 바꾼 것 → 옷 1~3
#   char2-hair.png      초록 옷을 입은 대기 칸에 머리 모양 8가지(남 4 · 여 4) × 3방향
#   char2-faces.png     같은 틀에 얼굴 8가지 × 3방향 — 2026-11-27 부터 쓰지 않는다 (얼굴은 아래 FACE_ART 의 손도트)
# 시트는 SpriteCook 원본(2752×1536)을 512 너비로 줄여 배경을 지운 것이다 (도트 한 점 = 그림 한 점).
# 머리는 방향마다 한 가지 모양이고 칸마다 조금 오르내릴 뿐이라, 얼굴·머리카락은 대기 칸 것을 그대로 따라 옮긴다.
# =====================================================================
FW, FH = 64, 80
HW, HH = 34, 27          # 머리 상자 크기 (테두리 · 귀 · 코 포함)
HX, HY = 15, 14          # 머리 상자 왼쪽 위 — 머리 위로 14줄이 머리 장식 자리
FOOT = 78                # 발끝(테두리)이 오는 줄
GREEN = (0, 210, 90)
SHOE_F = {hx('#9a6a3a'): hx('#e86a5a'), hx('#8a6a4a'): hx('#e86a5a'), hx('#c89a5a'): hx('#f7c1a8'), hx('#d9a05b'): hx('#f7c1a8'),
          hx('#5a4030'): (168, 64, 64), hx('#3a2a1c'): (168, 64, 64)}   # 여자 몸: 갈색 신 → 꽃신
# 얼굴이 놓이는 자리 (머리 상자 안, 방향마다): (x0, x1, y0, y1)
FACE_ZONE = {0: (9, 25, 7, 20), 1: (13, 28, 7, 20)}


def clean(path):
    im = load(path)
    im[im[..., 3] < 128] = 0
    return snap(im, edge_dark=120, extra=EXTRA)


def blank():
    return np.zeros((FH, FW, 4), np.int32)


def char_frames(path, head_ref=None):
    """시트 → frames[줄][칸] (64×80, 머리가 (HX, HY), 발끝 y=FOOT) · offs[줄][칸] (머리가 옮겨 간 (dx, dy)) · heads[줄]"""
    im = clean(path)
    cells = grid_cells(im, 8, 3, min_area=200)
    frames, offs, heads = [], [], []
    for r in range(3):
        base = sorted(cells[(r, c)][3] for c in range(8))[4]
        row = []
        for c in range(8):
            x0, y0, x1, y1 = cells[(r, c)]
            g = im[y0:y1 + 1, x0:x1 + 1]
            feet = np.where((g[-6:, :, 3] > 0).any(0))[0]
            fr = blank()
            put(fr, g, FW // 2 - int(round(feet.mean())), FOOT - (base - y1) - (g.shape[0] - 1))
            row.append(outline(fr))
        if head_ref is None:
            f0 = row[0]
            top = np.where((f0[..., 3] > 0).any(1))[0].min()
            xs = np.where((f0[top:top + 14, :, 3] > 0).any(0))[0]
            sx, sy = HX + (HW - (xs.max() - xs.min() + 1)) // 2 - xs.min(), HY - top
            row = [np.roll(np.roll(f, sy, 0), sx, 1) for f in row]
            head = row[0][HY:HY + HH, HX:HX + HW].copy()
            head = head_only(head, r)
        else:
            head = head_ref[r]
        hm = head[..., 3] > 0
        off_row = []
        for c in range(8):
            best = (-1, 0, 0)
            for dy in range(-10, 11):
                for dx in range(-14, 15):
                    x, y = HX + dx, HY + dy
                    if x < 0 or y < 0 or x + HW > FW or y + HH > FH:
                        continue
                    reg = row[c][y:y + HH, x:x + HW]
                    s = ((reg[..., :3] == head[..., :3]).all(-1) & hm & (reg[..., 3] > 0)).sum() - 0.5 * (abs(dx) + abs(dy))
                    if s > best[0]:
                        best = (s, dx, dy)
            off_row.append((best[1], best[2]))
        if head_ref is not None:          # 옷만 바꾼 시트: 기준 시트의 머리 자리에 맞춘다
            row = [np.roll(np.roll(row[c], head_ref['offs'][r][c][1] - off_row[c][1], 0), head_ref['offs'][r][c][0] - off_row[c][0], 1) for c in range(8)]
            off_row = list(head_ref['offs'][r])
        frames.append(row)
        offs.append(off_row)
        heads.append(head)
    return frames, offs, heads


def head_only(head, r):
    """머리 상자에서 머리(살색 덩어리 + 그 테두리)만 남긴다 — 옷깃 · 어깨는 뺀다"""
    skin = col_in(head, SKINS)
    lab, comps = components(skin)
    big_ = max(comps, key=lambda c: c['area'])
    keep = lab == big_['id']
    # 살색에 둘러싸인 눈 · 볼 · 입: 덩어리의 줄마다 왼쪽 끝~오른쪽 끝 사이
    fill = np.zeros_like(keep)
    for y in range(HH):
        xs = np.where(keep[y])[0]
        if len(xs):
            fill[y, xs.min():xs.max() + 1] = True
    dark = (lum(head[..., :3].astype(np.float64)) < 120) & (head[..., 3] > 0) & ~skin
    own = fill.copy()
    for _ in range(2):                                   # 머리 둘레의 어두운 테두리 (두 겹까지)
        p = np.pad(own, 1)
        near = p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:] | p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:]
        own |= near & dark
    out = head.copy()
    out[~own] = 0
    return out


def head_region(head, off):
    m = np.zeros((FH, FW), bool)
    put_mask(m, head[..., 3] > 0, HX + off[0], HY + off[1])
    return m


def put_mask(dst, src, x, y):
    h, w = src.shape
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(dst.shape[1], x + w), min(dst.shape[0], y + h)
    if x1 > x0 and y1 > y0:
        dst[y0:y1, x0:x1] |= src[y0 - y:y1 - y, x0 - x:x1 - x]


def bald(head, r):
    """얼굴(눈 · 볼 · 입)을 지운 머리. r = 0 앞 · 1 옆 · 2 뒤"""
    h = head.copy()
    if r == 2:
        return h
    x0, x1, y0, y1 = FACE_ZONE[r]
    a = h[..., 3] > 0
    for y in range(y0, y1):
        xs = np.where(a[y])[0]
        if len(xs) < 5:
            continue
        for x in range(max(x0, xs[2]), min(x1, xs[-3] + 1)):
            if a[y, x] and tuple(h[y, x, :3]) not in SKINS:
                h[y, x, :3] = SKIN
    return h


def split_base(frames, offs, heads):
    """기준 시트 → 몸 칸 · 옷 0 칸 · 칸마다 {off, legs(다리 자리), shoe_top}"""
    body, outfit, info = [], [], []
    for r in range(3):
        bh = bald(heads[r], r)
        brow, orow, irow = [], [], []
        for c in range(8):
            fr, off = frames[r][c], offs[r][c]
            hm = head_region(heads[r], off)
            op = fr[..., 3] > 0
            yb = np.where(col_in(fr, BLUES).any(1))[0].max()      # 도포 자락의 맨 아래 줄
            y1 = np.where(op.any(1))[0].max()
            legs = np.zeros((FH, FW), bool)
            legs[yb + 1:] = op[yb + 1:]
            b = blank()
            core = op & ~hm & ~legs                               # 숨은 몸통: 옷 사이로 비치지 않게 실루엣을 4px 줄여 살색으로
            for _ in range(4):
                p = np.pad(core, 1)
                core = core & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
            b[core] = (*SKIN, 255)
            b[legs] = fr[legs]
            put(b, bh, HX + off[0], HY + off[1])
            o = fr.copy()
            o[hm | legs] = 0
            brow.append(b)
            orow.append(o)
            irow.append({'off': off, 'legs': legs, 'shoe_top': y1 - 5})
        body.append(brow)
        outfit.append(orow)
        info.append(irow)
    return body, outfit, info


def split_outfit(frames, heads, body, info):
    """옷만 바꾼 시트 → 옷 칸 (머리 · 신발은 몸 레이어 것이 보이게 비운다)"""
    out = []
    for r in range(3):
        row = []
        for c in range(8):
            inf = info[r][c]
            o = frames[r][c].copy()
            hm = head_region(heads[r], inf['off'])
            p = np.pad(hm, 1)                                   # 머리 둘레 1px 까지 비운다 (머리가 1px 어긋나도 살색이 겹쳐 보이지 않게)
            near = p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
            o[hm | (near & col_in(o, SKINS))] = 0
            b = body[r][c]
            o[(o[..., :3] == b[..., :3]).all(-1) & (b[..., 3] > 0) & inf['legs']] = 0
            low = np.zeros((FH, FW), bool)
            low[inf['shoe_top']:] = True
            o[low & inf['legs']] = 0
            for y, x in zip(*np.where(col_in(o, BLUES))):       # 기준 시트의 파랑이 남은 점은 둘레 옷 색으로
                near_c = [tuple(o[yy, xx, :3]) for yy in range(max(0, y - 1), min(FH, y + 2)) for xx in range(max(0, x - 1), min(FW, x + 2))
                          if o[yy, xx, 3] and tuple(o[yy, xx, :3]) not in BLUES and tuple(o[yy, xx, :3]) != OUT and tuple(o[yy, xx, :3]) not in SKINS]
                o[y, x, :3] = max(set(near_c), key=near_c.count) if near_c else OUT
            row.append(o)
        out.append(row)
    return out


def green_rows(frames, heads):
    """머리 모양 · 얼굴 시트의 기준 칸: 대기 칸, 몸은 초록 옷"""
    rows = []
    for r in range(3):
        fr = frames[r][0].copy()
        m = (fr[..., 3] > 0) & ~head_region(heads[r], (0, 0)) & ~(fr[..., :3] == OUTC).all(-1)
        fr[m, :3] = GREEN
        rows.append(fr)
    return rows


def align_ref(path, ref, fit_top=False):
    """8칸 × 3줄 시트의 칸마다 기준 칸 ref[줄] 과 가장 많이 겹치는 자리에 놓는다.
    fit_top: 칸 위로 넘치는 머리 장식은 머리 위쪽 줄을 넘친 만큼 솎아 칸 안에 넣는다"""
    im = clean(path)
    cells = grid_cells(im, 8, 3, min_area=200)
    out = [[None] * 8 for _ in range(3)]
    for (r, c), (x0, y0, x1, y1) in cells.items():
        g = im[y0:y1 + 1, x0:x1 + 1]
        h, w = g.shape[:2]
        ro = ref[r][..., 3] > 0
        rc = ref[r][..., :3]
        best = None
        for y in range(FOOT - h - 6, FOOT - h + 8):
            for x in range((FW - w) // 2 - 12, (FW - w) // 2 + 13):
                fr = blank()
                put(fr, g, x, y)
                s = ((fr[..., :3] == rc).all(-1) & ro & (fr[..., 3] > 0)).sum()
                if best is None or s > best[0]:
                    best = (s, fr, x, y)
        out[r][c] = best[1]
        over = -best[3]
        if fit_top and over > 0:
            above = HY + over
            drop = set(np.round(np.linspace(1, above - 1, over + 2)[1:-1]).astype(int).tolist())
            while len(drop) < over:
                drop.add(max(set(range(1, above)) - drop))
            fr = blank()
            put(fr, g[[j for j in range(h) if j not in drop]], best[2], 0)
            out[r][c] = fr
    return out


def face_mask(r):
    m = np.zeros((FH, FW), bool)
    if r < 2:
        x0, x1, y0, y1 = FACE_ZONE[r]
        m[HY + y0:HY + y1, HX + x0:HX + x1] = True
    return m


def hair_of(fr, rf, r):
    """머리카락만 남긴다 (살 · 초록 옷 · 기준 칸과 같은 점은 뺀다)"""
    op = fr[..., 3] > 0
    is_out = (fr[..., :3] == OUTC).all(-1) & op
    same = (fr[..., :3] == rf[..., :3]).all(-1) & (rf[..., 3] > 0)
    c3 = fr[..., :3]
    greenish = op & (c3[..., 1] > c3[..., 0] + 25) & (c3[..., 1] > c3[..., 2] + 25)      # 초록 옷(과 그 그늘)
    fill = op & ~col_in(fr, SKINS) & ~greenish & ~col_in(fr, BLUES) & ~is_out & ~same
    face = face_mask(r)
    if r < 2:                                          # 얼굴 안의 볼 · 입 · 눈 흰자는 머리카락이 아니다
        fill &= ~(col_in(fr, {hx('#ff4d6d'), hx('#e86a5a'), hx('#ffffff'), hx('#f7c1a8')}) & face)
    lab, comps = components(fill)
    keep = np.zeros_like(fill)
    for c in comps:
        if c['area'] >= 14:
            keep |= lab == c['id']
    # 어두운 점: 머리카락 옆의 테두리 + 짙은 머리카락 속의 어두운 덩어리 (머리카락에서 이어진 것만)
    body_line = same.copy()
    body_line[:HY + HH - 2] = False                    # 목 아래의 몸 테두리는 머리카락이 아니다
    grow = is_out & ~(face & same) & ~body_line
    dark = np.zeros_like(keep)
    for _ in range(12):
        p = np.pad(keep | dark, 1)
        near = p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:] | p[:-2, :-2] | p[:-2, 2:] | p[2:, :-2] | p[2:, 2:]
        new = grow & near & ~dark
        if not new.any():
            break
        dark |= new
    o = np.zeros_like(fr)
    m = keep | dark
    o[m] = fr[m]
    top = (o[0, :, 3] > 0)
    o[0, top, :3] = OUT
    return o


# ---------------------------------------------------------------------
# 얼굴 4종 (동글 · 방긋 · 초롱 · 다부진): 손으로 찍은 도트 (2026-11-27). SpriteCook 시트(char2-faces.png)에서 잘라 쓰던 것을 바꿨다 —
# 64×80 칸에서 얼굴은 16×10 남짓이라 잘라 온 눈은 크기 · 자리가 얼굴마다 달랐다. 다시 그릴 목록: art/spritecook/REDRAW-QUEUE.md
# 앞모습은 왼쪽 절반(x 24~31)만 적고 가운데(31.5)를 축으로 뒤집어 붙인다 → 눈 · 눈썹 · 볼이 좌우 대칭. 옆모습은 오른쪽을 본다.
# 눈은 앞 26줄 · 옆 25줄부터: 바가지 머리(m3) · 긴 생머리(f0) 앞머리가 그 윗줄까지 내려온다. 눈썹은 그 위라 앞머리에 가려도 된다.
# 맨 아랫점은 앞 32줄 · 옆 31줄 — src/art/load.ts 의 2등신 만들기가 얼굴 레이어의 아래 끝을 턱으로 쓴다 (FACE_CHIN).
# ---------------------------------------------------------------------
FACE_PAL = {'#': OUT, 'w': hx('#fff8e8'), 'b': hx('#6b4226'), 'i': hx('#a85a34'), 'k': hx('#e86a5a'), 'r': hx('#c93a58'), 'm': hx('#a85a34')}
FACE_BASE = hx('#f2b48c')                                  # 얼굴 살색 (몸 레이어 머리의 바탕색)
FACE_LIGHT = {SKIN, hx('#f7c1a8'), hx('#ffe9b8'), hx('#fff4c2'), hx('#fff8e8')}   # 몸 레이어에 남은 옛 눈 자리(밝은 얼룩)
FACE_AT = {0: (24, 23), 1: (33, 22)}                       # 아래 그림의 왼쪽 위 (대기 칸 좌표)
FACE_SKIN = {0: (24, 39, 22, 32), 1: (30, 40, 21, 31)}     # 살색을 고르게 덮는 자리 (x0, x1, y0, y1 — 끝 포함)
FACE_CHIN = {0: (31, 32), 1: (36, 31)}                     # 언제나 찍는 맨 아랫점
FACE_ART = [
    {   # 0 동글: 둥글고 순한 눈 · 작은 미소
        0: ['........',
            '..bb....',
            '........',
            '..b#b...',
            '..w##...',
            '..b#b...',
            '.kk...m.',
            '.......m',
            '........',
            '........'],
        1: ['.........',
            '...bb....',
            '.........',
            '...##....',
            '...#w....',
            '...##....',
            '.kk......',
            '.....mm..',
            '.........',
            '.........'],
    },
    {   # 1 방긋: 웃어서 감긴 눈 · 벌린 입 · 짙은 볼
        0: ['........',
            '........',
            '........',
            '..###...',
            '.#...#..',
            '.kk.....',
            '.kk...##',
            '.......r',
            '........',
            '........'],
        1: ['.........',
            '.........',
            '.........',
            '....#....',
            '...#.#...',
            '.kk......',
            '.kk.##...',
            '.....r...',
            '.........',
            '.........'],
    },
    {   # 2 초롱: 크고 반짝이는 눈
        0: ['...bb...',
            '........',
            '...##...',
            '..#ww#..',
            '..#w##..',
            '..##i#..',
            '...##...',
            '.kk....m',
            '........',
            '........'],
        1: ['....bb...',
            '.........',
            '....#....',
            '...#ww...',
            '...#w#...',
            '...#i#...',
            '....#....',
            '.kk...m..',
            '.........',
            '.........'],
    },
    {   # 3 다부진: 굵고 치켜 올라간 눈썹 · 다문 입
        0: ['........',
            '.##.....',
            '..###...',
            '....##..',
            '..###...',
            '..w##...',
            '........',
            '......##',
            '........',
            '........'],
        1: ['.........',
            '..##.....',
            '...###...',
            '...##....',
            '...#w....',
            '...##....',
            '.........',
            '.....##..',
            '.........',
            '.........'],
    },
]


def face_holes(body_fr):
    """몸 레이어 머리 안의 빈 점 (머리를 가를 때 빠진 점 — 칸 테두리에서 투명으로 이어지지 않는 투명 점)"""
    clear = body_fr[..., 3] == 0
    seen = np.zeros_like(clear)
    seen[0, :], seen[-1, :], seen[:, 0], seen[:, -1] = clear[0, :], clear[-1, :], clear[:, 0], clear[:, -1]
    q = deque(zip(*np.where(seen)))
    while q:
        y, x = q.popleft()
        for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= yy < FH and 0 <= xx < FW and clear[yy, xx] and not seen[yy, xx]:
                seen[yy, xx] = True
                q.append((yy, xx))
    return clear & ~seen


def face_zone(r, off):
    m = np.zeros((FH, FW), bool)
    if r < 2:
        x0, x1, y0, y1 = FACE_SKIN[r]
        m[y0 + off[1]:y1 + 1 + off[1], x0 + off[0]:x1 + 1 + off[0]] = True
    return m


def face_hand(v, r, body_fr, off):
    """얼굴 v 의 한 칸: 살색 고르기(옛 눈 자리 · 빈 점) + 눈 · 눈썹 · 볼 · 입. 뒤를 보는 줄은 비운다"""
    o = blank()
    if r == 2:
        return o
    dx, dy = off
    o[face_zone(r, off) & (face_holes(body_fr) | col_in(body_fr, FACE_LIGHT))] = (*FACE_BASE, 255)
    ax, ay = FACE_AT[r]
    for j, line in enumerate(FACE_ART[v][r]):
        if r == 0:
            line = line + line[::-1]
        for i, ch in enumerate(line):
            if ch != '.':
                o[ay + j + dy, ax + i + dx] = (*FACE_PAL[ch], 255)
    cx, cy = FACE_CHIN[r]
    if not o[cy + dy, cx + dx, 3]:
        assert body_fr[cy + dy, cx + dx, 3], 'chin'
        o[cy + dy, cx + dx] = body_fr[cy + dy, cx + dx]
    assert not o[cy + dy + 1:].any(), 'below chin'
    return o


# 머리 레이어에 남은 옛 얼굴 조각(머리 시트에 그려져 있던 눈 · 눈썹 · 볼 · 턱 선)을 지우는 자리: 대기 칸의 (y0, y1, x0, x1) — 끝 포함.
# 머리 시트는 얼굴이 있는 그림에서 살색만 빼고 남긴 것이라, 머리가 얼굴 위에 그려질 때 눈 조각이 덧그려졌다 (단발 f3 은 눈이 아예 가려졌다).
HAIR_FACE = {
    0: {'m0': [(24, 25, 31, 38), (26, 26, 25, 38), (27, 34, 24, 39)],
        'm1': [(24, 25, 26, 38), (26, 26, 25, 39), (27, 34, 24, 39)],
        'm2': [(23, 25, 26, 38), (26, 34, 24, 39)],
        'm3': [(26, 34, 24, 39)],
        'f0': [(25, 35, 25, 38)],
        'f1': [(24, 25, 26, 38), (26, 34, 24, 39)],
        'f2': [(24, 25, 25, 38), (26, 34, 24, 39)],
        'f3': [(25, 27, 26, 37), (28, 29, 24, 39), (32, 34, 27, 36)]},
    1: {'m0': [(24, 24, 34, 40), (25, 30, 31, 40)],
        'm1': [(25, 30, 31, 40)],
        'm2': [(22, 24, 33, 40), (25, 30, 31, 40)],
        'm3': [(25, 30, 31, 40)],
        'f0': [(25, 30, 31, 40)],
        'f1': [(22, 30, 34, 40)],
        'f2': [(25, 30, 31, 40)],
        'f3': [(23, 24, 32, 39), (25, 30, 32, 40)]},
}


def hair_clean(h, name, r):
    if r < 2:
        for y0, y1, x0, x1 in HAIR_FACE[r][name]:
            h[y0:y1 + 1, x0:x1 + 1] = 0
    return h


def outfit_clean(rows3, body, offs):
    """옷 레이어에 섞인 얼굴 속의 점(몸 레이어 머리의 빈 점 자리에 남은 것)을 지운다 — 옷은 얼굴 위에 그려져 눈 옆에 점으로 보였다"""
    for r in range(2):
        for c in range(8):
            rows3[r][c][face_zone(r, offs[r][c]) & face_holes(body[r][c])] = 0
    return rows3


def spread(layer3, offs):
    """대기 칸의 레이어 3줄 → 8칸 × 3줄 (머리가 옮겨 간 만큼 같이 옮긴다)"""
    out = []
    for r in range(3):
        row = []
        for c in range(8):
            fr = blank()
            put(fr, layer3[r], offs[r][c][0], offs[r][c][1])
            row.append(fr)
        out.append(row)
    return out


def char_sheet(rows3):
    """[아래 8칸, 오른쪽 8칸, 위 8칸] → 512×320 (왼쪽 줄은 오른쪽 줄을 뒤집는다)"""
    sh = np.zeros((FH * 4, FW * 8, 4), np.int32)
    for row, r, flip in ((0, 0, False), (1, 1, True), (2, 1, False), (3, 2, False)):
        for c in range(8):
            fr = rows3[r][c]
            sh[row * FH:(row + 1) * FH, c * FW:(c + 1) * FW] = fr[:, ::-1] if flip else fr
    return sh


HAIR_NAMES = ['m0', 'm1', 'm2', 'm3', 'f0', 'f1', 'f2', 'f3']


def build_chars(only_base=False):
    frames, offs, heads = char_frames(SRC / 'char2-base.png')
    body, outfit0, info = split_base(frames, offs, heads)
    out = {'body_m': char_sheet(body)}
    bf = char_sheet(body)
    low = np.zeros(bf.shape[:2], bool)
    for row in range(4):
        low[row * FH + FH - 14:(row + 1) * FH] = True
    for src, dst in SHOE_F.items():
        bf[col_in(bf, {src}) & low, :3] = dst
    out['body_f'] = bf
    out['outfit_0'] = char_sheet(outfit_clean(outfit0, body, offs))
    if only_base:
        return out, frames, offs, heads
    href = {0: heads[0], 1: heads[1], 2: heads[2], 'offs': offs}
    for n in (1, 2, 3):
        fr, _, _ = char_frames(SRC / f'char2-outfit{n}.png', head_ref=href)
        out[f'outfit_{n}'] = char_sheet(outfit_clean(split_outfit(fr, heads, body, info), body, offs))
    ref = [snap(f, extra=EXTRA) for f in green_rows(frames, heads)]
    al = align_ref(SRC / 'char2-hair.png', ref, fit_top=True)
    for c, name in enumerate(HAIR_NAMES):
        out[f'hair_{name}'] = char_sheet(spread([hair_clean(hair_of(outline(al[r][c]), ref[r], r), name, r) for r in range(3)], offs))
    for v in range(4):
        out[f'face_{v}'] = char_sheet([[face_hand(v, r, body[r][c], offs[r][c]) for c in range(8)] for r in range(3)])
    return out


# =====================================================================
# 적 (size×size 4칸: 걷기 2 · 준비 · 맞음)
# 시트는 가로 8칸(왼쪽 4칸 · 오른쪽 4칸이 각각 한 마리). 줄은 그림마다 달라 세로 범위를 적어 둔다.
#   (id, 칸 크기, 왼쪽 0 / 오른쪽 1, y0, y1)
# =====================================================================
ENEMY_SHEETS = {
    'enemy1': [('slime', 16, 0, 26, 37), ('spitter', 16, 0, 54, 69), ('golem', 32, 1, 107, 138)],
    'enemy2': [('sprout', 16, 0, 24, 39), ('moth', 16, 1, 23, 40), ('lizard', 16, 0, 59, 70), ('toad', 16, 1, 57, 70),
               ('treant', 24, 0, 78, 102), ('imugi', 32, 1, 109, 140)],
    'enemy3': [('snowimp', 16, 0, 22, 38), ('icebat', 16, 1, 23, 38), ('frostjar', 16, 0, 53, 68), ('wisp', 16, 1, 52, 68),
               ('haetae', 24, 1, 77, 99), ('winterGeneral', 32, 0, 99, 131)],
    'enemy4': [('ram', 16, 0, 24, 37), ('kite', 16, 1, 22, 37), ('chick', 16, 0, 53, 67), ('geumgye', 24, 0, 76, 99), ('yeongdeung', 32, 1, 68, 99)],
    'enemy5': [('bulgae', 16, 0, 22, 38), ('sparrow', 16, 1, 53, 67), ('iron', 16, 0, 84, 99), ('hwacha', 24, 1, 73, 99), ('bulgasari', 32, 0, 100, 131)],
    # 16px 칸에 넘치던 것들을 작게 다시 그린 시트
    'enemy-fix': [('goblin', 16, 0, 24, 41), ('torchimp', 16, 1, 25, 41), ('wildcat', 16, 0, 69, 82), ('scarecrow', 16, 1, 66, 83),
                  ('icecrystal', 16, 0, 108, 122), ('bat', 16, 1, 108, 120)],
    # 돌갑옷 무사만 24px 칸에 맞게 다시 그린 시트 (가로 4칸) — 여섯째 값 = 시트의 가로 칸 수
    'enemy-knight': [('knight', 24, 0, 55, 78, 4)],
}
# 구역마다의 적 (확인 그림의 순서)
ZONES = [['slime', 'bat', 'spitter', 'goblin', 'knight', 'golem'], ['sprout', 'moth', 'lizard', 'toad', 'treant', 'imugi'],
         ['snowimp', 'icebat', 'frostjar', 'wisp', 'icecrystal', 'haetae', 'winterGeneral'], ['ram', 'kite', 'chick', 'scarecrow', 'geumgye', 'yeongdeung'],
         ['bulgae', 'torchimp', 'wildcat', 'sparrow', 'iron', 'hwacha', 'bulgasari']]


def enemy_strip(im, size, half, y0, y1, cols=8):
    W = im.shape[1]
    cw = W / cols
    out = np.zeros((size, size * 4, 4), np.int32)
    reg = im[y0:y1 + 1]
    lab, comps = components(reg[..., 3] > 0)
    stuck = size >= 32 or any(c['x1'] - c['x0'] + 1 > cw + 6 for c in comps)     # 옆 칸과 붙어 있으면 칸대로 자른다
    boxes = []
    for f in range(4):
        xa, xb = int(round((half * 4 + f) * cw)), int(round((half * 4 + f + 1) * cw))
        if stuck:
            m = reg[..., 3] > 0
            m[:, :xa] = False
            m[:, xb:] = False
        else:
            mine = [c for c in comps if abs(c['cx'] - (xa + xb) / 2) <= cw / 2]
            big = max((c['area'] for c in mine), default=0)
            m = np.zeros(reg.shape[:2], bool)
            for c in mine:
                if c['area'] >= 4 or c['area'] >= big:          # 흩날리는 잔 점(가루 · 짚)은 뺀다
                    m |= lab == c['id']
        ys, xs = np.where(m)
        if len(ys) == 0:
            boxes.append(None)
            continue
        g = reg[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
        g[~m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]] = 0
        boxes.append((g, xs.min(), xs.max(), ys.max(), (xa + xb) / 2))
    base = max(b[3] for b in boxes if b)
    s = min(1.0, size / max(max(b[0].shape[:2]) for i, b in enumerate(boxes) if b and i != 2))
    for f, b in enumerate(boxes):
        if not b:
            continue
        g, x0, x1, yb, cx = b
        sf = max(min(s, size / max(g.shape[:2])), 0.8 * s)     # 준비 칸이 조금 크면 줄이고, 많이 크면 칸에서 잘린다
        if sf < 1:
            g = shrink(g, sf)
        g = outline(np.pad(snap(g, tol=26), ((1, 1), (1, 1), (0, 0))))
        ys, xs = np.where(g[..., 3] > 0)
        g = g[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        h, w = g.shape[:2]
        bx = int(round(size / 2 + ((x0 + x1 + 1) / 2 - cx) * sf - w / 2))
        bx = max(min(0, size - w), min(max(0, size - w), bx))
        by = min(size - h, size - int(round((base - yb) * sf)) - h)
        cell = np.zeros((size, size, 4), np.int32)
        put(cell, g, bx, max(by, min(0, size - h)))
        out[:, f * size:(f + 1) * size] = cell
    return out


def build_enemies():
    res = {}
    for sheet, lst in ENEMY_SHEETS.items():
        im = key(load(SRC / f'{sheet}.png'))
        for eid, size, *rest in lst:
            res[eid] = enemy_strip(im, size, *rest)
    return res


# =====================================================================
# 타일 (16×16, TILE_ORDER 순서로 가로 한 줄)
# 시트는 12칸씩 4줄 = 43칸. skip = 앞에 덧그려진 칸 수, take = {칸: 가져올 곳} ('stone' = 1구역 시트의 같은 칸, 'hand' = 손그림 draw.py)
# fix = (그 테마 그림을 다시 올려 몇 칸만 고쳐 그린 시트, [거기서 가져올 칸]), calm = 흰 점(돌 부스러기)을 바탕색으로 지울 칸
# =====================================================================
TILE_ORDER = ['floor', 'floor2', 'wallTop', 'wallFace', 'doorOpen', 'doorLocked', 'water', 'pillar', 'gate', 'rock', 'switch', 'switchOn',
              'vine', 'stairs', 'chest', 'chestOpen', 'pedestal', 'pedestalEmpty', 'shop', 'fountain', 'rubble', 'fountainDry',
              'plate', 'plateOn', 'brazier', 'brazierLit', 'post',
              'coldWater', 'ice', 'bell', 'bellOn', 'gong', 'gongOn', 'boulder', 'pit',
              'rod', 'rodOn', 'puff', 'bars', 'mirrorA', 'mirrorB', 'fog', 'wish']
COLD = {'coldWater': 'stone', 'ice': 'stone'}      # 찬물 · 얼음은 테마와 상관없이 같은 그림
TILE_THEMES = {
    'stone': {'file': 'tiles.png', 'src': 'tiles-stone.png', 'fix': ('tiles-stone-fix.png', ['floor2', 'wallTop']), 'calm': ['floor']},
    'moss': {'file': 'tiles-moss.png', 'src': 'tiles-moss.png', 'skip': 12, 'take': {**COLD}},
    'frost': {'file': 'tiles-frost.png', 'src': 'tiles-frost.png', 'take': {**COLD}, 'fix': ('tiles-frost-fix.png', ['floor2', 'wallTop'])},
    'cloud': {'file': 'tiles-cloud.png', 'src': 'tiles-cloud.png', 'skip': 8, 'take': {**COLD}},
    'ember': {'file': 'tiles-ember.png', 'src': 'tiles-ember.png', 'skip': 12, 'take': {**COLD}, 'fix': ('tiles-ember-fix.png', ['floor2', 'brazier', 'pit']),
              # 바닥이 너무 붉어 붉은 적이 묻힌다 → 살구빛 바닥(--roulette-summer) · 주황 줄눈과 벽 윗면(--race-track)
              'recolor': [((232, 106, 90), hx('#f7c1a8'), 4), ((188, 32, 14), hx('#e08a4f'), 16), ((244, 82, 54), hx('#f9a873'), 16)]},
}


def tile_cells(path, skip=0):
    im = key(load(path))
    _, comps = components(im[..., 3] > 0)
    comps = [c for c in comps if c['area'] >= 120 and c['y1'] - c['y0'] >= 10 and c['x1'] - c['x0'] >= 10]
    comps.sort(key=lambda c: c['y0'])
    rows = []
    for c in comps:
        if rows and c['y0'] < rows[-1][0]['y1'] - 4:
            rows[-1].append(c)
        else:
            rows.append([c])
    cells = [c for row in rows for c in sorted(row, key=lambda c: c['x0'])][skip:]
    if len(cells) != len(TILE_ORDER):
        raise SystemExit(f'{path.name}: 타일 {len(cells)}칸 (있어야 할 수 {len(TILE_ORDER)})')
    out = []
    for c in cells:
        g = im[c['y0']:c['y1'] + 1, c['x0']:c['x1'] + 1]
        tint = lambda line: (np.minimum(line[:, 0], line[:, 2]) - line[:, 1]).mean()
        for _ in range(2):                              # 가장자리에 번진 자홍 줄(안쪽 줄보다 자홍빛이 도는 줄)은 잘라 낸다
            if g.shape[0] > 14 and tint(g[0]) - tint(g[2]) > 7:
                g = g[1:]
            if g.shape[0] > 14 and tint(g[-1]) - tint(g[-3]) > 7:
                g = g[:-1]
            if g.shape[1] > 14 and tint(g[:, 0]) - tint(g[:, 2]) > 7:
                g = g[:, 1:]
            if g.shape[1] > 14 and tint(g[:, -1]) - tint(g[:, -3]) > 7:
                g = g[:, :-1]
        g = to_img(g).resize((16, 16), Image.NEAREST)
        a = np.array(g).astype(np.int32)
        a[..., 3] = 255
        out.append(snap(a, tol=22, dark=30, edge_dark=0))
    return out


def build_tiles():
    made = {}
    hand = None
    for theme, cfg in TILE_THEMES.items():
        cells = tile_cells(SRC / cfg['src'], cfg.get('skip', 0))
        if 'fix' in cfg:
            fixed = tile_cells(SRC / cfg['fix'][0], -len(TILE_ORDER))      # 위에 덧그려진 조각이 있으면 뒤의 43칸만
            for k in cfg['fix'][1]:
                cells[TILE_ORDER.index(k)] = fixed[TILE_ORDER.index(k)]
        for k in cfg.get('calm', []):
            t = cells[TILE_ORDER.index(k)]
            cols, cnt = np.unique(t[..., :3].reshape(-1, 3), axis=0, return_counts=True)
            t[lum(t[..., :3].astype(np.float64)) > lum(cols[cnt.argmax()].astype(np.float64)) + 12, :3] = cols[cnt.argmax()]
        for k, frm in cfg.get('take', {}).items():
            i = TILE_ORDER.index(k)
            if frm == 'hand':
                if hand is None:
                    sys.path.insert(0, str(HERE))
                    import draw as hand
                hs = np.array(hand.draw_tiles(theme).im).astype(np.int32)
                t, fl = hs[:, i * 16:(i + 1) * 16].copy(), hs[:, :16]
                if k not in ('wallTop', 'wallFace', 'water'):
                    bgm = (t == fl).all(-1)                  # 손그림의 바닥 바탕은 새 바닥으로
                    t[bgm] = cells[0][bgm]
                cells[i] = t
            else:
                cells[i] = made[frm][:, i * 16:(i + 1) * 16]
        sh = np.concatenate(cells, 1)
        for src, dst, tol in cfg.get('recolor', []):
            m = (np.abs(sh[..., :3] - np.array(src)).max(-1) <= tol)
            sh[m, :3] = dst
        made[theme] = sh
    for theme, sh in made.items():                 # 연 상자 칸은 닫힌 상자 칸에서 다시 그린다 (받은 그림은 닫힌 상자처럼 보였다)
        made[theme] = np.array(chest_open.apply(to_img(sh))).astype(np.int32)
    return made


# =====================================================================
# 구슬 아이콘 (16×16) · 로비 카드
# =====================================================================
def build_orbs():
    ids = [o['id'] for o in json.loads((ROOT / 'games/tower/src/data/orbs.json').read_text(encoding='utf-8'))['orbs']]
    im = key(load(SRC / 'orbs.png'))
    cells = grid_cells(im, 8, 2, min_area=40)
    out = {}
    for i, oid in enumerate(ids):
        x0, y0, x1, y1 = cells[(i // 8, i % 8)]
        g = im[y0:y1 + 1, x0:x1 + 1]
        if max(g.shape[:2]) > 16:
            g = shrink(g, 16 / max(g.shape[:2]))
        g = outline(np.pad(snap(g, tol=26), ((1, 1), (1, 1), (0, 0))))
        ys, xs = np.where(g[..., 3] > 0)
        g = g[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        if max(g.shape[:2]) > 16:
            g = shrink(g, 16 / max(g.shape[:2]))
        cell = np.zeros((16, 16, 4), np.int32)
        put(cell, g, (16 - g.shape[1]) // 2, (16 - g.shape[0]) // 2)
        out[oid] = cell
    return out


def build_card():
    """16:9 그림의 가운데를 16:10 으로 잘라 640×400"""
    im = Image.open(SRC / 'card.png').convert('RGB')
    w = round(im.height * 1.6)
    x = (im.width - w) // 2
    return im.crop((x, 0, x + w, im.height)).resize((640, 400), Image.LANCZOS)


# =====================================================================
def main():
    chars = build_chars()
    for n, sh in chars.items():
        to_img(sh).save(ART / f'char/{n}.png')
    enemies = build_enemies()
    for e, st in enemies.items():
        to_img(st).save(ART / f'enemy/{e}.png')
    tiles = build_tiles()
    for theme, sh in tiles.items():
        to_img(sh).save(ART / TILE_THEMES[theme]['file'])
    orbs = build_orbs()
    for o, cell in orbs.items():
        to_img(cell).save(ART / f'orb/{o}.png')
    build_card().save(CARD, optimize=True)
    print(f'char {len(chars)} · enemy {len(enemies)} · tiles {len(tiles)} · orb {len(orbs)} · {CARD.name}')

    if len(sys.argv) > 1:      # 확인용 확대 그림
        out = Path(sys.argv[1])
        out.mkdir(parents=True, exist_ok=True)
        bg = (127, 184, 232, 255)

        def view(arr, name, scale):
            v = to_img(arr)
            b = Image.new('RGBA', v.size, bg)
            b.alpha_composite(v)
            b.resize((v.width * scale, v.height * scale), Image.NEAREST).convert('RGB').save(out / name)

        looks = [('m', 0, 0, 0), ('m', 1, 1, 2), ('m', 2, 3, 3), ('m', 3, 2, 0), ('f', 0, 2, 1), ('f', 1, 1, 1), ('f', 2, 0, 3), ('f', 3, 3, 2)]
        for i in range(0, len(looks), 2):
            sh = np.zeros((FH * 8, FW * 8, 4), np.int32)
            for j, (sex, hair, face, outfit) in enumerate(looks[i:i + 2]):
                for n in (f'body_{sex}', f'face_{face}', f'outfit_{outfit}', f'hair_{sex}{hair}'):
                    put(sh, chars[n], 0, j * FH * 4)
            view(sh, f'contact-chars-{i // 2}.png', 2)
        # 머리 8 · 얼굴 4 · 옷 4 를 한눈에 (대기 칸: 아래 · 오른쪽 · 위)
        kinds = [(f'hair_{n}', ('m' if n[0] == 'm' else 'f', 0, 0, n)) for n in HAIR_NAMES] + [(f'face_{i}', ('m', i, 0, None)) for i in range(4)] + [(f'outfit_{i}', ('f', 0, i, 'f3')) for i in range(4)]
        sh = np.zeros((FH * 3, FW * len(kinds), 4), np.int32)
        for k, (_, (sex, face, outfit, hair)) in enumerate(kinds):
            names = [f'body_{sex}', f'face_{face}', f'outfit_{outfit}'] + ([f'hair_{hair}'] if hair else [])
            for j, row in enumerate((0, 2, 3)):
                for n in names:
                    put(sh, chars[n][row * FH:(row + 1) * FH, :FW], k * FW, j * FH)
        view(sh, 'contact-kinds.png', 2)
        lay = ['TTTTTTTTTTTTTTTTTTTTTT', 'FFFFDFFFFFFFFFFFFFFFFF', '.,.p....wwv.qQ.WWI.12.', '.c.C.o.O.ws.hH.WII.3.4', '..r.g.S.f.d.P.bBnN.56.', 'TTTTTLTTTTTTTT.RU..778']
        kk = {'T': 'wallTop', 'F': 'wallFace', '.': 'floor', ',': 'floor2', 'p': 'pillar', 'w': 'water', 'v': 'vine', 's': 'switch', 'c': 'chest', 'C': 'chestOpen',
              'o': 'pedestal', 'O': 'pedestalEmpty', 'r': 'rock', 'g': 'gate', 'S': 'shop', 'f': 'fountain', 'd': 'fountainDry', 'D': 'doorOpen', 'L': 'doorLocked',
              'q': 'plate', 'Q': 'plateOn', 'h': 'brazier', 'H': 'brazierLit', 'P': 'post',
              'W': 'coldWater', 'I': 'ice', 'b': 'bell', 'B': 'bellOn', 'n': 'gong', 'N': 'gongOn', 'R': 'boulder', 'U': 'pit',
              '1': 'rod', '2': 'rodOn', '3': 'puff', '4': 'bars', '5': 'mirrorA', '6': 'mirrorB', '7': 'fog', '8': 'wish'}
        hero = blank()
        for n in ('body_m', 'face_0', 'outfit_0', 'hair_m0'):
            put(hero, chars[n][:FH, :FW], 0, 0)
        hero = hero[::2, ::2]                      # 방 그림은 타일 1배 → 캐릭터는 0.5배 (게임과 같은 크기)
        for theme, sh in tiles.items():
            view(sh, f'contact-tiles-{theme}.png', 3)
            room = np.zeros((16 * 6, 16 * 22, 4), np.int32)
            ti = lambda k: sh[:, TILE_ORDER.index(k) * 16:TILE_ORDER.index(k) * 16 + 16]
            for y, line in enumerate(lay):
                for x, ch in enumerate(line):
                    room[y * 16:y * 16 + 16, x * 16:x * 16 + 16] = ti(kk[ch])
            room[64:80, 176:192] = ti('stairs')
            room[64:80, 0:16] = ti('rubble')
            room[48:64, 176:192] = ti('switchOn')
            put(room, hero, 96, 16)
            x = 8
            for eid in ZONES[list(TILE_THEMES).index(theme)]:
                size = enemies[eid].shape[0]
                put(room, enemies[eid][:, :size], x, 80 - size)
                x += size + 6
            view(room, f'contact-room-{theme}.png', 5)
        for zi, ids in enumerate(ZONES):
            en = np.zeros((sum(enemies[e].shape[0] for e in ids), 128, 4), np.int32)
            y = 0
            for eid in ids:
                put(en, enemies[eid], 0, y)
                y += enemies[eid].shape[0]
            view(en, f'contact-enemies-{zi + 1}.png', 5)
        ob = np.zeros((35, 137, 4), np.int32)
        for i, cell in enumerate(orbs.values()):
            put(ob, cell, 1 + (i % 8) * 17, 1 + (i // 8) * 17)
        view(ob, 'contact-orbs.png', 8)


if __name__ == '__main__':
    main()
