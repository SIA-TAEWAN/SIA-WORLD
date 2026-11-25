# 시아의탑 — 그림 규격과 교체 방법

1~10구역(1~100층) 그림은 **Fable 5.2 손그림**(2026-11-25)이다: 캐릭터 레이어 18장 · 타일 시트 10장(`tiles.png` · `tiles-moss/frost/cloud/ember/thunder/galaxy/flower/storm/wish.png`) · 적 66종 · 구슬 아이콘 16개 · 로비 카드 · 투사체 6종(`proj/`, 아직 코드가 읽지 않음) · 엔딩 그림(`ending.png`, 아직 코드가 읽지 않음).
모두 `games/tower/art/draw.py` 한 파일이 그린다 — `python games/tower/art/draw.py` (저장소 어디서든, Pillow 필요) 를 돌리면
`public/art/**` 와 `manifest.json`, `shared/images/card-tower.png` 를 똑같이 다시 만든다 (`python games/tower/art/draw.py <폴더>` 는 확대한 확인용 그림도 그 폴더에 만든다).
SpriteCook 크레딧이 생기면 다시 그릴 목록에 올라 있다 (`art/spritecook/REDRAW-QUEUE.md` 6번).

`src/art/sheets.ts` 의 **코드로 그린 임시 도트**는 파일을 못 읽을 때의 대비용으로 남아 있다. 같은 규격의 PNG 를 `public/art/` 에 넣고
`public/art/manifest.json` 의 `files` 에 경로를 적으면 그 파일을 쓴다 (적힌 것만 불러온다 — 없는 파일을 불러 콘솔 오류가 나지 않게).
파일을 못 읽으면 같은 이름의 코드 그림으로 돌아간다. 화면은 `pixelArt: true` + 정수 배율이라 그림은 **원래 크기(1배)** 로 그린다.

```json
{ "files": ["char/body_m.png", "char/hair_f2.png", "tiles.png", "enemy/golem.png", "orb/rat.png"] }
```

## 캐릭터 레이어 (`public/art/char/`)

- 한 칸 **32×32**, 시트 **256×128** = 가로 8칸 × 세로 4줄. 배경은 투명.
- 가로(칸): `0` 대기 · `1~4` 걷기 · `5~7` 공격(칼을 뒤로 → 앞으로 → 휘두른 뒤)
- 세로(줄): `0` 아래 · `1` 왼쪽 · `2` 오른쪽 · `3` 위 (코드 그림은 왼쪽 줄을 오른쪽 줄을 뒤집어 만든다. 파일은 네 줄 모두 그려 넣는다)
- **모든 레이어가 같은 칸에 같은 자세**로 그려져야 겹쳤을 때 한 사람이 된다. 발끝은 칸 아래에서 1~2px 위(y≈30).
- 그리는 순서: 몸 → 얼굴 → 옷 → 머리 (`src/art/sheets.ts` 의 `layerNames`)

| 파일 | 내용 |
|---|---|
| `body_m.png` · `body_f.png` | 몸 (피부·팔·다리·신발) |
| `face_0~3.png` | 얼굴 4종: 동글 · 방긋 · 초롱 · 다부진 (위를 보는 줄은 비워 둔다) |
| `outfit_0~3.png` | 옷 4종 (남녀 같이): 파랑 도포 · 분홍 저고리 · 노랑 조끼 · 초록 무복 |
| `hair_m0~m3.png` | 남자 머리: 짧은 머리 · 삐죽 머리 · 상투 · 바가지 머리 |
| `hair_f0~f3.png` | 여자 머리: 긴 생머리 · 양갈래 · 올림 머리 · 단발 |

손그림(`draw.py`) 메모: 걷기 칸 1·3 은 발을 벌리고 몸이 1px 내려간다 (머리 장식이 칸 위로 잘리지 않게 위로는 움직이지 않는다). 왼쪽 줄은 오른쪽 줄을 뒤집은 것.
옷은 소매 끝의 손 자리를 비워 몸 레이어의 손이 보이고, 옷·머리의 테두리는 몸·머리 안쪽에는 두르지 않는다. 남녀 몸은 자세가 같고 다리 굵기와 신발 색(갈색 / 꽃신)만 다르다.
색은 `shared/theme.css` 값만 쓴다 (살색 `#ffd9b8` 한 가지만 임시 그림과 같은 값, 그늘은 `--roulette-summer`).

칼은 레이어에 없다: 공격 칸의 팔 모양 + 화면이 그리는 흰 칼 자국(`GameScene.drawSlash`).

## 타일 (`public/art/tiles.png`)

- 한 칸 **16×16**, 가로 한 줄 22칸 = **352×16**. 순서(`TILE_ORDER`):
  `floor` 바닥 · `floor2` 금 간 바닥 · `wallTop` 벽 윗면 · `wallFace` 벽 앞면(아래가 바닥인 벽) · `doorOpen` 열린 문턱 · `doorLocked` 잠긴 문(창살) ·
  `water` 물 · `pillar` 기둥 · `gate` 철문(스위치로 열림) · `rock` 금 간 바위 · `switch` 스위치 · `switchOn` 켜진 스위치 · `vine` 덩굴 ·
  `stairs` 계단 · `chest` 상자 · `chestOpen` 연 상자 · `pedestal` 구슬 받침대(구슬 있음) · `pedestalEmpty` 빈 받침대 · `shop` 상인 · `fountain` 샘 · `rubble` 잔돌 · `fountainDry` 마신 샘
- 1~10층 테마 "탑의 입구(돌 복도)": 바닥 `--roulette-winter`, 벽 `--ink-soft`/`--empty-line`, 테두리 `--outline` (DESIGN.md 의 기존 색만).
- 손그림: `switch`·`switchOn`·`vine` 은 물 위에 놓이는 칸이라 바탕이 물이고, 나머지 물건 칸은 바탕이 돌바닥이다 (칸은 모두 불투명).
- 뒤에 붙은 5칸 (모두 27칸 = **432×16**): `plate` 발판 · `plateOn` 눌린 발판(노랗게 빛남) · `brazier` 꺼진 화로 · `brazierLit` 불붙은 화로 · `post` 물가 말뚝(쇠고리). 바탕은 그 테마의 바닥.
- 테마마다 한 장: 1구역 `stone` = `tiles.png`, 다른 구역은 `tiles-<theme>.png` (floors.json 의 `theme`, `src/art/load.ts` 의 `tileFile`). 칸 순서는 같다.

- 3~5구역에서 붙은 8칸 (모두 35칸 = **560×16**, 다섯 시트 모두 같은 순서): `coldWater` 찬물(밝은 물 + 살얼음 금) · `ice` 얼음판(흰 판 + 빗금, 걸을 수 있다) · `bell` 풍경(나무 틀에 매달린 종 + 종이 물고기) · `bellOn` 울리는 풍경(노랗게 빛나고 옆으로 흔들림) · `gong` 징(나무 틀의 둥근 놋쇠판) · `gongOn` 울리는 징(밝아지고 둘레에 물결) · `boulder` 둥근 바위(둥글고 줄무늬 — 금 간 바위와 다르다) · `pit` 구덩이. 찬물·얼음은 테마와 상관없이 같은 그림, 나머지는 바탕이 그 테마의 바닥.

### 2구역 "이끼 낀 회랑" (`public/art/tiles-moss.png`, 11~20층, Fable 손그림 2026-11-25)

- 432×16, 같은 27칸. 바닥 `--roulette-autumn` + 줄눈 `--matgo-mat-light`, 금 간 바닥 자리는 이끼 덩어리, 벽 윗면은 이끼(`--table-matgo`)가 덮고 돌이 조금 드러남,
  벽 앞면은 `--ink-soft` 벽돌에 이끼(`--matgo-mat-dark`)가 흘러내림, 물 `--team-a`. 기둥·바위·받침대·샘·화로 같은 물건 칸은 1구역 그림에 이끼 점을 얹었다 (`draw.py` 의 `MOSS_ON`).

### 3구역 "서리 누각" (`public/art/tiles-frost.png`, 21~30층, Fable 손그림 2026-11-25)

- 바닥 `--roulette-spring` + 줄눈 `--sky-mid`, 금 간 바닥 자리는 쌓인 눈, 벽 윗면 `--table-blackjack` 에 눈, 벽 앞면 `--sky-deep` 벽돌 + 눈 덮인 처마와 고드름, 물 `--team-a`, 물건 칸에는 눈 점.

### 4구역 "새벽 구름 뜰" (`public/art/tiles-cloud.png`, 31~40층)

- 바닥 `--sky-bottom` + 줄눈 `--roulette-summer`, 금 간 바닥 자리는 금빛 구름 무늬(`--primary`), 벽 윗면 `--panel` 에 금 꽃무늬, 벽 앞면은 단청 들보(초록·파랑·노랑) 아래 붉은 기둥(`--lose`)과 흰 기단, 물 = 구름 바다(`--sky-mid` + 흰 구름).

### 5구역 "잿불 성채" (`public/art/tiles-ember.png`, 41~50층)

- 바닥 `--roulette-summer` + 줄눈 `--race-track-dark`, 금 간 바닥 자리는 재(`--draw`)와 불씨, 벽 윗면 `--race-track`, 벽 앞면 `--ink-soft` 벽돌에 달아오른 금, 물 = 용암(`--pink` + `--primary` 빛), 물건 칸에는 재 점.

### 6~10구역 (51~100층, Fable 손그림 2026-11-25)

- 6~10구역에서 붙은 8칸 (모두 43칸 = **688×16**, 열 시트 모두 같은 순서): `rod` 뇌석(돌기둥 + 쇠 갓) · `rodOn` 번개 감긴 뇌석 · `puff` 구름 덩이 · `bars` 쇠창살(밝은 쇠 — 철문과 다르다) · `mirrorA` / 거울 · `mirrorB` \ 거울 · `fog` 짙은 구름(칸 전체, 걸을 수 있다) · `wish` 받침 위 소원 구슬. 바탕은 그 테마의 바닥.
- `tiles-thunder.png` 천둥 마루: 잿빛 돌바닥(`--draw`/`--ink-soft`) + 번개 무늬, 푸른 기와 벽 윗면(`--team-a`), `--sky-deep` 벽돌에 막새, 물 = 먹구름(`--ink-soft` + `--primary-light` 번개).
- `tiles-galaxy.png` 은하 나루: 다리 널 바닥(`--empty-line`/`--ink-soft`) + 별 무늬, 하늘색 벽 윗면(`--sky-top`), `--sky-deep` 벽돌에 별, 물 = 은하수(`--outline` + 흰 별).
- `tiles-flower.png` 서천 꽃밭: 풀빛 바닥(`--matgo-mat-light`/`--matgo-mat-dark`) + 분홍 꽃, 꽃 핀 울타리 윗면, 나무 울타리 벽(`--ink-soft`), 물 = 연못(`--sky-mid` + 연잎).
- `tiles-storm.png` 칠성 폭풍단: 제단 돌바닥(`--line-soft`/`--draw`) + 북두칠성 무늬, `--sky-deep` 벽 윗면, 검은 벽돌에 별빛, 물 = 폭풍 구름(`--draw` + 흰 소용돌이).
- `tiles-wish.png` 소원의 정상: 금빛 바닥(`--panel-strong`/`--primary`) + 연꽃 무늬, 흰 벽 윗면에 옥 무늬, 옥빛 벽(`--table-poker`), 물 = 금빛 구름(`--primary-light`).
- 새 테마들은 벽·물·문턱을 같은 틀(`draw.py` 의 `mk_wall_top` · `mk_wall_face` · `mk_water` · `mk_door`)에 색만 바꿔 그렸고, 물건 칸은 1구역 그림 그대로다.

## 적 (`public/art/enemy/<id>.png`)

- 한 칸 size×size, 가로 4칸: `0·1` 걷기 · `2` 공격 준비(예고) · `3` 맞음. 오른쪽을 본다 (왼쪽은 뒤집는다).
- size: 일반 16 (`slime` 진흙 슬라임 · `bat` 동굴 박쥐 · `spitter` 독버섯 · `goblin` 돌 도깨비), 정예 24 (`knight` 돌갑옷 무사), 보스 32 (`golem` 문지기 골렘).
- 2구역 (Fable 손그림 2026-11-25): 일반 16 — `sprout` 가시 덩굴싹(흙에 뿌리박은 봉오리, 준비 칸은 입을 벌림) · `moth` 이끼 나방(연두 날개·분홍 점, 준비 칸은 독 가루) · `lizard` 이끼 도마뱀(등에 이끼, 준비 칸은 몸을 낮추고 꼬리를 세움) · `toad` 바위 두꺼비(등이 바위, 준비 칸은 웅크림), 정예 24 — `treant` 고목 수호자(이끼 머리·옹이 눈·뿌리 팔, 준비 칸은 팔을 듦), 보스 32 — `imugi` 이끼 이무기(똬리 튼 초록 뱀·이끼 비늘·돋기 시작한 뿔·노란 눈, 준비 칸은 입을 벌림).

- 3구역 (Fable 손그림 2026-11-25): 일반 16 — `snowimp` 눈 도깨비(흰 털 뭉치·파란 외뿔·얼음 방망이, 준비 칸은 방망이를 듦) · `icebat` 고드름 박쥐(하늘색 날개·몸 아래 고드름, 준비 칸은 날개를 젖힘) · `frostjar` 서리 항아리(서리 낀 옹기, 준비 칸은 아가리에서 냉기) · `wisp` 푸른 도깨비불(준비 칸은 커지고 하얘짐) · `icecrystal` 얼음 수정(맞은 칸은 금이 감), 정예 24 — `haetae` 서리 해태(흰 갈기·금 외뿔·파란 비늘, 준비 칸은 입을 벌리고 냉기), 보스 32 — `winterGeneral` 동장군(서리 갑옷·흰 수염·얼음 창, 준비 칸은 창을 머리 위로).
- 4구역: 일반 16 — `ram` 솜털 숫양(준비 칸은 머리를 숙임) · `kite` 방패연 요괴(방구멍·꼬리·큰 눈, 준비 칸은 기울어짐) · `chick` 솜털 병아리(준비 칸은 납작하게 돌진) · `scarecrow` 허수아비(밀짚모자·십자 막대, 준비 칸은 팔을 벌리고 짚을 날림), 정예 24 — `geumgye` 금계 장수(금빛 수탉·붉은 볏·가슴 갑옷, 준비 칸은 날개를 펴고 웅크림), 보스 32 — `yeongdeung` 영등할미(흰 쪽머리·파란 치마·큰 부채·구름, 준비 칸은 부채를 뒤로 젖힘).
- 5구역: 일반 16 — `bulgae` 불개(붉은 개·불꽃 갈기와 꼬리, 준비 칸은 낮게 웅크림) · `torchimp` 횃불 도깨비(붉은 도깨비·뿔 둘·횃불, 준비 칸은 횃불을 뒤로) · `wildcat` 얼룩 살쾡이(준비 칸은 웅크림) · `sparrow` 불씨 참새(날개 끝 불씨, 준비 칸은 돌진) · `iron` 쇠붙이(쇠 조각 더미, 맞은 칸은 튀어 오름), 정예 24 — `hwacha` 불화살 화차(바퀴 수레 + 화살 구멍 판, 준비 칸은 판에 불), 보스 32 — `bulgasari` 불가사리(곰 몸·코끼리 코·쇠 비늘·바늘 털·빛나는 눈, 준비 칸은 앞발을 듦).

- 6구역 (Fable 손그림 2026-11-25): `drumimp` 북 도깨비(배에 북, 준비 칸은 북채를 듦) · `thunderbird` 뇌조 · `raincloud` 비구름 요괴(준비 칸은 하얗게 번쩍) · `flagspirit` 번개 깃발(준비 칸은 빛남) · `drum` 천둥 북(맞은 칸 = 울림) 16, `thunderGeneral` 뇌우 장수(먹구름 투구·쇠도리깨) 24, `noegong` 뇌공(푸른 얼굴·붉은 수염·등의 북 고리, 준비 칸은 두 팔로 북채) 32.
- 7구역: `magpie` 까치 · `starslime` 별똥 슬라임(준비 칸은 부풂) · `starlet` 별 부스러기 · `weaver` 베틀 거미(등에 실꾸리, 준비 칸은 앞발을 듦) · `comet` 혜성 도깨비(불타는 꼬리) 16, `crowKnight` 까마귀 무사(부리 투구, 준비 칸은 날개를 폄) 24, `crowKing` 까마귀 대왕(세 발·금관·별빛 날개 끝, 준비 칸은 날개 활짝) 32 — `crowDecoy` 는 파일이 없고 `crowKing` 시트를 빌려 쓴다(`enemies.json` 의 `art`).
- 8구역: `thornhand` 가시 넝쿨손(준비 칸은 손가락을 벌림) · `butterfly` 꽃나비 · `beetle` 풍뎅이 무사(준비 칸은 웅크림) · `fairy` 꽃 요정(준비 칸은 팔을 벌림) 16, `peacock` 금공작(준비 칸은 꼬리를 폄) 24, `ggotgamgwan` 꽃감관(꽃 갓·녹색 도포·꽃가지, 준비 칸은 휘두름) 32.
- 9구역: `stormimp` 바람 도깨비(준비 칸은 바람 자루를 엶) · `hailjar` 우박 항아리(준비 칸은 우박이 튐) · `starshard` 별조각(준비 칸은 하얗게 커짐) · `hawk` 폭풍 매 16, `jangseung` 천하대장군 장승(준비 칸은 기울임) 24, `heukryong` 흑룡(검은 비늘·금빛 뿔, 준비 칸은 입을 벌림 — 이무기 뼈대에 색만 바꾼 것) 32.
- 10구역: `skysoldier` 하늘 병사(준비 칸은 창을 겨눔) · `crane` 흰 학 · `lantern` 소원 등롱(준비 칸은 하얗게 빛남) · `jadelion` 옥 사자(준비 칸은 웅크림) · `wishlight` 소원 등불(연꽃 등, 맞은 칸 = 환하게 켜짐) 16, `skygeneral` 천상 장군(금 갑옷·흰 깃·번개 칼) 24, `eodugsini` 어둑시니(**48** — 192×48, 아래로 퍼지는 먹빛 그림자·하얀 눈 셋, 준비 칸은 손을 뻗음).

## 투사체 · 엔딩 그림 (그려 두었지만 아직 코드가 읽지 않는다)

- `public/art/proj/<이름>.png`: `web` 8×8 · `crowfeather` 10×6(오른쪽을 본다) · `pollen` 6×6 · `petal` 8×6 · `storm` 12×12 · `shade` 10×10 — `GameScene` 이 `mk()` 로 그리는 코드 그림과 같은 이름·크기. 쓰려면 `load.ts` 에 `projSheet(name)` 같은 읽기 함수를 두고 `mk()` 자리에서 파일이 있으면 그 캔버스로 텍스처를 만든다 (manifest 에는 이미 적혀 있다).
- `public/art/ending.png` 120×90 (별 하늘 · 초승달 · 옥빛 궁궐 꼭대기 · 소원 구슬을 든 기본 대원), `ending-bg.png` 는 대원 없이 구슬만 떠 있는 배경. 엔딩 화면(`app.ts` `endingScreen`)은 지금 CSS 별 + `.wish-orb` + 내 캐릭터 캔버스로 그린다. 쓰려면 `.ending` 배경에 `ending-bg.png` 를 `image-rendering: pixelated` 로 깔고 그 위에 지금처럼 내 캐릭터를 올리면 된다.

## 구슬 아이콘 (`public/art/orb/<id>.png`)

- 손그림: 원소 색의 둥근 구슬 안에 동물 얼굴, 전설 구슬(현무·주작·백호·청룡)은 금테.
- 16×16 (메뉴·HUD 에서 키워 쓴다). 없으면 글자 그림(🐭 🐮 …, `orbs.json` 의 `icon`). id 는 `orbs.json` 그대로 (`rat` `ox` `dragon` … `blueDragon`).

## 코드로만 그리는 것

- 초승달 참격 · 독 포자 · 돌 투사체 · 피해 숫자(3×5 도트 글꼴) · 공격 예고(분홍 원·선) · 영체 팔 · 수호 거인(반투명) · 적 체력 바 (`src/scenes/GameScene.ts`)
- 캐릭터 만들기·처음 화면의 미리보기는 같은 시트를 DOM 캔버스로 잘라 겹친다 (`src/ui/preview.ts`).

## 로비 카드

- `shared/images/card-tower.png` (640×400) 는 **Fable 5.2 손그림**(2026-11-25)이다: `draw.py` 가 160×100 도트 그림(돌바닥 섬 · 기와 3층 돌탑 · 꼭대기의 소원 구슬 · 대원 둘 · 슬라임 · 박쥐 · 도깨비 · 골렘)을 4배로 키워 만든다. 게임 그림을 그대로 쓰므로 그림을 고치면 카드도 같이 바뀐다.
- 예전 임시 그림 `scripts/make-card.py` 는 같은 파일을 덮어쓰므로 돌리지 않는다. 다른 게임 카드처럼 SpriteCook 그림으로 바꿀 것 (다시 그릴 목록 6번).

## 소리

새 소리는 없다. 공용 `shared/sound.js` 의 이름을 빌려 쓴다: `twelveSlash`(칼) · `survPop`(적중) · `survSlash`(처치) · `twelveHurt`(피격) · `twelveLevel`(레벨 업) · `survChest`(상자) ·
`twelveRare`(구슬) · `tankBuild`(문 잠김·철문) · `toggle`(문 열림) · `tankBoom`(바위·영체 팔) · `boost`(초승달 참격) · `cutin`(각성) · `survBossWarn` · `survBossDown` ·
`tankHeal`(물약·샘) · `newRecord`(부활) · `coin`(상점) · `goal`(층 돌파) · `lose`(쓰러짐) · `click`.

## SpriteCook 으로 만들 것 (크레딧이 생기면)

지금은 아래 전부와 2~10구역(타일 시트 9장 · 적 60종 · 투사체 6종 · 엔딩 그림)이 Fable 손그림이다 (다시 그릴 목록 6·7번). 자세한 규격과 넣는 방법은 `art/spritecook/REDRAW-QUEUE.md` 6번.

1. 캐릭터 레이어 18장 (위 규격, 몸 2 · 얼굴 4 · 옷 4 · 머리 8) — 레이어마다 같은 자세 틀이 필요하므로 몸 시트를 먼저 만들고 그 위에 그린다
2. 돌 복도 타일 22칸 · 1구역 적 6종 · 구슬 아이콘 16개 · 로비 카드
