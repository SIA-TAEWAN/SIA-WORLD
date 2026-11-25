"""
시아의탑 도트 그림 전부 (Fable 5.2 손그림, 2026-11-25). SpriteCook 크레딧이 생기면 다시 그린다 (art/spritecook/REDRAW-QUEUE.md).

  python games/tower/art/draw.py            # public/art/** · manifest.json · shared/images/card-tower.png 를 다시 만든다
  python games/tower/art/draw.py <폴더>      # 확인용 확대 그림(contact-*.png)도 그 폴더에 만든다

1구역(tiles.png · 적 6종) + 2구역 "이끼 낀 회랑"(tiles-moss.png · 적 6종). 규격은 games/tower/ASSETS.md, 칸 순서·자세는 src/art/sheets.ts 와 같다. 무작위가 없어 몇 번을 돌려도 같은 파일이 나온다.
색은 shared/theme.css 의 값만 쓴다 (살색 한 가지만 sheets.ts 의 임시 그림과 같은 값).
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
ART = ROOT / 'games/tower/public/art'
CARD = ROOT / 'shared/images/card-tower.png'


def hx(h):
    return (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), 255)


# ---- shared/theme.css ----
OUT = hx('#2a1a10')        # --outline
INK = hx('#8a6a4a')        # --ink-soft
LINE = hx('#e2d3b5')       # --line-soft
EMPTY = hx('#c9b48e')      # --empty-line
PRIM = hx('#ffd34d')       # --primary
PRIM_L = hx('#ffe066')     # --primary-light
PRIM_D = hx('#f0a500')     # --primary-deep
PINK = hx('#ff4d6d')       # --pink
TRACK = hx('#eee2c8')      # --track
WHITE = hx('#ffffff')
PANEL = hx('#fff8e8')      # --panel
PANEL_S = hx('#fff4c2')    # --panel-strong
TEAM_A = hx('#3d8bff')     # --team-a
SKY_D = hx('#1f6fd1')      # --sky-deep
SKY_T = hx('#4aa8ff')      # --sky-top
SKY_M = hx('#9fd6ff')      # --sky-mid
WIN = hx('#4cb86a')        # --win
LOSE = hx('#e86a5a')       # --lose
DRAW = hx('#9a8c7e')       # --draw
MAT_L = hx('#8fcc9b')      # --matgo-mat-light
MAT_D = hx('#5fa772')      # --matgo-mat-dark
MATGO = hx('#7cc08a')      # --table-matgo
POKER = hx('#6cc6b5')      # --table-poker
SUMMER = hx('#f7c1a8')     # --roulette-summer
AUTUMN = hx('#a9ddc6')     # --roulette-autumn
WINTER = hx('#c9d1dd')     # --roulette-winter
TRACK_O = hx('#f9a873')    # --race-track
TRACK_D = hx('#e08a4f')    # --race-track-dark
LOG = hx('#9a6a3a')        # --charge-log
LOG_E = hx('#c89a5a')      # --charge-log-end
BLADE = hx('#cfd6de')      # --charge-blade
PIT = hx('#3a2a1c')        # --charge-pit
PIT_I = hx('#5a4030')      # --charge-pit-inner
CRATE = hx('#d9a05b')      # --charge-crate
STUN = hx('#9fb6ff')       # --charge-stun-tint
SKIN = hx('#ffd9b8')       # 살색 (sheets.ts 의 임시 그림과 같은 값)
SKIN_S = SUMMER            # 살색 그늘


class Cv:
    def __init__(self, w, h=None, bg=None):
        self.w, self.h = w, h or w
        self.im = Image.new('RGBA', (self.w, self.h), bg or (0, 0, 0, 0))
        self.px = self.im.load()

    def p(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = c

    def r(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.p(xx, yy, c)

    def row(self, y, x0, x1, c):
        self.r(x0, y, x1 - x0 + 1, 1, c)

    def col(self, x, y0, y1, c):
        self.r(x, y0, 1, y1 - y0 + 1, c)

    def pts(self, pts, c):
        for x, y in pts:
            self.p(x, y, c)

    def ell(self, cx, cy, rx, ry, c):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                    self.p(x, y, c)

    def clear(self, x, y, w, h):
        self.r(x, y, w, h, (0, 0, 0, 0))

    def solid(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h and self.px[x, y][3] > 100

    def mask(self):
        return {(x, y) for y in range(self.h) for x in range(self.w) if self.px[x, y][3] > 100}

    def outline(self, c=OUT, skip=None):
        """그림 바깥에 1px 테두리. skip = 테두리를 두르지 않을 자리"""
        m = self.mask()
        for y in range(self.h):
            for x in range(self.w):
                if (x, y) in m or (skip and (x, y) in skip):
                    continue
                if (x - 1, y) in m or (x + 1, y) in m or (x, y - 1) in m or (x, y + 1) in m:
                    self.px[x, y] = c

    def grid(self, x, y, rows, pal):
        for j, line in enumerate(rows):
            for i, ch in enumerate(line):
                if ch in pal:
                    self.p(x + i, y + j, pal[ch])

    def paste(self, other, x, y, flip=False):
        im = other.im.transpose(Image.FLIP_LEFT_RIGHT) if flip else other.im
        self.im.alpha_composite(im, (x, y))
        self.px = self.im.load()


# =====================================================================
# 캐릭터 레이어
# =====================================================================
F = 32
HXL, HXR = 10, 21  # 머리 가로 범위


def pose_of(d, col):
    walk = col - 1 if 1 <= col <= 4 else -1
    return {
        'dir': d,                                   # 0 아래 · 2 오른쪽 · 3 위
        'dip': 1 if walk in (0, 2) else 0,          # 발을 벌린 칸은 몸이 1px 내려간다
        'leg': 1 if walk == 0 else -1 if walk == 2 else 0,
        'arm': col - 5 if col >= 5 else -1,         # 공격: 0 뒤로 · 1 앞으로 · 2 휘두른 뒤
    }


def head_rows(d):
    hy = 5 + d
    rows = [(hy, 12, 19), (hy + 1, 11, 20)]
    rows += [(y, HXL, HXR) for y in range(hy + 2, hy + 10)]
    rows += [(hy + 10, 11, 20)]
    return rows


def legs(p, sex):
    """(x, 다리 높이, 폭, 신발 (x, y, w), 먼 다리인지)"""
    w = 3 if sex == 'm' else 2
    out = []
    if p['dir'] != 2:
        for x, lift in ((12 if sex == 'm' else 13, p['leg'] > 0), (17, p['leg'] < 0)):
            out.append((x, 3 if lift else 5, w, (x, 27 if lift else 29, w), False))
    elif p['leg'] == 0:
        out.append((14, 5, w, (14, 29, w + 1), False))
    else:
        far_x, near_x = (17, 12) if p['leg'] > 0 else (12, 17)
        for x, far in ((far_x, True), (near_x, False)):
            back = x == 12
            out.append((x, 4 if back else 5, w, (x, 28 if back else 29, w + 1), far))
    return out


def arms(p):
    """팔: sleeve(소매 자리) · hand(손 자리). 몸과 옷이 같은 자리에 그린다"""
    d, a, dr = p['dip'], p['arm'], p['dir']
    idle_l = {'sleeve': (10, 17 + d + p['leg'], 2, 4), 'hand': (10, 21 + d + p['leg'], 2, 2), 'cuff': True}
    idle_r = {'sleeve': (20, 17 + d - p['leg'], 2, 4), 'hand': (20, 21 + d - p['leg'], 2, 2), 'cuff': True}
    if dr == 2:
        if a < 0:
            sw = p['leg']
            return [{'sleeve': (15 + sw, 17 + d, 2, 4), 'hand': (15 + 2 * sw, 21 + d, 2, 2), 'cuff': True, 'on': True}]
        return [[
            {'sleeve': (10, 16, 4, 3), 'hand': (8, 13, 3, 3)},
            {'sleeve': (17, 18, 4, 3), 'hand': (21, 18, 4, 3)},
            {'sleeve': (16, 19, 4, 3), 'hand': (20, 20, 3, 3)},
        ][a]]
    if a < 0:
        return [idle_l, idle_r]
    if dr == 0:
        return [idle_l, [
            {'sleeve': (20, 15, 4, 3), 'hand': (23, 11, 2, 4)},
            {'sleeve': (20, 17, 3, 4), 'hand': (20, 21, 3, 5)},
            {'sleeve': (19, 20, 3, 3), 'hand': (15, 22, 4, 2)},
        ][a]]
    return [idle_r, [
        {'sleeve': (9, 17, 2, 4), 'hand': (8, 21, 2, 3)},
        {'sleeve': (8, 15, 4, 3), 'hand': (7, 9, 2, 6)},
        {'sleeve': (8, 15, 4, 3), 'hand': (8, 12, 2, 3)},
    ][a]]


def torso_x(p):
    return (12, 18) if p['dir'] == 2 else (12, 19)


def paint_body(cv, p, sex):
    d = p['dip']
    shoe = INK if sex == 'm' else LOSE
    for x, h, w, (sx, sy, sw), far in legs(p, sex):
        cv.r(x, 24, w, h, SKIN_S if far else SKIN)
        cv.r(sx, sy, sw, 2, PIT_I if far and sex == 'm' else shoe)
    x0, x1 = torso_x(p)
    cv.r(x0, 16 + d, x1 - x0 + 1, 8, SKIN)
    for a in arms(p):
        cv.r(*a['sleeve'], SKIN)
        cv.r(*a['hand'], SKIN)
    for y, a, b in head_rows(d):
        cv.row(y, a, b, SKIN)
    hy = 5 + d
    if p['dir'] == 2:
        cv.p(22, hy + 6, SKIN)                       # 코
        cv.r(14, hy + 5, 2, 2, SKIN_S)               # 귀
    elif p['dir'] == 0:
        cv.row(hy + 10, 13, 18, SKIN_S)              # 턱 그늘


BODY_MASK = {}   # (dir, col) → 몸이 차지하는 자리 (남·여 합친 것)
HEAD_MASK = {}


def face_paint(cv, p, v):
    if p['dir'] == 3:
        return
    y = 10 + p['dip']
    side = p['dir'] == 2
    eyes = [18] if side else [13, 17]
    for ex in eyes:
        if v == 0:      # 동글
            cv.r(ex, y, 2, 2, OUT)
        elif v == 1:    # 방긋
            cv.pts([(ex - 1 if not side or True else ex, y + 1), (ex, y), (ex + 1, y), (ex + 2, y + 1)], OUT)
        elif v == 2:    # 초롱
            cv.r(ex, y - 1, 2, 3, OUT)
            cv.p(ex, y - 1, WHITE)
            cv.p(ex + 1, y + 1, SKY_D)
        else:           # 다부진
            cv.r(ex, y, 2, 2, OUT)
    if v == 3:
        if side:
            cv.pts([(17, y - 2), (18, y - 2), (19, y - 1), (20, y - 1)], OUT)
        else:
            cv.pts([(12, y - 2), (13, y - 2), (14, y - 1), (19, y - 2), (18, y - 2), (17, y - 1)], OUT)
    # 입
    mx = 20 if side else 15
    if v == 0:
        cv.r(mx, y + 4, 1 if side else 2, 1, LOSE)
    elif v == 1:
        cv.r(mx, y + 3, 2, 1, OUT)
        cv.r(mx, y + 4, 2, 1, PINK)
    elif v == 2:
        cv.r(mx, y + 4, 1 if side else 2, 1, OUT)
    else:
        cv.r(mx, y + 4, 2, 1, PIT_I)
    # 볼
    if v != 3:
        if side:
            cv.r(20, y + 2, 2, 1, PINK)
        else:
            cv.r(11, y + 2, 2, 1, PINK)
            cv.r(19, y + 2, 2, 1, PINK)


# 옷 4벌: 파랑 도포 · 분홍 저고리 · 노랑 조끼 · 초록 무복
OUTFITS = [
    {'top': TEAM_A, 'shade': SKY_D, 'sleeve': TEAM_A, 'cuff': PANEL, 'low': 'robe'},
    {'top': PINK, 'shade': LOSE, 'sleeve': PINK, 'cuff': PANEL, 'low': 'skirt'},
    {'top': PRIM, 'shade': PRIM_D, 'sleeve': PANEL, 'cuff': LINE, 'low': 'pants', 'pants': INK, 'pants_far': PIT_I},
    {'top': WIN, 'shade': MAT_D, 'sleeve': WIN, 'cuff': PIT, 'low': 'pants', 'pants': PIT, 'pants_far': OUT},
]


def outfit_paint(cv, p, v):
    o = OUTFITS[v]
    d, dr = p['dip'], p['dir']
    side, back = dr == 2, dr == 3
    x0, x1 = torso_x(p)
    w = x1 - x0 + 1
    ty = 16 + d
    # --- 아래옷 ---
    if o['low'] == 'pants':
        for x, h, _, _, far in legs(p, 'm'):
            hh = h - 1 if v == 2 else h
            cv.r(x, 24, 3, hh, o['pants_far'] if far else o['pants'])
            if v == 3:
                cv.r(x, 24 + h - 2, 3, 2, DRAW if far else PANEL)     # 행전
        cv.r(x0, 24, w, 1, o['pants'])
    elif o['low'] == 'robe':
        for x, h, _, _, far in legs(p, 'm'):
            cv.r(x, 24, 3, h, LINE if far else PANEL)                 # 흰 바지
        cv.r(x0 - 1, 22 + d, w + 2, 26 - (22 + d), TEAM_A)
        cv.row(26, x0 - 1, x1 + 1, SKY_D)
        if not side and not back:
            cv.col(15, 23 + d, 26, SKY_D)
    else:
        cv.r(x0 - 1, 21 + d, w + 2, 27 - (21 + d), PANEL)
        cv.r(x0 - 2, 25, w + 4, 3, PANEL)
        cv.row(27, x0 - 2, x1 + 2, LINE)
        if side:
            cv.col(15, 23 + d, 26, LINE)
        else:
            cv.col(13, 23 + d, 26, LINE)
            cv.col(18, 23 + d, 26, LINE)
    # --- 웃옷 ---
    th = 5 if v == 1 else 6 if v == 0 else 8
    if v == 2:
        cv.r(x0, ty, w, 8, PANEL)                                     # 흰 적삼
        cv.r(x0, ty, w, 7, PRIM)
        cv.row(ty + 6, x0, x1, PRIM_D)
        if side:
            cv.col(x1, ty, ty + 6, PANEL)
            cv.col(x1 - 1, ty, ty + 6, PRIM_D)
        elif not back:
            cv.r(15, ty, 2, 7, PANEL)
            cv.col(14, ty, ty + 6, PRIM_D)
            cv.col(17, ty, ty + 6, PRIM_D)
            cv.p(15, ty + 3, OUT)
    else:
        cv.r(x0, ty, w, th if v != 3 else 8, o['top'])
    if v != 2 and not side:                                           # 겨드랑이 그늘
        cv.col(x0, ty + 2, ty + (th if v != 3 else 8) - 1, o['shade'])
        cv.col(x1, ty + 2, ty + (th if v != 3 else 8) - 1, o['shade'])
    # 깃
    if v in (0, 1, 3):
        if side:
            cv.pts([(x1, ty), (x1, ty + 1), (x1 - 1, ty + 2)], PANEL)
        elif back:
            cv.row(ty, 14, 17, PANEL)
        else:
            cv.pts([(13, ty), (14, ty), (15, ty + 1), (16, ty + 2), (18, ty), (17, ty), (16, ty + 1)], PANEL)
    # 띠 · 고름
    if v == 0:
        cv.row(ty + 5, x0, x1, PIT)
        if side:
            cv.r(x1 - 1, ty + 5, 2, 1, PRIM)
            cv.col(x1 - 1, ty + 6, ty + 8, PRIM)
        elif not back:
            cv.r(15, ty + 5, 2, 1, PRIM)
            cv.col(16, ty + 6, ty + 8, PRIM)
    elif v == 1:
        if side:
            cv.col(x1 - 1, ty + 3, ty + 7, PRIM)
        elif not back:
            cv.pts([(16, ty + 3), (15, ty + 4), (15, ty + 5), (15, ty + 6), (17, ty + 4), (17, ty + 5), (17, ty + 6), (17, ty + 7)], PRIM)
        cv.row(ty + 4, x0, x1, LOSE) if back else None
    elif v == 3:
        cv.row(ty + 6, x0, x1, PRIM)
        cv.row(ty + 7, x0, x1, MAT_D)
        if side:
            cv.col(x0, ty + 6, ty + 9, PRIM_D)
        elif back:
            cv.r(15, ty + 6, 2, 3, PRIM_D)
        else:
            cv.p(13, ty + 6, PRIM_D)
            cv.col(13, ty + 7, ty + 9, PRIM)
    # --- 소매 (손 자리는 비워 몸의 손이 보이게) ---
    for a in arms(p):
        cv.clear(*a['hand'])
    for a in arms(p):
        sx, sy, sw, sh = a['sleeve']
        if a.get('on'):                                               # 옆모습: 몸통 위의 팔
            cv.r(sx - 1, sy + 1, sw + 2, sh, o['shade'] if v != 2 else PRIM_D)
            hx_, hy_, hw_, hh_ = a['hand']
            cv.clear(hx_, hy_, hw_, hh_)
        cv.r(sx, sy, sw, sh, o['sleeve'])
        if a.get('cuff'):
            cv.r(sx, sy + sh - 1, sw, 1, o['cuff'])
        elif v == 3:
            hx_, hy_, hw_, hh_ = a['hand']
            # 팔 보호대: 소매 끝(손 쪽) 한 줄
            if sw > sh:
                cv.r(sx + sw - 1 if hx_ >= sx else sx, sy, 1, sh, PIT)
            else:
                cv.r(sx, sy if hy_ < sy else sy + sh - 1, sw, 1, PIT)


HAIRS = {
    'm0': (LOG, PIT_I, LOG_E), 'm1': (PIT, OUT, PIT_I), 'm2': (PIT_I, PIT, LOG), 'm3': (TRACK_D, LOG, TRACK_O),
    'f0': (PIT, OUT, PIT_I), 'f1': (LOG, PIT_I, LOG_E), 'f2': (PIT_I, PIT, LOG), 'f3': (PRIM_D, TRACK_D, PRIM),
}


def hair_paint(cv, p, key):
    c, s, l = HAIRS[key]
    d, dr = p['dip'], p['dir']
    hy = 5 + d
    side, back, front = dr == 2, dr == 3, dr == 0
    R, row, col, pts = cv.r, cv.row, cv.col, cv.pts
    # 정수리 (모두 같다)
    row(hy - 2, 12, 19, c)
    row(hy - 1, 11, 20, c)
    cap_h = 1 if key == 'm2' else 2
    for i in range(cap_h):
        row(hy + i, HXL, HXR, c)
    if back:
        bottom = {'m0': 8, 'm1': 8, 'm2': 7, 'm3': 7, 'f0': 9, 'f1': 8, 'f2': 7, 'f3': 9}[key]
        for y in range(hy + 1, hy + bottom + 1):
            row(y, HXL, HXR, c)
        row(hy + bottom, HXL, HXR, s)
    # 윤기
    row(hy - 1, 13, 15, l)
    cv.p(12, hy, l)

    if key == 'm0':      # 짧은 머리
        if front:
            row(hy + 2, 10, 15, c); row(hy + 2, 20, 21, c)
            col(10, hy + 3, hy + 4, c); col(21, hy + 3, hy + 4, c)
            row(hy + 3, 11, 12, s)
        elif side:
            R(10, hy + 2, 6, 6, c); row(hy + 7, 10, 15, s)
            row(hy + 2, 16, 19, c); R(15, hy + 3, 2, 2, c)
        else:
            row(hy + 9, 12, 19, s)
    elif key == 'm1':    # 삐죽 머리
        pts([(11, hy - 2), (12, hy - 3), (13, hy - 3), (15, hy - 3), (16, hy - 3), (17, hy - 3), (16, hy - 4), (19, hy - 3), (20, hy - 3), (20, hy - 2), (21, hy - 1), (10, hy - 1)], c)
        if front:
            for x in (10, 11, 12, 14, 15, 17, 18, 20, 21):
                cv.p(x, hy + 2, c)
            pts([(10, hy + 3), (11, hy + 3), (14, hy + 3), (18, hy + 3), (21, hy + 3), (20, hy + 3), (10, hy + 4), (21, hy + 4)], c)
        elif side:
            R(10, hy + 2, 6, 6, c)
            pts([(9, hy + 2), (9, hy + 5), (9, hy + 6), (10, hy + 8), (12, hy + 8)], c)
            for x in (16, 17, 19, 20):
                cv.p(x, hy + 2, c)
            R(15, hy + 3, 2, 2, c); cv.p(18, hy + 3, c)
            row(hy + 7, 11, 15, s)
        else:
            pts([(11, hy + 9), (12, hy + 9), (14, hy + 9), (15, hy + 9), (17, hy + 9), (18, hy + 9), (20, hy + 9), (9, hy + 3), (22, hy + 3), (9, hy + 6), (22, hy + 6)], c)
    elif key == 'm2':    # 상투
        tx = 13 if side else 14
        R(tx, hy - 4, 4, 2, c)
        row(hy - 4, tx + 1, tx + 2, l)
        pts([(tx - 1, hy - 3), (tx + 4, hy - 3)], PRIM)            # 동곳
        if not back:
            row(hy + 1, HXL, HXR, OUT)                              # 망건
            if front:
                pts([(10, hy + 2), (21, hy + 2), (10, hy + 3), (21, hy + 3)], c)
            else:
                R(10, hy + 2, 5, 5, c); row(hy + 6, 10, 14, s); R(15, hy + 2, 1, 3, c)
        else:
            row(hy + 1, HXL, HXR, c)
    elif key == 'm3':    # 바가지 머리
        row(hy, 12, 19, l); row(hy - 1, 13, 15, c)
        if front:
            row(hy + 2, 10, 21, c)
            row(hy + 2, 12, 19, s)
            col(10, hy + 3, hy + 5, c); col(21, hy + 3, hy + 5, c)
        elif side:
            R(10, hy + 2, 6, 5, c); row(hy + 6, 10, 15, s)
            row(hy + 2, 16, 21, s); R(15, hy + 3, 2, 3, c)
    elif key == 'f0':    # 긴 생머리
        if front:
            row(hy + 2, 10, 14, c); row(hy + 2, 17, 21, c)
            row(hy + 3, 10, 12, c); row(hy + 3, 19, 21, c)
            R(9, hy + 2, 2, 13, c); R(21, hy + 2, 2, 13, c)
            pts([(9, hy + 15), (22, hy + 15)], c)
            col(9, hy + 8, hy + 14, l); col(22, hy + 8, hy + 14, l)
        elif side:
            R(9, hy + 2, 7, 9, c); R(9, hy + 11, 4, 4, c); row(hy + 15, 10, 12, c)
            row(hy + 2, 16, 18, c); R(15, hy + 3, 2, 3, c)
            col(11, hy + 5, hy + 13, l)
        else:
            R(9, hy + 2, 14, 14, c); row(hy + 16, 10, 21, c)
            col(13, hy + 4, hy + 13, l); col(19, hy + 7, hy + 14, l)
            row(hy + 16, 10, 21, s)
    elif key == 'f1':    # 양갈래
        if front:
            row(hy + 2, 10, 14, c); row(hy + 2, 17, 21, c)
            col(10, hy + 3, hy + 4, c); col(21, hy + 3, hy + 4, c)
        elif side:
            R(10, hy + 2, 6, 6, c); row(hy + 7, 10, 15, s)
            row(hy + 2, 16, 20, c); R(15, hy + 3, 2, 2, c)
        else:
            col(15, hy - 1, hy + 6, s)
        if side:
            R(6, hy + 4, 4, 7, c); row(hy + 11, 7, 8, c); col(7, hy + 5, hy + 9, l)
            R(8, hy + 2, 2, 2, PINK)
        else:
            R(7, hy + 4, 3, 7, c); cv.p(8, hy + 11, c); col(8, hy + 5, hy + 9, l)
            R(22, hy + 4, 3, 7, c); cv.p(23, hy + 11, c); col(23, hy + 5, hy + 9, l)
            R(8, hy + 2, 2, 2, PINK); R(22, hy + 2, 2, 2, PINK)
    elif key == 'f2':    # 올림 머리 (쪽 + 비녀)
        bx = 12 if side else 13
        R(bx, hy - 4, 6, 2, c); row(hy - 5, bx + 1, bx + 4, c)
        row(hy - 4, bx + 1, bx + 2, l)
        row(hy - 3, bx - 2, bx - 1, PRIM); row(hy - 3, bx + 6, bx + 7, PRIM)
        cv.p(bx + 8, hy - 3, PINK)
        if front:
            row(hy + 2, 10, 13, c); row(hy + 2, 18, 21, c)
            row(hy + 3, 10, 11, c); row(hy + 3, 20, 21, c)
            col(10, hy + 4, hy + 5, c); col(21, hy + 4, hy + 5, c)
        elif side:
            R(10, hy + 2, 5, 5, c); row(hy + 6, 10, 14, s)
            row(hy + 2, 15, 18, c); R(15, hy + 3, 1, 3, c)
    else:                # 단발
        if front:
            row(hy + 2, 10, 14, c); row(hy + 2, 16, 21, c)
            row(hy + 3, 10, 11, c); row(hy + 3, 20, 21, c)
            R(9, hy + 2, 2, 7, c); R(21, hy + 2, 2, 7, c)
            row(hy + 9, 10, 11, s); row(hy + 9, 20, 21, s)
        elif side:
            R(9, hy + 2, 8, 7, c); row(hy + 9, 10, 16, s)
            row(hy + 2, 17, 21, c); cv.p(17, hy + 3, c)
        else:
            R(9, hy + 2, 14, 7, c); row(hy + 9, 10, 21, s)
            row(hy, 12, 18, l)


def char_sheet(painter, kind):
    """kind: body · face · outfit · hair. 왼쪽 줄은 오른쪽 줄을 뒤집는다"""
    sheet = Cv(F * 8, F * 4)
    for d in range(4):
        for col in range(8):
            p = pose_of(2 if d == 1 else d, col)
            key = (p['dir'], col)
            fr = Cv(F)
            painter(fr, p)
            if kind == 'body':
                m = fr.mask()
                BODY_MASK[key] = BODY_MASK.get(key, set()) | m
                HEAD_MASK[key] = {(x, y) for y, a, b in head_rows(p['dip']) for x in range(a, b + 1)}
                fr.outline()
            elif kind == 'outfit':
                fr.outline(skip=BODY_MASK[key])
            elif kind == 'hair':
                fr.outline(skip=HEAD_MASK[key])
            sheet.paste(fr, col * F, d * F, flip=d == 1)
    return sheet


def draw_chars():
    out = {}
    for sex in 'mf':     # 몸 자리를 먼저 다 모은다 (옷 테두리가 남·여 몸 어디에도 겹치지 않게)
        char_sheet(lambda cv, p: paint_body(cv, p, sex), 'body')
    for sex in 'mf':
        out[f'body_{sex}'] = char_sheet(lambda cv, p: paint_body(cv, p, sex), 'body')
    for v in range(4):
        out[f'face_{v}'] = char_sheet(lambda cv, p: face_paint(cv, p, v), 'face')
        out[f'outfit_{v}'] = char_sheet(lambda cv, p: outfit_paint(cv, p, v), 'outfit')
        for sex in 'mf':
            out[f'hair_{sex}{v}'] = char_sheet(lambda cv, p: hair_paint(cv, p, f'{sex}{v}'), 'hair')
    return out


# =====================================================================
# 타일 (1구역 "탑의 입구": 돌 복도)
# =====================================================================
TILE_ORDER = ['floor', 'floor2', 'wallTop', 'wallFace', 'doorOpen', 'doorLocked', 'water', 'pillar', 'gate', 'rock', 'switch', 'switchOn',
              'vine', 'stairs', 'chest', 'chestOpen', 'pedestal', 'pedestalEmpty', 'shop', 'fountain', 'rubble', 'fountainDry',
              'plate', 'plateOn', 'brazier', 'brazierLit', 'post']

# 테마: stone = 1구역 "탑의 입구" (tiles.png) · moss = 2구역 "이끼 낀 회랑" (tiles-moss.png)
THEMES = {
    'stone': {'floor': WINTER, 'seam': DRAW, 'hi': WHITE, 'shadow': DRAW, 'moss': False},
    'moss': {'floor': AUTUMN, 'seam': MAT_L, 'hi': PANEL, 'shadow': MAT_D, 'moss': True},
}
TP = THEMES['stone']


def t_floor(c, cracked=False):
    c.r(0, 0, 16, 16, TP['floor'])
    c.row(7, 0, 15, TP['seam']); c.row(15, 0, 15, TP['seam'])
    c.col(10, 0, 6, TP['seam']); c.col(3, 8, 14, TP['seam'])
    c.pts([(0, 0), (11, 0), (4, 8)], TP['hi'])                         # 판돌 모서리 빛
    if TP['moss']:
        c.pts([(10, 7), (3, 15)], MATGO)                               # 이음새에 낀 이끼
        if cracked:                                                    # 이끼 덩어리
            c.r(2, 2, 4, 3, MATGO); c.pts([(1, 3), (6, 3), (3, 1), (4, 5)], MATGO); c.pts([(3, 3), (4, 2)], MAT_L); c.pts([(2, 4), (5, 4)], MAT_D)
            c.r(11, 11, 3, 2, MATGO); c.pts([(10, 12), (12, 13)], MATGO); c.p(12, 11, MAT_L); c.p(11, 12, MAT_D)
            c.pts([(8, 10), (7, 11), (7, 12)], MAT_D)
    elif cracked:
        c.pts([(4, 2), (5, 3), (5, 4), (6, 5), (7, 5), (11, 10), (10, 11), (10, 12), (9, 13)], DRAW)
        c.pts([(13, 3), (2, 12)], BLADE)


def t_water(c):
    c.r(0, 0, 16, 16, TEAM_A)
    c.row(3, 1, 5, SKY_M); c.row(4, 4, 7, SKY_T)
    c.row(10, 8, 13, SKY_M); c.row(11, 11, 15, SKY_T); c.row(11, 0, 0, SKY_T)
    c.row(7, 11, 14, SKY_D); c.row(13, 2, 5, SKY_D); c.row(1, 9, 12, SKY_D)
    c.pts([(2, 3), (9, 10)], WHITE)


# 이끼 테마에서 물건 칸 위에 얹는 이끼 (어두운 점, 밝은 점)
MOSS_ON = {
    'pillar': ([(2, 0), (3, 0), (4, 1), (2, 1), (11, 11), (12, 11), (12, 12), (4, 6), (4, 7)], [(3, 1), (11, 12), (5, 5)]),
    'rock': ([(4, 3), (5, 2), (6, 2), (3, 4), (2, 6), (11, 5), (12, 6)], [(5, 3), (4, 4), (12, 5)]),
    'stairs': ([(2, 13), (3, 13), (12, 10), (11, 10), (3, 7), (12, 4)], [(2, 12), (12, 9)]),
    'pedestal': ([(3, 12), (4, 12), (11, 13), (10, 11)], [(3, 13), (5, 11)]),
    'pedestalEmpty': ([(3, 12), (4, 12), (11, 13), (10, 11), (7, 7)], [(3, 13), (5, 11)]),
    'fountain': ([(2, 9), (3, 10), (2, 10), (12, 3), (13, 4)], [(3, 9), (12, 4)]),
    'fountainDry': ([(2, 9), (3, 10), (2, 10), (12, 3), (13, 4), (5, 6), (10, 7)], [(3, 9), (12, 4)]),
    'rubble': ([(3, 9), (10, 11), (9, 4)], [(4, 9)]),
    'switch': ([(3, 4), (4, 4), (3, 5), (12, 11), (11, 12)], [(4, 5)]),
    'switchOn': ([(3, 4), (4, 4), (3, 5), (12, 11), (11, 12)], [(4, 5)]),
    'plate': ([(3, 4), (4, 4), (3, 5), (12, 10)], [(4, 5)]),
    'brazier': ([(2, 7), (3, 8), (12, 12), (11, 13)], [(3, 7)]),
    'brazierLit': ([(2, 7), (3, 8), (12, 12), (11, 13)], [(3, 7)]),
    'gate': ([(1, 14), (2, 15), (6, 13), (12, 2)], []),
    'doorLocked': ([(0, 13), (1, 14), (14, 2), (15, 3), (5, 12)], [(1, 13)]),
    'chest': ([(2, 12), (3, 13)], []),
    'chestOpen': ([(2, 12), (3, 13)], []),
}


def draw_tiles(theme='stone'):
    global TP
    TP = THEMES[theme]
    moss = TP['moss']
    sheet = Cv(16 * len(TILE_ORDER), 16)
    for i, k in enumerate(TILE_ORDER):
        c = Cv(16)
        if k == 'floor':
            t_floor(c)
        elif k == 'floor2':
            t_floor(c, True)
        elif k == 'wallTop' and moss:                                  # 이끼가 덮은 벽 윗면
            c.r(0, 0, 16, 16, MATGO)
            c.row(7, 0, 15, MAT_D); c.row(15, 0, 15, MAT_D)
            c.col(5, 0, 6, MAT_D); c.col(12, 8, 14, MAT_D)
            c.pts([(1, 1), (2, 1), (8, 2), (9, 2), (9, 3), (14, 4), (2, 10), (3, 10), (3, 11), (7, 12), (14, 10), (15, 10)], MAT_L)
            c.r(7, 9, 3, 2, EMPTY); c.p(7, 9, LINE); c.r(1, 3, 2, 2, EMPTY); c.p(1, 3, LINE)      # 드러난 돌
            c.pts([(12, 2), (4, 13), (10, 5)], WIN)
        elif k == 'wallFace' and moss:                                 # 이끼가 흘러내린 벽
            c.r(0, 0, 16, 16, INK)
            c.row(9, 0, 15, PIT_I); c.col(7, 4, 8, PIT_I); c.col(3, 10, 14, PIT_I); c.col(12, 10, 14, PIT_I)
            c.row(4, 0, 6, LOG); c.row(4, 8, 15, LOG); c.row(10, 4, 11, LOG); c.row(10, 0, 2, LOG); c.row(10, 13, 15, LOG)
            c.r(0, 0, 16, 3, MATGO); c.row(0, 0, 15, MAT_L); c.row(3, 0, 15, MAT_D)
            for x, n in ((0, 2), (1, 4), (2, 3), (5, 1), (6, 2), (9, 1), (10, 5), (11, 6), (12, 3), (14, 2), (15, 1)):
                c.col(x, 4, 3 + n, MAT_D)
            c.pts([(1, 5), (10, 6), (11, 7), (11, 5), (2, 4), (12, 4)], MATGO)
            c.pts([(11, 10), (1, 8)], WIN)
            c.row(14, 0, 15, PIT_I); c.row(15, 0, 15, OUT)
        elif k == 'doorOpen' and moss:
            c.r(0, 0, 16, 16, AUTUMN)
            c.row(15, 0, 15, MAT_L); c.col(15, 0, 15, MAT_L)
            c.row(0, 0, 14, PANEL); c.col(0, 0, 14, PANEL)
            c.pts([(2, 2), (12, 2), (2, 12), (12, 12)], MATGO); c.pts([(13, 13), (14, 14), (13, 14), (14, 13), (12, 14)], MATGO)
        elif k == 'wallTop':
            c.r(0, 0, 16, 16, EMPTY)
            c.row(7, 0, 15, INK); c.row(15, 0, 15, INK)
            c.col(5, 0, 6, INK); c.col(12, 8, 14, INK)
            c.row(0, 0, 4, LINE); c.row(0, 6, 15, LINE); c.row(8, 0, 11, LINE); c.row(8, 13, 15, LINE)
            c.pts([(9, 3), (2, 11), (14, 12)], LOG_E)
        elif k == 'wallFace':
            c.r(0, 0, 16, 16, INK)
            c.r(0, 0, 16, 3, EMPTY); c.row(0, 0, 15, LINE)
            c.row(3, 0, 15, OUT)
            c.row(9, 0, 15, PIT_I); c.col(7, 4, 8, PIT_I); c.col(3, 10, 14, PIT_I); c.col(12, 10, 14, PIT_I)
            c.row(4, 0, 6, LOG); c.row(4, 8, 15, LOG); c.row(10, 4, 11, LOG); c.row(10, 0, 2, LOG); c.row(10, 13, 15, LOG)
            c.row(14, 0, 15, PIT_I); c.row(15, 0, 15, OUT)
        elif k == 'doorOpen':
            c.r(0, 0, 16, 16, WINTER)
            c.r(0, 0, 16, 16, BLADE)                                   # 문턱: 이음새 없는 넓은 판돌
            c.row(15, 0, 15, DRAW); c.col(15, 0, 15, DRAW)
            c.row(0, 0, 14, WHITE); c.col(0, 0, 14, WHITE)
            c.pts([(2, 2), (12, 2), (2, 12), (12, 12)], EMPTY)
        elif k == 'doorLocked':
            c.r(0, 0, 16, 16, PIT)
            for x in (1, 5, 9, 13):
                c.col(x, 0, 15, BLADE); c.col(x + 1, 0, 15, DRAW)
            c.r(0, 2, 16, 2, INK); c.row(2, 0, 15, LOG_E)
            c.r(0, 12, 16, 2, INK); c.row(12, 0, 15, LOG_E)
            c.r(5, 5, 6, 6, OUT); c.r(6, 6, 4, 4, PRIM); c.row(6, 6, 9, PRIM_L); c.row(9, 6, 9, PRIM_D)
            c.r(7, 7, 2, 2, OUT)
        elif k == 'water':
            t_water(c)
        elif k == 'pillar':
            t_floor(c)
            c.r(2, 13, 13, 2, TP['shadow'])                                   # 그림자
            c.r(2, 11, 12, 3, EMPTY); c.row(11, 2, 13, LINE); c.row(13, 2, 13, INK)
            c.r(4, 3, 8, 8, EMPTY); c.col(4, 3, 10, LINE); c.col(5, 3, 10, LINE); c.col(10, 3, 10, INK); c.col(11, 3, 10, INK)
            c.col(8, 3, 10, LOG_E)
            c.r(2, 0, 12, 3, EMPTY); c.row(0, 2, 13, LINE); c.row(2, 2, 13, INK)
            c.col(1, 0, 2, OUT); c.col(14, 0, 2, OUT); c.col(3, 3, 10, OUT); c.col(12, 3, 10, OUT)
            c.col(1, 11, 13, OUT); c.col(14, 11, 13, OUT); c.row(14, 2, 13, OUT); c.row(3, 2, 2, OUT); c.row(3, 13, 13, OUT)
            c.p(2, 10, OUT); c.p(13, 10, OUT)
        elif k == 'gate':
            t_floor(c)
            for x in (1, 6, 11):
                c.r(x, 0, 3, 16, OUT); c.col(x + 1, 1, 15, DRAW); c.p(x + 1, 0, BLADE); c.col(x + 1, 1, 3, BLADE)
            c.r(0, 3, 16, 3, OUT); c.row(4, 0, 15, INK)
            c.r(0, 11, 16, 3, OUT); c.row(12, 0, 15, INK)
            for x in (2, 7, 12):
                c.p(x, 4, PRIM_D); c.p(x, 12, PRIM_D)
        elif k == 'rock':
            t_floor(c)
            b = Cv(16)
            b.grid(0, 0, [
                '................',
                '.....hhhhh......',
                '...hhhhhhhgg....',
                '..hhhhggggggg...',
                '..hhgggggggggg..',
                '.hhggggggggggd..',
                '.hggggggggggggd.',
                '.hgggggggggggdd.',
                '.hgggggggggggdd.',
                '.ggggggggggggdd.',
                '.gggggggggggddd.',
                '.gggggggggggddd.',
                '..ggggggggdddd..',
                '..dddddddddddd..',
                '................',
                '................',
            ], {'h': WINTER, 'g': DRAW, 'd': INK})
            b.pts([(8, 2), (8, 3), (7, 4), (7, 5), (8, 6), (9, 7), (9, 8), (6, 6), (5, 7), (10, 9), (11, 10), (8, 9), (8, 10), (7, 11)], OUT)
            b.outline()
            c.row(14, 3, 13, TP['shadow'])
            c.paste(b, 0, 0)
        elif k in ('switch', 'switchOn'):
            t_water(c)
            on = k == 'switchOn'
            c.r(2, 3, 12, 11, OUT)
            c.r(3, 4, 10, 8, EMPTY); c.row(4, 3, 12, LINE); c.r(3, 12, 10, 1, INK)
            c.r(5, 6, 6, 5, OUT)
            if on:
                c.r(6, 8, 4, 2, WIN); c.row(8, 6, 9, MAT_L)
                c.pts([(4, 2), (11, 2), (8, 1)], WIN)
            else:
                c.r(6, 6, 4, 4, PINK); c.row(6, 6, 9, SUMMER); c.p(6, 6, WHITE); c.row(9, 6, 9, LOSE)
        elif k == 'vine':
            t_water(c)
            b = Cv(16)
            b.grid(0, 0, [
                '....gg....gg....',
                '...gGGg..gGGg...',
                '..gGGGGggGGGg...',
                '..gGGgGGGGgGGg..',
                '.gGGgdgGGgdgGGg.',
                '.gGGgdgGGgdgGGg.',
                '..gGGgGGGGgGGg..',
                '.gGGGGGggGGGGGg.',
                '.gGGgGGgdGGgGGg.',
                '..gGdgGGGGgdGg..',
                '.gGGdgGGGGgdGGg.',
                '.gGGGgGggGgGGGg.',
                '..gGGGGgdGGGGg..',
                '...gGGg..gGGg...',
                '....gg....gg....',
                '................',
            ], {'g': MAT_D, 'G': WIN, 'd': PIT})
            b.pts([(4, 2), (10, 2), (3, 7), (9, 6), (12, 8)], MAT_L)
            b.pts([(7, 4), (12, 11)], PINK)
            b.outline()
            c.paste(b, 0, 0)
        elif k == 'stairs':
            c.r(0, 0, 16, 16, PIT)
            c.col(0, 0, 15, INK); c.col(15, 0, 15, INK); c.col(1, 0, 15, OUT); c.col(14, 0, 15, OUT)
            for n, y in enumerate((12, 9, 6, 3, 0)):
                x0 = 2 + (n > 1) + (n > 3)
                c.r(x0, y, 16 - 2 * x0, 2, [PANEL, LINE, LINE, EMPTY, EMPTY][n])
                c.r(x0, y + 2, 16 - 2 * x0, 1, [INK, INK, INK, PIT_I, PIT_I][n])
            c.row(15, 2, 13, INK)
            c.pts([(7, 12), (8, 12), (6, 13), (9, 13), (7, 9), (8, 9)], PRIM_D)
        elif k in ('chest', 'chestOpen'):
            t_floor(c)
            b = Cv(16)
            if k == 'chest':
                b.r(2, 5, 12, 9, CRATE)
                b.r(2, 5, 12, 3, LOG_E); b.row(5, 3, 12, PANEL_S)
                b.row(8, 2, 13, OUT)
                b.col(4, 5, 13, LOG); b.col(11, 5, 13, LOG)
                b.r(2, 12, 12, 2, LOG)
                b.r(7, 7, 2, 4, PRIM); b.p(7, 9, OUT); b.p(8, 9, OUT); b.row(7, 7, 8, PRIM_L)
            else:
                b.r(2, 2, 12, 4, LOG); b.row(2, 3, 12, LOG_E); b.col(4, 2, 5, PIT_I); b.col(11, 2, 5, PIT_I)
                b.r(2, 6, 12, 3, PIT); b.pts([(5, 7), (9, 6), (11, 7)], PRIM); b.p(7, 7, PRIM_L)
                b.r(2, 9, 12, 5, CRATE); b.col(4, 9, 13, LOG); b.col(11, 9, 13, LOG); b.r(2, 12, 12, 2, LOG)
                b.row(9, 2, 13, LOG_E)
            b.outline()
            c.row(15, 3, 13, TP['shadow'])
            c.paste(b, 0, 0)
        elif k in ('pedestal', 'pedestalEmpty'):
            t_floor(c)
            b = Cv(16)
            b.r(3, 12, 10, 2, EMPTY); b.row(13, 3, 12, INK)
            b.r(5, 9, 6, 3, EMPTY); b.col(5, 9, 11, LINE); b.col(10, 9, 11, INK)
            b.r(4, 7, 8, 2, LINE); b.row(8, 4, 11, EMPTY)
            if k == 'pedestal':
                b.grid(5, 1, ['.yyyy.', 'yWyyyy', 'yyyyyd', 'yyyydd', 'yyyydd', '.dddd.'], {'y': PRIM, 'W': WHITE, 'd': PRIM_D})
            else:
                b.row(7, 6, 9, INK)
            b.outline()
            c.row(15, 4, 12, TP['shadow'])
            c.paste(b, 0, 0)
            if k == 'pedestal':
                c.pts([(2, 2), (13, 4)], WHITE)
        elif k == 'shop':
            t_floor(c)
            b = Cv(16)
            # 갓 쓴 상인
            b.r(6, 0, 4, 2, OUT); b.row(2, 3, 12, PIT); b.row(1, 6, 9, PIT); b.row(0, 6, 9, PIT)
            b.r(5, 3, 6, 4, SKIN); b.pts([(6, 4), (9, 4)], OUT); b.row(6, 7, 8, LOSE); b.pts([(5, 5), (10, 5)], PINK)
            b.r(4, 7, 8, 2, WIN); b.pts([(7, 7), (8, 7)], PANEL)
            # 좌판
            b.r(1, 9, 14, 5, CRATE); b.row(9, 1, 14, PINK); b.row(10, 1, 14, PANEL)
            b.col(1, 11, 13, LOG); b.col(14, 11, 13, LOG); b.row(13, 1, 14, LOG)
            b.r(3, 11, 2, 2, PRIM); b.p(3, 11, PRIM_L); b.r(7, 11, 2, 2, PINK); b.p(7, 11, SUMMER); b.r(11, 11, 2, 2, SKY_T); b.p(11, 11, SKY_M)
            b.outline()
            c.paste(b, 0, 0)
        elif k in ('fountain', 'fountainDry'):
            t_floor(c)
            b = Cv(16)
            b.grid(0, 0, [
                '................',
                '................',
                '....llllllll....',
                '..lleeeeeeeell..',
                '.leewwwwwwwweei.',
                '.lewwwwwwwwwwei.',
                '.lewwwwwwwwwwei.',
                '.lewwwwwwwwwwei.',
                '.leewwwwwwwweei.',
                '.eeeeeeeeeeeeei.',
                '.eeeeeeeeeeeeii.',
                '.iieeeeeeeeeiii.',
                '..iiiiiiiiiiii..',
                '................',
                '................',
                '................',
            ], {'l': LINE, 'e': EMPTY, 'i': INK, 'w': SKY_M if k == 'fountain' else DRAW})
            if k == 'fountain':
                b.row(5, 4, 7, WHITE); b.row(7, 8, 11, TEAM_A); b.p(10, 5, WHITE); b.row(4, 3, 12, SKY_T)
                b.pts([(7, 1), (8, 0), (9, 1)], SKY_M)
            else:
                b.row(4, 3, 12, INK); b.pts([(6, 6), (7, 6), (8, 7), (9, 7), (10, 6)], PIT_I)
            b.outline()
            c.row(14, 3, 13, TP['shadow'])
            c.paste(b, 0, 0)
        elif k == 'rubble':
            t_floor(c)
            b = Cv(16)
            b.r(3, 9, 4, 3, DRAW); b.row(9, 3, 5, WINTER); b.p(6, 11, INK)
            b.r(9, 4, 3, 2, DRAW); b.p(9, 4, WINTER)
            b.r(10, 11, 4, 2, DRAW); b.row(11, 10, 12, WINTER)
            b.p(7, 6, DRAW)
            b.outline()
            c.paste(b, 0, 0)
        elif k in ('plate', 'plateOn'):                                # 발판 (눌리면 낮아지고 노랗게 빛난다)
            t_floor(c)
            c.r(2, 3, 12, 11, OUT)
            if k == 'plate':
                c.r(3, 4, 10, 7, EMPTY); c.row(4, 3, 12, LINE); c.col(3, 4, 10, LINE)
                c.r(3, 11, 10, 2, INK)
                c.r(6, 6, 4, 3, INK); c.pts([(6, 6), (9, 6), (6, 8), (9, 8)], EMPTY); c.r(7, 7, 2, 1, EMPTY)
            else:
                c.r(3, 5, 10, 8, PRIM); c.row(12, 3, 12, PRIM_D); c.col(12, 5, 12, PRIM_D)
                c.r(5, 7, 6, 4, PRIM_L); c.r(7, 8, 2, 2, WHITE)
                c.pts([(1, 2), (14, 2), (8, 1)], PRIM_L)
        elif k in ('brazier', 'brazierLit'):                           # 화로 (돌 그릇)
            t_floor(c)
            b = Cv(16)
            b.r(2, 7, 12, 2, EMPTY); b.row(7, 2, 13, LINE)
            b.r(3, 9, 10, 2, INK); b.r(4, 11, 8, 1, INK); b.r(6, 12, 4, 1, PIT_I)
            b.r(4, 13, 8, 2, EMPTY); b.row(14, 4, 11, INK); b.col(3, 9, 10, LOG_E)
            if k == 'brazierLit':
                b.grid(4, 0, ['...p....', '..pp.p..', '..ppp...', '.ppopp..', '.poyopp.', 'ppoyyop.', 'poyYyop.'], {'p': PINK, 'o': PRIM_D, 'y': PRIM, 'Y': WHITE})
            else:
                b.r(4, 6, 8, 1, DRAW); b.pts([(5, 6), (8, 6), (10, 6)], PIT); b.pts([(6, 5), (9, 5)], DRAW)
            b.outline()
            c.row(15, 4, 12, TP['shadow'])
            c.paste(b, 0, 0)
            if k == 'brazierLit':
                c.pts([(2, 3), (13, 1)], PRIM_L)
        elif k == 'post':                                              # 물가 말뚝 (감을 고리)
            t_floor(c)
            b = Cv(16)
            b.r(5, 3, 6, 11, LOG); b.col(5, 5, 13, LOG_E); b.col(10, 5, 13, PIT_I); b.col(8, 6, 12, PIT_I)
            b.r(5, 2, 6, 3, LOG_E); b.row(1, 6, 9, LOG_E); b.r(7, 2, 2, 2, LOG); b.p(7, 2, CRATE)
            b.r(4, 8, 8, 2, BLADE); b.row(9, 4, 11, DRAW); b.p(4, 8, WHITE)
            b.r(11, 9, 3, 3, DRAW); b.p(12, 10, (0, 0, 0, 0)); b.p(12, 9, BLADE)
            b.outline()
            c.row(15, 5, 11, TP['shadow'])
            c.paste(b, 0, 0)
        if moss and k in MOSS_ON:
            dark, light = MOSS_ON[k]
            c.pts(dark, MAT_D); c.pts(light, MATGO)
        sheet.paste(c, i * 16, 0)
    return sheet


# =====================================================================
# 적 (오른쪽을 본다. 0·1 걷기 · 2 공격 준비 · 3 맞음)
# =====================================================================
def e_slime(c, f):
    sq = 1 if f in (1, 3) else -1 if f == 2 else 0     # 납작 / 길쭉
    top = 5 + sq
    rows = [(top, 5, 10), (top + 1, 4, 11)]
    for y in range(top + 2, top + 4):
        rows.append((y, 3 - (sq > 0), 12 + (sq > 0)))
    for y in range(top + 4, 14):
        rows.append((y, 2 - (sq > 0) + (sq < 0), 13 + (sq > 0) - (sq < 0)))
    rows.append((14, 3, 12))
    for y, a, b in rows:
        c.row(y, a, b, LOG)
    c.row(14, 3, 12, PIT_I); c.row(13, 2 + (sq < 0), 3 + (sq < 0), PIT_I); c.row(13, 10, 13 - (sq < 0), PIT_I)
    c.r(5, top + 2, 2, 1, LOG_E); c.r(4, top + 3, 1, 2, LOG_E); c.p(7, top + 1, LOG_E)
    c.p(5, top + 2, WHITE)
    ey = top + 4
    eye = WHITE if f == 3 else OUT
    c.r(8, ey, 1, 2, eye); c.r(11, ey, 1, 2, eye)
    if f == 2:
        c.r(9, ey + 3, 2, 2, PINK); c.pts([(7, ey - 1), (12, ey - 1)], OUT)
    else:
        c.row(ey + 3, 9, 10, PIT)
    c.pts([(5, 11), (12, 8)], PIT_I)


def e_bat(c, f):
    wing_up = f in (0, 2)
    # 날개
    if wing_up:
        c.grid(0, 2, ['.ww.........ww..', 'wwww.......wwww.', 'wWwww.....wwwWw.', 'w.wWww...wwWw.w.', '...wwww.wwww....', '....www.www.....'], {'w': INK, 'W': LOG_E})
    else:
        c.grid(0, 6, ['...wwww.wwww....', '..wwWww.wwWww...', '.wwWww...wwWww..', '.ww.w.....w.ww..', '.w...........w..'], {'w': INK, 'W': LOG_E})
    # 몸
    c.r(6, 5, 5, 6, PIT_I); c.row(11, 7, 9, PIT_I); c.row(4, 6, 6, PIT_I); c.row(4, 10, 10, PIT_I); c.row(3, 6, 6, PIT_I); c.row(3, 10, 10, PIT_I)
    c.row(9, 7, 9, INK); c.row(10, 7, 9, INK)
    eye = WHITE if f == 3 else PRIM if f == 2 else PINK
    c.p(8, 7, eye); c.p(10, 7, eye)
    c.p(8, 9, WHITE); c.p(10, 9, WHITE)                                # 송곳니
    if f == 2:
        c.row(8, 8, 10, PINK)


def e_spitter(c, f):
    up = 1 if f == 2 else 0
    dn = 1 if f in (1, 3) else 0
    # 대
    c.r(5, 9, 6, 6, PANEL); c.col(5, 9, 14, LINE); c.row(14, 5, 10, LINE); c.r(4, 13, 8, 2, PANEL); c.row(14, 4, 11, LINE)
    # 갓
    top = 2 - up + dn
    cap = ['....pppppp....', '..pppppppppp..', '.pppppppppppp.', 'pppppppppppppp', 'pppppppppppppp', 'pppppppppppppp', '.dddddddddddd.']
    c.grid(1, top, cap, {'p': PINK, 'd': LOSE})
    c.r(4, top + 1, 2, 2, WHITE); c.r(10, top + 2, 2, 2, WHITE); c.p(7, top + 4, WHITE); c.p(13, top + 4, WHITE); c.p(2, top + 4, WHITE)
    c.row(top + 7, 4, 11, EMPTY)                                       # 주름
    eye = WHITE if f == 3 else OUT
    c.p(8, 11, eye); c.p(10, 11, eye)
    if f == 3:
        c.p(8, 11, OUT); c.p(10, 11, OUT); c.pts([(7, 10), (11, 10)], OUT)
    if f == 2:
        c.r(9, 12, 2, 2, OUT); c.pts([(13, 11), (15, 13)], WIN); c.p(14, 12, MAT_L)
        c.pts([(6, 12), (11, 12)], PINK)
    else:
        c.row(13, 9, 10, PIT_I)


def e_goblin(c, f):
    b = 1 if f == 1 else 0
    lean = -1 if f == 3 else 0
    x = 3 + lean
    # 다리
    c.r(x + 1, 13, 2, 2, DRAW); c.r(x + 5, 13, 2, 2 - b, DRAW)
    # 몸 (큰 머리 한 덩어리)
    c.r(x, 4 + b, 9, 9 - b, DRAW); c.row(3 + b, x + 1, x + 7, DRAW)
    c.row(4 + b, x + 1, x + 6, WINTER); c.col(x, 5 + b, 8, WINTER); c.p(x + 1, 3 + b, WINTER)
    c.col(x + 8, 6 + b, 12, INK)
    # 뿔
    c.col(x + 2, 1 + b, 2 + b, PRIM); c.p(x + 2, 1 + b, PRIM_L)
    c.col(x + 6, 1 + b, 2 + b, PRIM); c.p(x + 6, 1 + b, PRIM_L)
    # 얼굴
    eye = WHITE if f == 3 else PINK if f == 2 else OUT
    c.r(x + 4, 6 + b, 1, 2, eye); c.r(x + 7, 6 + b, 1, 2, eye)
    c.pts([(x + 3, 5 + b), (x + 4, 5 + b), (x + 7, 5 + b), (x + 8, 5 + b)], OUT) if f == 2 else None
    c.row(9 + b, x + 3, x + 7, OUT); c.p(x + 4, 9 + b, WHITE); c.p(x + 7, 9 + b, WHITE)
    # 호피 허리옷
    c.r(x, 11, 9, 2, PRIM_D); c.pts([(x + 1, 11), (x + 4, 12), (x + 6, 11)], OUT)
    # 방망이
    if f == 2:
        c.r(12, 0, 3, 6, LOG); c.col(12, 0, 5, LOG_E); c.pts([(14, 1), (14, 4)], PIT); c.r(12, 6, 2, 3, PIT_I); c.r(11, 8, 2, 2, DRAW)
    else:
        c.r(12 + lean, 4 + b, 3, 6, LOG); c.col(12 + lean, 4 + b, 9 + b, LOG_E); c.pts([(14 + lean, 5 + b), (14 + lean, 8 + b)], PIT)
        c.r(12 + lean, 10 + b, 2, 2, PIT_I); c.r(11 + lean, 10 + b, 2, 2, DRAW)


def e_knight(c, f):
    b = 1 if f == 1 else 0
    lx = -1 if f == 3 else 0
    x = 6 + lx
    # 다리 · 신
    c.r(x + 1, 18, 4, 4 - 0, DRAW); c.r(x + 6, 18, 4, 4 - b, DRAW)
    c.r(x + 1, 21, 5, 2, PIT_I); c.r(x + 6, 21 - b, 5, 2, PIT_I)
    # 몸통 갑옷
    c.r(x, 10 + b, 11, 9 - b, WINTER); c.col(x, 10 + b, 18, WHITE); c.col(x + 10, 11 + b, 18, DRAW); c.row(18, x, x + 10, DRAW)
    c.row(13 + b, x + 1, x + 9, DRAW); c.row(16, x + 1, x + 9, DRAW)
    c.pts([(x + 3, 11 + b), (x + 7, 11 + b), (x + 3, 14 + b), (x + 7, 14 + b)], INK)
    c.r(x + 4, 17, 3, 2, PRIM_D)
    # 어깨
    c.r(x - 1, 9 + b, 4, 3, DRAW); c.row(9 + b, x - 1, x + 2, WINTER)
    c.r(x + 8, 9 + b, 4, 3, DRAW); c.row(9 + b, x + 8, x + 11, WINTER)
    # 투구
    c.r(x + 1, 2 + b, 9, 8, DRAW); c.row(1 + b, x + 2, x + 8, DRAW)
    c.row(2 + b, x + 2, x + 7, WINTER); c.col(x + 1, 3 + b, 6 + b, WINTER)
    c.r(x + 3, 5 + b, 7, 2, OUT)
    eye = WHITE if f == 3 else PINK if f == 2 else PRIM
    c.p(x + 5, 5 + b, eye); c.p(x + 8, 5 + b, eye)
    c.col(x + 6, 7 + b, 8 + b, INK); c.col(x + 8, 7 + b, 8 + b, INK)
    # 깃털 장식
    c.r(x + 3, -1 + b + 1, 4, 1, PINK); c.r(x + 1, 0 + b, 3, 1, PINK); c.p(x, 1 + b, PINK); c.p(x + 4, 1 + b, LOSE)
    # 방패 (뒤쪽 팔)
    c.r(x - 3, 11 + b, 4, 7, TEAM_A); c.col(x - 3, 11 + b, 16 + b, SKY_M); c.row(17 + b, x - 2, x, SKY_D); c.p(x - 1, 14 + b, PRIM)
    # 칼
    if f == 2:
        c.r(x + 11, 9, 2, 3, PIT_I); c.row(8, x + 10, x + 13, PRIM_D)
        c.r(x + 11, 0, 2, 8, BLADE); c.col(x + 11, 0, 7, WHITE); c.p(x + 14, 1, PINK); c.p(x + 15, 0, PINK); c.p(x + 15, 2, PINK)
    else:
        c.r(x + 11, 13 + b, 2, 3, PIT_I); c.col(x + 13, 12 + b, 16 + b, PRIM_D)
        c.r(x + 14, 13 + b, 4, 2, BLADE); c.row(13 + b, x + 14, x + 17, WHITE)


def e_golem(c, f):
    b = 1 if f == 1 else 0
    lx = -1 if f == 3 else 0
    x = lx
    up = f == 2
    # 다리
    c.r(x + 9, 25, 6, 6, INK); c.r(x + 18, 25, 6, 6 - b, INK)
    c.row(25, x + 9, x + 14, DRAW); c.row(30, x + 8, x + 15, PIT_I); c.row(30 - b, x + 17, x + 24, PIT_I)
    c.r(x + 8, 28, 8, 2, DRAW); c.r(x + 17, 28 - b, 8, 2, DRAW)
    # 몸통
    c.r(x + 7, 11 + b, 19, 15 - b, DRAW); c.r(x + 8, 10 + b, 17, 1, DRAW)
    c.row(11 + b, x + 8, x + 24, WINTER); c.col(x + 7, 12 + b, 20, WINTER); c.col(x + 8, 12 + b, 14 + b, WINTER)
    c.col(x + 25, 13 + b, 25, INK); c.row(25, x + 8, x + 25, INK); c.col(x + 24, 20, 24, INK)
    # 금 · 돌 이음새
    c.pts([(x + 10, 21), (x + 11, 22), (x + 12, 22), (x + 13, 23), (x + 21, 13 + b), (x + 22, 14 + b), (x + 22, 15 + b)], PIT_I)
    c.row(20, x + 9, x + 12, INK); c.row(20, x + 20, x + 23, INK)
    # 가슴의 문양 (구슬 조각 자리)
    core = WHITE if f == 3 else PINK if up else PRIM
    c.r(x + 14, 15 + b, 5, 5, OUT); c.r(x + 15, 16 + b, 3, 3, core); c.p(x + 15, 16 + b, WHITE if not f == 3 else PRIM_L)
    c.pts([(x + 16, 14 + b), (x + 16, 20 + b), (x + 13, 17 + b), (x + 19, 17 + b)], OUT)
    # 이끼
    c.pts([(x + 8, 11 + b), (x + 9, 11 + b), (x + 10, 11 + b), (x + 9, 12 + b), (x + 22, 11 + b), (x + 23, 11 + b), (x + 23, 12 + b)], WIN)
    c.pts([(x + 10, 12 + b), (x + 24, 12 + b)], MAT_D)
    # 머리
    hy = 2 + b
    c.r(x + 11, hy, 12, 9, WINTER); c.row(hy - 1, x + 12, x + 21, WINTER)
    c.row(hy - 1, x + 12, x + 21, WHITE); c.col(x + 11, hy, hy + 5, WHITE)
    c.col(x + 22, hy + 1, hy + 8, DRAW); c.row(hy + 8, x + 12, x + 22, DRAW)
    c.r(x + 13, hy + 2, 9, 3, OUT)
    eye = WHITE if f == 3 else PINK if up else PRIM
    c.r(x + 14, hy + 3, 2, 2, eye); c.r(x + 19, hy + 3, 2, 2, eye)
    c.row(hy + 6, x + 15, x + 20, OUT); c.pts([(x + 16, hy + 7), (x + 19, hy + 7)], OUT)
    c.pts([(x + 12, hy), (x + 13, hy + 1)], DRAW)
    # 팔
    def arm(ax, raised):
        if raised:
            c.r(ax, 4, 6, 9, DRAW); c.col(ax, 4, 12, WINTER); c.col(ax + 5, 5, 12, INK)
            c.r(ax - 1, 0, 8, 6, DRAW); c.row(0, ax, ax + 5, WINTER); c.col(ax - 1, 1, 4, WINTER); c.row(5, ax, ax + 6, INK); c.col(ax + 6, 1, 5, INK)
            c.pts([(ax + 1, 3), (ax + 3, 3), (ax + 5, 3)], PIT_I)
        else:
            c.r(ax, 11 + b, 6, 10, DRAW); c.col(ax, 11 + b, 20, WINTER); c.col(ax + 5, 12 + b, 20, INK); c.row(11 + b, ax, ax + 5, WINTER)
            c.r(ax - 1, 19 + b, 8, 6, DRAW); c.row(19 + b, ax, ax + 5, WINTER); c.col(ax - 1, 20 + b, 23 + b, WINTER)
            c.row(24 + b, ax, ax + 6, INK); c.col(ax + 6, 20 + b, 24 + b, INK)
            c.pts([(ax + 1, 22 + b), (ax + 3, 22 + b), (ax + 5, 22 + b)], PIT_I)
    arm(x + 2, up)
    arm(x + 25 - (1 if up else 0), up)


# ---- 2구역 "이끼 낀 회랑" ----
def e_sprout(c, f):
    up = 1 if f == 2 else 0
    sw = 1 if f == 1 else 0
    dn = 1 if f == 3 else 0
    # 흙 · 뿌리
    c.r(4, 13, 8, 2, INK); c.row(13, 5, 10, LOG); c.pts([(3, 14), (12, 14)], PIT_I)
    c.r(7, 11, 2, 2, MAT_D)
    # 잎
    c.grid(0, 8 + dn, ['.dd..........dd.', 'dGGd........dGGd', '.dGGd......dGGd.', '..ddd......ddd..'], {'d': MAT_D, 'G': WIN})
    # 봉오리 머리
    x, y = 3 + sw, 3 - up + dn
    c.grid(x, y, ['...gggg...', '.gggggggg.', 'gggggggggg', 'gggggggggg', 'gggggggggg', 'gggggggggg', '.gggggggg.', '..dddddd..'], {'g': WIN, 'd': MAT_D})
    c.r(x + 1, y + 1, 2, 1, MAT_L); c.p(x + 1, y + 2, MAT_L)
    c.pts([(x + 4, y - 1), (x + 5, y - 1), (x + 5, y - 2)], MAT_L)                      # 새순
    c.pts([(x - 1, y + 2), (x + 10, y + 2), (x + 2, y - 1), (x + 8, y - 1)], PANEL)     # 가시
    eye = WHITE if f == 3 else OUT
    c.r(x + 5, y + 2, 1, 2, eye); c.r(x + 8, y + 2, 1, 2, eye)
    if f == 2:
        c.r(x + 5, y + 4, 5, 3, OUT); c.r(x + 6, y + 5, 3, 2, PINK); c.pts([(x + 6, y + 4), (x + 8, y + 4)], PANEL)
        c.pts([(x + 4, y + 1), (x + 9, y + 1)], OUT)
    else:
        c.row(y + 5, x + 6, x + 8, OUT)


def e_moth(c, f):
    up = f in (0, 2)
    wide = f == 2
    if up:
        c.grid(0, 1, ['.ll.........ll..', 'lLLl.......lLLl.', 'lLpLl.....lLpLl.', 'lLLLLl...lLLLLl.', '.lLLLl...lLLLl..', '..llll...llll...', '..lLLl...lLLl...', '...ll.....ll....'],
               {'l': MAT_D, 'L': MAT_L, 'p': PINK})
    else:
        c.grid(0, 5, ['..llll...llll...', '.lLLLl...lLLLl..', 'lLLpLl...lLpLLl.', 'lLLLl.....lLLLl.', '.lLl.......lLl..', '..l.........l...'], {'l': MAT_D, 'L': MAT_L, 'p': PINK})
    # 몸
    c.r(6, 5, 4, 3, LINE); c.r(6, 8, 4, 4, INK); c.row(12, 7, 8, INK); c.row(9, 6, 9, LOG_E); c.row(11, 6, 9, LOG_E)
    c.pts([(6, 3), (5, 2), (9, 3), (10, 2)], PIT_I)                                    # 더듬이
    eye = WHITE if f == 3 else OUT
    c.p(7, 6, eye); c.p(9, 6, eye)
    if f == 3:
        c.pts([(6, 6), (8, 6)], OUT)
    if wide:
        c.pts([(2, 11), (4, 13), (1, 14), (12, 12), (14, 10), (13, 14), (7, 14)], PINK)   # 독 가루


def e_lizard(c, f):
    b = 1 if f == 1 else 0
    dash = f == 2
    lx = -1 if f == 3 else 0
    y = 8 + (1 if dash else 0)
    # 꼬리
    if dash:
        c.pts([(1, y - 3), (1, y - 2), (2, y - 1), (2, y), (3, y), (3, y + 1)], WIN); c.p(1, y - 4, MAT_D)
    else:
        c.pts([(0, y + 3 - b), (1, y + 3 - b), (2, y + 2), (2, y + 3), (3, y + 2)], WIN)
    # 다리
    c.r(4 + lx - b, 13, 2, 2, MAT_D); c.r(10 + lx + b, 13, 2, 2, MAT_D)
    # 몸 · 머리
    c.r(3 + lx, y + 1, 10, 4, WIN); c.row(y, 4 + lx, 11 + lx, WIN)
    c.r(10 + lx, y - 2, 5, 5, WIN); c.r(14 + lx, y, 2, 3, WIN)
    c.row(y + 4, 4 + lx, 12 + lx, PANEL_S)
    if not dash:
        c.row(y + 2, 13 + lx, 15 + lx, PANEL_S)
    # 등의 이끼
    c.row(y, 4 + lx, 9 + lx, MAT_D); c.pts([(5 + lx, y - 1), (7 + lx, y - 1), (8 + lx, y - 1), (10 + lx, y - 2), (11 + lx, y - 3)], MAT_D)
    c.pts([(5 + lx, y), (8 + lx, y)], MATGO)
    eye = WHITE if f == 3 else PINK if dash else PRIM
    c.r(12 + lx, y - 1, 2, 2, OUT); c.p(13 + lx, y - 1, eye)
    if dash:
        c.r(13, y + 1, 3, 2, OUT); c.r(14, y + 1, 2, 1, PINK); c.p(15, y + 2, PANEL)
    else:
        c.p(15 + lx, y, MAT_D)


def e_toad(c, f):
    cr = 2 if f == 2 else 1 if f == 1 else 0
    y = 3 + cr
    # 뒷다리 · 배
    c.r(1, 11, 3, 3, MAT_D); c.r(12, 11, 3, 3, MAT_D)
    c.r(3, 10, 10, 4, MATGO); c.r(5, 12, 6, 2, LINE)
    # 바위 등
    c.grid(2, y, ['...hhhhhh...', '.hhggggggg..', 'hhgggggggggd', 'hggggggggggd', 'hggggggggggd', 'gggggggggddd', '.ggggggdddd.'], {'h': WINTER, 'g': DRAW, 'd': INK})
    c.pts([(6, y + 1), (6, y + 2), (7, y + 3), (10, y + 2), (4, y + 4)], INK)
    c.pts([(4, y + 1), (5, y), (11, y + 3)], MAT_D); c.p(4, y + 2, MATGO)
    # 얼굴 (오른쪽 앞)
    fy = max(y + 6, 10)
    c.r(4, fy, 10, 3, MATGO)
    if f == 2:
        c.r(6, fy + 1, 7, 2, OUT)
    else:
        c.row(fy + 2, 5, 13, OUT)
    eye = WHITE if f == 3 else PRIM
    c.r(6, fy - 1, 2, 2, eye); c.r(11, fy - 1, 2, 2, eye); c.p(7, fy, OUT); c.p(12, fy, OUT)
    if f == 3:
        c.p(7, fy, WHITE); c.p(12, fy, WHITE)
    c.r(3, 13, 3, 2, MAT_D); c.r(10, 13, 3, 2, MAT_D)


def e_treant(c, f):
    b = 1 if f == 1 else 0
    lx = -1 if f == 3 else 0
    x = 7 + lx
    up = f == 2
    # 뿌리 발
    c.r(x - 1, 20, 5, 3, INK); c.r(x + 6, 20, 5, 3, INK); c.pts([(x - 2, 22), (x + 11, 22), (x + 4, 21), (x + 5, 21)], INK)
    c.row(22, x - 1, x + 3, PIT_I); c.row(22, x + 6, x + 10, PIT_I)
    # 줄기
    c.r(x, 8 + b, 10, 13 - b, LOG); c.col(x, 9 + b, 20, LOG_E); c.col(x + 9, 9 + b, 20, PIT_I); c.col(x + 8, 14, 20, PIT_I)
    c.pts([(x + 2, 17), (x + 2, 18), (x + 3, 19), (x + 6, 18), (x + 6, 19)], PIT_I)
    # 얼굴 (옹이 구멍)
    eye = WHITE if f == 3 else PINK if up else PRIM
    c.r(x + 3, 11 + b, 3, 3, OUT); c.r(x + 7, 11 + b, 3, 3, OUT)
    c.r(x + 4, 12 + b, 2, 1, eye); c.r(x + 8, 12 + b, 2, 1, eye)
    c.r(x + 5, 15 + b, 4, 2 + (1 if up else 0), OUT)
    # 이끼 머리
    c.ell(x + 4.5, 4.5 + b, 8.4, 4.6, WIN)
    c.row(8 + b, x - 2, x + 11, MAT_D); c.pts([(x - 1, 9 + b), (x + 3, 9 + b), (x + 7, 9 + b), (x + 10, 9 + b), (x + 10, 10 + b)], MAT_D)
    c.pts([(x, 2 + b), (x + 1, 1 + b), (x + 2, 1 + b), (x + 6, 2 + b), (x + 7, 1 + b), (x - 2, 5 + b), (x + 3, 4 + b), (x + 4, 4 + b)], MAT_L)
    c.pts([(x + 9, 5 + b), (x + 10, 6 + b), (x + 1, 6 + b), (x + 5, 6 + b)], MAT_D)
    c.pts([(x + 8, 3 + b)], PINK)                                                         # 작은 꽃
    # 뿌리 팔
    for ax, sgn in ((x - 4, -1), (x + 11, 1)):
        if up:
            c.r(ax, 6, 3, 8, INK)
            c.col(ax if sgn < 0 else ax + 2, 6, 13, LOG_E if sgn < 0 else PIT_I)
            c.pts([(ax + 1 + sgn, 5), (ax + 1 + sgn, 4), (ax + 1, 5), (ax + 1 + 2 * sgn, 3), (ax + 1 - sgn, 4)], INK)
        else:
            c.r(ax, 11 + b, 3, 8, INK)
            c.col(ax if sgn < 0 else ax + 2, 11 + b, 18, LOG_E if sgn < 0 else PIT_I)
            c.pts([(ax + 1 + sgn, 19 + b), (ax + 1 + sgn, 20 + b), (ax + 1, 19 + b), (ax + 1 - sgn, 19 + b)], INK)
            c.p(ax + 1, 11 + b, MAT_D)


def e_imugi(c, f):
    b = 1 if f == 1 else 0
    lx = -1 if f == 3 else 0
    op = f == 2
    hy = b - (1 if op else 0)
    # 꼬리 끝
    c.pts([(3, 11 + b), (3, 12 + b), (2, 13 + b), (3, 13 + b), (2, 14 + b), (3, 14 + b), (4, 14 + b)], WIN)
    c.r(2, 15 + b, 4, 5, WIN); c.col(2, 15 + b, 19, MAT_L)
    # 뒤 똬리
    c.ell(15.5, 19 + b, 12.5, 5, MAT_D)
    c.pts([(7, 17 + b), (11, 16 + b), (15, 16 + b), (20, 16 + b), (24, 17 + b)], WIN)
    # 목
    nx = 18 + lx
    c.r(nx, 8 + hy, 8, 13 - hy, WIN); c.col(nx, 9 + hy, 19, MAT_D); c.r(nx + 5, 11 + hy, 3, 9 - hy, AUTUMN)
    for yy in range(12 + hy, 20, 2):
        c.row(yy, nx + 5, nx + 7, MAT_L)
    c.pts([(nx + 2, 12 + hy), (nx + 3, 15), (nx + 2, 18)], MAT_D)
    # 앞 똬리
    c.ell(15.5, 24.5, 14.2, 5.6, WIN)
    for y in range(27, 31):
        for x in range(1, 31):
            if ((x - 15.5) / 14.2) ** 2 + ((y - 24.5) / 5.6) ** 2 <= 1.0:
                c.p(x, y, AUTUMN if (x + 1) % 4 else MAT_L)
    c.row(26, 3, 28, MAT_D)
    c.pts([(6, 20), (7, 20), (8, 19), (9, 19), (10, 19), (11, 19)], MAT_L); c.pts([(3, 22), (4, 21)], MAT_L)
    for x, y in ((6, 23), (10, 22), (14, 23), (18, 22), (22, 23), (26, 23), (8, 25), (12, 24), (16, 25), (20, 24), (24, 25)):   # 이끼 비늘
        c.p(x, y, MAT_D); c.p(x + 1, y, MAT_D); c.p(x, y - 1, MATGO)
    # 머리
    h0 = 15 + lx
    c.ell(h0 + 7, 7 + hy, 7.4, 4.8, WIN)
    c.r(h0 + 9, 5 + hy, 7, 5, WIN); c.r(h0 + 15, 6 + hy, 1, 3, WIN)
    c.row(3 + hy, h0 + 4, h0 + 9, MAT_L); c.pts([(h0 + 2, 5 + hy), (h0 + 3, 4 + hy)], MAT_L)
    c.pts([(h0 + 3, 2 + hy), (h0 + 4, 1 + hy), (h0 + 7, 1 + hy), (h0 + 8, 2 + hy)], PANEL_S)           # 돋기 시작한 뿔
    c.pts([(h0 + 1, 7 + hy), (h0 + 2, 8 + hy), (h0 + 4, 9 + hy), (h0 + 5, 6 + hy), (h0 + 3, 6 + hy)], MAT_D)
    c.pts([(h0 + 2, 7 + hy), (h0 + 4, 5 + hy)], MATGO)
    eye = WHITE if f == 3 else PINK if op else PRIM
    c.r(h0 + 8, 4 + hy, 4, 4, OUT); c.r(h0 + 9, 5 + hy, 3, 2, eye); c.p(h0 + 11, 5 + hy, WHITE if f == 3 else OUT); c.p(h0 + 9, 5 + hy, WHITE)
    c.p(h0 + 15, 6 + hy, MAT_D)
    if op:
        c.r(h0 + 8, 10 + hy, 8, 1, OUT); c.r(h0 + 9, 11 + hy, 7, 2, PINK); c.r(h0 + 8, 13 + hy, 7, 2, WIN); c.row(14 + hy, h0 + 8, h0 + 13, MAT_D)
        c.pts([(h0 + 10, 10 + hy), (h0 + 14, 10 + hy), (h0 + 13, 12 + hy)], WHITE); c.pts([(h0 + 11, 12 + hy), (h0 + 12, 12 + hy)], LOSE)
    else:
        c.row(10 + hy, h0 + 6, h0 + 14, AUTUMN)
        c.row(9 + hy, h0 + 9, h0 + 15, OUT); c.p(h0 + 8, 8 + hy, OUT); c.p(h0 + 12, 10 + hy, WHITE)


ENEMIES = {'slime': (16, e_slime), 'bat': (16, e_bat), 'spitter': (16, e_spitter), 'goblin': (16, e_goblin), 'knight': (24, e_knight), 'golem': (32, e_golem),
           'sprout': (16, e_sprout), 'moth': (16, e_moth), 'lizard': (16, e_lizard), 'toad': (16, e_toad), 'treant': (24, e_treant), 'imugi': (32, e_imugi)}


def draw_enemy(eid):
    size, fn = ENEMIES[eid]
    sheet = Cv(size * 4, size)
    for f in range(4):
        c = Cv(size)
        fn(c, f)
        c.outline()
        sheet.paste(c, f * size, 0)
    return sheet


# =====================================================================
# 구슬 아이콘 16×16
# =====================================================================
ORB_ROWS = [(1, 5, 10), (2, 3, 12), (3, 2, 13), (4, 2, 13)] + [(y, 1, 14) for y in range(5, 11)] + [(11, 2, 13), (12, 2, 13), (13, 3, 12), (14, 5, 10)]

FACE_RAT = ['.##....##.', '####..####', '####..####', '.########.', '.#o####o#.', '.########.', '..##rr##..', '...####...']
FACE_OX = ['y........y', 'yy......yy', '.########.', '.########.', '.#o####o#.', '.########.', '..rorror..', '..rrrrrr..']
FACE_DRAGON = ['.y.y..y.y.', '..yy..yy..', '.########.', '.#o####o#.', '.########.', '##.####.##', '..#o##o#..', '...####...']
FACE_SNAKE = ['...####...', '..#o##o#..', '..######..', '...###r...', '.....##r..', '.##...##..', '.###..##..', '..#####...']
FACE_RABBIT = ['.##....##.', '.#r....r#.', '.#r....r#.', '.##....##.', '.########.', '.#o####o#.', '.###rr###.', '..######..']
FACE_MONKEY = ['..######..', '.########.', '##.s##s.##', '##soSSos##', '.#ssssss#.', '.#sooooS#.', '..#ssss#..', '...####...']
FACE_TURTLE = ['....##....', '...#oo#...', '.#.####.#.', '.##y##y##.', '..#y##y#..', '.##y##y##.', '.#.####.#.', '....##....']
FACE_ROOSTER = ['...r.r.r..', '...rrrrr..', '..######..', '.########.', '.#o####o#.', '.###yy###.', '..#ryyr#..', '...#rr#...']
FACE_SHEEP = ['..##.##.#.', '.########.', '##########', '##ssssss##', '.#sossos#.', '.#ssssss#.', '..#srrs#..', '...####...']
FACE_DOG = ['..######..', 'ss######ss', 'ss#o##o#ss', 'ss######ss', '.s##oo##s.', '..######..', '...#rr#...', '....rr....']
FACE_TIGER = ['.##....##.', '####oo####', '.###oo###.', '.o######o.', '.#o####o#.', '.o######o.', '..##rr##..', '...####...']
FACE_PHOENIX = ['....yy....', '#...yy...#', '##.####.##', '###o##o###', '####yy####', '.########.', '..######..', '.y.#yy#.y.']
FACE_HORSE = ['..#....#..', '..##mm##..', '..#mmmm#..', '..#o##o#..', '..######..', '...####...', '...####...', '...#rr#...']
FACE_PIG = ['.##....##.', '.###..###.', '.########.', '.#o####o#.', '.########.', '.##rrrr##.', '.##orro##.', '..######..']

# id: (바탕, 그늘, 얼굴 색, 눈·무늬 색, {추가 색}, 전설인지)
ORBS = {
    'rat': (WINTER, DRAW, PIT_I, WHITE, {'r': PINK}, FACE_RAT, False),
    'ox': (LINE, INK, LOG, OUT, {'r': SUMMER, 'y': PIT}, FACE_OX, False),
    'dragon': (PINK, LOSE, WIN, OUT, {'y': PRIM}, FACE_DRAGON, False),
    'snake': (WIN, MAT_D, PANEL, OUT, {'r': PINK}, FACE_SNAKE, False),
    'rabbit': (SKY_M, TEAM_A, WHITE, OUT, {'r': PINK}, FACE_RABBIT, False),
    'monkey': (TRACK_O, TRACK_D, PIT_I, OUT, {'s': SKIN, 'S': SKIN}, FACE_MONKEY, False),
    'turtle': (SKY_T, SKY_D, MAT_D, OUT, {'y': PRIM_L}, FACE_TURTLE, True),
    'rooster': (PANEL_S, PRIM_D, WHITE, OUT, {'r': PINK, 'y': PRIM_D}, FACE_ROOSTER, False),
    'sheep': (SUMMER, LOSE, WHITE, OUT, {'s': PIT_I, 'r': PINK}, FACE_SHEEP, False),
    'dog': (STUN, TEAM_A, PANEL, OUT, {'s': LOG, 'r': PINK}, FACE_DOG, False),
    'tiger': (PRIM_D, TRACK_D, PRIM_L, OUT, {'r': PINK}, FACE_TIGER, False),
    'phoenix': (PINK, LOSE, PRIM, OUT, {'y': PANEL}, FACE_PHOENIX, True),
    'horse': (PRIM, PRIM_D, LOG, OUT, {'r': SUMMER, 'm': PIT}, FACE_HORSE, False),
    'pig': (AUTUMN, MAT_D, SUMMER, OUT, {'r': PINK}, FACE_PIG, False),
    'whiteTiger': (BLADE, DRAW, WHITE, PIT, {'r': SKY_T}, FACE_TIGER, True),
    'blueDragon': (SKY_D, PIT, SKY_M, OUT, {'y': PRIM}, FACE_DRAGON, True),
}


def draw_orb(oid):
    base, dark, face, eye, extra, rows, legend = ORBS[oid]
    c = Cv(16)
    for y, a, b in ORB_ROWS:
        c.row(y, a, b, base)
    # 아래·오른쪽 그늘
    for y, a, b in ORB_ROWS[-4:]:
        c.row(y, a, b, dark)
    c.col(14, 7, 10, dark); c.col(13, 9, 12, dark)
    c.row(11, 2, 5, base); c.row(12, 2, 3, base)
    # 테두리
    ring = Cv(16)
    for y, a, b in ORB_ROWS:
        ring.row(y, a, b, base)
    m = ring.mask()
    for (x, y) in m:
        if not {(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)} <= m:
            c.p(x, y, OUT)
    if legend:      # 전설: 금테
        inner = {(x, y) for (x, y) in m if {(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)} <= m}
        for (x, y) in inner:
            if not {(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)} <= inner:
                c.p(x, y, PRIM)
    pal = {'#': face, 'o': eye}
    pal.update(extra)
    c.grid(3, 4, rows, pal)
    c.p(3, 3, WHITE); c.p(4, 2, WHITE) if not legend else c.p(4, 3, WHITE)
    return c


# =====================================================================
# 로비 카드 640×400 (160×100 도트 그림을 4배)
# =====================================================================
def draw_card(chars, enemies, orbs):
    try:
        sky = Image.open(ROOT / 'shared/images/card-finger.png').convert('RGBA').getpixel((4, 4))
    except Exception:
        sky = SKY_M
    c = Cv(160, 100, sky)
    # 구름
    for cx, cy in ((14, 14), (120, 30), (58, 8)):
        c.r(cx, cy, 22, 4, WHITE); c.r(cx + 4, cy - 3, 9, 3, WHITE); c.r(cx + 11, cy - 2, 7, 2, WHITE); c.row(cy + 4, cx + 3, cx + 18, WHITE)
    # 탑 (가운데 오른쪽)
    tw = Cv(160, 100)
    tiers = [(74, 62, 52, 26), (79, 38, 42, 20), (84, 16, 32, 18)]      # x, y, w, h
    for i, (x, y, w, h) in enumerate(tiers):
        tw.r(x, y, w, h, EMPTY)
        tw.col(x, y, y + h - 1, LINE); tw.col(x + 1, y, y + h - 1, LINE)
        tw.r(x + w - 4, y, 4, h, INK)
        for yy in range(y + 5, y + h, 6):
            tw.row(yy, x + 2, x + w - 5, INK)
        for n, yy in enumerate(range(y, y + h, 6)):
            for xx in range(x + 6 + (n % 2) * 5, x + w - 5, 10):
                tw.col(xx, yy, min(yy + 4, y + h - 1), INK)
        # 처마 (기와)
        ex, ew = x - 5, w + 10
        tw.r(ex, y - 4, ew, 4, PIT_I); tw.row(y - 4, ex, ex + ew - 1, LOSE); tw.row(y - 5, ex + 2, ex + ew - 3, PINK)
        tw.r(ex - 2, y - 6, 3, 3, PINK); tw.r(ex + ew - 1, y - 6, 3, 3, PINK)
        for xx in range(ex + 2, ex + ew - 1, 4):
            tw.col(xx, y - 3, y - 1, PIT)
        # 창
        for wx in ([x + w // 2 - 2] if i == 2 else [x + w // 4 - 2, x + 3 * w // 4 - 3]):
            if i == 0:
                continue
            tw.r(wx, y + 6, 5, 7, OUT); tw.r(wx + 1, y + 7, 3, 5, PRIM); tw.row(y + 7, wx + 1, wx + 3, PRIM_L); tw.col(wx + 2, y + 7, y + 11, PRIM_D)
    # 지붕 꼭대기
    for n in range(7):
        tw.row(10 - n, 86 + n * 2, 113 - n * 2, PINK if n else LOSE)
    tw.row(10, 82, 117, PIT_I); tw.row(9, 84, 115, LOSE)
    # 문 · 계단
    tw.r(93, 70, 14, 18, OUT); tw.r(95, 72, 10, 16, PIT); tw.row(70, 95, 104, OUT); tw.r(96, 71, 8, 1, PIT)
    tw.pts([(93, 70), (94, 70), (105, 70), (106, 70)], EMPTY)
    tw.r(97, 76, 6, 12, PIT_I); tw.r(98, 80, 4, 8, PRIM_D); tw.r(99, 83, 2, 5, PRIM_L)
    tw.r(90, 86, 20, 2, LINE); tw.r(88, 88, 24, 2, PANEL)
    tw.r(82, 64, 6, 8, OUT); tw.r(83, 65, 4, 6, PRIM); tw.r(112, 64, 6, 8, OUT); tw.r(113, 65, 4, 6, PRIM)
    tw.outline()
    # 섬 (돌바닥)
    isl = Cv(160, 100)
    isl.r(6, 70, 148, 22, WINTER)
    for yy in range(70, 90, 6):
        isl.row(yy + 5, 6, 153, DRAW)
        for xx in range(10 + ((yy // 6) % 2) * 6, 152, 12):
            isl.col(xx, yy, yy + 4, DRAW)
        isl.row(yy, 6, 153, WHITE) if yy > 70 else None
    isl.r(6, 89, 148, 6, INK); isl.row(89, 6, 153, OUT); isl.row(92, 6, 153, PIT_I)
    for xx in range(12, 152, 9):
        isl.col(xx, 90, 91, PIT_I); isl.col(xx + 4, 93, 94, PIT_I)
    for cx_, cy_ in ((6, 70), (153, 70)):
        pass
    isl.pts([(6, 70), (7, 70), (6, 71), (153, 70), (152, 70), (153, 71), (6, 94), (153, 94), (7, 94), (152, 94), (6, 93), (153, 93)], (0, 0, 0, 0))
    isl.outline()
    c.paste(isl, 0, 0)
    c.paste(tw, 0, 0)
    # 꼭대기의 소원 구슬
    for rr, col_ in ((9, PANEL_S), (6, PRIM_L)):
        for y in range(-rr, rr + 1):
            for x in range(-rr, rr + 1):
                if x * x + y * y <= rr * rr and (x + y) % 2 == 0:
                    c.p(99 + x, 0 + y + 2, col_)
    orb = Cv(8)
    orb.grid(0, 0, ['.yyyy.', 'yWyyyy', 'yyyyyd', 'yyyydd', 'yyyydd', '.dddd.'], {'y': PRIM, 'W': WHITE, 'd': PRIM_D})
    orb.outline()
    c.paste(orb, 96, -1)
    for sx, sy in ((84, 5), (116, 3), (124, 14), (74, 20)):
        c.pts([(sx, sy - 1), (sx, sy + 1), (sx - 1, sy), (sx + 1, sy), (sx, sy)], WHITE)
    # 대원
    def hero(names, d, col, x, y):
        for n in names:
            fr = Cv(F)
            fr.im = chars[n].im.crop((col * F, d * F, col * F + F, d * F + F)); fr.px = fr.im.load()
            c.paste(fr, x, y)
    c.r(40, 86, 14, 2, DRAW); c.r(15, 88, 14, 2, DRAW)
    hero(['body_m', 'face_3', 'outfit_0', 'hair_m0'], 2, 6, 30, 56)
    hero(['body_f', 'face_2', 'outfit_1', 'hair_f1'], 0, 0, 6, 58)
    # 칼 자국 (초승달)
    for (x, y) in ((58, 62), (60, 63), (62, 65), (63, 67), (64, 70), (64, 73), (63, 76), (62, 78), (60, 80), (58, 81)):
        c.r(x - 1, y - 1, 4, 4, OUT)
    for (x, y) in ((58, 62), (60, 63), (62, 65), (63, 67), (64, 70), (64, 73), (63, 76), (62, 78), (60, 80), (58, 81)):
        c.r(x, y, 2, 2, WHITE)
    for (x, y) in ((62, 66), (63, 69), (64, 72), (63, 77)):
        c.p(x, y, PRIM_L)
    # 적
    def foe(eid, f, x, y, flip=True):
        s = ENEMIES[eid][0]
        fr = Cv(s)
        fr.im = enemies[eid].im.crop((f * s, 0, f * s + s, s)); fr.px = fr.im.load()
        c.paste(fr, x, y, flip)
    c.r(70, 86, 12, 2, DRAW); c.r(126, 88, 24, 2, DRAW)
    foe('slime', 3, 68, 72)
    foe('bat', 0, 60, 34)
    foe('goblin', 0, 112, 74)
    foe('golem', 2, 122, 58)
    foe('bat', 1, 134, 40)
    CARD.parent.mkdir(parents=True, exist_ok=True)
    c.im.resize((640, 400), Image.NEAREST).convert('RGB').save(CARD)
    return c


# =====================================================================
def main():
    files = []

    def save(cv, rel):
        path = ART / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        cv.im.save(path)
        files.append(rel)

    chars = draw_chars()
    order = ['body_m', 'body_f'] + [f'face_{i}' for i in range(4)] + [f'outfit_{i}' for i in range(4)] + [f'hair_m{i}' for i in range(4)] + [f'hair_f{i}' for i in range(4)]
    for n in order:
        save(chars[n], f'char/{n}.png')
    tiles = draw_tiles('stone')
    save(tiles, 'tiles.png')
    tiles_moss = draw_tiles('moss')
    save(tiles_moss, 'tiles-moss.png')
    enemies = {e: draw_enemy(e) for e in ENEMIES}
    for e in ENEMIES:
        save(enemies[e], f'enemy/{e}.png')
    orbs = {o: draw_orb(o) for o in ORBS}
    for o in ORBS:
        save(orbs[o], f'orb/{o}.png')
    card = draw_card(chars, enemies, orbs)
    manifest = {
        '_note': 'public/art/ 에 넣은 그림 파일 목록 (여기 적힌 것만 불러온다). games/tower/art/draw.py 가 다시 쓴다. ASSETS.md 참고',
        'files': files,
    }
    (ART / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(files)} files + manifest.json + {CARD.name}')

    if len(sys.argv) > 1:      # 확인용 확대 그림
        out = Path(sys.argv[1])
        out.mkdir(parents=True, exist_ok=True)
        bg = hx('#7fb8e8')
        looks = [('m', 0, 0, 0), ('m', 1, 1, 2), ('m', 2, 3, 3), ('m', 3, 2, 0), ('f', 0, 2, 1), ('f', 1, 1, 1), ('f', 2, 0, 3), ('f', 3, 3, 2)]
        sh = Cv(256, 128 * len(looks), bg)
        for i, (sex, hair, face, outfit) in enumerate(looks):
            for n in (f'body_{sex}', f'face_{face}', f'outfit_{outfit}', f'hair_{sex}{hair}'):
                sh.paste(chars[n], 0, i * 128)
        for i in range(0, len(looks), 2):
            sh.im.crop((0, i * 128, 256, i * 128 + 256)).resize((1024, 1024), Image.NEAREST).save(out / f'contact-chars-{i // 2}.png')
        lay = ['TTTTTTTTTTTTTT', 'FFFFDFFFFFFFFF', '.,.p....wwv.qQ', '.c.C.o.O.ws.hH', '..r.g.S.f.d.P.', 'TTTTTLTTTTTTTT']
        key = {'T': 'wallTop', 'F': 'wallFace', '.': 'floor', ',': 'floor2', 'p': 'pillar', 'w': 'water', 'v': 'vine', 's': 'switch', 'c': 'chest', 'C': 'chestOpen',
               'o': 'pedestal', 'O': 'pedestalEmpty', 'r': 'rock', 'g': 'gate', 'S': 'shop', 'f': 'fountain', 'd': 'fountainDry', 'D': 'doorOpen', 'L': 'doorLocked',
               'q': 'plate', 'Q': 'plateOn', 'h': 'brazier', 'H': 'brazierLit', 'P': 'post'}
        for name, sheet in (('stone', tiles), ('moss', tiles_moss)):
            sheet.im.resize((sheet.w * 3, 48), Image.NEAREST).save(out / f'contact-tiles-{name}.png')
            room = Cv(16 * 14, 16 * 6)
            ti = lambda k: sheet.im.crop((TILE_ORDER.index(k) * 16, 0, TILE_ORDER.index(k) * 16 + 16, 16))
            for y, line in enumerate(lay):
                for x, ch in enumerate(line):
                    room.im.paste(ti(key[ch]), (x * 16, y * 16))
            room.im.paste(ti('stairs'), (11 * 16, 4 * 16)); room.im.paste(ti('rubble'), (0, 4 * 16)); room.im.paste(ti('switchOn'), (11 * 16, 3 * 16))
            room.im.resize((room.w * 5, room.h * 5), Image.NEAREST).save(out / f'contact-room-{name}.png')
        en = Cv(128 * 2 + 8, 16 * 4 + 24 + 32, bg)
        ys = [0, 0]
        for n, e in enumerate(ENEMIES):
            k = n // 6
            en.paste(enemies[e], k * 136, ys[k])
            ys[k] += ENEMIES[e][0]
        en.im.resize((en.w * 5, en.h * 5), Image.NEAREST).save(out / 'contact-enemies.png')
        ob = Cv(16 * 8 + 9, 16 * 2 + 3, hx('#fff8e8'))
        for i, o in enumerate(ORBS):
            ob.paste(orbs[o], 1 + (i % 8) * 17, 1 + (i // 8) * 17)
        ob.im.resize((ob.w * 8, ob.h * 8), Image.NEAREST).save(out / 'contact-orbs.png')


if __name__ == '__main__':
    main()
