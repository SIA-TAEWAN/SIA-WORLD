# 시아의탑 — 그림 규격과 교체 방법

지금 그림은 모두 **코드로 그린 임시 도트**(`src/art/sheets.ts`)다. 같은 규격의 PNG 를 `public/art/` 에 넣고
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

칼은 레이어에 없다: 공격 칸의 팔 모양 + 화면이 그리는 흰 칼 자국(`GameScene.drawSlash`).

## 타일 (`public/art/tiles.png`)

- 한 칸 **16×16**, 가로 한 줄 22칸 = **352×16**. 순서(`TILE_ORDER`):
  `floor` 바닥 · `floor2` 금 간 바닥 · `wallTop` 벽 윗면 · `wallFace` 벽 앞면(아래가 바닥인 벽) · `doorOpen` 열린 문턱 · `doorLocked` 잠긴 문(창살) ·
  `water` 물 · `pillar` 기둥 · `gate` 철문(스위치로 열림) · `rock` 금 간 바위 · `switch` 스위치 · `switchOn` 켜진 스위치 · `vine` 덩굴 ·
  `stairs` 계단 · `chest` 상자 · `chestOpen` 연 상자 · `pedestal` 구슬 받침대(구슬 있음) · `pedestalEmpty` 빈 받침대 · `shop` 상인 · `fountain` 샘 · `rubble` 잔돌 · `fountainDry` 마신 샘
- 1~10층 테마 "탑의 입구(돌 복도)": 바닥 `--roulette-winter`, 벽 `--ink-soft`/`--empty-line`, 테두리 `--outline` (DESIGN.md 의 기존 색만).
- 구역이 늘면 `tiles-<theme>.png` 로 나눌 예정 (floors.json 의 `theme`).

## 적 (`public/art/enemy/<id>.png`)

- 한 칸 size×size, 가로 4칸: `0·1` 걷기 · `2` 공격 준비(예고) · `3` 맞음. 오른쪽을 본다 (왼쪽은 뒤집는다).
- size: 일반 16 (`slime` 진흙 슬라임 · `bat` 동굴 박쥐 · `spitter` 독버섯 · `goblin` 돌 도깨비), 정예 24 (`knight` 돌갑옷 무사), 보스 32 (`golem` 문지기 골렘).

## 구슬 아이콘 (`public/art/orb/<id>.png`)

- 16×16 (메뉴·HUD 에서 키워 쓴다). 없으면 글자 그림(🐭 🐮 …, `orbs.json` 의 `icon`). id 는 `orbs.json` 그대로 (`rat` `ox` `dragon` … `blueDragon`).

## 코드로만 그리는 것

- 초승달 참격 · 독 포자 · 돌 투사체 · 피해 숫자(3×5 도트 글꼴) · 공격 예고(분홍 원·선) · 영체 팔 · 수호 거인(반투명) · 적 체력 바 (`src/scenes/GameScene.ts`)
- 캐릭터 만들기·처음 화면의 미리보기는 같은 시트를 DOM 캔버스로 잘라 겹친다 (`src/ui/preview.ts`).

## 로비 카드

- `shared/images/card-tower.png` (640×400) 는 `python games/tower/scripts/make-card.py` 로 코드로 그린 **임시 그림**이다 (돌탑 + 소원 구슬 + 도트 대원 + 골렘). 다른 게임 카드처럼 SpriteCook 그림으로 바꿀 것.

## 소리

새 소리는 없다. 공용 `shared/sound.js` 의 이름을 빌려 쓴다: `twelveSlash`(칼) · `survPop`(적중) · `survSlash`(처치) · `twelveHurt`(피격) · `twelveLevel`(레벨 업) · `survChest`(상자) ·
`twelveRare`(구슬) · `tankBuild`(문 잠김·철문) · `toggle`(문 열림) · `tankBoom`(바위·영체 팔) · `boost`(초승달 참격) · `cutin`(각성) · `survBossWarn` · `survBossDown` ·
`tankHeal`(물약·샘) · `newRecord`(부활) · `coin`(상점) · `goal`(층 돌파) · `lose`(쓰러짐) · `click`.

## SpriteCook 으로 만들 것 (크레딧이 생기면)

1. 캐릭터 레이어 18장 (위 규격, 몸 2 · 얼굴 4 · 옷 4 · 머리 8) — 레이어마다 같은 자세 틀이 필요하므로 몸 시트를 먼저 만들고 그 위에 그린다
2. 돌 복도 타일 22칸 · 1구역 적 6종 · 구슬 아이콘 16개 · 로비 카드
