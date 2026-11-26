# 시아팡팡 그림

그림 파일 없이 모두 코드로 그린다. SpriteCook 그림은 아직 쓰지 않는다 (`spritecook-assets.json` 없음).

| 무엇 | 파일 |
| --- | --- |
| 정령 9종 · 강화 정령 · 정령왕 구슬 | `src/game/spirits.js` (`draw(ctx, kind, time, special)` · 몸 반지름 약 20) |
| 얼음 · 상자 · 덩굴 · 보드 칸 · 특수 효과 · 파티클 | `src/ui/app.js` |
| 챕터 배경 10종 · 정령 마당 | `src/ui/scene.js` (`paintBg`) |
| 로비 카드 | `shared/images/card-pang.png` (640×400, 정령 마당 1장 배경 + 정령들. 코드 그림을 캡처했다) |

색: 보드 바닥 밤하늘 `#2B2350`, 칸 `#352B5E` / `#3C3268`, 판 테두리는 DESIGN.md 의 크림 판 + 갈색 외곽선.
