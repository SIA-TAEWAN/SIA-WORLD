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

### 6. 시아의탑 1·2구역 그림 전부 — 캐릭터 레이어 18장 · 타일 27칸 × 2테마 · 적 12종 · 구슬 아이콘 16개 · 로비 카드 (필수)
- 지금: Fable 5.2 손그림 (2026-11-25, `python games/tower/art/draw.py` — `public/art/**` · `manifest.json` · 로비 카드를 한 번에 다시 만든다. `python games/tower/art/draw.py <폴더>` 는 확대한 확인용 그림 `contact-*.png` 도 만든다)
- 규격은 `games/tower/ASSETS.md` 그대로 (1배 크기 도트, 투명 배경, 진한 갈색 1px 테두리, 색은 `shared/theme.css` 값)
- 넣을 곳: `games/tower/public/art/`
  - 캐릭터 레이어 `char/*.png` 18장 (256×128 = 32×32 칸 가로 8 × 세로 4. 가로 대기·걷기 4·공격 3, 세로 아래·왼쪽·오른쪽·위): `body_m` `body_f` 몸 · `face_0~3` 동글·방긋·초롱·다부진 · `outfit_0~3` 파랑 도포·분홍 저고리(흰 치마)·노랑 조끼(흰 적삼·갈색 바지)·초록 무복(금띠·검은 바지) · `hair_m0~m3` 짧은 머리·삐죽 머리·상투(동곳·망건)·바가지 머리 · `hair_f0~f3` 긴 생머리·양갈래(분홍 댕기)·올림 머리(금비녀)·단발
  - `tiles.png` 432×16 (16×16 27칸, `TILE_ORDER` 순서): 돌바닥 2 · 벽 윗면 · 벽 앞면 · 문턱 · 잠긴 문 · 물 · 기둥 · 철문 · 금 간 바위 · 스위치 2 · 덩굴 · 계단 · 상자 2 · 구슬 받침대 2 · 갓 쓴 상인 좌판 · 샘 2 · 잔돌 · 발판 2(눌리면 노랑) · 화로 2(꺼짐 / 불붙음) · 물가 말뚝
  - 2구역 `tiles-moss.png` 432×16 (같은 27칸, "이끼 낀 회랑"): 연두 돌바닥(`--roulette-autumn`, 줄눈 `--matgo-mat-light`) · 이끼 덩어리 바닥 · 이끼 덮인 벽 윗면 · 이끼가 흘러내린 벽돌 벽 · 나머지 물건 칸은 1구역 것에 이끼
  - 적 `enemy/<id>.png` (가로 4칸: 걷기 2 · 공격 준비 · 맞음, 오른쪽을 본다): `slime` 진흙 슬라임 · `bat` 동굴 박쥐 · `spitter` 독버섯 · `goblin` 돌 도깨비(금 뿔·호피·방망이) 16×16, `knight` 돌갑옷 무사(분홍 깃·파란 방패·칼) 24×24, `golem` 문지기 골렘(가슴의 구슬 문양·이끼) 32×32
  - 2구역 적 (같은 형식): `sprout` 가시 덩굴싹 · `moth` 이끼 나방 · `lizard` 이끼 도마뱀 · `toad` 바위 두꺼비 16×16, `treant` 고목 수호자 24×24, `imugi` 이끼 이무기(여의주를 바라는 노란 눈, 준비 칸은 입을 벌림) 32×32
  - 구슬 아이콘 `orb/<id>.png` 16×16 16개 (`src/data/orbs.json` 의 id): 원소 색 구슬 안에 동물 얼굴, 전설 4개는 금테
  - 로비 카드 `shared/images/card-tower.png` 640×400 (다른 `card-*.png` 와 같은 하늘색 바탕): 기와 3층 돌탑 · 꼭대기의 소원 구슬 · 칼을 휘두르는 대원 · 1구역 적들
- 문제: 2구역 두꺼비는 16px 에 바위 등과 얼굴이 뭉쳐 보이고, 이끼 테마의 물건 칸은 1구역 그림에 점만 얹은 것이다. 손그림은 네모·줄로 그려 걷기 4칸이 단순하고(다리만 움직인다) 옆모습 몸이 가늘다. 옷 주름·머리카락 결 같은 잔 표현이 없다. 구슬 아이콘은 16px 라 동물이 또렷하지 않은 것이 있다 (주작 · 현무 · 말). 로비 카드는 도트 그림이라 다른 카드(만화풍 그림)와 결이 다르다
- 다시 그릴 때: **몸 시트를 먼저** 만들고(자세 틀) 그 위에 얼굴·옷·머리를 같은 칸·같은 자세로 그린다 — 겹쳐서 한 사람이 되는지 `?local=1&reset=1` 의 캐릭터 만들기 미리보기와 게임 안 네 방향(걷기·공격)으로 확인. 발끝 y≈30, 머리는 칸 가운데(x 10~21). 3구역(21층~) 이후 그림도 같은 방식으로 이 항목에 이어서 적는다
- style 참고: 로비 카드는 다른 게임 카드(`shared/images/card-twelve.png` 등), 도트는 지금 손그림의 비율(2.5등신, 머리 12px)
- 넣은 뒤: `public/art/manifest.json` 의 `files` 는 그대로 두면 된다 (파일 이름이 같다). `games/tower/ASSETS.md` 의 "Fable 손그림" 표시를 지우고 `games/tower/spritecook-assets.json` 을 만들어 asset id 를 적는다. `draw.py` 는 바꾼 그림을 덮어쓰지 않게 그 부분을 지우거나 파일째 지운다 (`scripts/make-card.py` 도)

## 완료

(아직 없음)
