# SpriteCook 다시 그릴 목록

SpriteCook 크레딧이 없을 때 Fable 5.2 로 손수 그리거나 임시로 둔 그림, 그리고 SpriteCook 으로 다시 그리면 나아질 그림을 모아 둔다.
사용자가 "저장해둔 디자인을 SpriteCook 으로 그려줘" 라고 하면 이 목록을 위에서부터 전부 그린다.
그린 뒤에는 각 게임의 `spritecook-assets.json` 에 asset id 를 적고, 이 목록에서 지우거나 "완료" 로 옮긴다.

## 남은 항목

### 1. 시아마을 선물 장식물 `gift_cat` — "야옹이의 금관 방석" (필수)
- 지금: Fable 5.2 손그림 (`games/village/public/art/b-gift_cat-1.png`, 2026-11-23)
- 규격: 기존 `b-gift_<id>-1.png` 12종과 같은 크기·시점·투명 배경. 비교 이미지 `art/spritecook/cat/village-gift-compare.png`
- 그릴 것: 보라 비단 방석 위의 작은 금관(보라 보석), 금빛 술 장식. 고양이 디자인은 `shared/images/zodiac/full/cat.png` (asset `a6ba0812-b27d-44dc-8929-40613cda4698`) 를 reference 로
- style 참고: 마을 선물 그림들 (`games/village/spritecook-assets.json` 의 gift 항목 asset id)
- 넣은 뒤: `games/village/ASSETS.md` 의 "Fable 손그림" 표시를 지우고 spritecook-assets.json 에 기록

### 2. 시아핑거 고양이 그림 `h-cat` · `cut-cat` (권장)
- 지금: SpriteCook `gpt-image-2` 로 그림 (기존 대원은 `gemini-3.1-flash-image` — 그때 크레딧이 모자라 모델이 다름)
- 문제: `cut-cat` 은 속도선·망토가 칸을 차지해 몸이 다른 컷인보다 작게 보인다
- 다시 그릴 때: 기존 대원과 같은 모델, `games/finger/art/build.py` 방식(HEROES·FLIP), 400×400 컷인은 몸을 더 크게

### 3. 시아탱크 고양이 탱크 `tanks/cat.png` (선택)
- 지금: 귀가 하나만 보인다 (금관이 두 번째 귀 자리를 차지). 다른 동물은 귀가 둘
- 다시 그릴 때: edit 로 귀 둘 + 금관, 무한궤도 폭 108px 기준 유지 (`tankArt.json` 의 cx 값을 다시 잴 것)

### 4. 고양이 얼굴·전신 `shared/images/zodiac/face|full/cat.png` (선택)
- 지금: 외곽선이 쥐·호랑이보다 조금 얇고 머리 비율이 약 50% (다른 십이지는 약 60%)
- 다시 그릴 때: 같은 디자인(후보 A)에서 외곽선 굵게·머리 크게. 바꾸면 핑거·탱크 그림과도 맞는지 볼 것

## 완료

(아직 없음)
