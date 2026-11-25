# SpriteCook 다시 그릴 목록

SpriteCook 크레딧이 없을 때 Fable 5.2 로 손수 그리거나 임시로 둔 그림, 그리고 SpriteCook 으로 다시 그리면 나아질 그림을 모아 둔다.
사용자가 "저장해둔 디자인을 SpriteCook 으로 그려줘" 라고 하면 이 목록을 위에서부터 전부 그린다.
그린 뒤에는 각 게임의 `spritecook-assets.json` 에 asset id 를 적고, 이 목록에서 지우거나 "완료" 로 옮긴다.

## 남은 항목

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

### 6. 시아의탑 1~5구역 그림 전부 — 캐릭터 레이어 18장 · 타일 35칸 × 5테마 · 적 32종 · 구슬 아이콘 16개 · 로비 카드 (필수)
- 지금: Fable 5.2 손그림 (2026-11-25, `python games/tower/art/draw.py` — `public/art/**` · `manifest.json` · 로비 카드를 한 번에 다시 만든다. `python games/tower/art/draw.py <폴더>` 는 확대한 확인용 그림 `contact-*.png` 도 만든다)
- 규격은 `games/tower/ASSETS.md` 그대로 (1배 크기 도트, 투명 배경, 진한 갈색 1px 테두리, 색은 `shared/theme.css` 값)
- 넣을 곳: `games/tower/public/art/`
  - 캐릭터 레이어 `char/*.png` 18장 (256×128 = 32×32 칸 가로 8 × 세로 4. 가로 대기·걷기 4·공격 3, 세로 아래·왼쪽·오른쪽·위): `body_m` `body_f` 몸 · `face_0~3` 동글·방긋·초롱·다부진 · `outfit_0~3` 파랑 도포·분홍 저고리(흰 치마)·노랑 조끼(흰 적삼·갈색 바지)·초록 무복(금띠·검은 바지) · `hair_m0~m3` 짧은 머리·삐죽 머리·상투(동곳·망건)·바가지 머리 · `hair_f0~f3` 긴 생머리·양갈래(분홍 댕기)·올림 머리(금비녀)·단발
  - `tiles.png` 560×16 (16×16 35칸, `TILE_ORDER` 순서 — 아래 27칸 + 3~5구역 8칸): 돌바닥 2 · 벽 윗면 · 벽 앞면 · 문턱 · 잠긴 문 · 물 · 기둥 · 철문 · 금 간 바위 · 스위치 2 · 덩굴 · 계단 · 상자 2 · 구슬 받침대 2 · 갓 쓴 상인 좌판 · 샘 2 · 잔돌 · 발판 2(눌리면 노랑) · 화로 2(꺼짐 / 불붙음) · 물가 말뚝
  - 3~5구역에서 붙은 8칸 (다섯 시트 모두): 찬물(살얼음 금) · 얼음판 · 풍경 2(나무 틀의 종 / 울리며 빛남) · 징 2(놋쇠판 / 울리며 물결) · 둥근 줄무늬 바위 · 구덩이
  - 3구역 `tiles-frost.png` "서리 누각": 하늘색 돌바닥(`--roulette-spring`, 줄눈 `--sky-mid`) · 쌓인 눈 · 눈 덮인 벽 윗면(`--table-blackjack`) · 파란 벽돌(`--sky-deep`)에 고드름
  - 4구역 `tiles-cloud.png` "새벽 구름 뜰": 살구빛 바닥(`--sky-bottom`, 줄눈 `--roulette-summer`) · 금빛 구름 무늬 · 흰 벽 윗면 · 단청 들보와 붉은 기둥(`--lose`) · 구름 바다
  - 5구역 `tiles-ember.png` "잿불 성채": 붉은 돌바닥(`--roulette-summer`, 줄눈 `--race-track-dark`) · 재와 불씨 · 주황 벽 윗면(`--race-track`) · 달아오른 금이 간 벽돌 · 용암
  - 2구역 `tiles-moss.png` 560×16 (같은 35칸, "이끼 낀 회랑"): 연두 돌바닥(`--roulette-autumn`, 줄눈 `--matgo-mat-light`) · 이끼 덩어리 바닥 · 이끼 덮인 벽 윗면 · 이끼가 흘러내린 벽돌 벽 · 나머지 물건 칸은 1구역 것에 이끼
  - 적 `enemy/<id>.png` (가로 4칸: 걷기 2 · 공격 준비 · 맞음, 오른쪽을 본다): `slime` 진흙 슬라임 · `bat` 동굴 박쥐 · `spitter` 독버섯 · `goblin` 돌 도깨비(금 뿔·호피·방망이) 16×16, `knight` 돌갑옷 무사(분홍 깃·파란 방패·칼) 24×24, `golem` 문지기 골렘(가슴의 구슬 문양·이끼) 32×32
  - 2구역 적 (같은 형식): `sprout` 가시 덩굴싹 · `moth` 이끼 나방 · `lizard` 이끼 도마뱀 · `toad` 바위 두꺼비 16×16, `treant` 고목 수호자 24×24, `imugi` 이끼 이무기(여의주를 바라는 노란 눈, 준비 칸은 입을 벌림) 32×32
  - 3구역 적: `snowimp` 눈 도깨비 · `icebat` 고드름 박쥐 · `frostjar` 서리 항아리 · `wisp` 푸른 도깨비불 · `icecrystal` 얼음 수정 16×16, `haetae` 서리 해태 24×24, `winterGeneral` 동장군 32×32
  - 4구역 적: `ram` 솜털 숫양 · `kite` 방패연 요괴 · `chick` 솜털 병아리 · `scarecrow` 허수아비 16×16, `geumgye` 금계 장수 24×24, `yeongdeung` 영등할미(구름 위, 큰 부채) 32×32
  - 5구역 적: `bulgae` 불개 · `torchimp` 횃불 도깨비 · `wildcat` 얼룩 살쾡이 · `sparrow` 불씨 참새 · `iron` 쇠붙이 16×16, `hwacha` 불화살 화차 24×24, `bulgasari` 불가사리(곰 몸·코끼리 코·쇠 비늘) 32×32 — 준비 칸의 모습은 `games/tower/ASSETS.md` 의 적 항목
  - 구슬 아이콘 `orb/<id>.png` 16×16 16개 (`src/data/orbs.json` 의 id): 원소 색 구슬 안에 동물 얼굴, 전설 4개는 금테
  - 로비 카드 `shared/images/card-tower.png` 640×400 (다른 `card-*.png` 와 같은 하늘색 바탕): 기와 3층 돌탑 · 꼭대기의 소원 구슬 · 칼을 휘두르는 대원 · 1구역 적들
- 문제: 3~5구역 — 불가사리는 코끼리 코가 팔처럼 보이고 앞발을 든 칸이 뭉쳐 보인다. 횃불 도깨비는 횃불이 몸에 붙어 보인다. 살쾡이 얼굴이 또렷하지 않다. 새 테마의 물건 칸(기둥·상자·샘 등)은 1구역 그림 그대로에 눈·재 점만 얹었다. 2구역 두꺼비는 16px 에 바위 등과 얼굴이 뭉쳐 보이고, 이끼 테마의 물건 칸은 1구역 그림에 점만 얹은 것이다. 손그림은 네모·줄로 그려 걷기 4칸이 단순하고(다리만 움직인다) 옆모습 몸이 가늘다. 옷 주름·머리카락 결 같은 잔 표현이 없다. 구슬 아이콘은 16px 라 동물이 또렷하지 않은 것이 있다 (주작 · 현무 · 말). 로비 카드는 도트 그림이라 다른 카드(만화풍 그림)와 결이 다르다
- 다시 그릴 때: **몸 시트를 먼저** 만들고(자세 틀) 그 위에 얼굴·옷·머리를 같은 칸·같은 자세로 그린다 — 겹쳐서 한 사람이 되는지 `?local=1&reset=1` 의 캐릭터 만들기 미리보기와 게임 안 네 방향(걷기·공격)으로 확인. 발끝 y≈30, 머리는 칸 가운데(x 10~21). 6~10구역(51~100층)은 7번 항목
- style 참고: 로비 카드는 다른 게임 카드(`shared/images/card-twelve.png` 등), 도트는 지금 손그림의 비율(2.5등신, 머리 12px)
- 넣은 뒤: `public/art/manifest.json` 의 `files` 는 그대로 두면 된다 (파일 이름이 같다). `games/tower/ASSETS.md` 의 "Fable 손그림" 표시를 지우고 `games/tower/spritecook-assets.json` 을 만들어 asset id 를 적는다. `draw.py` 는 바꾼 그림을 덮어쓰지 않게 그 부분을 지우거나 파일째 지운다 (`scripts/make-card.py` 도)

### 7. 시아의탑 6~10구역 그림 — 타일 새 8칸 + 테마 5장 · 적 34종 · 투사체 6종 · 엔딩 그림 (필수)
- 지금: Fable 5.2 손그림 (2026-11-25, 6번과 같은 `python games/tower/art/draw.py`). 규격·넣을 곳·확인 방법은 6번과 같다 (`games/tower/ASSETS.md`)
- 타일: 시트 10장 모두 688×16 (43칸). 뒤에 붙은 8칸 — 뇌석 2(돌기둥 + 쇠 갓 / 번개 감김) · 구름 덩이 · 쇠창살 · 거울 2(/ · \) · 짙은 구름 · 받침 위 소원 구슬
  - `tiles-thunder.png` 천둥 마루(먹구름 위 푸른 기와) · `tiles-galaxy.png` 은하 나루(오작교 다리 널 · 은하수) · `tiles-flower.png` 서천 꽃밭(풀밭 · 꽃 울타리 · 연못) · `tiles-storm.png` 칠성 폭풍단(제단 돌 · 북두칠성 · 폭풍 구름) · `tiles-wish.png` 소원의 정상(금빛 바닥 · 옥빛 궁궐 벽 · 금빛 구름) — 색은 `ASSETS.md` 의 6~10구역 항목
- 적 `enemy/<id>.png` (가로 4칸: 걷기 2 · 준비 · 맞음, 오른쪽을 본다. 준비 칸의 모습은 `ASSETS.md`):
  - 6구역: `drumimp` · `thunderbird` · `raincloud` · `flagspirit` · `drum` 16, `thunderGeneral` 24, `noegong` 32
  - 7구역: `magpie` · `starslime` · `starlet` · `weaver` · `comet` 16, `crowKnight` 24, `crowKing` 32 (`crowDecoy` 가 빌려 쓴다)
  - 8구역: `thornhand` · `butterfly` · `beetle` · `fairy` 16, `peacock` 24, `ggotgamgwan` 32
  - 9구역: `stormimp` · `hailjar` · `starshard` · `hawk` 16, `jangseung` 24, `heukryong` 32
  - 10구역: `skysoldier` · `crane` · `lantern` · `jadelion` · `wishlight` 16, `skygeneral` 24, `eodugsini` **48** (192×48, 마지막 보스)
- 투사체 `proj/<이름>.png`: `web` 8×8 · `crowfeather` 10×6 · `pollen` 6×6 · `petal` 8×6 · `storm` 12×12 · `shade` 10×10 (아직 코드가 읽지 않는다 — 연결 방법은 `ASSETS.md`)
- 엔딩 `ending.png` · `ending-bg.png` 120×90: 별 하늘 · 초승달 · 옥빛 궁궐 꼭대기 · 소원 구슬(을 든 대원). 다시 그릴 때는 더 큰 그림(예: 480×360)으로 그려도 된다 — 아직 코드가 읽지 않는다
- 문제: 새 테마 5장은 벽·물·문턱을 같은 틀에 색만 바꿔 그려 구역마다 개성이 약하고, 물건 칸은 1구역 그림 그대로다. 정예 3종(뇌우 장수 · 까마귀 무사 · 천상 장군)은 같은 뼈대의 색·무기 바꾸기, 새 3종(뇌조 · 까치 · 폭풍 매)과 도깨비 3종(북 · 혜성 · 바람)도 같은 뼈대다. 흑룡은 이무기 색 바꾸기. 베틀 거미는 보라색 토큰이 없어 연보라(`--charge-stun-tint`)로 그렸다. 꽃나비 날개가 네모지다
- 넣은 뒤: 6번과 같다

## 완료

- 시아마을 선물 장식물 `gift_cat` — SpriteCook `gemini-nano-banana-2.1` 로 다시 그림 (2026-11-25, asset `5bbada7d-86fb-430b-a62a-45db032af1ed`)
- 시아마을 새 기념물 7종 · 열두 지신 문 3단계 — SpriteCook (2026-11-25, `monE` · `monF` · `jisin` 시트, `games/village/spritecook-assets.json`). 함께 돌격대·핑거 기념물 6종 `monD` 도 그림

