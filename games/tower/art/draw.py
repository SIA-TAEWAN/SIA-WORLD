"""
시아의탑 6~10구역 도트 그림 (Fable 5.2 손그림, 2026-11-25): 타일 시트 5장(tiles-thunder/galaxy/flower/storm/wish.png) · 적 34종 · 투사체 6종(proj/) · 엔딩 그림.
SpriteCook 크레딧이 생기면 다시 그린다 (art/spritecook/REDRAW-QUEUE.md 7번).

  python games/tower/art/draw.py            # 위 그림들과 manifest.json 을 다시 만든다
  python games/tower/art/draw.py <폴더>      # 확인용 확대 그림(contact-*.png)도 그 폴더에 만든다

1~5구역(캐릭터 레이어 · 타일 5장 · 적 32종 · 구슬 아이콘)과 로비 카드는 SpriteCook 그림으로 바뀌었다 — art/build.py 가 만들고, 이 파일은 그 파일들을 쓰지 않는다
(그리는 코드는 남아 있다: build.py 가 몇몇 타일 칸을 여기서 빌리고, 엔딩 그림과 확인용 그림이 예전 캐릭터 · 타일을 쓴다).
규격은 games/tower/ASSETS.md, 칸 순서·자세는 src/art/sheets.ts 와 같다. 무작위가 없어 몇 번을 돌려도 같은 파일이 나온다.
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
SKY_B = hx('#ffe9b8')      # --sky-bottom
BJ = hx('#7fb8e8')         # --table-blackjack
SPRING = hx('#9cc7f2')     # --roulette-spring
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
              'plate', 'plateOn', 'brazier', 'brazierLit', 'post',
              'coldWater', 'ice', 'bell', 'bellOn', 'gong', 'gongOn', 'boulder', 'pit',
              'rod', 'rodOn', 'puff', 'bars', 'mirrorA', 'mirrorB', 'fog', 'wish']

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
    if TP.get('deco'):
        TP['deco'](c, cracked)
    elif TP['moss']:
        c.pts([(10, 7), (3, 15)], MATGO)                               # 이음새에 낀 이끼
        if cracked:                                                    # 이끼 덩어리
            c.r(2, 2, 4, 3, MATGO); c.pts([(1, 3), (6, 3), (3, 1), (4, 5)], MATGO); c.pts([(3, 3), (4, 2)], MAT_L); c.pts([(2, 4), (5, 4)], MAT_D)
            c.r(11, 11, 3, 2, MATGO); c.pts([(10, 12), (12, 13)], MATGO); c.p(12, 11, MAT_L); c.p(11, 12, MAT_D)
            c.pts([(8, 10), (7, 11), (7, 12)], MAT_D)
    elif cracked:
        c.pts([(4, 2), (5, 3), (5, 4), (6, 5), (7, 5), (11, 10), (10, 11), (10, 12), (9, 13)], DRAW)
        c.pts([(13, 3), (2, 12)], BLADE)


def t_water(c):
    if TP.get('water'):
        return TP['water'](c)
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


# ---- 3구역 "서리 누각" (tiles-frost.png) ----
def frost_deco(c, cracked):
    c.p(13, 4, WHITE)
    if cracked:                                                        # 쌓인 눈
        c.r(2, 2, 5, 3, WHITE); c.pts([(1, 3), (7, 3), (3, 1), (4, 1), (4, 5), (5, 5)], WHITE); c.pts([(2, 4), (3, 4), (6, 4)], SKY_M)
        c.r(10, 11, 4, 2, WHITE); c.pts([(11, 10), (12, 13)], WHITE); c.pts([(10, 12), (13, 12)], SKY_M)


def frost_wall_top(c):
    c.r(0, 0, 16, 16, BJ)
    c.row(7, 0, 15, TEAM_A); c.row(15, 0, 15, TEAM_A)
    c.col(5, 0, 6, TEAM_A); c.col(12, 8, 14, TEAM_A)
    c.row(0, 0, 4, SKY_M); c.row(0, 6, 15, SKY_M); c.row(8, 0, 11, SKY_M); c.row(8, 13, 15, SKY_M)
    c.r(7, 1, 5, 2, WHITE); c.pts([(6, 2), (12, 2), (8, 3), (9, 3)], WHITE); c.r(1, 9, 4, 2, WHITE); c.pts([(5, 10), (2, 11), (14, 12), (14, 11)], WHITE)
    c.pts([(8, 2), (2, 10)], SKY_M)


def frost_wall_face(c):
    c.r(0, 0, 16, 16, SKY_D)
    c.row(9, 0, 15, OUT); c.col(7, 4, 8, OUT); c.col(3, 10, 14, OUT); c.col(12, 10, 14, OUT)
    c.row(4, 0, 6, TEAM_A); c.row(4, 8, 15, TEAM_A); c.row(10, 4, 11, TEAM_A); c.row(10, 0, 2, TEAM_A); c.row(10, 13, 15, TEAM_A)
    c.r(0, 0, 16, 3, WHITE); c.row(2, 0, 15, SKY_M); c.row(3, 0, 15, BJ)
    for x, n in ((1, 3), (2, 5), (5, 2), (6, 4), (9, 2), (10, 6), (11, 3), (14, 4)):      # 고드름
        c.col(x, 3, 2 + n, WHITE); c.p(x, 2 + n, SKY_M)
    c.row(14, 0, 15, OUT); c.row(15, 0, 15, OUT)
    c.pts([(4, 14), (5, 14), (13, 14)], WHITE)


def frost_door(c):
    c.r(0, 0, 16, 16, SKY_M)
    c.row(15, 0, 15, SPRING); c.col(15, 0, 15, SPRING)
    c.row(0, 0, 14, WHITE); c.col(0, 0, 14, WHITE)
    c.pts([(2, 2), (12, 2), (2, 12), (12, 12), (7, 7), (8, 8)], WHITE)


# ---- 4구역 "새벽 구름 뜰" (tiles-cloud.png) ----
def cloud_deco(c, cracked):
    if cracked:                                                        # 금빛 구름 무늬
        c.pts([(3, 3), (4, 2), (5, 2), (6, 3), (6, 4), (5, 4), (2, 4), (2, 5), (3, 5), (4, 5)], PRIM)
        c.pts([(10, 11), (11, 10), (12, 10), (13, 11), (13, 12), (12, 12), (10, 12), (11, 13)], PRIM)
        c.pts([(5, 3), (12, 11)], PRIM_L)


def cloud_wall_top(c):
    c.r(0, 0, 16, 16, PANEL)
    c.row(7, 0, 15, LINE); c.row(15, 0, 15, LINE)
    c.col(5, 0, 6, LINE); c.col(12, 8, 14, LINE)
    c.row(0, 0, 4, WHITE); c.row(0, 6, 15, WHITE); c.row(8, 0, 11, WHITE); c.row(8, 13, 15, WHITE)
    c.pts([(9, 3), (10, 2), (11, 3), (10, 4), (2, 11), (3, 10), (4, 11), (3, 12)], PRIM)


def cloud_wall_face(c):
    c.r(0, 0, 16, 16, LOSE)
    # 단청 들보
    c.r(0, 0, 16, 2, PANEL); c.row(0, 0, 15, WHITE)
    c.r(0, 2, 16, 3, WIN)
    for x in range(0, 16, 4):
        c.r(x, 2, 2, 3, TEAM_A); c.p(x + 2, 3, PRIM); c.p(x, 3, PANEL)
    c.row(5, 0, 15, OUT)
    # 붉은 기둥
    c.col(3, 6, 12, PIT_I); c.col(4, 6, 12, SUMMER); c.col(11, 6, 12, PIT_I); c.col(12, 6, 12, SUMMER)
    c.pts([(7, 8), (8, 8), (7, 9), (8, 9)], PRIM); c.pts([(15, 8), (0, 8), (15, 9), (0, 9)], PRIM)
    c.r(0, 13, 16, 2, PANEL); c.row(13, 0, 15, WHITE); c.row(14, 0, 15, LINE); c.row(15, 0, 15, OUT)


def cloud_water(c):                                                    # 구름 바다
    c.r(0, 0, 16, 16, SKY_M)
    c.r(1, 3, 7, 3, WHITE); c.row(2, 2, 5, WHITE); c.row(6, 2, 7, PANEL); c.pts([(0, 4), (8, 4)], WHITE)
    c.r(8, 10, 7, 3, WHITE); c.row(9, 10, 13, WHITE); c.row(13, 9, 14, PANEL); c.pts([(15, 11), (7, 11)], WHITE)
    c.row(8, 12, 15, SKY_T); c.row(14, 1, 4, SKY_T); c.row(0, 10, 13, SKY_T)


def cloud_door(c):
    c.r(0, 0, 16, 16, PANEL)
    c.row(15, 0, 15, SUMMER); c.col(15, 0, 15, SUMMER)
    c.row(0, 0, 14, WHITE); c.col(0, 0, 14, WHITE)
    c.pts([(2, 2), (12, 2), (2, 12), (12, 12)], PRIM)


# ---- 5구역 "잿불 성채" (tiles-ember.png) ----
def ember_deco(c, cracked):
    c.pts([(13, 4), (6, 12)], TRACK_O)
    if cracked:                                                        # 재 · 불씨
        c.r(2, 2, 4, 2, DRAW); c.pts([(1, 3), (6, 3), (3, 1), (4, 4)], DRAW); c.p(3, 2, PINK); c.p(5, 3, PRIM)
        c.pts([(11, 10), (10, 11), (10, 12), (9, 13)], TRACK_D); c.pts([(12, 12), (13, 12), (12, 11)], DRAW); c.p(12, 12, PINK)


def ember_wall_top(c):
    c.r(0, 0, 16, 16, TRACK_O)
    c.row(7, 0, 15, TRACK_D); c.row(15, 0, 15, TRACK_D)
    c.col(5, 0, 6, TRACK_D); c.col(12, 8, 14, TRACK_D)
    c.row(0, 0, 4, SKY_B); c.row(0, 6, 15, SKY_B); c.row(8, 0, 11, SKY_B); c.row(8, 13, 15, SKY_B)
    c.pts([(9, 3), (10, 3), (2, 11), (3, 12), (14, 11)], DRAW); c.pts([(8, 4), (14, 4)], LOSE)


def ember_wall_face(c):
    c.r(0, 0, 16, 16, INK)
    c.r(0, 0, 16, 3, TRACK_O); c.row(0, 0, 15, SKY_B)
    c.row(3, 0, 15, OUT)
    c.row(9, 0, 15, PIT_I); c.col(7, 4, 8, PIT_I); c.col(3, 10, 14, PIT_I); c.col(12, 10, 14, PIT_I)
    c.row(4, 0, 6, LOG); c.row(4, 8, 15, LOG); c.row(10, 4, 11, LOG); c.row(10, 0, 2, LOG); c.row(10, 13, 15, LOG)
    c.pts([(7, 6), (7, 7), (8, 9), (9, 9), (12, 11), (12, 12)], PINK); c.pts([(7, 8), (10, 9), (12, 13)], PRIM)   # 달아오른 금
    c.pts([(1, 5), (2, 5), (14, 6), (5, 12)], PIT)
    c.row(14, 0, 15, PIT_I); c.row(15, 0, 15, OUT)


def ember_water(c):                                                    # 용암
    c.r(0, 0, 16, 16, PINK)
    c.row(3, 1, 5, PRIM); c.row(4, 4, 7, PRIM_D); c.row(10, 8, 13, PRIM); c.row(11, 11, 15, PRIM_D); c.row(11, 0, 0, PRIM_D)
    c.row(7, 11, 14, LOSE); c.row(13, 2, 5, LOSE); c.row(1, 9, 12, LOSE); c.row(8, 2, 4, LOSE)
    c.pts([(2, 3), (9, 10)], PRIM_L); c.pts([(13, 2), (6, 14)], PRIM)


def ember_door(c):
    c.r(0, 0, 16, 16, SUMMER)
    c.row(15, 0, 15, TRACK_D); c.col(15, 0, 15, TRACK_D)
    c.row(0, 0, 14, PANEL); c.col(0, 0, 14, PANEL)
    c.pts([(2, 2), (12, 2), (2, 12), (12, 12)], DRAW)


THEMES.update({
    'frost': {'floor': SPRING, 'seam': SKY_M, 'hi': WHITE, 'shadow': BJ, 'moss': False, 'deco': frost_deco,
              'wallTop': frost_wall_top, 'wallFace': frost_wall_face, 'doorOpen': frost_door, 'overlay': (SKY_M, WHITE)},
    'cloud': {'floor': SKY_B, 'seam': SUMMER, 'hi': WHITE, 'shadow': SUMMER, 'moss': False, 'deco': cloud_deco,
              'wallTop': cloud_wall_top, 'wallFace': cloud_wall_face, 'doorOpen': cloud_door, 'water': cloud_water},
    'ember': {'floor': SUMMER, 'seam': TRACK_D, 'hi': PANEL, 'shadow': TRACK_D, 'moss': False, 'deco': ember_deco,
              'wallTop': ember_wall_top, 'wallFace': ember_wall_face, 'doorOpen': ember_door, 'water': ember_water, 'overlay': (PIT_I, DRAW)},
})
THEME_FILES = {'stone': 'tiles.png', 'moss': 'tiles-moss.png', 'frost': 'tiles-frost.png', 'cloud': 'tiles-cloud.png', 'ember': 'tiles-ember.png'}


# ---- 6~10구역 테마: 같은 틀에 색만 바꾼다 ----
def mk_wall_top(base, seam, hi, dots=(), dot_col=None, dots2=(), col2=None):
    def fn(c):
        c.r(0, 0, 16, 16, base)
        c.row(7, 0, 15, seam); c.row(15, 0, 15, seam); c.col(5, 0, 6, seam); c.col(12, 8, 14, seam)
        c.row(0, 0, 4, hi); c.row(0, 6, 15, hi); c.row(8, 0, 11, hi); c.row(8, 13, 15, hi)
        if dot_col:
            c.pts(dots, dot_col)
        if col2:
            c.pts(dots2, col2)
    return fn


def mk_wall_face(brick, mortar, bhi, lip, lip_hi, extra=None):
    def fn(c):
        c.r(0, 0, 16, 16, brick)
        c.r(0, 0, 16, 3, lip); c.row(0, 0, 15, lip_hi); c.row(3, 0, 15, OUT)
        c.row(9, 0, 15, mortar); c.col(7, 4, 8, mortar); c.col(3, 10, 14, mortar); c.col(12, 10, 14, mortar)
        c.row(4, 0, 6, bhi); c.row(4, 8, 15, bhi); c.row(10, 4, 11, bhi); c.row(10, 0, 2, bhi); c.row(10, 13, 15, bhi)
        c.row(14, 0, 15, mortar); c.row(15, 0, 15, OUT)
        if extra:
            extra(c)
    return fn


def mk_water(base, dark, light, glint, extra=None):
    def fn(c):
        c.r(0, 0, 16, 16, base)
        c.row(3, 1, 5, light); c.row(4, 4, 7, light); c.row(10, 8, 13, light); c.row(11, 11, 15, light); c.row(11, 0, 0, light)
        c.row(7, 11, 14, dark); c.row(13, 2, 5, dark); c.row(1, 9, 12, dark)
        c.pts([(2, 3), (9, 10)], glint)
        if extra:
            extra(c)
    return fn


def mk_door(base, edge, hi, stud):
    def fn(c):
        c.r(0, 0, 16, 16, base)
        c.row(15, 0, 15, edge); c.col(15, 0, 15, edge)
        c.row(0, 0, 14, hi); c.col(0, 0, 14, hi)
        c.pts([(2, 2), (12, 2), (2, 12), (12, 12)], stud)
    return fn


# 6구역 "천둥 마루" — 먹구름 위 기와
def thunder_deco(c, cracked):
    if cracked:                                                        # 번개 무늬
        c.pts([(12, 10), (11, 11), (10, 12), (11, 12), (12, 12), (11, 13)], PRIM); c.p(11, 12, PRIM_L)


def thunder_wall_top(c):                                               # 푸른 기와
    c.r(0, 0, 16, 16, TEAM_A)
    for y in (3, 7, 11, 15):
        c.row(y, 0, 15, SKY_D)
    for y0 in (0, 4, 8, 12):
        off = 0 if (y0 // 4) % 2 == 0 else 2
        for x in range(off, 16, 4):
            c.col(x, y0, y0 + 2, SKY_D); c.p((x + 1) % 16, y0, SKY_T); c.p((x + 2) % 16, y0, SKY_T)


def thunder_face_extra(c):
    for x in (1, 5, 9, 13):                                            # 막새
        c.r(x, 1, 2, 2, SKY_D); c.p(x, 1, PRIM)
    c.pts([(8, 6), (9, 7), (8, 7), (9, 8)], PRIM)


def thunder_water_extra(c):
    c.r(1, 5, 5, 2, DRAW); c.r(9, 12, 5, 2, DRAW); c.pts([(2, 4), (3, 4), (10, 11), (11, 11)], DRAW)
    c.pts([(13, 3), (12, 4), (13, 4), (12, 5)], PRIM_L)


# 7구역 "은하 나루" — 오작교 은하수
def galaxy_deco(c, cracked):
    c.row(3, 1, 8, LOG_E); c.row(11, 5, 13, LOG_E)                     # 다리 널 결
    if cracked:
        c.pts([(4, 2), (3, 3), (4, 3), (5, 3), (4, 4)], PRIM_L); c.pts([(11, 11), (12, 12), (10, 12), (11, 13), (11, 12)], PRIM_L)
        c.pts([(4, 3), (11, 12)], WHITE)


def galaxy_water(c):                                                   # 은하수
    c.r(0, 0, 16, 16, OUT)
    c.pts([(1, 6), (2, 5), (3, 5), (4, 4), (5, 4), (6, 3), (10, 12), (11, 11), (12, 11), (13, 10), (14, 10), (15, 9), (0, 9)], SKY_D)
    c.pts([(2, 2), (9, 1), (13, 5), (5, 9), (8, 14), (14, 13), (1, 12), (7, 6)], WHITE)
    c.pts([(11, 3), (3, 14)], PRIM_L); c.pts([(6, 11), (12, 7), (4, 7)], STUN)
    c.pts([(10, 3), (12, 3), (11, 2), (11, 4)], SKY_T)


def galaxy_face_extra(c):
    c.pts([(2, 6), (10, 7), (14, 12), (5, 12)], PRIM_L); c.pts([(9, 1), (3, 1), (13, 2)], WHITE)


# 8구역 "서천 꽃밭"
def flower_deco(c, cracked):
    c.pts([(13, 4), (6, 12)], MATGO)
    if cracked:
        for fx, fy in ((4, 3), (11, 11)):
            c.pts([(fx, fy - 1), (fx - 1, fy), (fx + 1, fy), (fx, fy + 1)], PINK); c.p(fx, fy, PRIM)
        c.pts([(6, 5), (9, 12)], WIN)


def flower_wall_top(c):                                                # 꽃 울타리 윗면
    c.r(0, 0, 16, 16, WIN)
    c.pts([(0, 3), (5, 7), (9, 2), (14, 9), (3, 12), (11, 14), (7, 10)], MAT_D)
    for fx, fy, col in ((3, 3, PINK), (11, 6, SUMMER), (7, 12, PINK)):
        c.pts([(fx, fy - 1), (fx - 1, fy), (fx + 1, fy), (fx, fy + 1)], col); c.p(fx, fy, PRIM)
    c.pts([(6, 1), (15, 6), (5, 13)], MAT_L)


def flower_wall_face(c):                                               # 나무 울타리
    c.r(0, 0, 16, 16, INK)
    for x in (0, 4, 8, 12):
        c.col(x, 4, 14, LOG); c.col(x + 3, 4, 14, PIT_I)
    c.r(0, 7, 16, 1, PIT_I); c.r(0, 12, 16, 1, PIT_I)
    c.r(0, 0, 16, 4, WIN); c.row(3, 0, 15, MAT_D)
    for fx, col in ((2, PINK), (7, SUMMER), (12, PINK)):
        c.pts([(fx, 0), (fx - 1, 1), (fx + 1, 1), (fx, 2)], col); c.p(fx, 1, PRIM)
    c.pts([(5, 4), (10, 5), (10, 4), (14, 4)], WIN)
    c.row(15, 0, 15, OUT)


def flower_water_extra(c):
    c.r(9, 3, 4, 3, WIN); c.p(12, 3, SKY_M); c.pts([(10, 4), (11, 4)], PINK); c.p(10, 3, SUMMER)   # 연잎 · 연꽃
    c.r(2, 11, 3, 2, MAT_D)


# 9구역 "칠성 폭풍단"
def storm_deco(c, cracked):
    if cracked:                                                        # 북두칠성
        pts = [(2, 3), (4, 2), (6, 3), (8, 5), (9, 8), (12, 9), (13, 12)]
        c.pts([(3, 2), (5, 2), (7, 4), (9, 6), (9, 7), (10, 8), (11, 9), (13, 10), (13, 11)], DRAW)
        c.pts(pts, PRIM_D); c.pts([(2, 3), (8, 5), (13, 12)], PRIM_L)


def storm_face_extra(c):
    c.pts([(2, 6), (5, 7), (9, 6), (13, 11), (6, 12)], PRIM_L); c.pts([(1, 1), (8, 1), (12, 1)], SKY_T)


def storm_water_extra(c):
    c.pts([(6, 6), (7, 5), (8, 5), (9, 6), (9, 7), (8, 8), (7, 8), (6, 7)], WHITE); c.pts([(3, 9), (4, 8), (12, 14), (13, 13)], WHITE)


# 10구역 "소원의 정상" — 옥빛 궁궐
def wish_deco(c, cracked):
    if cracked:                                                        # 연꽃 무늬
        c.pts([(11, 10), (10, 11), (12, 11), (11, 12), (9, 12), (13, 12)], PINK); c.p(11, 11, SUMMER)


def wish_face_extra(c):
    c.pts([(1, 1), (5, 1), (9, 1), (13, 1)], PRIM); c.row(2, 0, 15, PRIM_L)
    c.pts([(5, 6), (4, 7), (6, 7), (5, 7), (13, 12), (12, 12)], PINK)


def wish_water_extra(c):
    c.r(1, 5, 5, 2, WHITE); c.pts([(2, 4), (3, 4)], WHITE); c.r(9, 12, 5, 2, WHITE); c.pts([(10, 11), (11, 11)], WHITE)


THEMES.update({
    'thunder': {'floor': DRAW, 'seam': INK, 'hi': WINTER, 'shadow': INK, 'moss': False, 'deco': thunder_deco,
                'wallTop': thunder_wall_top, 'wallFace': mk_wall_face(SKY_D, OUT, TEAM_A, TEAM_A, SKY_T, thunder_face_extra),
                'doorOpen': mk_door(WINTER, INK, WHITE, PRIM), 'water': mk_water(INK, PIT_I, DRAW, PRIM_L, thunder_water_extra)},
    'galaxy': {'floor': EMPTY, 'seam': INK, 'hi': LINE, 'shadow': INK, 'moss': False, 'deco': galaxy_deco,
               'wallTop': mk_wall_top(SKY_T, SKY_D, SKY_M, [(9, 3), (2, 11), (14, 12)], WHITE, [(3, 4), (10, 12)], PRIM_L),
               'wallFace': mk_wall_face(SKY_D, OUT, TEAM_A, SKY_T, SKY_M, galaxy_face_extra),
               'doorOpen': mk_door(LINE, INK, PANEL, PRIM_L), 'water': galaxy_water},
    'flower': {'floor': MAT_L, 'seam': MAT_D, 'hi': AUTUMN, 'shadow': MAT_D, 'moss': False, 'deco': flower_deco,
               'wallTop': flower_wall_top, 'wallFace': flower_wall_face,
               'doorOpen': mk_door(AUTUMN, MAT_D, PANEL, PINK), 'water': mk_water(SKY_M, BJ, WHITE, WHITE, flower_water_extra)},
    'storm': {'floor': LINE, 'seam': DRAW, 'hi': WHITE, 'shadow': DRAW, 'moss': False, 'deco': storm_deco,
              'wallTop': mk_wall_top(SKY_D, OUT, TEAM_A, [(9, 3), (2, 11), (14, 12)], PRIM_L),
              'wallFace': mk_wall_face(PIT, OUT, PIT_I, SKY_D, TEAM_A, storm_face_extra),
              'doorOpen': mk_door(PANEL, DRAW, WHITE, PRIM_L), 'water': mk_water(DRAW, INK, WINTER, WHITE, storm_water_extra)},
    'wish': {'floor': PANEL_S, 'seam': PRIM, 'hi': WHITE, 'shadow': PRIM, 'moss': False, 'deco': wish_deco,
             'wallTop': mk_wall_top(PANEL, LINE, WHITE, [(9, 3), (10, 2), (11, 3), (10, 4), (2, 11), (3, 10), (4, 11), (3, 12)], POKER),
             'wallFace': mk_wall_face(POKER, MAT_D, AUTUMN, PANEL, WHITE, wish_face_extra),
             'doorOpen': mk_door(PANEL, PRIM, WHITE, PINK), 'water': mk_water(PRIM_L, PRIM, PANEL, WHITE, wish_water_extra)},
})
THEME_FILES.update({'thunder': 'tiles-thunder.png', 'galaxy': 'tiles-galaxy.png', 'flower': 'tiles-flower.png', 'storm': 'tiles-storm.png', 'wish': 'tiles-wish.png'})


def t_new8(c, k):
    """6~10구역에서 붙은 8칸. 그렸으면 True"""
    if k in ('rod', 'rodOn'):                                          # 뇌석 (빛나면 번개가 감긴다)
        t_floor(c)
        b = Cv(16)
        b.r(4, 12, 8, 2, INK); b.row(12, 4, 11, DRAW)
        b.r(5, 4, 6, 8, DRAW); b.col(5, 4, 11, WINTER); b.col(6, 4, 11, WINTER); b.col(10, 4, 11, INK); b.pts([(8, 6), (8, 7), (7, 9)], INK)
        b.r(4, 1, 8, 3, INK); b.row(1, 4, 11, BLADE); b.row(3, 4, 11, PIT_I)
        b.r(7, 0, 2, 1, LINE)
        if k == 'rodOn':
            b.pts([(5, 5), (6, 5), (7, 6), (8, 6), (9, 7), (10, 7), (10, 8), (9, 9), (8, 9), (7, 10), (6, 10), (5, 11)], PRIM_L)
            b.pts([(7, 6), (9, 9), (6, 10)], WHITE); b.r(7, 0, 2, 1, WHITE)
        b.outline()
        c.row(14, 4, 12, TP['shadow'])
        c.paste(b, 0, 0)
        if k == 'rodOn':
            c.pts([(2, 2), (3, 3), (2, 4), (13, 1), (12, 2), (13, 3), (2, 9), (13, 8)], PRIM_L); c.pts([(3, 2), (12, 1), (7, 0), (8, 0)], WHITE)
    elif k == 'puff':                                                  # 구름 덩이
        t_floor(c)
        b = Cv(16)
        b.ell(5, 8, 3.6, 3.2, WHITE); b.ell(10, 8.5, 4, 3, WHITE); b.ell(7.5, 5.5, 3.6, 3, WHITE); b.r(3, 8, 10, 3, WHITE)
        b.row(11, 3, 12, SKY_M); b.pts([(2, 10), (13, 10), (5, 10), (9, 10)], SKY_M); b.pts([(6, 4), (7, 4), (4, 7)], PANEL)
        b.outline()
        c.row(14, 3, 12, TP['shadow']); c.row(15, 4, 11, TP['shadow'])
        c.paste(b, 0, 0)
    elif k == 'bars':                                                  # 쇠창살
        t_floor(c)
        for x in (0, 4, 8, 12):
            c.r(x, 0, 4, 16, OUT); c.col(x + 1, 0, 15, WINTER); c.col(x + 2, 0, 15, DRAW)
        c.r(0, 3, 16, 3, OUT); c.row(4, 0, 15, INK); c.r(0, 10, 16, 3, OUT); c.row(11, 0, 15, INK)
        for x in (1, 5, 9, 13):
            c.p(x, 4, BLADE); c.p(x, 11, BLADE)
    elif k in ('mirrorA', 'mirrorB'):                                  # 하늘 거울 (/ 또는 \)
        t_floor(c)
        b = Cv(16)
        for i in range(11):
            x = 12 - i if k == 'mirrorA' else 3 + i
            b.r(x - 1, 2 + i, 3, 2, SKY_M); b.p(x, 2 + i, WHITE)
        ends = [(13, 1), (1, 13)] if k == 'mirrorA' else [(2, 1), (14, 13)]
        for ex, ey in ends:
            b.r(ex - 1, ey, 2, 2, PRIM_D); b.p(ex - 1, ey, PRIM)
        b.outline()
        c.row(15, 2, 13, TP['shadow'])
        c.paste(b, 0, 0)
    elif k == 'fog':                                                   # 짙은 구름 (걸을 수 있다)
        c.r(0, 0, 16, 16, DRAW)
        c.ell(4, 4, 3.6, 2.6, LINE); c.ell(11, 9, 4, 2.8, LINE); c.ell(4, 13, 3.4, 2.2, LINE); c.ell(13, 1, 2.6, 1.6, LINE)
        c.pts([(3, 3), (4, 3), (10, 8), (11, 8), (3, 12)], WHITE)
        c.pts([(8, 3), (9, 4), (1, 9), (2, 9), (8, 14), (9, 14), (15, 12)], INK)
    elif k == 'wish':                                                  # 소원 구슬 (100층)
        t_floor(c)
        b = Cv(16)
        b.r(4, 12, 8, 2, EMPTY); b.row(13, 4, 11, INK); b.r(5, 10, 6, 2, LINE); b.row(11, 5, 10, EMPTY)
        b.ell(7.5, 5.5, 4.6, 4.6, PRIM_L)
        b.pts([(10, 8), (11, 7), (11, 6), (9, 9), (8, 9)], PRIM); b.r(5, 3, 2, 2, WHITE); b.p(7, 3, WHITE); b.p(9, 7, PINK)
        b.outline(PRIM_D)
        b2 = Cv(16)
        b2.paste(b, 0, 0)
        c.row(15, 4, 12, TP['shadow'])
        c.paste(b2, 0, 0)
        c.pts([(1, 3), (14, 2), (2, 8), (14, 9)], WHITE); c.pts([(1, 2), (1, 4), (0, 3), (2, 3), (14, 1), (14, 3), (13, 2), (15, 2)], PRIM_L)
    else:
        return False
    return True


def frame_posts(b):
    """풍경 · 징의 나무 틀"""
    b.r(2, 2, 2, 12, INK); b.col(2, 3, 13, LOG_E); b.r(12, 2, 2, 12, INK); b.col(13, 3, 13, PIT_I)
    b.r(1, 1, 14, 2, LOG); b.row(1, 1, 14, LOG_E)
    b.r(1, 13, 4, 1, PIT_I); b.r(11, 13, 4, 1, PIT_I)


def draw_tiles(theme='stone'):
    global TP
    TP = THEMES[theme]
    moss = TP['moss']
    sheet = Cv(16 * len(TILE_ORDER), 16)
    for i, k in enumerate(TILE_ORDER):
        c = Cv(16)
        if callable(TP.get(k)):
            TP[k](c)
        elif k == 'floor':
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
        elif k == 'coldWater':                                         # 찬물 (살얼음 금)
            c.r(0, 0, 16, 16, SKY_M)
            c.row(3, 1, 6, WHITE); c.row(7, 9, 14, WHITE); c.row(12, 3, 7, WHITE); c.pts([(2, 9), (13, 2), (12, 13)], WHITE)
            c.pts([(6, 4), (7, 5), (7, 6), (8, 7), (11, 8), (11, 9), (10, 10), (10, 11), (4, 13), (3, 14)], TEAM_A)
            c.row(10, 1, 4, SPRING); c.row(5, 10, 13, SPRING); c.row(15, 6, 10, SPRING)
        elif k == 'ice':                                               # 얼음판 (걸을 수 있다)
            c.r(0, 0, 16, 16, WHITE)
            c.row(15, 0, 15, BJ); c.col(15, 0, 15, BJ); c.row(14, 1, 14, SKY_M); c.col(14, 1, 14, SKY_M)
            c.row(0, 0, 15, SKY_M); c.col(0, 0, 15, SKY_M)
            c.pts([(3, 6), (4, 5), (5, 4), (6, 3), (4, 8), (5, 7), (6, 6), (7, 5), (10, 12), (11, 11), (12, 10), (9, 10), (10, 9)], SKY_M)
            c.pts([(2, 2), (12, 4)], SPRING)
        elif k in ('bell', 'bellOn'):                                  # 풍경 (울리면 노랗게 빛나고 흔들린다)
            t_floor(c)
            fr = Cv(16)
            frame_posts(fr)
            fr.outline(skip={(xx, yy) for xx in range(4, 12) for yy in range(3, 13)})
            b = Cv(16)
            on = k == 'bellOn'
            dx = 1 if on else 0
            b.col(7 + dx // 2, 3, 4, OUT); b.col(8 + dx // 2, 3, 4, OUT)
            body, hi, lo = (PRIM, WHITE, PRIM_D) if on else (PRIM_D, PRIM, TRACK_D)
            b.row(5, 6 + dx, 9 + dx, body); b.r(5 + dx, 6, 6, 4, body); b.row(10, 4 + dx, 11 + dx, lo)
            b.col(6 + dx, 6, 9, hi); b.p(7 + dx, 5, hi)
            b.r(7 + 2 * dx, 11, 2, 1, OUT); b.r(7 + 3 * dx, 12, 2, 2, PANEL); b.p(7 + 3 * dx, 13, PINK)   # 추 · 종이 물고기
            b.outline()
            c.row(15, 2, 13, TP['shadow'])
            c.paste(fr, 0, 0)
            c.paste(b, 0, 0)
            if on:
                c.pts([(4, 5), (4, 8), (13, 5), (13, 8), (8, 4)], WHITE); c.pts([(5, 6), (14, 7)], PRIM_L)
        elif k in ('gong', 'gongOn'):                                  # 징 (울리면 둘레에 물결)
            t_floor(c)
            fr = Cv(16)
            frame_posts(fr)
            fr.outline(skip={(xx, yy) for xx in range(4, 12) for yy in range(3, 13)})
            b = Cv(16)
            on = k == 'gongOn'
            b.col(6, 3, 4, OUT); b.col(9, 3, 4, OUT)
            ring = Cv(16)
            ring.ell(7.5, 8.5, 3.6, 3.6, OUT)
            b.paste(ring, 0, 0)
            b.ell(7.5, 8.5, 2.7, 2.7, PRIM if on else PRIM_D)
            b.r(7, 8, 2, 2, WHITE if on else PRIM); b.pts([(6, 7), (7, 6)], PRIM_L if on else PRIM)
            b.pts([(9, 10), (8, 11)], PRIM_D if on else TRACK_D)
            b.outline()
            c.row(15, 2, 13, TP['shadow'])
            c.paste(fr, 0, 0)
            c.paste(b, 0, 0)
            if on:
                c.pts([(4, 6), (4, 7), (4, 10), (4, 11), (11, 6), (11, 7), (11, 10), (11, 11), (5, 5), (10, 5), (5, 12), (10, 12)], PRIM_L)
        elif k == 'boulder':                                           # 둥근 바위 (줄무늬 — 밀어 굴린다)
            t_floor(c)
            b = Cv(16)
            b.ell(7.5, 7.5, 6.2, 6.2, DRAW)
            for y in range(16):
                for x in range(16):
                    if b.solid(x, y):
                        if (x - 5.5) ** 2 + (y - 5) ** 2 <= 9:
                            b.p(x, y, WINTER)
                        elif (x - 6) ** 2 + (y - 6) ** 2 >= 44:
                            b.p(x, y, INK)
            for y, (x0, x1) in {5: (2, 13), 9: (1, 13)}.items():        # 줄무늬
                for x in range(x0, x1 + 1):
                    if b.solid(x, y + (1 if 4 < x < 11 else 0)):
                        b.p(x, y + (1 if 4 < x < 11 else 0), LINE if x < 9 else EMPTY)
            b.pts([(4, 4), (5, 3)], WHITE)
            b.outline()
            c.row(15, 3, 13, TP['shadow']); c.row(14, 12, 14, TP['shadow'])
            c.paste(b, 0, 0)
        elif k == 'pit':                                               # 구덩이
            t_floor(c)
            c.ell(7.5, 8, 6.6, 6.2, OUT)
            c.ell(7.5, 8.8, 5.4, 4.6, PIT)
            c.row(3, 5, 10, INK); c.row(4, 3, 12, INK); c.pts([(2, 5), (13, 5), (2, 6), (13, 6)], INK); c.row(5, 4, 11, PIT_I)
            c.pts([(4, 3), (11, 3)], TP['seam'])
        elif t_new8(c, k):
            pass
        if moss and k in MOSS_ON:
            dark, light = MOSS_ON[k]
            c.pts(dark, MAT_D); c.pts(light, MATGO)
        if TP.get('overlay') and k in MOSS_ON:
            dark, light = MOSS_ON[k]
            c.pts(dark, TP['overlay'][0]); c.pts(light, TP['overlay'][1])
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


# ---- 3구역 "서리 누각" ----
def e_snowimp(c, f):
    b = 1 if f == 1 else 0
    lx = -1 if f == 3 else 0
    x = 2 + lx
    c.r(x + 2, 13, 2, 2, SPRING); c.r(x + 6, 13, 2, 2 - b, SPRING)
    c.ell(x + 4.5, 8.5 + b * 0.5, 5.2, 4.8, WHITE)
    c.pts([(x - 1, 7 + b), (x + 10, 6 + b), (x + 2, 3 + b), (x + 7, 3 + b)], WHITE)                 # 털
    c.pts([(x, 10), (x + 1, 12), (x + 3, 13), (x + 6, 13), (x + 8, 12), (x + 9, 10), (x + 2, 7 + b)], SKY_M)
    c.col(x + 4, 1 + b, 3 + b, TEAM_A); c.pts([(x + 5, 2 + b), (x + 5, 3 + b)], TEAM_A); c.p(x + 4, 1 + b, SKY_M)   # 파란 뿔
    eye = PINK if f == 3 else SKY_D
    c.r(x + 5, 7 + b, 1, 2, eye); c.r(x + 8, 7 + b, 1, 2, eye)
    if f == 2:
        c.pts([(x + 4, 6), (x + 5, 6), (x + 8, 6), (x + 9, 6)], SKY_D)
    c.row(10 + b, x + 5, x + 8, OUT); c.p(x + 6, 10 + b, PINK)
    if f == 2:                                                                                     # 얼음 방망이
        c.r(12, 0, 3, 6, SKY_M); c.col(12, 0, 5, WHITE); c.pts([(14, 1), (14, 4)], TEAM_A); c.r(12, 6, 2, 3, INK)
    else:
        c.r(12 + lx, 4 + b, 3, 6, SKY_M); c.col(12 + lx, 4 + b, 9 + b, WHITE); c.pts([(14 + lx, 5 + b), (14 + lx, 8 + b)], TEAM_A)
        c.r(12 + lx, 10 + b, 2, 2, INK)


def e_icebat(c, f):
    pal = {'w': BJ, 'W': WHITE}
    if f == 2:      # 돌진: 날개를 뒤로 젖힌다
        c.grid(0, 2, ['ww..........ww..', 'wWww.......wWww.', '.wWwww....wwWww.', '..wwWww..wwWww..', '....www..www....'], pal)
        c.pts([(1, 9), (2, 11), (0, 12)], WHITE)
    elif f in (0, 3):
        c.grid(0, 2, ['.ww.........ww..', 'wwww.......wwww.', 'wWwww.....wwwWw.', 'w.wWww...wwWw.w.', '...wwww.wwww....', '....www.www.....'], pal)
    else:
        c.grid(0, 6, ['...wwww.wwww....', '..wwWww.wwWww...', '.wwWww...wwWww..', '.ww.w.....w.ww..', '.w...........w..'], pal)
    c.r(6, 5, 5, 6, SKY_D); c.pts([(6, 4), (10, 4), (6, 3), (10, 3)], SKY_D)
    c.row(9, 7, 9, TEAM_A); c.row(10, 7, 9, TEAM_A)
    eye = PINK if f == 2 else WHITE
    c.p(8, 7, eye); c.p(10, 7, eye)
    if f == 3:
        c.pts([(7, 7), (9, 7)], WHITE)
    c.r(7, 11, 3, 1, SKY_M); c.col(8, 12, 14, WHITE); c.p(7, 12, SKY_M); c.p(9, 12, WHITE)             # 고드름


def e_frostjar(c, f):
    b = 1 if f == 1 else 0
    c.ell(7.5, 9.5, 5.6, 4.8, LOG)
    c.col(12, 8, 12, INK); c.row(14, 5, 10, INK); c.pts([(11, 13), (11, 6), (13, 9), (13, 10)], INK); c.col(3, 8, 11, LOG_E)
    c.r(6, 5, 4, 1, INK)
    c.r(5, 3 + b, 6, 2, LOG_E); c.row(3 + b, 5, 10, CRATE); c.row(3 + b, 6, 9, PIT)
    c.pts([(3, 7), (4, 6), (5, 6), (4, 7), (11, 6), (12, 7), (10, 6), (4, 13), (6, 14), (9, 14)], WHITE)   # 서리
    c.pts([(3, 8), (12, 8), (5, 7), (10, 7)], SKY_M)
    eye = WHITE if f == 3 else SKY_M if f == 2 else PRIM
    c.r(6, 8, 2, 3, OUT); c.r(10, 8, 2, 3, OUT); c.p(7, 9, eye); c.p(11, 9, eye)
    c.row(12, 8, 9, OUT)
    if f == 2:                                                                                      # 냉기
        c.pts([(6, 1), (7, 0), (9, 1), (10, 0), (8, 2), (5, 2), (11, 2), (8, 1)], WHITE); c.pts([(8, 0), (4, 1), (12, 1)], SKY_M)


def e_wisp(c, f):
    big = f == 2
    r = 5 if big else 4
    cy = 10 - (1 if f == 1 else 0)
    c.ell(8, cy, r, r, TEAM_A)
    tip = [(7, cy - r - 1), (7, cy - r - 2), (6, cy - r - 3)] if f == 1 else [(8, cy - r - 1), (8, cy - r - 2), (9, cy - r - 3)]
    c.pts(tip + [(7, cy - r), (8, cy - r), (9, cy - r), (7, cy - r + 1), (9, cy - r + 1)], TEAM_A)
    if not big:
        c.pts([(8 - r - 1, cy - 1), (8 + r + 1, cy + 1)], TEAM_A)
    c.ell(8, cy + 1, r - 1.6, r - 1.8, SKY_M)
    if big:
        c.ell(8, cy + 0.5, r - 1.4, r - 1.6, WHITE); c.pts([(2, 3), (14, 4), (13, 14)], WHITE)
    else:
        c.ell(8, cy + 1.6, r - 2.8, r - 2.8, WHITE)
    eye = PINK if f == 3 else OUT
    c.r(7, cy - 1, 1, 2, eye); c.r(10, cy - 1, 1, 2, eye)


def e_haetae(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    c.ell(3 + x, 11 + b, 2.6, 3.2, WHITE); c.pts([(2 + x, 9 + b), (4 + x, 13 + b)], SKY_M)             # 꼬리
    for lx_, sh in ((5, 0), (8, b), (12, 0), (15, b)):
        c.r(lx_ + x, 17, 3, 5 - sh, BJ); c.r(lx_ + x, 21 - sh, 3, 2, WHITE)
    c.ell(10 + x, 14 + b, 7.2, 4.6, SPRING)
    for sx, sy in ((5, 13), (8, 12), (11, 13), (7, 15), (10, 15), (13, 15), (4, 15)):                  # 비늘
        c.p(sx + x, sy + b, TEAM_A); c.p(sx + 1 + x, sy + b, BJ)
    c.row(18 + b, 6 + x, 13 + x, PANEL)
    c.ell(16 + x, 9 + b, 6.2, 6.4, WHITE)                                                              # 갈기
    c.pts([(11 + x, 6 + b), (10 + x, 10 + b), (12 + x, 14 + b), (15 + x, 3 + b), (13 + x, 4 + b), (19 + x, 15 + b), (12 + x, 9 + b), (14 + x, 13 + b)], SKY_M)
    c.ell(18 + x, 10 + b, 4.2, 4.2, SPRING); c.r(20 + x, 10 + b, 3, 3, SPRING); c.p(22 + x, 10 + b, OUT)
    c.col(18 + x, 2 + b, 5 + b, PRIM); c.p(18 + x, 2 + b, PRIM_L); c.p(19 + x, 5 + b, PRIM_D)          # 외뿔
    eye = WHITE if f == 3 else PINK if f == 2 else PRIM
    c.r(18 + x, 8 + b, 2, 2, OUT); c.p(19 + x, 8 + b, eye)
    c.row(7 + b, 17 + x, 20 + x, SKY_D)
    if f == 2:
        c.r(19, 12, 4, 3, OUT); c.r(20, 13, 3, 1, PINK); c.pts([(20, 12), (22, 12)], WHITE)
        c.pts([(23, 11), (23, 13), (23, 15), (22, 16)], WHITE)                                          # 냉기
    else:
        c.row(13 + b, 19 + x, 22 + x, OUT); c.p(20 + x, 13 + b, WHITE)


def e_winter_general(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    up = f == 2
    c.r(7 + x, 13 + b, 18, 15 - b, BJ); c.col(7 + x, 13 + b, 27, SPRING); c.col(24 + x, 13 + b, 27, TEAM_A)   # 망토
    c.r(10 + x, 25, 5, 5, SKY_D); c.r(17 + x, 25, 5, 5 - b, SKY_D)
    c.r(9 + x, 28, 7, 3, PIT); c.r(16 + x, 28 - b, 7, 3, PIT); c.row(28, 9 + x, 15 + x, WHITE); c.row(28 - b, 16 + x, 22 + x, WHITE)
    c.r(9 + x, 20 + b, 14, 6 - b, TEAM_A)
    for xx in (9, 13, 17, 21):
        c.col(xx + x, 20 + b, 25, SKY_D)
    c.row(25, 9 + x, 22 + x, WHITE)
    c.r(9 + x, 12 + b, 14, 9, SKY_D)
    for yy in (14, 16, 18):
        for xx in range(10, 22, 2):
            c.p(xx + (yy // 2) % 2 + x, yy + b, TEAM_A)
    c.r(9 + x, 19 + b, 14, 2, PRIM); c.r(15 + x, 19 + b, 2, 2, PRIM_D)
    for px_ in (5, 21):                                                                                 # 어깨 갑옷
        c.r(px_ + x, 11 + b, 6, 4, BJ); c.row(11 + b, px_ + x, px_ + 5 + x, WHITE); c.pts([(px_ + 1 + x, 15 + b), (px_ + 3 + x, 15 + b)], WHITE)
    c.r(11 + x, 4 + b, 10, 8, SKIN)
    c.r(10 + x, 1 + b, 12, 5, SKY_D); c.row(b, 12 + x, 19 + x, SKY_D); c.row(5 + b, 10 + x, 21 + x, WHITE); c.r(15 + x, b, 2, 3, PRIM)
    c.r(10 + x, 6 + b, 2, 4, SKY_D); c.r(20 + x, 6 + b, 2, 4, SKY_D); c.row(2 + b, 11 + x, 13 + x, TEAM_A)
    eye = WHITE if f == 3 else PINK if up else SKY_D
    c.r(13 + x, 7 + b, 2, 2, OUT); c.r(17 + x, 7 + b, 2, 2, OUT); c.p(14 + x, 7 + b, eye); c.p(18 + x, 7 + b, eye)
    c.row(6 + b, 12 + x, 14 + x, WHITE); c.row(6 + b, 17 + x, 19 + x, WHITE)
    c.r(12 + x, 10 + b, 8, 3, WHITE); c.r(13 + x, 13 + b, 6, 3, WHITE); c.r(14 + x, 16 + b, 4, 2, WHITE)   # 흰 수염
    c.r(11 + x, 9 + b, 2, 2, WHITE); c.r(19 + x, 9 + b, 2, 2, WHITE)
    c.pts([(13 + x, 12 + b), (18 + x, 13 + b), (15 + x, 15 + b), (16 + x, 17 + b)], SKY_M); c.row(10 + b, 15 + x, 16 + x, LOSE)
    c.r(5 + x, 14 + b, 4, 6, BJ); c.r(5 + x, 19 + b, 3, 2, SKIN)
    if up:                                                                                              # 얼음 창을 높이 든다
        c.r(23 + x, 5, 4, 8, BJ); c.r(23 + x, 3, 4, 3, SKIN)
        c.r(3 + x, 2, 23, 2, INK); c.row(2, 3 + x, 25 + x, LOG_E); c.r(24 + x, 1, 1, 4, PRIM)
        c.r(26 + x, 1, 3, 4, WHITE); c.r(29 + x, 2, 2, 2, WHITE); c.pts([(26 + x, 4), (27 + x, 4), (28 + x, 4), (30 + x, 3)], SKY_M)
        c.pts([(30, 0), (31, 5), (28, 6)], WHITE)
    else:
        c.r(23 + x, 14 + b, 4, 6, BJ)
        c.r(26 + x, 8, 2, 23, INK); c.col(26 + x, 8, 30, LOG_E)
        c.r(26 + x, 3, 2, 5, WHITE); c.p(26 + x, 2, WHITE); c.pts([(25 + x, 5), (28 + x, 5), (25 + x, 6), (28 + x, 6), (25 + x, 7), (28 + x, 7)], SKY_M)
        c.r(25 + x, 8, 4, 1, PRIM)
        c.r(25 + x, 19 + b, 3, 2, SKIN)


def e_icecrystal(c, f):
    c.r(3, 13, 10, 2, WHITE); c.pts([(2, 14), (13, 14)], WHITE); c.row(14, 4, 11, SKY_M)
    c.r(6, 4, 4, 9, SKY_M); c.r(7, 2, 2, 2, SKY_M); c.p(7, 1, SKY_M); c.col(6, 4, 12, WHITE); c.col(7, 1, 3, WHITE); c.col(9, 4, 12, TEAM_A)
    c.r(2, 8, 3, 5, SKY_M); c.p(3, 7, SKY_M); c.col(2, 8, 12, WHITE); c.col(4, 9, 12, TEAM_A)
    c.r(11, 6, 3, 7, SKY_M); c.pts([(12, 5), (12, 4)], SKY_M); c.col(11, 6, 12, WHITE); c.col(13, 7, 12, TEAM_A)
    if f == 1:
        c.pts([(8, 5), (8, 6), (12, 7)], WHITE)
    else:
        c.pts([(8, 9), (3, 10)], WHITE)
    if f == 2:
        c.pts([(1, 3), (14, 2), (4, 1), (0, 6), (15, 9)], WHITE); c.r(8, 6, 1, 4, WHITE)
    if f == 3:                                                                                          # 금이 간다
        c.pts([(7, 5), (8, 6), (8, 7), (7, 8), (8, 9), (7, 10), (12, 8), (12, 9), (3, 10), (3, 11)], OUT)


# ---- 4구역 "새벽 구름 뜰" ----
def e_ram(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    hy = 2 if f == 2 else 0
    c.r(3 + x, 12, 2, 3, PIT_I); c.r(8 + x, 12, 2, 3 - b, PIT_I)
    c.ell(6.5 + x, 8.5 + b * 0.5, 5.4, 4.2, WHITE)
    c.pts([(2 + x, 5 + b), (5 + x, 4 + b), (8 + x, 4 + b), (1 + x, 9), (11 + x, 5 + b)], WHITE)
    c.pts([(3 + x, 11), (6 + x, 12), (9 + x, 11), (4 + x, 7), (7 + x, 9), (2 + x, 9), (9 + x, 7)], LINE)
    c.r(10 + x, 6 + hy + b, 4, 5, INK); c.r(13 + x, 8 + hy + b, 2, 3, INK); c.p(14 + x, 10 + hy + b, PIT)
    c.p(12 + x, 8 + hy + b, PINK if f == 3 else WHITE)
    c.grid(9 + x, 3 + hy + b, ['.hhh.', 'hhHhh', 'hH.hh', 'hh...'], {'h': PRIM_D, 'H': PRIM})     # 말린 뿔


def e_kite(c, f):
    t = Cv(16)
    t.r(3, 1, 10, 10, PANEL)
    t.r(3, 1, 10, 2, PINK); t.r(3, 9, 10, 2, TEAM_A); t.col(3, 3, 8, LINE); t.col(12, 3, 8, LINE)
    t.clear(7, 5, 2, 2)                                                                                 # 방구멍
    eye = PINK if f == 3 else OUT
    t.r(4, 4, 2, 2, eye); t.r(10, 4, 2, 2, eye); t.p(5, 4, WHITE); t.p(11, 4, WHITE)
    t.row(8, 6, 9, OUT)
    if f == 1:
        t.pts([(5, 11), (6, 12), (5, 13), (6, 14)], PINK); t.pts([(10, 11), (9, 12), (10, 13), (9, 14)], TEAM_A)
    else:
        t.pts([(5, 11), (4, 12), (5, 13), (4, 14)], PINK); t.pts([(10, 11), (11, 12), (10, 13), (11, 14)], TEAM_A)
    for y in range(16):
        dx = (8 - y) // 3 if f == 2 else 0
        for xx in range(16):
            if t.solid(xx, y):
                c.p(xx + dx, y, t.px[xx, y])


def e_chick(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    dash = f == 2
    d = 1 if dash else 0
    if dash:
        c.ell(8, 10, 5.6, 4.2, PRIM)
    else:
        c.ell(7.5 + x, 9 + b, 5, 5, PRIM)
    c.pts([(5 + x, 6 + b + d), (6 + x, 5 + b + d), (5 + x, 7 + b + d)], PRIM_L)
    c.row(13 if dash else 13 + b, 5 + x, 10 + x, PRIM_D)
    c.pts([(7 + x, 3 + b + 2 * d), (8 + x, 2 + b + 2 * d)], PRIM_D)
    if dash:
        c.pts([(2, 7), (3, 8), (2, 8), (1, 6), (3, 9)], PRIM_D)
    else:
        c.r(4 + x, 9 + b, 3, 2, PRIM_D)
    eye = WHITE if f == 3 else OUT
    c.r(9 + x, 7 + b + d, 1, 2, eye); c.r(11 + x, 7 + b + d, 1, 2, eye)
    c.r(12 + x, 9 + b + d, 2 + d, 2, TRACK_D)
    c.pts([(6 + x - b, 14), (9 + x + b, 14)], TRACK_D)


def e_scarecrow(c, f):
    up = f == 2
    h = 1 if f == 1 else -1 if f == 3 else 0
    c.r(7, 9, 2, 6, INK); c.row(15, 6, 9, PIT_I)
    if up:
        for i in range(5):
            c.r(5 - i, 9 - i, 2, 1, INK); c.r(9 + i, 9 - i, 2, 1, INK)
        c.pts([(0, 4), (1, 3), (0, 3), (14, 4), (15, 3), (15, 4)], PRIM)
        c.pts([(12, 1), (13, 7), (3, 1), (15, 8)], PRIM)                                               # 날리는 짚
    else:
        c.r(1, 9, 14, 2, INK)
        c.r(0, 8, 2, 4, PRIM); c.r(14, 8, 2, 4, PRIM); c.pts([(0, 8), (15, 11)], PRIM_D)
    c.r(5, 9, 6, 4, TEAM_A); c.pts([(6, 10), (9, 12)], PINK); c.pts([(5, 13), (7, 13), (10, 13)], TEAM_A); c.col(10, 9, 12, SKY_D)
    c.r(5 + h, 4, 6, 5, PANEL_S)
    eye = PINK if f == 3 else OUT
    c.pts([(6 + h, 6), (9 + h, 6)], eye); c.row(7, 7 + h, 8 + h, OUT)
    c.pts([(5 + h, 8), (10 + h, 8)], LINE)
    c.row(3, 3 + h, 12 + h, PRIM_D); c.row(2, 5 + h, 10 + h, PRIM); c.row(1, 6 + h, 9 + h, PRIM); c.row(0, 7 + h, 8 + h, PRIM_D)


def e_geumgye(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    cr = 2 if f == 2 else 0
    c.r(9 + x, 18, 2, 4, TRACK_D); c.r(13 + x, 18, 2, 4 - b, TRACK_D)
    c.r(9 + x, 22, 4, 1, TRACK_D); c.r(13 + x, 22 - b, 4, 1, TRACK_D)
    c.grid(x, 4 + cr, ['..ddd...', '.dTTdd..', 'dTT.ddd.', 'dT..rdd.', 'd...rrdd', '....rrdd', '.....rdd', '......dd'], {'d': PRIM_D, 'T': TRACK_D, 'r': LOSE})   # 꼬리 깃
    c.ell(11 + x, 14 + cr * 0.5 + b * 0.5, 6, 5, PRIM)
    c.ell(12 + x, 16 + cr * 0.5, 3.5, 2.6, PRIM_L)
    c.r(13 + x, 5 + cr + b, 5, 7, PRIM)
    c.r(12 + x, 11 + cr, 6, 3, LOSE); c.row(11 + cr, 12 + x, 17 + x, PINK); c.p(15 + x, 12 + cr, PRIM)     # 가슴 갑옷
    c.ell(15.5 + x, 5 + cr + b, 3.4, 3.2, PRIM_L)
    c.r(13 + x, 1 + cr + b, 5, 1, PINK); c.pts([(13 + x, cr + b), (15 + x, cr + b), (17 + x, cr + b), (12 + x, 2 + cr + b)], PINK)   # 볏
    c.r(19 + x, 5 + cr + b, 2, 2, TRACK_D); c.p(21 + x, 6 + cr + b, TRACK_D); c.r(18 + x, 7 + cr + b, 2, 2, PINK)
    c.p(17 + x, 4 + cr + b, WHITE if f == 3 else OUT)
    if f == 2:
        c.pts([(16 + x, 3 + cr), (17 + x, 3 + cr)], OUT)
        c.r(5 + x, 10, 4, 5, PRIM_D); c.r(3 + x, 7, 3, 4, PRIM_D); c.r(2 + x, 4, 2, 4, TRACK_D); c.p(2 + x, 3, LOSE)
        c.r(17, 13, 4, 4, PRIM_D); c.r(20, 10, 3, 4, PRIM_D); c.r(22, 7, 2, 4, TRACK_D); c.p(23, 6, LOSE)
    else:
        c.r(7 + x, 12 + b, 6, 5, PRIM_D); c.row(16 + b, 8 + x, 11 + x, TRACK_D); c.pts([(8 + x, 13 + b), (10 + x, 14 + b)], PRIM)


def e_yeongdeung(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    back = f == 2
    # 구름
    c.ell(15.5, 27, 12, 3.4, WHITE); c.ell(8, 26, 4, 3, WHITE); c.ell(23, 26, 4, 3, WHITE); c.ell(15, 25, 5, 3, WHITE)
    c.row(30, 7, 24, SKY_M); c.pts([(5, 28), (26, 28), (10, 29), (20, 29), (4, 27), (27, 27)], SKY_M)
    # 파란 치마
    for y in range(15, 26):
        w = 5 + (y - 15) * 0.55
        c.row(y + b, int(15.5 + x - w), int(15.5 + x + w), TEAM_A)
    c.col(12 + x, 18 + b, 25, SKY_D); c.col(18 + x, 17 + b, 25, SKY_D); c.col(15 + x, 20 + b, 25, SKY_T); c.row(25 + b, 10 + x, 21 + x, SKY_M)
    c.pts([(22 + x, 24 + b), (23 + x, 23 + b)] if f % 2 else [(9 + x, 24 + b), (8 + x, 23 + b)], TEAM_A)
    # 저고리
    c.r(11 + x, 11 + b, 10, 5, PANEL); c.pts([(14 + x, 11 + b), (15 + x, 12 + b), (16 + x, 12 + b), (17 + x, 11 + b)], LINE)
    c.col(16 + x, 13 + b, 17 + b, LOSE); c.p(17 + x, 13 + b, LOSE)
    # 머리
    c.r(11 + x, 3 + b, 10, 8, SKIN); c.row(11 + b, 14 + x, 17 + x, SKIN_S)
    c.r(10 + x, 2 + b, 12, 3, WHITE); c.row(1 + b, 12 + x, 19 + x, WHITE); c.col(10 + x, 4 + b, 7 + b, WHITE); c.col(21 + x, 4 + b, 7 + b, WHITE)
    c.pts([(13 + x, 3 + b), (17 + x, 2 + b), (10 + x, 6 + b)], LINE)
    c.r(14 + x, 0, 4, 2, WHITE); c.p(15 + x, 0, LINE); c.r(12 + x, 1, 2, 1, PRIM); c.r(18 + x, 1, 3, 1, PRIM)            # 쪽 · 비녀
    if back:
        c.r(13 + x, 6 + b, 2, 2, OUT); c.r(17 + x, 6 + b, 2, 2, OUT); c.p(14 + x, 6 + b, PINK); c.p(18 + x, 6 + b, PINK)
        c.r(15 + x, 9 + b, 2, 2, OUT)
    elif f == 3:
        c.pts([(13 + x, 6 + b), (14 + x, 7 + b), (13 + x, 7 + b), (17 + x, 7 + b), (18 + x, 6 + b), (18 + x, 7 + b)], OUT); c.row(9 + b, 15 + x, 16 + x, OUT)
    else:
        c.pts([(13 + x, 7 + b), (14 + x, 6 + b), (15 + x, 7 + b), (17 + x, 7 + b), (18 + x, 6 + b), (19 + x, 7 + b)], OUT); c.row(9 + b, 15 + x, 16 + x, LOSE)
    c.pts([(12 + x, 8 + b), (20 + x, 8 + b)], PINK); c.pts([(12 + x, 5 + b), (20 + x, 5 + b)], SKIN_S)
    fan = ['..ppppp...', '.pFFFFFp..', 'pFFrFFrFp.', 'pFrFFrFFFp', 'pFFFrFFFFp', '.pFFFFFFp.', '..pppppp..']
    pal = {'p': PINK, 'F': PANEL_S, 'r': PRIM_D}
    if back:                                                                                            # 부채를 뒤로 크게 젖힌다
        c.r(20 + x, 12 + b, 4, 5, PANEL); c.r(20 + x, 17 + b, 3, 2, SKIN)
        c.r(6 + x, 11 + b, 6, 3, PANEL); c.r(5 + x, 10 + b, 2, 2, SKIN); c.r(5 + x, 8 + b, 1, 3, INK)
        c.grid(0, 2 + b, fan, pal)
        c.pts([(11, 3), (12, 1), (1, 11)], WHITE)
    else:
        c.r(8 + x, 12 + b, 4, 5, PANEL); c.r(9 + x, 17 + b, 3, 2, SKIN)
        c.r(20 + x, 12 + b, 4, 3, PANEL); c.r(23 + x, 12 + b, 2, 2, SKIN); c.r(25 + x, 12 + b, 1, 3, INK)
        c.grid(21 + x, 5 + b, fan, pal)


# ---- 5구역 "잿불 성채" ----
def e_bulgae(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    low = f == 2
    dy = 1 if low else 0
    h = 2 if low else 3
    c.r(6 + x, 15 - h, 1, h, PIT_I); c.r(11 + x, 15 - h, 1, h, PIT_I)
    c.r(4 + x, 15 - h, 2, h, LOSE); c.r(9 + x, 15 - h, 2, h - b, LOSE)
    c.r(3 + x, 8 + dy, 9, 4, LOSE); c.row(11 + dy, 4 + x, 10 + x, PIT_I)
    hy = 5 + dy * 2 + b
    c.r(10 + x, hy, 4, 5, LOSE); c.r(13 + x, hy + 2, 3, 3, LOSE); c.p(15 + x, hy + 2, OUT)
    c.pts([(10 + x, hy - 1), (11 + x, hy - 2), (11 + x, hy - 1)], PIT_I)
    c.p(12 + x, hy + 1, WHITE if f >= 2 else PRIM)
    c.row(hy + 4, 13 + x, 15 + x, OUT)
    if low:
        c.p(14 + x, hy + 4, WHITE)
    c.pts([(5 + x, 7 + dy), (7 + x, 6 + dy), (8 + x, 7 + dy), (9 + x, 5 + dy), (9 + x, 6 + dy), (6 + x, 7 + dy), (9 + x, 4 + dy)], PINK)   # 불꽃 갈기
    c.pts([(7 + x, 7 + dy), (9 + x, 7 + dy)], PRIM)
    c.grid(x, 3 + dy - b, ['.p..', 'pp..', 'pyp.', 'pyyp', '.pyp', '..pp'], {'p': PINK, 'y': PRIM})                             # 불꽃 꼬리


def e_torchimp(c, f):
    b = 1 if f == 1 else 0
    lean = -1 if f == 3 else 0
    x = 3 + lean
    c.r(x + 1, 13, 2, 2, LOSE); c.r(x + 5, 13, 2, 2 - b, LOSE)
    c.r(x, 4 + b, 9, 9 - b, LOSE); c.row(3 + b, x + 1, x + 7, LOSE)
    c.row(4 + b, x + 1, x + 6, SUMMER); c.col(x, 5 + b, 8, SUMMER)
    c.col(x + 8, 6 + b, 12, PIT_I)
    for hx_ in (x + 2, x + 6):
        c.col(hx_, 1 + b, 2 + b, PRIM); c.p(hx_, 1 + b, PRIM_L)
    eye = WHITE if f == 3 else PRIM if f == 2 else OUT
    c.r(x + 4, 6 + b, 1, 2, eye); c.r(x + 7, 6 + b, 1, 2, eye)
    if f == 2:
        c.pts([(x + 3, 5 + b), (x + 4, 5 + b), (x + 7, 5 + b), (x + 8, 5 + b)], OUT)
    c.row(9 + b, x + 3, x + 7, OUT); c.p(x + 4, 9 + b, WHITE); c.p(x + 7, 9 + b, WHITE)
    c.r(x, 11, 9, 2, PRIM_D); c.pts([(x + 1, 11), (x + 4, 12), (x + 6, 11)], OUT)
    flame = ['.p..', 'pyp.', 'pyyp', '.pyp']
    pal = {'p': PINK, 'y': PRIM}
    if f == 2:                                                                                          # 횃불을 뒤로 당긴다
        c.r(1, 6, 2, 6, INK); c.r(2, 10, 2, 2, LOSE); c.grid(0, 2, flame, pal)
    else:
        c.r(13 + lean, 6 + b, 2, 6, INK); c.r(12 + lean, 10 + b, 2, 2, LOSE); c.grid(12 + lean, 2 + b, flame, pal)


def e_wildcat(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    low = f == 2
    dy = 1 if low else 0
    ly, lh = (13, 2) if low else (12, 3)
    c.r(5 + x, ly, 1, lh, LOG); c.r(11 + x, ly, 1, lh, LOG)
    c.r(3 + x, ly, 2, lh, TRACK_D); c.r(9 + x, ly, 2, lh - (b if not low else 0), TRACK_D)
    c.r(3 + x, 8 + dy, 9, 4, TRACK_D)
    if low:
        c.r(2 + x, 7, 5, 3, TRACK_D)
    c.row(8 + dy, 4 + x, 10 + x, TRACK_O); c.row(11 + dy, 5 + x, 10 + x, PANEL)
    c.pts([(4 + x, 9 + dy), (6 + x, 10 + dy), (8 + x, 9 + dy), (10 + x, 10 + dy), (5 + x, 8 + dy)], OUT)   # 얼룩
    hy = 5 + b + 2 * dy
    c.r(10 + x, hy, 5, 5, TRACK_D)
    c.pts([(10 + x, hy - 1), (10 + x, hy - 2), (14 + x, hy - 1), (14 + x, hy - 2), (11 + x, hy - 1), (13 + x, hy - 1)], TRACK_D)
    c.r(12 + x, hy + 2, 3, 3, PANEL); c.p(14 + x, hy + 2, PINK); c.p(11 + x, hy, OUT)
    eye = WHITE if f == 3 else WIN
    c.p(11 + x, hy + 1, eye); c.p(13 + x, hy + 1, eye)
    if f == 1:
        c.pts([(2 + x, 8), (1 + x, 7), (0 + x, 6), (0 + x, 5), (1 + x, 4)], TRACK_D); c.p(1 + x, 4, OUT)
    else:
        c.pts([(2 + x, 7 + dy), (1 + x, 6 + dy), (1 + x, 5 + dy), (1 + x, 4 + dy), (2 + x, 3 + dy)], TRACK_D); c.p(2 + x, 3 + dy, OUT)


def e_sparrow(c, f):
    pal = {'w': INK, 'p': PINK, 'y': PRIM}
    c.r(2, 9, 3, 2, PIT_I); c.p(1, 9, PIT_I)
    c.ell(8, 9, 4, 3.4, LOG); c.ell(8.5, 10.5, 2.8, 1.8, PANEL)
    c.ell(11, 7, 2.6, 2.6, LOG); c.p(11, 8, PANEL); c.p(12, 8, PIT); c.row(5, 10, 12, PIT_I)
    c.r(14, 7, 2, 1, PRIM_D)
    c.p(12, 6, WHITE if f == 3 else OUT)
    if f == 2:                                                                                          # 돌진
        c.grid(0, 5, ['yppwww..', '.ypwwww.'], pal); c.pts([(0, 8), (1, 12), (3, 13)], PRIM)
    elif f in (0, 3):
        c.grid(4, 2, ['y.....', 'py....', 'ppw...', '.www..', '..www.'], pal)
    else:
        c.grid(4, 9, ['..www.', '.www..', 'ppw...', 'py....', 'y.....'], pal)


def e_hwacha(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    c.r(x, 13, 5, 1, INK); c.p(x, 14, PIT_I)
    c.r(6 + x, 10, 2, 4, INK); c.r(15 + x, 10, 2, 3, INK)
    c.r(3 + x, 13, 16, 3, CRATE); c.row(13, 3 + x, 18 + x, LOG_E); c.row(15, 3 + x, 18 + x, LOG)
    c.r(5 + x, 3, 15, 7, LOG_E); c.row(3, 5 + x, 19 + x, PANEL_S); c.row(9, 5 + x, 19 + x, LOG); c.col(5 + x, 3, 9, LOG)   # 화살 구멍 판
    for yy in (4, 6, 8):
        for xx in range(7, 19, 2):
            c.p(xx + x, yy, OUT)
        c.p(20 + x, yy, BLADE); c.p(21 + x, yy, WHITE)
    for wx in (7, 16):                                                                                  # 바퀴
        c.ell(wx + x, 18.5, 4.2, 4.2, LOG); c.ell(wx + x, 18.5, 2.7, 2.7, EMPTY)
        if b:
            c.pts([(wx + x - 2, 17), (wx + x + 1, 17), (wx + x - 2, 20), (wx + x + 1, 20)], LOG)
        else:
            c.pts([(wx + x - 1, 16), (wx + x, 16), (wx + x - 1, 21), (wx + x, 21), (wx + x - 3, 18), (wx + x - 3, 19), (wx + x + 2, 18), (wx + x + 2, 19)], LOG)
        c.r(wx + x - 1, 18, 2, 2, INK)
    if f == 2:                                                                                          # 판에 불이 붙는다
        c.grid(6, 0, ['.p...p...p..p.', 'pyp.pyp.pyppyp', 'pyp.pyp.pyppyp'], {'p': PINK, 'y': PRIM})
        for yy in (4, 6, 8):
            c.p(20, yy, PRIM); c.p(21, yy, PINK)
        c.pts([(22, 2), (23, 5), (22, 9)], PRIM)


def e_bulgasari(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    up = f == 2
    c.pts([(2 + x, 16), (1 + x, 15), (1 + x, 14)], INK)
    c.r(5 + x, 23, 6, 7, INK); c.r(4 + x, 28, 8, 3, PIT_I); c.pts([(5 + x, 30), (7 + x, 30), (9 + x, 30)], WHITE)
    if up:
        c.r(15 + x, 23, 6, 7, INK); c.r(14 + x, 28, 8, 3, PIT_I); c.pts([(15 + x, 30), (17 + x, 30), (19 + x, 30)], WHITE)
    else:
        c.r(17 + x, 23, 6, 7 - b, INK); c.r(16 + x, 28 - b, 8, 3, PIT_I); c.pts([(17 + x, 30 - b), (19 + x, 30 - b), (21 + x, 30 - b)], WHITE)
    c.ell(13.5 + x, 18 + b * 0.5, 10.5, 7.5, DRAW)
    body = c.mask()
    c.ell(15 + x, 22, 6, 3, WINTER)
    for row, yy in enumerate(range(12, 24, 3)):                                                          # 쇠 비늘
        for xx in range(5 + (row % 2) * 2, 23, 4):
            if (xx + x, yy + b) in body and (xx + 1 + x, yy + b) in body and yy < 21:
                c.p(xx + x, yy + b, INK); c.p(xx + 1 + x, yy + b, INK); c.p(xx + x, yy - 1 + b, BLADE)
    for xx in range(4, 19, 2):                                                                           # 바늘 털
        top = 8 + abs(xx - 11) // 2 + b
        c.col(xx + x, top, top + 3, WHITE if xx % 4 else BLADE)
    hy = 9 + b - (2 if up else 0)
    c.r(16 + x, hy - 6, 3, 3, DRAW); c.r(23 + x, hy - 6, 3, 3, DRAW); c.p(17 + x, hy - 5, INK); c.p(24 + x, hy - 5, INK)
    c.ell(21 + x, hy, 6, 5.2, DRAW); c.row(hy - 4, 19 + x, 23 + x, WINTER); c.col(16 + x, hy - 1, hy + 2, WINTER)
    eye = WHITE if f == 3 else PINK if up else PRIM
    c.r(19 + x, hy - 2, 3, 2, OUT); c.r(24 + x, hy - 2, 2, 2, OUT); c.r(20 + x, hy - 2, 2, 1, eye); c.p(24 + x, hy - 2, eye)
    c.r(25 + x, hy + 1, 4, 4, DRAW); c.r(27 + x, hy + 4, 3, 7, DRAW); c.r(25 + x, hy + 10, 4, 2, DRAW)   # 코끼리 코
    c.pts([(27 + x, hy + 5), (28 + x, hy + 5), (27 + x, hy + 7), (28 + x, hy + 7), (27 + x, hy + 9), (28 + x, hy + 9)], INK); c.col(29 + x, hy + 4, hy + 10, INK); c.col(27 + x, hy + 2, hy + 4, WINTER); c.col(26 + x, hy + 1, hy + 3, WINTER)
    c.pts([(30 + x, hy + 10), (31 + x, hy + 9), (31 + x, hy + 8), (30 + x, hy + 11)], DRAW)
    c.pts([(24 + x, hy + 4), (23 + x, hy + 5), (24 + x, hy + 5), (23 + x, hy + 6)], WHITE)
    c.pts([(12 + x, 20 + b), (14 + x, 19 + b), (16 + x, 21 + b)], PINK if up else LOSE)                  # 달아오른 배
    if up:                                                                                               # 앞발을 든다
        c.r(17 + x, 15, 7, 5, DRAW); c.row(15, 17 + x, 23 + x, WINTER); c.row(19, 17 + x, 23 + x, INK)
        c.r(22 + x, 14, 4, 7, INK); c.pts([(26 + x, 15), (26 + x, 17), (26 + x, 19)], WHITE)
        c.r(8 + x, 14, 7, 4, DRAW); c.row(14, 8 + x, 14 + x, WINTER); c.row(17, 8 + x, 14 + x, INK)
        c.r(6 + x, 13, 3, 6, INK); c.pts([(5 + x, 14), (5 + x, 16), (5 + x, 18)], WHITE)


def e_iron(c, f):
    dy = -2 if f == 3 else 0
    c.row(14, 2, 13, DRAW)
    c.grid(1, 6 + dy, [
        '.....bb.......',
        '....bBBb..dd..',
        '..ddbBBbbdDDd.',
        '.dDDdbbbbdDDd.',
        'ddDDddiiiidddd',
        'diiddiIIiidiid',
        'iiIIiiIIiiiIIi',
        '.iiiiiiiiiiii.',
    ], {'b': BLADE, 'B': WHITE, 'd': DRAW, 'D': WINTER, 'i': INK, 'I': PIT_I})
    c.r(9, 3 + dy, 3, 3, DRAW); c.p(10, 4 + dy, PIT); c.pts([(9, 2 + dy), (11, 2 + dy), (12, 4 + dy)], DRAW)     # 톱니
    c.pts([(3, 6 + dy), (3, 5 + dy), (2, 4 + dy), (2, 3 + dy)], BLADE)                                        # 못
    c.pts([(4, 11 + dy), (10, 12 + dy), (7, 9 + dy)], TRACK_D)                                                # 녹
    if f == 1:
        c.pts([(6, 7), (12, 8)], WHITE)
    if f == 2:
        c.pts([(6, 10), (9, 11), (12, 10), (4, 9)], PINK); c.pts([(7, 10), (11, 11)], PRIM)
    if f == 3:
        c.pts([(1, 3), (14, 2), (8, 0), (0, 9), (15, 8)], BLADE)


# =====================================================================
# 6~10구역 적 — 같은 뼈대를 여러 적이 나눠 쓴다
# =====================================================================
def imp_base(c, f, body, hi, shade, horns=PRIM, cloth=PRIM_D, x0=3, hit_eye=WHITE):
    """도깨비 몸 (큰 머리 한 덩어리). (x, b, lean) 을 돌려준다"""
    b = 1 if f == 1 else 0
    lean = -1 if f == 3 else 0
    x = x0 + lean
    c.r(x + 1, 13, 2, 2, body); c.r(x + 5, 13, 2, 2 - b, body)
    c.r(x, 4 + b, 9, 9 - b, body); c.row(3 + b, x + 1, x + 7, body)
    c.row(4 + b, x + 1, x + 6, hi); c.col(x, 5 + b, 8, hi)
    c.col(x + 8, 6 + b, 12, shade)
    for hx_ in (x + 2, x + 6):
        c.col(hx_, 1 + b, 2 + b, horns)
    eye = hit_eye if f == 3 else PRIM if f == 2 else OUT
    c.r(x + 4, 6 + b, 1, 2, eye); c.r(x + 7, 6 + b, 1, 2, eye)
    if f == 2:
        c.pts([(x + 3, 5 + b), (x + 4, 5 + b), (x + 7, 5 + b), (x + 8, 5 + b)], OUT)
    c.row(9 + b, x + 3, x + 7, OUT); c.p(x + 4, 9 + b, WHITE); c.p(x + 7, 9 + b, WHITE)
    if cloth:
        c.r(x, 11, 9, 2, cloth)
    return x, b, lean


def bird_base(c, f, body, belly, cap, wing, tip1, tip2, beak, tail, eye=OUT, cheek=None):
    pal = {'w': wing, 'p': tip1, 'y': tip2}
    c.r(2, 9, 3, 2, tail); c.p(1, 9, tail)
    c.ell(8, 9, 4, 3.4, body); c.ell(8.5, 10.5, 2.8, 1.8, belly)
    c.ell(11, 7, 2.6, 2.6, body); c.row(5, 10, 12, cap)
    if cheek:
        c.p(11, 8, cheek)
    c.r(14, 7, 2, 1, beak)
    c.p(12, 6, WHITE if f == 3 else eye)
    if f == 2:
        c.grid(0, 5, ['yppwww..', '.ypwwww.'], pal)
    elif f in (0, 3):
        c.grid(4, 2, ['y.....', 'py....', 'ppw...', '.www..', '..www.'], pal)
    else:
        c.grid(4, 9, ['..www.', '.www..', 'ppw...', 'py....', 'y.....'], pal)


def blob_base(c, f, body, hi, sh, eye=OUT):
    sq = 1 if f in (1, 3) else -1 if f == 2 else 0
    top = 5 + sq
    c.ell(7.5, (top + 14) / 2, 5.4 + (0.7 if sq > 0 else 0), (14 - top) / 2 + 0.4, body)
    c.row(14, 3, 12, sh); c.pts([(2, 13), (13, 13)], sh)
    c.r(5, top + 2, 2, 1, hi); c.p(4, top + 3, hi)
    ey = top + 4
    c.r(8, ey, 1, 2, eye); c.r(11, ey, 1, 2, eye)
    c.row(ey + 3, 9, 10, OUT)
    return top


def general24(c, f, armor, a_hi, a_sh, helm, helm_hi, eye_col, boot, weapon, plume=None, shield=None, extra=None):
    """정예 무사 뼈대 (갑옷 · 투구 · 무기)"""
    b = 1 if f == 1 else 0
    x = 6 + (-1 if f == 3 else 0)
    if extra:
        extra(c, x, b, f, True)
    c.r(x + 1, 18, 4, 4, a_sh); c.r(x + 6, 18, 4, 4 - b, a_sh)
    c.r(x + 1, 21, 5, 2, boot); c.r(x + 6, 21 - b, 5, 2, boot)
    c.r(x, 10 + b, 11, 9 - b, armor); c.col(x, 10 + b, 18, a_hi); c.col(x + 10, 11 + b, 18, a_sh); c.row(18, x, x + 10, a_sh)
    c.row(13 + b, x + 1, x + 9, a_sh); c.row(16, x + 1, x + 9, a_sh)
    c.r(x + 4, 17, 3, 2, PRIM_D)
    c.r(x - 1, 9 + b, 4, 3, a_sh); c.row(9 + b, x - 1, x + 2, a_hi); c.r(x + 8, 9 + b, 4, 3, a_sh); c.row(9 + b, x + 8, x + 11, a_hi)
    c.r(x + 1, 2 + b, 9, 8, helm); c.row(1 + b, x + 2, x + 8, helm); c.row(2 + b, x + 2, x + 7, helm_hi); c.col(x + 1, 3 + b, 6 + b, helm_hi)
    c.r(x + 3, 5 + b, 7, 2, OUT)
    eye = WHITE if f == 3 else PINK if f == 2 else eye_col
    c.p(x + 5, 5 + b, eye); c.p(x + 8, 5 + b, eye)
    if plume:
        plume(c, x, b, f)
    if shield:
        c.r(x - 3, 11 + b, 4, 7, shield[0]); c.col(x - 3, 11 + b, 16 + b, shield[1]); c.p(x - 1, 14 + b, shield[2])
    weapon(c, x, b, f)
    if extra:
        extra(c, x, b, f, False)


def shear_paste(c, t, k):
    """t 를 줄마다 옆으로 밀어 c 에 그린다 (기울이기)"""
    for y in range(t.h):
        dx = k(y)
        for xx in range(t.w):
            if t.solid(xx, y):
                c.p(xx + dx, y, t.px[xx, y])


# ---- 6구역 "천둥 마루" ----
def e_drumimp(c, f):
    x, b, lean = imp_base(c, f, TEAM_A, SKY_M, SKY_D, horns=PRIM_L, cloth=None)
    c.ell(x + 4, 11.3, 3.4, 2.4, LOSE); c.ell(x + 4, 11.3, 2.2, 1.4, PANEL); c.p(x + 4, 11, PRIM)       # 배의 북
    if f == 2:                                                                                          # 북채를 치켜든다
        c.r(12, 2, 1, 6, INK); c.r(11, 0, 3, 2, PANEL_S); c.r(11, 8, 2, 2, TEAM_A); c.pts([(14, 3), (15, 1)], PRIM_L)
    else:
        c.r(13 + lean, 7 + b, 1, 5, INK); c.r(12 + lean, 5 + b, 3, 2, PANEL_S); c.r(12 + lean, 11, 2, 2, TEAM_A)


def e_thunderbird(c, f):
    bird_base(c, f, PRIM, PANEL_S, PRIM_D, PRIM_D, PRIM_L, WHITE, TRACK_D, PRIM_D)
    c.pts([(10, 4), (11, 3), (10, 2), (11, 1)], PRIM_L)                                                 # 번개 볏
    c.pts([(1, 10), (0, 11), (1, 12)], PRIM_L)
    if f == 2:
        c.pts([(0, 8), (1, 12), (3, 13), (15, 4)], WHITE)


def e_raincloud(c, f):
    b = 1 if f == 1 else 0
    flash = f == 2
    base, sh, hi = (WHITE, WINTER, WHITE) if flash else (DRAW, INK, WINTER)
    c.ell(5, 6 + b, 3.6, 3, base); c.ell(10, 6 + b, 4.2, 3.4, base); c.ell(7.5, 4 + b, 3.4, 2.8, base); c.r(3, 6 + b, 10, 3, base)
    c.row(9 + b, 3, 12, sh); c.pts([(2, 8 + b), (13, 8 + b)], sh); c.pts([(6, 3 + b), (7, 2 + b), (5, 4 + b)], hi)
    pupil = PINK if f == 3 else WHITE if flash else PRIM
    c.r(5, 6 + b, 2, 2, OUT); c.r(10, 6 + b, 2, 2, OUT); c.p(6, 6 + b, pupil); c.p(11, 6 + b, pupil)
    c.pts([(4, 4 + b), (5, 5 + b), (12, 4 + b), (11, 5 + b)], OUT); c.row(8 + b, 7, 9, OUT)
    if flash:
        c.pts([(8, 10), (7, 11), (8, 12), (9, 12), (8, 13), (7, 14)], PRIM_L); c.pts([(3, 12), (12, 13)], SKY_M)
    elif f == 1:
        c.pts([(5, 12), (5, 13), (9, 11), (9, 12), (13, 12), (13, 13)], SKY_M)
    else:
        c.pts([(4, 11), (4, 12), (8, 12), (8, 13), (12, 11), (12, 12)], SKY_M)


def e_flagspirit(c, f):
    b = 1 if f == 1 else 0
    glow = f == 2
    cloth, edge, bolt = (PRIM_L, WHITE, WHITE) if glow else (SKY_D, TEAM_A, PRIM_L)
    c.r(3, 1, 1, 14, INK); c.p(3, 0, PRIM); c.r(2, 14, 3, 1, PIT_I)
    for xx in range(4, 14):
        dy = 1 if (xx // 3 + b) % 2 else 0
        c.col(xx, 2 + dy, 9 + dy, cloth); c.p(xx, 2 + dy, edge); c.p(xx, 9 + dy, edge)
    c.pts([(8, 3), (7, 4), (6, 5), (7, 5), (8, 5), (7, 6), (6, 7)], bolt)
    eye = PINK if f == 3 else WHITE
    c.r(10, 5, 2, 2, eye); c.p(11, 6, OUT)
    c.pts([(13, 11), (13, 12)], PINK)
    if glow:
        c.pts([(15, 2), (14, 0), (1, 5), (15, 8), (9, 12)], PRIM_L)


def flail(c, x, b, f):
    if f == 2:                                                                                          # 쇠도리깨를 높이 든다
        c.r(x + 11, 4, 2, 9, INK); c.pts([(x + 12, 3), (x + 13, 2)], DRAW)
        c.r(x + 13, 0, 3, 3, BLADE); c.p(x + 14, 1, DRAW); c.pts([(x + 12, 0), (x + 16, 1), (x + 14, 3)], WHITE)
        c.pts([(x + 16, 4), (x + 17, 3)], PRIM_L)
    else:
        c.r(x + 11, 12 + b, 2, 4, INK); c.r(x + 12, 9 + b, 1, 3, INK); c.pts([(x + 13, 9 + b), (x + 14, 10 + b)], DRAW)
        c.r(x + 14, 11 + b, 3, 3, BLADE); c.p(x + 15, 12 + b, DRAW); c.pts([(x + 17, 12 + b), (x + 15, 14 + b), (x + 13, 12 + b)], WHITE)


def cloud_helm(c, x, b, f):
    c.ell(x + 3, 2 + b, 2.6, 2, DRAW); c.ell(x + 7.5, 1.5 + b, 3, 2, DRAW); c.pts([(x + 2, 1 + b), (x + 7, 0 + b)], WINTER)
    c.pts([(x + 5, 3 + b), (x + 9, 3 + b)], INK)


def e_thunder_general(c, f):
    general24(c, f, SKY_D, TEAM_A, PIT, INK, DRAW, PRIM_L, PIT, flail, plume=cloud_helm, shield=(PRIM_D, PRIM, WHITE))


def e_noegong(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    up = f == 2
    ring = Cv(32)
    ring.ell(15.5, 13, 13.4, 11.8, INK); ring.ell(15.5, 13, 12.2, 10.6, (0, 0, 0, 0)); ring.clear(0, 15, 32, 17)
    c.paste(ring, 0, 0)
    for dx_, dy_ in ((2, 12), (4, 5), (10, 1), (18, 1), (24, 5), (26, 12)):                              # 등에 두른 북
        c.ell(dx_ + 2, dy_ + 2, 2.7, 2.7, LOSE); c.ell(dx_ + 2, dy_ + 2, 1.5, 1.5, PANEL); c.p(dx_ + 2, dy_ + 2, PRIM)
    c.r(10 + x, 25, 5, 5, SKY_D); c.r(17 + x, 25, 5, 5 - b, SKY_D); c.r(9 + x, 28, 7, 3, PIT); c.r(16 + x, 28 - b, 7, 3, PIT)
    c.r(9 + x, 20 + b, 14, 6 - b, PRIM_D); c.pts([(11 + x, 22), (14 + x, 24), (17 + x, 22), (20 + x, 24), (12 + x, 25), (19 + x, 21 + b)], OUT)   # 호피
    c.r(10 + x, 13 + b, 12, 7, TEAM_A); c.col(10 + x, 13 + b, 19, SKY_T); c.col(21 + x, 14 + b, 19, SKY_D)
    c.pts([(14 + x, 16 + b), (15 + x, 17 + b), (16 + x, 17 + b), (17 + x, 16 + b), (15 + x, 19 + b), (16 + x, 19 + b)], SKY_D)
    c.r(9 + x, 19 + b, 14, 2, PINK); c.r(15 + x, 19 + b, 2, 3, PRIM)
    c.r(11 + x, 4 + b, 10, 9, TEAM_A); c.col(11 + x, 5 + b, 10 + b, SKY_T)
    c.r(10 + x, 1 + b, 12, 4, PINK); c.pts([(10 + x, b), (12 + x, b), (15 + x, b), (16 + x, b), (19 + x, b), (21 + x, b), (9 + x, 3 + b), (22 + x, 3 + b)], PINK)
    c.pts([(12 + x, 2 + b), (17 + x, 1 + b)], LOSE)
    c.r(12 + x, b, 2, 2, PRIM); c.r(18 + x, b, 2, 2, PRIM)                                                # 뿔
    eye = PINK if f == 3 else PRIM_L if up else WHITE
    c.r(13 + x, 7 + b, 2, 2, eye); c.r(17 + x, 7 + b, 2, 2, eye); c.p(14 + x, 8 + b, OUT); c.p(17 + x, 8 + b, OUT)
    c.row(6 + b, 12 + x, 14 + x, OUT); c.row(6 + b, 17 + x, 19 + x, OUT); c.p(15 + x, 7 + b, OUT); c.p(16 + x, 7 + b, OUT)
    c.r(12 + x, 11 + b, 8, 3, PINK); c.r(13 + x, 14 + b, 6, 2, PINK); c.r(14 + x, 16 + b, 4, 1, LOSE)     # 붉은 수염
    c.row(11 + b, 14 + x, 17 + x, OUT); c.pts([(14 + x, 11 + b), (17 + x, 11 + b)], WHITE)
    c.pts([(13 + x, 13 + b), (18 + x, 14 + b)], LOSE)
    if up:                                                                                               # 두 팔로 북채를 번쩍
        for ax in (5, 23):
            c.r(ax + x, 7, 4, 8, TEAM_A); c.col(ax + x, 7, 14, SKY_T); c.r(ax + 1 + x, 0, 1, 7, INK); c.r(ax + x, 0, 3, 2, PANEL_S)
        c.pts([(3, 1), (2, 3), (29, 1), (30, 3), (15, 0), (16, 0)], PRIM_L)
    else:
        for ax, sx in ((5, 4), (23, 27)):
            c.r(ax + x, 14 + b, 4, 6, TEAM_A); c.col(ax + x, 14 + b, 19 + b, SKY_T)
            c.r(sx + x, 17 + b, 1, 7, INK); c.r(sx - 1 + x, 23 + b, 3, 2, PANEL_S)


def e_drum(c, f):
    ring = f == 3
    glow = f == 2
    c.r(3, 12, 2, 3, INK); c.r(11, 12, 2, 3, INK); c.r(3, 13, 10, 1, PIT_I)
    c.ell(8, 7.5, 5.6, 5.2, PINK if glow else LOSE)
    c.ell(8, 7.5, 3.8, 3.6, WHITE if glow or ring else PANEL)
    c.pts([(4, 4), (12, 4), (3, 8), (13, 8), (4, 11), (12, 11), (8, 2)], PRIM)
    c.pts([(7, 6), (8, 6), (9, 7), (8, 7)], PINK); c.pts([(7, 8), (8, 8), (8, 9), (9, 9), (7, 7)], TEAM_A)
    if f == 1:
        c.p(6, 5, WHITE)
    if ring:                                                                                             # 울림
        c.pts([(1, 3), (0, 7), (1, 11), (14, 3), (15, 7), (14, 11), (5, 0), (10, 0)], WHITE)
    if glow:
        c.pts([(1, 2), (14, 1), (0, 9)], PRIM_L)


# ---- 7구역 "은하 나루" ----
def e_magpie(c, f):
    bird_base(c, f, PIT, WHITE, OUT, SKY_D, WHITE, WHITE, PIT_I, PIT, eye=WHITE)
    c.r(0, 10, 3, 1, PIT); c.p(9, 9, WHITE)


def e_starslime(c, f):
    top = blob_base(c, f, PRIM, WHITE, PRIM_D, eye=WHITE if f == 3 else OUT)
    c.pts([(4, 10), (11, 6 + (top - 5)), (6, 12)], PRIM_L)
    if f == 2:                                                                                           # 부푼다
        c.pts([(1, 5), (14, 4), (2, 12), (13, 12), (8, 1)], WHITE); c.pts([(0, 8), (15, 9)], PRIM_L)


STAR_S = ['....s....', '....s....', '...sss...', 'sssssssss', '.sssssss.', '..sssss..', '..sssss..', '.sss.sss.', '.s.....s.']
STAR_L = ['......s......', '.....sss.....', '.....sss.....', 'sssssssssssss', '.sssssssssss.', '..sssssssss..', '...sssssss...', '..sssssssss..', '..ssss.ssss..', '.sss.....sss.',
          '.s.........s.']


def e_starlet(c, f):
    b = 1 if f == 1 else 0
    c.grid(3, 3 + b, STAR_S, {'s': WHITE if f == 2 else PRIM_L})
    c.pts([(7, 6 + b), (7, 5 + b)], WHITE)
    eye = PINK if f == 3 else OUT
    c.p(6, 7 + b, eye); c.p(8, 7 + b, eye)
    if f == 2:
        c.pts([(1, 2), (13, 3), (2, 12), (12, 12)], PRIM_L)


def e_weaver(c, f):
    b = 1 if f == 1 else 0
    up = f == 2
    left = [[(4, 8), (3, 7), (2, 8), (1, 9)], [(4, 10), (3, 10), (2, 11), (1, 12)], [(5, 12), (4, 13), (3, 14)]]
    right = [[(12, 11), (13, 12), (14, 13)], [(12, 12), (12, 13), (12, 14)]]
    for i, leg in enumerate(left + right):
        c.pts([(px_, py_ + (b if i % 2 else 0)) for px_, py_ in leg], SKY_D)
    if up:                                                                                               # 앞발을 든다
        c.pts([(12, 8), (13, 6), (14, 5), (15, 3), (12, 7), (13, 5), (13, 4), (14, 2)], SKY_D)
    else:
        c.pts([(12, 9), (13, 9), (14, 10), (15, 11 + b), (12, 8), (13, 7), (14, 7), (15, 8 - b)], SKY_D)
    c.ell(6.5, 9, 3.8, 3.3, STUN); c.pts([(4, 11), (6, 12), (8, 12), (9, 11)], TEAM_A)
    c.r(5, 4, 4, 3, PANEL); c.row(5, 5, 8, PINK); c.col(4, 4, 6, LOG); c.col(9, 4, 6, LOG)                # 실꾸리
    c.ell(10.5, 10, 2.4, 2.2, STUN); c.row(12, 10, 11, TEAM_A)
    eye = WHITE if f == 3 else PINK
    c.p(10, 9, eye); c.p(12, 9, eye); c.p(12, 11, WHITE)


def e_comet(c, f):
    x, b, lean = imp_base(c, f, SKY_M, WHITE, BJ, horns=PRIM_L, cloth=TEAM_A, x0=6, hit_eye=PINK)
    pal = {'p': PINK, 'y': PRIM}
    if f == 2:                                                                                           # 웅크리고 꼬리가 커진다
        c.grid(0, 3, ['...pp.', '..pyp.', '.pyyp.', 'pyyyyp', '.pyyp.', '..pyp.', '...pp.'], pal)
    else:
        c.grid(1 + lean, 5 + b, ['..pp.', '.pyp.', 'pyyyp', '.pyp.', '..pp.'], pal)


def crow_weapon(c, x, b, f):
    if f == 2:
        c.r(x + 11, 9, 2, 3, PIT_I); c.row(8, x + 10, x + 13, PRIM_D); c.r(x + 11, 0, 2, 8, BLADE); c.col(x + 11, 0, 7, WHITE)
    else:
        c.r(x + 11, 13 + b, 2, 3, PIT_I); c.col(x + 13, 12 + b, 16 + b, PRIM_D); c.r(x + 14, 13 + b, 4, 2, BLADE); c.row(13 + b, x + 14, x + 17, WHITE)


def crow_helm(c, x, b, f):
    c.r(x + 10, 5 + b, 3, 2, PRIM_D); c.p(x + 13, 6 + b, PRIM_D); c.p(x + 10, 5 + b, PRIM)                # 부리
    c.pts([(x + 2, b), (x + 4, b), (x + 6, b), (x + 3, 1 + b), (x + 5, 1 + b)], PIT)


def crow_wings(c, x, b, f, behind):
    if f == 2 and behind:                                                                                # 날개를 펼친다
        c.grid(0, 3, ['pp......', 'wwpp....', '.wwwpp..', '..wwwww.', '...wwwww', '....wwww'], {'w': PIT, 'p': SKY_D})
        c.grid(16, 3, ['......pp', '....ppww', '..ppwww.', '.wwwww..', 'wwwww...', 'wwww....'], {'w': PIT, 'p': SKY_D})


def e_crow_knight(c, f):
    general24(c, f, PIT, SKY_D, OUT, PIT, SKY_D, PRIM, OUT, crow_weapon, plume=crow_helm, extra=crow_wings)


def e_crow_king(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    sp = f == 2
    for lx_ in (11, 15, 19):                                                                             # 세 발
        c.r(lx_ + x, 25, 2, 5, PRIM_D); c.r(lx_ - 1 + x, 30, 4, 1, PRIM_D)
    c.r(4 + x, 20 + b, 6, 3, PIT); c.pts([(3 + x, 22 + b), (2 + x, 23 + b), (4 + x, 23 + b)], PIT)
    if sp:                                                                                               # 날개 활짝
        for sgn in (-1, 1):
            def X(v):
                return v if sgn < 0 else 31 - v
            for (x0, x1, y0) in ((0, 10, 6), (0, 9, 9), (1, 9, 12), (3, 9, 15), (5, 9, 18)):
                for xx in range(x0, x1 + 1):
                    c.r(X(xx), y0, 1, 3, PIT if y0 % 2 == 0 else PIT_I)
                c.p(X(x0), y0, PRIM_L); c.p(X(x0), y0 + 1, WHITE)
            c.pts([(X(2), 4), (X(5), 4)], SKY_D)
    c.ell(15.5 + x, 18 + b, 7.6, 7.8, PIT)
    c.pts([(10 + x, 14 + b), (9 + x, 16 + b), (9 + x, 18 + b), (11 + x, 12 + b)], SKY_D)
    c.pts([(14 + x, 19 + b), (15 + x, 20 + b), (16 + x, 19 + b), (13 + x, 22 + b), (14 + x, 23 + b), (15 + x, 22 + b), (17 + x, 22 + b), (18 + x, 23 + b), (19 + x, 22 + b)], PIT_I)
    if not sp:
        c.ell(8 + x, 18 + b, 2.6, 6.4, PIT_I); c.ell(23 + x, 18 + b, 2.6, 6.4, PIT_I)
        c.pts([(7 + x, 24 + b), (8 + x, 25 + b), (23 + x, 25 + b), (24 + x, 24 + b)], PRIM_L); c.pts([(8 + x, 24 + b), (23 + x, 24 + b)], WHITE)
    c.ell(15.5 + x, 8 + b, 4.8, 4.5, PIT); c.pts([(12 + x, 6 + b), (13 + x, 5 + b)], SKY_D)
    c.r(13 + x, 2 + b, 6, 2, PRIM); c.pts([(13 + x, 1 + b), (15 + x, b), (16 + x, b), (18 + x, 1 + b)], PRIM); c.p(15 + x, 2 + b, PINK); c.row(3 + b, 13 + x, 18 + x, PRIM_D)   # 금관
    c.r(20 + x, 8 + b, 3, 2, PRIM_D); c.p(23 + x, 9 + b, PRIM_D); c.p(20 + x, 8 + b, PRIM)
    eye = WHITE if f == 3 else PRIM_L if sp else PINK
    c.r(14 + x, 7 + b, 2, 2, eye); c.r(18 + x, 7 + b, 2, 2, eye)


# ---- 8구역 "서천 꽃밭" ----
def e_thornhand(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    c.r(4, 13, 8, 2, INK); c.row(13, 5, 10, LOG)
    c.r(6 + x, 8, 4, 6, WIN); c.col(6 + x, 8, 13, MAT_L); c.col(9 + x, 8, 13, MAT_D); c.pts([(5 + x, 10), (10 + x, 11), (5 + x, 12)], PANEL)
    c.r(5 + x, 5, 6, 4, WIN)
    if f == 2:                                                                                           # 손가락을 벌린다
        c.pts([(4, 4), (3, 3), (2, 2), (11, 4), (12, 3), (13, 2), (11, 7), (12, 7), (13, 6), (4, 7), (3, 7), (2, 6)], WIN); c.r(7, 1, 2, 4, WIN)
        c.pts([(2, 1), (13, 1), (7, 0), (14, 5), (1, 5)], PANEL)
    else:
        c.r(5 + x, 3 + b, 1, 2, WIN); c.r(7 + x, 2 + b, 2, 3, WIN); c.r(10 + x, 3 + b, 1, 2, WIN); c.r(11 + x, 6, 2, 1, WIN)
        c.pts([(5 + x, 2 + b), (10 + x, 2 + b), (13 + x, 6)], PANEL)
    c.r(7 + x, 6, 2, 2, OUT); c.p(8 + x, 6, WHITE if f == 3 else PRIM)


def e_butterfly(c, f):
    op = f in (0, 2)
    if op:
        c.ell(4, 6, 3, 3, PINK); c.ell(11.5, 6, 3, 3, PINK); c.ell(4.5, 10.5, 2.4, 2.2, PRIM); c.ell(11, 10.5, 2.4, 2.2, PRIM)
        c.pts([(3, 5), (12, 5)], WHITE); c.pts([(4, 7), (11, 7)], SUMMER); c.pts([(4, 11), (11, 11)], PRIM_L)
    else:
        c.ell(5, 6.5, 2, 3, PINK); c.ell(10.5, 6.5, 2, 3, PINK); c.ell(5.5, 10.5, 1.6, 2, PRIM); c.ell(10, 10.5, 1.6, 2, PRIM)
        c.pts([(5, 5), (10, 5)], WHITE)
    c.r(7, 5, 2, 7, PIT_I); c.r(7, 4, 2, 1, PIT_I); c.pts([(6, 3), (5, 2), (9, 3), (10, 2)], PIT_I)
    c.p(7, 5, WHITE if f != 3 else PINK); c.p(8, 5, WHITE if f != 3 else PINK)
    if f == 2:
        c.pts([(1, 2), (14, 2), (0, 10), (15, 12), (8, 14)], PRIM_L)


def e_beetle(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    low = f == 2
    dy = 1 if low else 0
    c.r(3 + x, 13, 2, 2, PIT); c.r(7 + x, 13, 2, 2, PIT); c.r(10 + x, 13, 2, 2 - b, PIT)
    c.ell(7 + x, 9 + dy, 5.4, 4 - dy * 0.6, WIN)
    c.pts([(4 + x, 7 + dy), (5 + x, 6 + dy), (6 + x, 6 + dy)], MAT_L); c.col(7 + x, 6 + dy, 12, MAT_D); c.row(12, 4 + x, 10 + x, MAT_D)
    c.r(11 + x, 8 + dy, 3, 4, PIT_I); c.p(12 + x, 9 + dy, WHITE if f == 3 else PRIM)
    if low:
        c.pts([(14, 10), (15, 10), (15, 9), (15, 11), (14, 9)], PIT_I)
    else:
        c.pts([(13 + x, 7), (14 + x, 6), (14 + x, 5), (15 + x, 4), (13 + x, 4), (14 + x, 4)], PIT_I)


def e_fairy(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    c.ell(4 + x, 7 + b, 2.6, 3, SKY_M); c.ell(12 + x, 7 + b, 2.6, 3, SKY_M); c.pts([(3 + x, 6 + b), (12 + x, 6 + b)], WHITE)
    c.grid(4 + x, 9 + b, ['..pppp..', '.pPppPp.', 'pPppppPp', 'pp.pp.pp'], {'p': PINK, 'P': SUMMER})
    c.pts([(7 + x, 13 + b), (9 + x, 13 + b)], SKIN)
    c.r(7 + x, 7 + b, 3, 2, WIN)
    c.r(6 + x, 2 + b, 5, 5, SKIN); c.r(6 + x, 1 + b, 5, 2, PRIM_D); c.p(5 + x, 3 + b, PRIM_D); c.p(11 + x, 3 + b, PRIM_D); c.p(8 + x, b, PINK)
    eye = PINK if f == 3 else OUT
    c.p(7 + x, 4 + b, eye); c.p(9 + x, 4 + b, eye)
    if f == 2:                                                                                           # 팔을 벌린다
        c.pts([(5, 7), (4, 6), (11, 7), (12, 6)], SKIN); c.pts([(2, 2), (14, 2), (14, 11), (1, 11), (8, 15)], PRIM_L)
    else:
        c.p(6 + x, 8 + b, SKIN); c.p(10 + x, 8 + b, SKIN)


def e_peacock(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    fan = f == 2
    if fan:                                                                                              # 꼬리를 편다
        c.ell(11, 10, 10.5, 9.5, PRIM)
        for px_, py_ in ((2, 9), (4, 4), (8, 2), (13, 2), (17, 4), (19, 9)):
            c.r(px_ - 1, py_ - 1, 4, 4, WIN); c.r(px_, py_, 2, 2, TEAM_A); c.p(px_, py_, WHITE)
        c.pts([(6, 8), (7, 10), (9, 6), (10, 9), (13, 6), (13, 9), (16, 8), (15, 10), (5, 13), (17, 13)], PRIM_D)
    else:
        c.grid(x, 12 + b, ['dddddd....', '.dTdTddd..', '..dddTdddd', '....dddd..'], {'d': PRIM_D, 'T': TEAM_A})
    c.r(11 + x, 19, 1, 4, TRACK_D); c.r(14 + x, 19, 1, 4 - b, TRACK_D); c.r(11 + x, 22, 3, 1, TRACK_D); c.r(14 + x, 22 - b, 3, 1, TRACK_D)
    c.ell(12 + x, 15 + b, 4.6, 4.2, PRIM); c.ell(11 + x, 15.5 + b, 2.6, 2.2, PRIM_D); c.pts([(14 + x, 17 + b), (15 + x, 16 + b)], PRIM_L)
    c.r(14 + x, 7 + b, 3, 7, PRIM); c.col(14 + x, 8 + b, 12 + b, PRIM_L)
    c.ell(16 + x, 6 + b, 2.6, 2.4, PRIM_L)
    c.pts([(15 + x, 2 + b), (16 + x, 1 + b), (17 + x, 2 + b), (16 + x, 3 + b), (15 + x, 1 + b), (17 + x, 1 + b)], TEAM_A); c.p(16 + x, 1 + b, WIN)
    c.r(19 + x, 6 + b, 2, 1, TRACK_D)
    c.p(17 + x, 5 + b, PINK if f == 3 else OUT)


def e_ggotgamgwan(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    sw = f == 2
    c.r(10 + x, 28, 5, 3, PIT); c.r(17 + x, 28 - b, 5, 3, PIT)
    c.r(9 + x, 13 + b, 14, 15 - b, WIN); c.r(8 + x, 22, 16, 6, WIN)                                       # 녹색 도포
    c.col(12 + x, 21, 27, MAT_D); c.col(19 + x, 21, 27, MAT_D); c.row(27, 8 + x, 23 + x, MAT_D); c.col(9 + x, 14 + b, 21, MAT_L)
    c.pts([(14 + x, 13 + b), (15 + x, 14 + b), (16 + x, 15 + b), (18 + x, 13 + b), (17 + x, 14 + b)], PANEL)
    c.r(9 + x, 19 + b, 14, 1, PINK); c.r(15 + x, 19 + b, 2, 4, PRIM)
    c.r(11 + x, 5 + b, 10, 8, SKIN); c.col(11 + x, 5 + b, 8 + b, PIT); c.col(20 + x, 5 + b, 8 + b, PIT)
    eye = PINK if f == 3 else OUT
    c.r(13 + x, 8 + b, 2, 2, eye); c.r(17 + x, 8 + b, 2, 2, eye); c.pts([(12 + x, 10 + b), (20 + x, 10 + b)], PINK)
    c.row(11 + b, 14 + x, 17 + x, PIT_I); c.pts([(15 + x, 12 + b), (16 + x, 12 + b)], PIT_I)
    c.r(6 + x, 4 + b, 20, 2, PIT); c.r(11 + x, b, 10, 4, PIT); c.row(3 + b, 11 + x, 20 + x, PINK); c.row(4 + b, 7 + x, 24 + x, PIT_I)   # 갓
    for fx, fy in ((8, 3), (23, 3), (15, 0)):                                                            # 갓의 꽃
        c.pts([(fx + x, fy - 1 + b), (fx - 1 + x, fy + b), (fx + 1 + x, fy + b), (fx + x, fy + 1 + b)], PINK); c.p(fx + x, fy + b, PRIM)
    c.r(5 + x, 14 + b, 5, 8, WIN); c.r(5 + x, 21 + b, 4, 1, PANEL); c.r(6 + x, 22 + b, 2, 2, SKIN)
    blossoms = lambda pts: [(c.pts([(px_, py_ - 1), (px_ - 1, py_), (px_ + 1, py_), (px_, py_ + 1)], PINK), c.p(px_, py_, PRIM)) for px_, py_ in pts]
    if sw:                                                                                               # 꽃가지를 휘두른다
        c.r(22 + x, 6, 5, 8, WIN); c.r(23 + x, 4, 3, 3, SKIN)
        c.r(3 + x, 2, 23, 1, INK); c.pts([(4 + x, 1), (8 + x, 3), (12 + x, 1)], INK)
        blossoms([(3, 2), (8, 1), (13, 3), (28, 2)]); c.pts([(29, 6), (30, 9), (1, 6), (27, 0), (31, 4)], PINK); c.pts([(6, 3), (10, 1)], WIN)
    else:
        c.r(22 + x, 14 + b, 5, 6, WIN); c.r(24 + x, 19 + b, 3, 2, SKIN)
        c.r(27 + x, 7, 1, 24, INK); c.pts([(26 + x, 9), (28 + x, 12), (26 + x, 6)], INK)
        blossoms([(27 + x, 5), (25 + x, 8), (29 + x, 11), (28 + x, 2)]); c.pts([(26 + x, 12), (28 + x, 8)], WIN)


# ---- 9구역 "칠성 폭풍단" ----
def e_stormimp(c, f):
    x, b, lean = imp_base(c, f, DRAW, WINTER, INK, horns=LINE, cloth=SKY_D)
    if f == 2:                                                                                           # 바람 자루를 연다
        c.ell(12, 10, 2.4, 2.8, PANEL_S); c.r(12, 6, 3, 2, LINE); c.p(13, 6, PIT)
        c.pts([(13, 4), (14, 3), (15, 3), (12, 2), (13, 1), (14, 0), (15, 5), (11, 4)], WHITE); c.pts([(12, 3), (14, 1)], SKY_M)
    else:
        c.ell(13 + lean, 9 + b, 2.4, 3, PANEL_S); c.p(13 + lean, 5 + b, LINE); c.r(12 + lean, 6 + b, 2, 1, PINK); c.p(14 + lean, 10 + b, LINE)


def e_hailjar(c, f):
    b = 1 if f == 1 else 0
    c.ell(7.5, 9.5, 5.6, 4.8, PIT)
    c.col(3, 8, 11, PIT_I); c.pts([(4, 7), (4, 12)], PIT_I)
    c.r(6, 5, 4, 1, OUT)
    c.r(5, 3 + b, 6, 2, PIT_I); c.row(3 + b, 5, 10, INK); c.row(3 + b, 6, 9, OUT)
    c.pts([(9, 6), (10, 7), (10, 8), (11, 9), (10, 10), (5, 11), (6, 12), (6, 13)], DRAW)                  # 금
    eye = WHITE if f == 3 else SKY_M if f == 2 else PRIM
    c.r(6, 8, 2, 2, eye); c.r(9, 8, 2, 2, eye); c.p(7, 9, OUT); c.p(10, 9, OUT)
    c.row(12, 8, 9, DRAW)
    if f == 2:                                                                                           # 우박이 튄다
        for hx_, hy_ in ((5, 0), (9, 1), (12, 2), (2, 3), (14, 6)):
            c.r(hx_, hy_, 2, 2, WHITE); c.p(hx_ + 1, hy_ + 1, SKY_M)


def e_starshard(c, f):
    b = 1 if f == 1 else 0
    big = f == 2
    c.grid(1, 2 + b, STAR_L, {'s': WHITE if big else PRIM})
    if big:                                                                                              # 하얗게 커진다
        c.pts([(7, 1), (0, 5), (14, 5), (1, 13), (13, 13), (4, 4), (10, 4), (7, 12)], WHITE); c.pts([(0, 1), (14, 1), (15, 9), (0, 9)], PRIM_L)
    else:
        c.pts([(6, 4 + b), (7, 3 + b), (5, 6 + b), (4, 6 + b)], PRIM_L); c.pts([(9, 10 + b), (10, 9 + b)], PRIM_D)
    eye = PINK if f == 3 else OUT
    c.r(5, 7 + b, 1, 2, eye); c.r(9, 7 + b, 1, 2, eye); c.row(10 + b, 6, 8, OUT if not big else PRIM_D)


def e_hawk(c, f):
    bird_base(c, f, DRAW, WINTER, INK, INK, PIT_I, PIT, PRIM, INK, eye=PRIM)
    c.p(15, 8, PRIM_D); c.pts([(7, 11), (9, 11)], INK)


def e_jangseung(c, f):
    t = Cv(24)
    t.r(8, 2, 8, 20, LOG); t.col(8, 3, 21, LOG_E); t.col(15, 3, 21, PIT_I); t.pts([(10, 18), (13, 20), (11, 21)], PIT_I)
    t.r(7, 1, 10, 3, INK); t.row(0, 9, 14, INK); t.row(1, 8, 15, LOG_E); t.r(7, 21, 10, 2, PIT_I)
    t.r(9, 6, 3, 3, WHITE); t.r(13, 6, 3, 3, WHITE)
    pupil = PINK if f >= 2 else OUT
    t.p(10, 7, pupil); t.p(14, 7, pupil); t.p(11, 7, pupil if f == 2 else WHITE); t.p(15, 7, pupil if f == 2 else WHITE)
    t.row(5, 9, 11, OUT); t.row(5, 13, 15, OUT); t.p(12, 6, OUT); t.p(8, 4, OUT); t.p(16, 4, OUT)
    t.r(11, 8, 2, 3, LOG_E); t.p(12, 10, PIT_I)
    t.r(8, 10, 2, 2, PINK); t.r(14, 10, 2, 2, PINK)
    t.r(9, 13, 6, 3, OUT); t.pts([(10, 13), (12, 13), (14, 13), (11, 15), (13, 15)], WHITE)
    t.pts([(11, 17), (12, 17), (12, 18), (11, 19), (12, 19)], OUT)
    if f == 2:                                                                                           # 앞으로 기울인다
        shear_paste(c, t, lambda y: (11 - y) // 4)
    else:
        shear_paste(c, t, lambda y: -1 if f == 3 else (1 if f == 1 and y < 8 else 0))


# ---- 10구역 "소원의 정상" ----
def e_skysoldier(c, f):
    b = 1 if f == 1 else 0
    lean = -1 if f == 3 else 0
    x = 3 + lean
    c.r(x + 1, 13, 2, 2, DRAW); c.r(x + 5, 13, 2, 2 - b, DRAW)
    c.r(x, 8 + b, 9, 5 - b, WHITE); c.col(x + 8, 8 + b, 12, BLADE); c.row(10 + b, x + 1, x + 7, BLADE); c.row(12, x, x + 8, PINK)
    c.r(x + 1, 4 + b, 7, 4, SKIN)
    eye = PINK if f == 3 else OUT
    c.p(x + 4, 5 + b, eye); c.p(x + 6, 5 + b, eye); c.p(x + 5, 7 + b, LOSE)
    c.r(x, 2 + b, 9, 2, WINTER); c.row(1 + b, x + 1, x + 7, WINTER); c.row(3 + b, x, x + 8, DRAW); c.row(1 + b, x + 2, x + 5, WHITE)
    c.r(x + 3, b, 2, 1, PINK); c.p(x + 2, b, PINK); c.p(x + 1, 1 + b, PINK)                                # 붉은 술
    if f == 2:                                                                                           # 창을 겨눈다
        c.r(5, 9, 9, 1, INK); c.pts([(15, 9), (14, 8), (14, 9), (14, 10)], BLADE); c.p(13, 10, PINK); c.r(10, 9, 2, 2, SKIN)
    else:
        c.r(13 + lean, 3, 1, 12, INK); c.r(13 + lean, 0, 1, 3, BLADE); c.p(12 + lean, 2, BLADE); c.p(14 + lean, 2, BLADE); c.p(14 + lean, 4, PINK)
        c.r(12 + lean, 9 + b, 2, 2, SKIN)


def e_crane(c, f):
    pal = {'w': WHITE, 'o': OUT, 's': BLADE}
    c.r(1, 10, 3, 1, PIT); c.p(0, 11, PIT)
    c.pts([(3, 8), (2, 8), (3, 9)], OUT)
    c.ell(7, 9, 4.2, 2.6, WHITE); c.row(11, 5, 9, BLADE)
    c.r(10, 7, 2, 2, WHITE); c.r(11, 5, 2, 3, WHITE); c.r(12, 3, 2, 3, WHITE); c.p(11, 6, OUT)
    c.r(12, 2, 2, 1, PINK)
    c.r(14, 4, 2, 1, PRIM_D)
    c.p(13, 4, PINK if f == 3 else OUT)
    if f == 2:
        c.grid(0, 5, ['oowwww..', '.oswwww.'], pal)
    elif f in (0, 3):
        c.grid(3, 2, ['.o....', 'ow....', '.ww...', '.sww..', '..www.'], pal)
    else:
        c.grid(3, 10, ['..www.', '.sww..', '.ww...', 'ow....', '.o....'], pal)


def e_lantern(c, f):
    b = 1 if f == 1 else 0
    glow = f == 2
    c.p(8, 1 + b, INK)
    c.ell(8, 8 + b, 4.6, 4.6, WHITE if glow else PINK)
    c.col(6, 5 + b, 11 + b, PANEL if glow else LOSE); c.col(10, 5 + b, 11 + b, PANEL if glow else LOSE)
    c.pts([(5, 6 + b), (5, 7 + b)], PANEL_S if glow else SUMMER)
    c.r(6, 3 + b, 5, 1, PRIM); c.r(7, 2 + b, 3, 1, PRIM_D); c.r(6, 13 + b, 5, 1, PRIM)
    if not b:
        c.p(8, 14, PINK)
    eye = WHITE if f == 3 else OUT
    c.r(7, 7 + b, 1, 2, eye); c.r(9, 7 + b, 1, 2, eye)
    if glow:                                                                                             # 하얗게 빛난다
        c.pts([(1, 8), (14, 8), (2, 3), (13, 3), (2, 13), (13, 13), (8, 0)], PRIM_L); c.pts([(0, 8), (15, 8)], WHITE)


def e_jadelion(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    low = f == 2
    dy = 1 if low else 0
    h = 2 if low else 3
    c.r(6 + x, 15 - h, 1, h, MAT_D); c.r(11 + x, 15 - h, 1, h, MAT_D)
    c.r(4 + x, 15 - h, 2, h, POKER); c.r(9 + x, 15 - h, 2, h - b, POKER)
    c.r(3 + x, 8 + dy, 9, 4, POKER); c.row(11 + dy, 4 + x, 10 + x, MAT_D); c.row(8 + dy, 4 + x, 9 + x, AUTUMN)
    c.ell(2 + x, 6 + dy, 1.8, 1.8, AUTUMN); c.p(3 + x, 8 + dy, POKER)
    hy = 7 + dy * 2 + b
    c.ell(11 + x, hy, 3.9, 3.9, AUTUMN); c.pts([(8 + x, hy - 2), (9 + x, hy + 3), (12 + x, hy - 4), (14 + x, hy + 3), (8 + x, hy + 1)], MAT_D)
    c.r(10 + x, hy - 1, 4, 4, POKER); c.r(13 + x, hy + 1, 2, 2, POKER); c.p(15 + x, hy + 1, OUT)
    c.p(12 + x, hy, WHITE if f == 3 else PRIM); c.row(hy + 3, 12 + x, 14 + x, OUT)
    if low:
        c.p(13 + x, hy + 3, WHITE)


def sky_sword(c, x, b, f):
    if f == 2:                                                                                           # 번개 칼을 치켜든다
        c.r(x + 11, 9, 2, 3, TRACK_D); c.row(8, x + 10, x + 13, PINK)
        c.pts([(x + 11, 7), (x + 12, 7), (x + 12, 6), (x + 13, 6), (x + 13, 5), (x + 12, 5), (x + 12, 4), (x + 11, 4), (x + 11, 3), (x + 12, 3), (x + 12, 2), (x + 13, 2), (x + 13, 1), (x + 12, 0)], PRIM_L)
        c.pts([(x + 12, 6), (x + 12, 4), (x + 12, 2)], WHITE); c.pts([(x + 15, 3), (x + 16, 1), (x + 9, 1)], PRIM_L)
    else:
        c.r(x + 11, 13 + b, 2, 3, TRACK_D); c.col(x + 13, 12 + b, 16 + b, PINK)
        c.pts([(x + 14, 14 + b), (x + 15, 14 + b), (x + 15, 13 + b), (x + 16, 13 + b), (x + 16, 14 + b), (x + 17, 14 + b), (x + 14, 13 + b)], PRIM_L); c.p(x + 15, 14 + b, WHITE)


def white_plume(c, x, b, f):
    c.r(x + 3, b, 4, 1, WHITE); c.r(x + 1, b, 3, 1, WHITE); c.p(x, 1 + b, WHITE); c.p(x + 4, 1 + b, BLADE); c.pts([(x - 1, 2 + b)], WHITE)


def e_skygeneral(c, f):
    general24(c, f, PRIM, PRIM_L, PRIM_D, PRIM, PRIM_L, SKY_D, TRACK_D, sky_sword, plume=white_plume, shield=(PINK, SUMMER, PRIM))


def e_eodugsini(c, f):
    b = 1 if f == 1 else 0
    x = -1 if f == 3 else 0
    reach = f == 2

    def half(y):
        if y < 6:
            return 4 + (y - 3) * 2
        w = 8 + (y - 6) * 0.42 if y <= 30 else 18.1 + (y - 30) * 0.36
        return w + (1 if (y // 3 + b) % 2 else 0)
    for y in range(3, 46):
        w = half(y)
        c.row(y, int(24 - w) + x, int(23 + w) + x, PIT)
        if y > 8:
            c.row(y, int(24 - w) + 3 + x, int(23 + w) - 3 + x, OUT)
        c.p(int(24 - w) + x, y, PIT_I)
    c.row(3, 22 + x, 25 + x, PIT_I); c.row(4, 19 + x, 21 + x, PIT_I); c.row(5, 17 + x, 18 + x, PIT_I)
    for i, tx in enumerate(range(1, 46, 4)):                                                             # 아래로 흘러내리는 그림자
        ln = 1 + (i + b) % 2
        c.r(tx + x, 45, 2, ln, PIT)
    c.pts([(7, 30), (5, 34), (40, 31), (43, 36), (12, 24), (36, 22), (3, 40), (44, 41)], PIT_I)
    c.pts([(9, 12), (38, 10), (6, 20), (41, 18)], INK if not reach else SKY_D)                            # 흩날리는 먹빛
    # 팔
    if reach:                                                                                            # 손을 뻗는다
        for sgn in (-1, 1):
            def X(v):
                return v if sgn < 0 else 47 - v
            for i in range(9):
                c.r(min(X(12 - i), X(12 - i + 3)), 23 - i, 4, 3, PIT)
            c.pts([(X(1), 12), (X(0), 10), (X(2), 10), (X(4), 11), (X(3), 13)], PIT); c.pts([(X(0), 9), (X(2), 9), (X(4), 10)], WHITE)
    else:
        for sgn in (-1, 1):
            def X(v):
                return v if sgn < 0 else 47 - v
            c.r(min(X(8), X(11)) + x, 22 + b, 4, 10, PIT); c.r(min(X(6), X(11)) + x, 31 + b, 6, 3, PIT)
            c.pts([(X(6) + x, 34 + b), (X(8) + x, 34 + b), (X(10) + x, 34 + b)], INK)
    # 하얀 눈 셋
    if f == 3:
        c.r(17 + x, 15, 4, 1, WHITE); c.r(27 + x, 15, 4, 1, WHITE); c.r(22 + x, 9, 4, 1, WHITE)
    else:
        c.r(17 + x, 14, 4, 3, WHITE); c.r(27 + x, 14, 4, 3, WHITE); c.r(22 + x, 8, 4, 3, WHITE)
        c.pts([(16 + x, 15), (21 + x, 15), (26 + x, 15), (31 + x, 15), (21 + x, 9), (26 + x, 9)], SKY_M)
        if reach:
            c.pts([(18 + x, 15), (19 + x, 15), (28 + x, 15), (29 + x, 15), (23 + x, 9), (24 + x, 9)], PINK)
            c.pts([(20, 21), (22, 22), (24, 21), (26, 22), (28, 21)], WHITE)


def e_wishlight(c, f):
    lit = f == 3
    pal = {'p': PINK, 'P': PANEL_S if lit else SUMMER}
    c.row(14, 3, 12, WIN); c.pts([(2, 13), (13, 13)], WIN)
    c.grid(1, 7, ['..p...pp...p..', '.pPp.pPPp.pPp.', '.pPPppPPppPPp.', 'ppPPPpPPpPPPpp', 'pPPPPPPPPPPPPp', '.ppPPPPPPPPpp.', '...pppppppp...'], pal)
    if lit:                                                                                              # 환하게 켜진다
        c.grid(5, 1, ['..y..', '.yWy.', 'yWWWy', 'yWWWy', '.yWy.', '..y..'], {'y': PRIM_L, 'W': WHITE})
        c.pts([(1, 2), (14, 2), (2, 5), (13, 5), (8, 0), (0, 8), (15, 8)], WHITE)
    else:
        c.r(7, 4, 2, 4, INK); c.p(7, 3, DRAW)
        if f == 2:
            c.r(7, 2, 2, 2, PRIM); c.p(7, 1, PRIM_L); c.pts([(4, 2), (11, 3)], PRIM_L)
        elif f == 1:
            c.p(8, 3, PRIM_D)


# ---- 6~10구역 투사체 (지금은 GameScene 이 코드로 그린다 — 파일을 읽게 되면 proj/<이름>.png) ----
def draw_projectiles():
    out = {}
    c = Cv(8, 8)                                                        # 거미줄
    c.pts([(1, 1), (6, 1), (1, 6), (6, 6), (2, 2), (5, 2), (2, 5), (5, 5)], LINE)
    c.row(3, 0, 7, WHITE); c.row(4, 0, 7, WHITE); c.col(3, 0, 7, WHITE); c.col(4, 0, 7, WHITE)
    c.pts([(2, 1), (5, 1), (1, 2), (6, 2), (1, 5), (6, 5), (2, 6), (5, 6)], WHITE); c.r(3, 3, 2, 2, LINE)
    out['web'] = c
    c = Cv(10, 6)                                                       # 까마귀 깃
    c.grid(0, 0, ['..........', '.pppppp...', 'wsssssppy.', '.pppppp...', '..........', '..........'], {'p': PIT, 's': SKY_D, 'w': WHITE, 'y': PRIM_L})
    c.outline()
    out['crowfeather'] = c
    c = Cv(6, 6)                                                        # 꽃가루
    c.r(1, 1, 4, 4, PRIM_L); c.r(2, 2, 2, 2, PRIM); c.p(2, 2, WHITE)
    c.outline(PRIM_D)
    out['pollen'] = c
    c = Cv(8, 6)                                                        # 꽃잎
    c.grid(0, 0, ['........', '..ppp...', '.pPPppp.', '..ppp...', '........', '........'], {'p': PINK, 'P': SUMMER})
    c.outline()
    out['petal'] = c
    c = Cv(12, 12)                                                      # 폭풍
    c.ell(5.5, 5.5, 4.6, 4.6, SKY_D)
    c.pts([(3, 3), (4, 2), (5, 2), (6, 2), (7, 3), (8, 4), (8, 5), (7, 7), (6, 8), (5, 8), (3, 6), (3, 5)], TEAM_A)
    c.pts([(5, 4), (6, 4), (5, 5), (4, 6), (5, 6), (6, 6), (5, 7)], PRIM_L); c.p(5, 5, WHITE)
    c.outline()
    out['storm'] = c
    c = Cv(10, 10)                                                      # 그림자
    c.ell(4.5, 4.5, 3.7, 3.7, PIT); c.ell(4.5, 5, 2.4, 2.4, OUT)
    c.pts([(3, 4), (6, 4)], WHITE); c.pts([(2, 2), (7, 2), (1, 5), (8, 6)], PIT_I)
    c.outline(INK)
    out['shade'] = c
    return out


# ---- 엔딩 그림 120×90 (별 하늘 · 탑 꼭대기 · 소원 구슬) ----
def draw_ending(chars, tile_sheets, with_hero=True):
    c = Cv(120, 90, OUT)
    seed = 20261125
    for y in range(34, 62):                                             # 지평선 쪽 푸른 빛
        for xx in range(120):
            if (xx + y) % 2 == 0 and (xx * 7 + y * 13) % 7 < (y - 34) // 4:
                c.p(xx, y, SKY_D)
    for i in range(70):                                                 # 별 (정해진 수열)
        seed = (seed * 1103515245 + 12345) % (1 << 31)
        sx, sy = (seed >> 8) % 120, (seed >> 16) % 70
        col = [WHITE, WHITE, PRIM_L, STUN, SKY_M][i % 5]
        c.p(sx, sy, col)
        if i % 9 == 0:
            c.pts([(sx - 1, sy), (sx + 1, sy), (sx, sy - 1), (sx, sy + 1)], col)
    c.ell(98, 14, 6, 6, PANEL_S); c.ell(100.5, 12.5, 5, 5, OUT)         # 초승달
    wish = tile_sheets['wish'].im
    tile = lambda k: wish.crop((TILE_ORDER.index(k) * 16, 0, TILE_ORDER.index(k) * 16 + 16, 16))
    for i in range(8):                                                  # 옥빛 궁궐 꼭대기
        c.im.paste(tile('floor' if i % 3 else 'floor2'), (i * 16 - 4, 62))
        c.im.paste(tile('wallFace'), (i * 16 - 4, 78))
    c.px = c.im.load()
    c.row(61, 0, 119, PRIM_D)
    ox, oy = (66, 50) if with_hero else (60, 36)
    for rr, col in ((15, SKY_D), (11, PRIM_D), (8, PRIM)):              # 구슬 빛
        for y in range(-rr, rr + 1):
            for xx in range(-rr, rr + 1):
                if xx * xx + y * y <= rr * rr and (xx + y) % 2 == 0:
                    c.p(ox + xx, oy + y, col)
    for dx_, dy_ in ((0, -19), (0, 19), (-19, 0), (19, 0), (-14, -14), (14, -14), (-14, 14), (14, 14)):
        c.p(ox + dx_, oy + dy_, PRIM_L); c.p(ox + dx_ * 21 // 19, oy + dy_ * 21 // 19, WHITE)
    orb = Cv(14)
    orb.ell(6.5, 6.5, 5, 5, PRIM_L); orb.pts([(9, 9), (10, 8), (10, 7), (8, 10), (7, 10)], PRIM); orb.r(4, 3, 2, 2, WHITE); orb.p(6, 3, WHITE); orb.p(8, 8, PINK)
    orb.outline(PRIM_D)
    c.paste(orb, ox - 6, oy - 6)
    if with_hero:
        c.ell(58, 76, 8, 2, PRIM_D)
        for n in ('body_m', 'face_2', 'outfit_0', 'hair_m0'):           # 구슬을 들어 올린 대원 (아래 보기 · 공격 첫 칸)
            fr = Cv(F)
            fr.im = chars[n].im.crop((5 * F, 0, 6 * F, F)); fr.px = fr.im.load()
            c.paste(fr, 42, 46)
    return c


def heuk_base(c, f):
    b = 1 if f == 1 else 0
    lx = -1 if f == 3 else 0
    op = f == 2
    hy = b - (1 if op else 0)
    # 꼬리 끝
    c.pts([(3, 11 + b), (3, 12 + b), (2, 13 + b), (3, 13 + b), (2, 14 + b), (3, 14 + b), (4, 14 + b)], PIT)
    c.r(2, 15 + b, 4, 5, PIT); c.col(2, 15 + b, 19, INK)
    # 뒤 똬리
    c.ell(15.5, 19 + b, 12.5, 5, PIT_I)
    c.pts([(7, 17 + b), (11, 16 + b), (15, 16 + b), (20, 16 + b), (24, 17 + b)], PIT)
    # 목
    nx = 18 + lx
    c.r(nx, 8 + hy, 8, 13 - hy, PIT); c.col(nx, 9 + hy, 19, PIT_I); c.r(nx + 5, 11 + hy, 3, 9 - hy, DRAW)
    for yy in range(12 + hy, 20, 2):
        c.row(yy, nx + 5, nx + 7, INK)
    c.pts([(nx + 2, 12 + hy), (nx + 3, 15), (nx + 2, 18)], PIT_I)
    # 앞 똬리
    c.ell(15.5, 24.5, 14.2, 5.6, PIT)
    for y in range(27, 31):
        for x in range(1, 31):
            if ((x - 15.5) / 14.2) ** 2 + ((y - 24.5) / 5.6) ** 2 <= 1.0:
                c.p(x, y, DRAW if (x + 1) % 4 else INK)
    c.row(26, 3, 28, PIT_I)
    c.pts([(6, 20), (7, 20), (8, 19), (9, 19), (10, 19), (11, 19)], INK); c.pts([(3, 22), (4, 21)], INK)
    for x, y in ((6, 23), (10, 22), (14, 23), (18, 22), (22, 23), (26, 23), (8, 25), (12, 24), (16, 25), (20, 24), (24, 25)):   # 이끼 비늘
        c.p(x, y, PIT_I); c.p(x + 1, y, PIT_I); c.p(x, y - 1, SKY_D)
    # 머리
    h0 = 15 + lx
    c.ell(h0 + 7, 7 + hy, 7.4, 4.8, PIT)
    c.r(h0 + 9, 5 + hy, 7, 5, PIT); c.r(h0 + 15, 6 + hy, 1, 3, PIT)
    c.row(3 + hy, h0 + 4, h0 + 9, INK); c.pts([(h0 + 2, 5 + hy), (h0 + 3, 4 + hy)], INK)
    c.pts([(h0 + 3, 2 + hy), (h0 + 4, 1 + hy), (h0 + 7, 1 + hy), (h0 + 8, 2 + hy)], PRIM)           # 돋기 시작한 뿔
    c.pts([(h0 + 1, 7 + hy), (h0 + 2, 8 + hy), (h0 + 4, 9 + hy), (h0 + 5, 6 + hy), (h0 + 3, 6 + hy)], PIT_I)
    c.pts([(h0 + 2, 7 + hy), (h0 + 4, 5 + hy)], SKY_D)
    eye = WHITE if f == 3 else PINK if op else PRIM
    c.r(h0 + 8, 4 + hy, 4, 4, OUT); c.r(h0 + 9, 5 + hy, 3, 2, eye); c.p(h0 + 11, 5 + hy, WHITE if f == 3 else OUT); c.p(h0 + 9, 5 + hy, WHITE)
    c.p(h0 + 15, 6 + hy, PIT_I)
    if op:
        c.r(h0 + 8, 10 + hy, 8, 1, OUT); c.r(h0 + 9, 11 + hy, 7, 2, PINK); c.r(h0 + 8, 13 + hy, 7, 2, PIT); c.row(14 + hy, h0 + 8, h0 + 13, PIT_I)
        c.pts([(h0 + 10, 10 + hy), (h0 + 14, 10 + hy), (h0 + 13, 12 + hy)], WHITE); c.pts([(h0 + 11, 12 + hy), (h0 + 12, 12 + hy)], LOSE)
    else:
        c.row(10 + hy, h0 + 6, h0 + 14, DRAW)
        c.row(9 + hy, h0 + 9, h0 + 15, OUT); c.p(h0 + 8, 8 + hy, OUT); c.p(h0 + 12, 10 + hy, WHITE)


def e_heukryong(c, f):
    heuk_base(c, f)
    b = 1 if f == 1 else 0
    h0 = 15 + (-1 if f == 3 else 0)
    hy = b - (1 if f == 2 else 0)
    c.pts([(h0 + 3, 1 + hy), (h0 + 2, hy), (h0 + 1, hy), (h0 + 7, hy), (h0 + 8, hy), (h0 + 9, 1 + hy), (h0 + 4, 2 + hy), (h0 + 8, 2 + hy)], PRIM)   # 금빛 뿔
    c.pts([(h0 + 2, hy), (h0 + 8, hy)], PRIM_L)
    c.pts([(h0 + 14, 11 + hy), (h0 + 15, 12 + hy), (h0 + 16, 12 + hy), (h0 + 13, 12 + hy)], PRIM_L)                                               # 수염
    c.pts([(h0 + 1, 4 + hy), (h0, 6 + hy), (h0 + 1, 8 + hy), (19, 13), (18, 16)], SKY_D)                                                           # 갈기


ENEMIES = {'slime': (16, e_slime), 'bat': (16, e_bat), 'spitter': (16, e_spitter), 'goblin': (16, e_goblin), 'knight': (24, e_knight), 'golem': (32, e_golem),
           'sprout': (16, e_sprout), 'moth': (16, e_moth), 'lizard': (16, e_lizard), 'toad': (16, e_toad), 'treant': (24, e_treant), 'imugi': (32, e_imugi),
           'snowimp': (16, e_snowimp), 'icebat': (16, e_icebat), 'frostjar': (16, e_frostjar), 'wisp': (16, e_wisp), 'haetae': (24, e_haetae),
           'winterGeneral': (32, e_winter_general), 'icecrystal': (16, e_icecrystal),
           'ram': (16, e_ram), 'kite': (16, e_kite), 'chick': (16, e_chick), 'scarecrow': (16, e_scarecrow), 'geumgye': (24, e_geumgye), 'yeongdeung': (32, e_yeongdeung),
           'bulgae': (16, e_bulgae), 'torchimp': (16, e_torchimp), 'wildcat': (16, e_wildcat), 'sparrow': (16, e_sparrow), 'hwacha': (24, e_hwacha),
           'bulgasari': (32, e_bulgasari), 'iron': (16, e_iron),
           'drumimp': (16, e_drumimp), 'thunderbird': (16, e_thunderbird), 'raincloud': (16, e_raincloud), 'flagspirit': (16, e_flagspirit),
           'thunderGeneral': (24, e_thunder_general), 'noegong': (32, e_noegong), 'drum': (16, e_drum),
           'magpie': (16, e_magpie), 'starslime': (16, e_starslime), 'starlet': (16, e_starlet), 'weaver': (16, e_weaver), 'comet': (16, e_comet),
           'crowKnight': (24, e_crow_knight), 'crowKing': (32, e_crow_king),
           'thornhand': (16, e_thornhand), 'butterfly': (16, e_butterfly), 'beetle': (16, e_beetle), 'fairy': (16, e_fairy), 'peacock': (24, e_peacock),
           'ggotgamgwan': (32, e_ggotgamgwan),
           'stormimp': (16, e_stormimp), 'hailjar': (16, e_hailjar), 'starshard': (16, e_starshard), 'hawk': (16, e_hawk), 'jangseung': (24, e_jangseung),
           'heukryong': (32, e_heukryong),
           'skysoldier': (16, e_skysoldier), 'crane': (16, e_crane), 'lantern': (16, e_lantern), 'jadelion': (16, e_jadelion), 'skygeneral': (24, e_skygeneral),
           'eodugsini': (48, e_eodugsini), 'wishlight': (16, e_wishlight)}
ZONE3 = ['snowimp', 'icebat', 'frostjar', 'wisp', 'icecrystal', 'haetae', 'winterGeneral']
ZONE4 = ['ram', 'kite', 'chick', 'scarecrow', 'geumgye', 'yeongdeung']
ZONE5 = ['bulgae', 'torchimp', 'wildcat', 'sparrow', 'iron', 'hwacha', 'bulgasari']
ZONE6 = ['drumimp', 'thunderbird', 'raincloud', 'flagspirit', 'drum', 'thunderGeneral', 'noegong']
ZONE7 = ['magpie', 'starslime', 'starlet', 'weaver', 'comet', 'crowKnight', 'crowKing']
ZONE8 = ['thornhand', 'butterfly', 'beetle', 'fairy', 'peacock', 'ggotgamgwan']
ZONE9 = ['stormimp', 'hailjar', 'starshard', 'hawk', 'jangseung', 'heukryong']
ZONE10 = ['skysoldier', 'crane', 'lantern', 'jadelion', 'wishlight', 'skygeneral', 'eodugsini']


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
        if rel in SPRITECOOK:          # SpriteCook 그림(art/build.py)은 덮어쓰지 않는다 — 목록에만 올린다
            files.append(rel)
            return
        path = ART / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        cv.im.save(path)
        files.append(rel)

    spritecook_enemies = list(ENEMIES)[0:12] + ZONE3 + ZONE4 + ZONE5
    SPRITECOOK = {f'enemy/{e}.png' for e in spritecook_enemies} | {f'orb/{o}.png' for o in ORBS} | {THEME_FILES[t] for t in ('stone', 'moss', 'frost', 'cloud', 'ember')}
    chars = draw_chars()
    SPRITECOOK |= {f'char/{n}.png' for n in chars}
    order = ['body_m', 'body_f'] + [f'face_{i}' for i in range(4)] + [f'outfit_{i}' for i in range(4)] + [f'hair_m{i}' for i in range(4)] + [f'hair_f{i}' for i in range(4)]
    for n in order:
        save(chars[n], f'char/{n}.png')
    tile_sheets = {t: draw_tiles(t) for t in THEME_FILES}
    for t, f in THEME_FILES.items():
        save(tile_sheets[t], f)
    tiles = tile_sheets['stone']
    enemies = {e: draw_enemy(e) for e in ENEMIES}
    for e in ENEMIES:
        save(enemies[e], f'enemy/{e}.png')
    orbs = {o: draw_orb(o) for o in ORBS}
    for o in ORBS:
        save(orbs[o], f'orb/{o}.png')
    projs = draw_projectiles()
    for n, cv in projs.items():
        save(cv, f'proj/{n}.png')
    ending = draw_ending(chars, tile_sheets, True)
    save(ending, 'ending.png')
    save(draw_ending(chars, tile_sheets, False), 'ending-bg.png')
    # 로비 카드(shared/images/card-tower.png)는 SpriteCook 그림이다 — draw_card 는 부르지 않는다
    manifest = {
        '_note': 'public/art/ 에 넣은 그림 파일 목록 (여기 적힌 것만 불러온다). 1~5구역은 games/tower/art/build.py(SpriteCook), 6~10구역은 art/draw.py(손그림)가 만든다. ASSETS.md 참고',
        'files': files,
    }
    (ART / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(files)} files (SpriteCook {len(SPRITECOOK)} 은 그대로 둠) + manifest.json')

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
        lay = ['TTTTTTTTTTTTTTTTTTTTTT', 'FFFFDFFFFFFFFFFFFFFFFF', '.,.p....wwv.qQ.WWI.12.', '.c.C.o.O.ws.hH.WII.3.4', '..r.g.S.f.d.P.bBnN.56.', 'TTTTTLTTTTTTTT.RU..778']
        key = {'T': 'wallTop', 'F': 'wallFace', '.': 'floor', ',': 'floor2', 'p': 'pillar', 'w': 'water', 'v': 'vine', 's': 'switch', 'c': 'chest', 'C': 'chestOpen',
               'o': 'pedestal', 'O': 'pedestalEmpty', 'r': 'rock', 'g': 'gate', 'S': 'shop', 'f': 'fountain', 'd': 'fountainDry', 'D': 'doorOpen', 'L': 'doorLocked',
               'q': 'plate', 'Q': 'plateOn', 'h': 'brazier', 'H': 'brazierLit', 'P': 'post',
               'W': 'coldWater', 'I': 'ice', 'b': 'bell', 'B': 'bellOn', 'n': 'gong', 'N': 'gongOn', 'R': 'boulder', 'U': 'pit',
               '1': 'rod', '2': 'rodOn', '3': 'puff', '4': 'bars', '5': 'mirrorA', '6': 'mirrorB', '7': 'fog', '8': 'wish'}
        for name, sheet in tile_sheets.items():
            sheet.im.resize((sheet.w * 3, 48), Image.NEAREST).save(out / f'contact-tiles-{name}.png')
            room = Cv(16 * 22, 16 * 6)
            ti = lambda k: sheet.im.crop((TILE_ORDER.index(k) * 16, 0, TILE_ORDER.index(k) * 16 + 16, 16))
            for y, line in enumerate(lay):
                for x, ch in enumerate(line):
                    room.im.paste(ti(key[ch]), (x * 16, y * 16))
            room.im.paste(ti('stairs'), (11 * 16, 4 * 16)); room.im.paste(ti('rubble'), (0, 4 * 16)); room.im.paste(ti('switchOn'), (11 * 16, 3 * 16))
            room.im.resize((room.w * 5, room.h * 5), Image.NEAREST).save(out / f'contact-room-{name}.png')
        zones = [list(ENEMIES)[0:6], list(ENEMIES)[6:12], ZONE3, ZONE4, ZONE5, ZONE6, ZONE7, ZONE8, ZONE9, ZONE10]
        for zi, ids in enumerate(zones):
            en = Cv(max(ENEMIES[e][0] for e in ids) * 4, sum(ENEMIES[e][0] for e in ids), bg)
            y = 0
            for e in ids:
                en.paste(enemies[e], 0, y)
                y += ENEMIES[e][0]
            en.im.resize((en.w * 5, en.h * 5), Image.NEAREST).save(out / f'contact-enemies-{zi + 1}.png')
        pj = Cv(70, 14, bg)
        xx = 1
        for n, cv in projs.items():
            pj.paste(cv, xx, 1)
            xx += cv.w + 2
        pj.im.resize((pj.w * 8, pj.h * 8), Image.NEAREST).save(out / 'contact-proj.png')
        ending.im.resize((480, 360), Image.NEAREST).save(out / 'contact-ending.png')
        ob = Cv(16 * 8 + 9, 16 * 2 + 3, hx('#fff8e8'))
        for i, o in enumerate(ORBS):
            ob.paste(orbs[o], 1 + (i % 8) * 17, 1 + (i // 8) * 17)
        ob.im.resize((ob.w * 8, ob.h * 8), Image.NEAREST).save(out / 'contact-orbs.png')


if __name__ == '__main__':
    main()
