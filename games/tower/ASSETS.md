# 시아의탑 — 그림 규격과 교체 방법

1·2구역(1~20층) 그림은 **Fable 5.2 손그림**(2026-11-25)이다: 캐릭터 레이어 18장 · `tiles.png` · `tiles-moss.png` · 적 12종 · 구슬 아이콘 16개 · 로비 카드.
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

### 2구역 "이끼 낀 회랑" (`public/art/tiles-moss.png`, 11~20층, Fable 손그림 2026-11-25)

- 432×16, 같은 27칸. 바닥 `--roulette-autumn` + 줄눈 `--matgo-mat-light`, 금 간 바닥 자리는 이끼 덩어리, 벽 윗면은 이끼(`--table-matgo`)가 덮고 돌이 조금 드러남,
  벽 앞면은 `--ink-soft` 벽돌에 이끼(`--matgo-mat-dark`)가 흘러내림, 물 `--team-a`. 기둥·바위·받침대·샘·화로 같은 물건 칸은 1구역 그림에 이끼 점을 얹었다 (`draw.py` 의 `MOSS_ON`).

## 적 (`public/art/enemy/<id>.png`)

- 한 칸 size×size, 가로 4칸: `0·1` 걷기 · `2` 공격 준비(예고) · `3` 맞음. 오른쪽을 본다 (왼쪽은 뒤집는다).
- size: 일반 16 (`slime` 진흙 슬라임 · `bat` 동굴 박쥐 · `spitter` 독버섯 · `goblin` 돌 도깨비), 정예 24 (`knight` 돌갑옷 무사), 보스 32 (`golem` 문지기 골렘).
- 2구역 (Fable 손그림 2026-11-25): 일반 16 — `sprout` 가시 덩굴싹(흙에 뿌리박은 봉오리, 준비 칸은 입을 벌림) · `moth` 이끼 나방(연두 날개·분홍 점, 준비 칸은 독 가루) · `lizard` 이끼 도마뱀(등에 이끼, 준비 칸은 몸을 낮추고 꼬리를 세움) · `toad` 바위 두꺼비(등이 바위, 준비 칸은 웅크림), 정예 24 — `treant` 고목 수호자(이끼 머리·옹이 눈·뿌리 팔, 준비 칸은 팔을 듦), 보스 32 — `imugi` 이끼 이무기(똬리 튼 초록 뱀·이끼 비늘·돋기 시작한 뿔·노란 눈, 준비 칸은 입을 벌림).

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

지금은 아래 전부와 2구역(`tiles-moss.png` · 적 6종)이 Fable 손그림이다. 자세한 규격과 넣는 방법은 `art/spritecook/REDRAW-QUEUE.md` 6번.

1. 캐릭터 레이어 18장 (위 규격, 몸 2 · 얼굴 4 · 옷 4 · 머리 8) — 레이어마다 같은 자세 틀이 필요하므로 몸 시트를 먼저 만들고 그 위에 그린다
2. 돌 복도 타일 22칸 · 1구역 적 6종 · 구슬 아이콘 16개 · 로비 카드
