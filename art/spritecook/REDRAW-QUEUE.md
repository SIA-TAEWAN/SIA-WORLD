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

### 5. 시아마을 새 기념물 7종 · 특별 건물 '열두 지신 문' 3단계 (필수)
- 지금: Fable 5.2 손그림 (2026-11-24, `python games/village/art/hand_099.py`). 비교 이미지(만들 때 확인용, 임시 폴더라 지워질 수 있음 — `python games/village/art/hand_099.py <폴더>` 로 다시 만든다): `C:\Users\jeetpgpc\AppData\Local\Temp\claude\e9633c44ded35461\5660048b-a927-4afa-8a40-d0d72bb3baaf\scratchpad\village-art-compare.png`
- 넣을 곳: `games/village/public/art/`
  - 기념물 (192×272, 256색 PNG, 투명 배경, 칸 아래쪽 가운데, 다른 기념물과 같은 돌 받침): `b-mon_twelve_keys-1.png` 열쇠 돌기둥(돌기둥에 금 열쇠 여섯 개) · `b-mon_twelve_final-1.png` 열두길 비석(글씨 새긴 둥근 비석, 붉은 꼭지) · `b-mon_twelve_hard-1.png` 금빛 열두길 문(금 문짝 · 기와지붕 · 반짝임) · `b-mon_twelve_tower-1.png` 구름 탑 등불(구름 위 3층 탑 꼭대기의 등불) · `b-mon_daily7-1.png` 도전 달력(일곱 칸 중 한 칸이 노랑) · `b-mon_daily_first-1.png` 장원 깃발(붉은 깃발에 금 동그라미, 어사화) · `b-mon_race_week-1.png` 주간 시상대(1·2·3 시상대 위 금 트로피)
  - 열두 지신 문 (2×2 = 384×544, 같은 형식): `b-jisin-1.png`(원판 4개 · 널지붕) · `b-jisin-2.png`(원판 8개 · 기와 · 단청 · 등불) · `b-jisin-3.png`(원판 12개 · 금빛 용마루와 현판)
- 문제: 손그림은 정면에 가깝고 납작하다 (SpriteCook 그림은 위에서 비스듬히 본 입체감과 돌 · 기와의 잔 질감이 있다)
- 다시 그릴 때: 기념물은 3×2 시트 `monE`(6칸) + `monF`(첫 칸), 지신 문은 가로 3칸 시트 `jisin` → `games/village/art/sheets/` → `art/build.py` 의 `SHEET` 에 줄 추가(`jisin` 은 `BIG` 에도) → `python art/build.py`
- style 참고 (`games/village/spritecook-assets.json`): 기념물 `monA` `4af1a345-db7e-4417-80df-4ff03f1e9e4d` · `monB` `ffb9a066-2da6-4c01-8c37-49355db941df` · `monC` `26fa23a3-7971-44d0-9316-94fe04037655`, 지신 문은 `shrine` 시트의 asset id
- 넣은 뒤: `games/village/ASSETS.md` 의 "Fable 손그림" 표시를 지우고 spritecook-assets.json 에 기록 (`hand_099.py` 는 지워도 된다)

## 완료

(아직 없음)
