"""SIA WORLD 앱 아이콘 만들기 (PWA 설치 아이콘·홈 화면 아이콘·로비 favicon).

다시 만들 때:  python scripts/make-app-icons.py   (저장소 최상위에서, Pillow 필요)

그림: 하늘 그라데이션(--sky-top → --sky-mid) 위 노란 해(--primary, 갈색 외곽선) 앞에
고양이(야옹이, 왕관·망토) 상반신 (2026-11-26 호랑이 → 고양이).
원본은 SpriteCook 고양이 전신 고해상도 그림 art/spritecook/cat/full-src.png (shared/images/zodiac/full/cat.png 의 원본).
색은 shared/theme.css 값 그대로 쓴다 (DESIGN.md: 굵은 갈색 외곽선 + 밝은 단색).

만드는 파일 (shared/images/app/):
  icon-192.png, icon-512.png       둥근 네모 + 굵은 외곽선, 모서리는 투명 (purpose: any)
  icon-maskable-512.png            꽉 찬 바탕, 얼굴은 가운데 안전 영역(지름 80%) 안 (purpose: maskable)
  apple-touch-icon.png (180)       꽉 찬 바탕 (iOS 가 모서리를 알아서 둥글게 깎는다)
  favicon-32.png, favicon-48.png   로비 탭 아이콘
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "spritecook" / "cat" / "full-src.png"
OUT = ROOT / "shared" / "images" / "app"

# shared/theme.css
SKY_TOP = (0x4A, 0xA8, 0xFF)
SKY_MID = (0x9F, 0xD6, 0xFF)
PRIMARY = (0xFF, 0xD3, 0x4D)
OUTLINE = (0x2A, 0x1A, 0x10)

# 원본(1912x1912)에서 왕관 끝~가슴(망토 매듭) 부분: 정사각형
CAT_BOX = (190, 0, 1720, 1530)

WORK = 1024  # 크게 그린 뒤 줄인다 (가장자리를 매끄럽게)


def cat() -> Image.Image:
    return Image.open(SRC).convert("RGBA").crop(CAT_BOX)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(SKY_TOP, SKY_MID))
        d.line([(0, y), (size, y)], fill=c + (255,))
    return img


def scene(size: int, head: float, sun: float, inset: float) -> Image.Image:
    """꽉 찬 정사각형 그림. head: 고양이 폭(전체 대비), sun: 해 지름(전체 대비), inset: 바깥 테두리 몫"""
    img = gradient(size)
    d = ImageDraw.Draw(img)
    cx = size / 2
    # 해 (노란 원 + 갈색 외곽선): 머리 뒤에 둥근 판
    r = size * sun / 2
    cy = size * 0.47
    line = round(size * 0.022)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=PRIMARY + (255,), outline=OUTLINE + (255,), width=line)
    # 고양이: 가운데, 아래쪽이 테두리에 걸쳐 잘리게 (얼굴 위주 아바타처럼)
    t = cat()
    w = round(size * head)
    h = round(t.height * w / t.width)
    t = t.resize((w, h), Image.LANCZOS)
    bottom = size - round(size * inset)
    img.alpha_composite(t, (round(cx - w / 2), bottom - h + round(size * 0.02)))
    return img


def rounded_mask(size: int, inset: float, radius: float) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    a = size * inset
    ImageDraw.Draw(m).rounded_rectangle([a, a, size - a, size - a], radius=size * radius, fill=255)
    return m


def icon_any() -> Image.Image:
    """둥근 네모 + 굵은 외곽선 (모서리 투명)"""
    S = WORK
    inset = 0.035
    radius = 0.22
    line = round(S * 0.04)
    pic = scene(S, head=0.72, sun=0.62, inset=inset + 0.02)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(pic, (0, 0), rounded_mask(S, inset, radius))
    a = S * inset
    ImageDraw.Draw(out).rounded_rectangle(
        [a, a, S - a, S - a], radius=S * radius, outline=OUTLINE + (255,), width=line,
    )
    return out


def icon_full(head: float, sun: float) -> Image.Image:
    """꽉 찬 바탕 (maskable·apple). 외곽선은 플랫폼 마스크에 잘리므로 그리지 않는다"""
    return scene(WORK, head=head, sun=sun, inset=0)


def save(img: Image.Image, name: str, size: int, opaque: bool = False) -> None:
    out = img.resize((size, size), Image.LANCZOS)
    if opaque:
        bg = Image.new("RGB", out.size, SKY_TOP)
        bg.paste(out, (0, 0), out)
        out = bg
    out.save(OUT / name, optimize=True)
    print(f"{name} {size}x{size}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    any_ = icon_any()
    save(any_, "icon-192.png", 192)
    save(any_, "icon-512.png", 512)
    save(any_, "favicon-48.png", 48)
    save(any_, "favicon-32.png", 32)
    # maskable: 안전 영역은 가운데 지름 80% 원 → 얼굴(귀~턱)이 그 안에 들어가게 작게
    save(icon_full(head=0.62, sun=0.56), "icon-maskable-512.png", 512, opaque=True)
    save(icon_full(head=0.74, sun=0.62), "apple-touch-icon.png", 180, opaque=True)


if __name__ == "__main__":
    main()
