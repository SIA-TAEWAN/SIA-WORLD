# 시아팡팡 그림

정령·보드·효과는 그림 파일 없이 모두 코드로 그린다. 지도 챕터 카드 배경 10장(`public/art/maps/ch01~10.webp`, 912×560)만 SpriteCook 그림이다 — asset id 는 `spritecook-assets.json`, 원본은 `art/spritecook/`, 자르기·WebP 만들기는 `python art/build_maps.py`. 그림을 못 읽으면 크림 판 그대로 보인다.

| 무엇 | 파일 |
| --- | --- |
| 정령 9종 · 강화 정령 · 정령왕 구슬 | `src/game/spirits.js` (`draw(ctx, kind, time, special)` · 몸 반지름 약 20) |
| 얼음 · 상자 · 덩굴 · 보드 칸 · 특수 효과 · 파티클 | `src/ui/app.js` |
| 챕터 배경 10종 · 정령 마당 | `src/ui/scene.js` (`paintBg`) |
| 로비 카드 | `shared/images/card-pang.png` (640×400, 정령 마당 1장 배경 + 정령들. 코드 그림을 캡처했다) |

색: 보드 바닥 밤하늘 `#2B2350`, 칸 `#352B5E` / `#3C3268`, 판 테두리는 DESIGN.md 의 크림 판 + 갈색 외곽선.
