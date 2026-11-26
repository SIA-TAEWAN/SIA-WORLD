# 시아카드배틀 그림 (ASSETS)

그림은 전부 `public/art/<이름>.png` 에 있고, `src/art.ts` 의 `ART_FILES` 에 적힌 이름만 받는다 (`tests/art.test.ts` 가 폴더와 목록이 같은지, 데이터의 그림 이름이 다 있는지 본다).
못 읽으면 코드 그림·글자로 바뀐다: 캔버스는 `this.textures.exists`, HTML 은 `artImg()` 의 `onerror`, 카드 틀·지도 칸 시트는 처음 화면 전에 `preloadUi()` 로 읽어 보고 못 읽으면 코드 카드·글자 그림.
주소 뒤에 `?v=<빌드 판본>` (`vite.config.ts` 의 `__CARD_BUILD__`) — 배포 뒤 서비스 워커가 옛 그림을 내주지 않게.

## 새 그림 5장 (2026-11-26, 시아카드배틀 전용)

전부 SpriteCook `gemini-nano-banana-2.1` (1K, HD · pixel 아님), 한 장에 12 크레딧씩 60 크레딧. 직접 그린 것 없음.
받은 그림을 PIL 로 크기·투명만 정리했다. asset id 는 `spritecook-assets.json`. (처음에는 `art-new/` 에 두었다가 3단계에서 `public/art/` 로 옮김)

| 파일 | 크기 | 칸 | 내용 |
| --- | --- | --- | --- |
| `public/art/card-frame.png` | 512×712 (256×356 의 2배) | 1장 | 카드 틀. 투명 배경, 중립 밝은 회색·흰색 + 갈색 외곽선 |
| `public/art/intent.png` | 640×128 | 가로 5칸 · 칸 128×128 | 0 공격(칼) · 1 방어(방패) · 2 강화(팔뚝+위 화살표) · 3 방해(보라 구름+아래 화살표) · 4 모름(물음표) |
| `public/art/energy.png` | 128×128 | 1개 (구슬 지름 120, 둘레 4px 여백) | 금빛 기력 구슬. 숫자는 코드로 가운데에 |
| `public/art/map-nodes.png` | 768×128 | 가로 6칸 · 칸 128×128 | 0 전투(엇갈린 칼) · 1 정예(뿔 도깨비 얼굴) · 2 상점(좌판) · 3 쉼터(모닥불) · 4 보물(상자) · 5 이야기(물음표 두루마리) |
| `shared/images/card-card.png` | 640×400 | 1장 | 로비 카드 (불투명) |

### 카드 틀 자리 (512×712 기준 — `art.ts` 의 `FRAME`)

- 그림 칸: x 57~454, y 57~376 (397×319). **투명하게 뚫려 있다** — 카드 그림을 틀 아래에 먼저 그리고 틀을 위에 덮는다. 틀을 색 입힘(tint) 해도 그림은 영향받지 않는다. 그림 칸 왼쪽 위 귀퉁이는 기력 원, 아래쪽은 이름 띠가 살짝 덮는다.
- 기력 원: 중심 (70, 65), 안쪽 흰 원 반지름 약 42, 바깥 테 반지름 약 58. 화면은 여기에 `energy.png` 를 얹고 숫자를 쓴다.
- 이름 띠: 글자 자리 x 80~435, y 395~455 (가운데 (256, 425)).
- 설명 칸: x 42~472, y 496~670.
- 색: 틀 몸통이 밝은 회색이라 곱하기 tint 로 종류색을 입힌다(캔버스 `setTint`, HTML 은 틀 모양으로 가린 `mix-blend-mode: multiply` 층). 설명 칸도 같이 물들어서 그 위에 흰 칸을 코드로 다시 깐다. 등급 테두리는 코드 선(`RARITY_RING`).

### 시트 칸

- 두 시트 모두 아이콘을 같은 배율로 줄여(가장 큰 변 116px) 칸 가운데에 놓았다. 칸 사이 선·테두리 없음.
- 의도: Phaser `spritesheet('intent', 128)`, 프레임 = 위 표의 순서 (`INTENT_FRAME`). 지도 칸: CSS `background-size: 600% 100%` + `background-position: 칸×20% 0` (`MAP_NODE_FRAME`).

### 로비 카드

- 16:9 원본(1376×768)을 가로 4% 줄이고 왼쪽을 잘라 16:10 으로 맞춤 (오른쪽 도깨비불이 잘리지 않게).
- 다른 로비 카드와 같은 이름 규칙: `shared/images/card-<게임 id>.png`.

## 기존 그림 (3단계에서 복사)

PRD [그림] 절대로 시아열두길(`games/twelve/public/art`)·시아핑거(`games/finger/public/art`)·공용(`shared/images/cards/back.png`)에서 그대로 복사했다 (바이트가 같음). 같은 이름이 두 게임에 있으면 열두길 것 (`fx-poison` 은 열두길 192px 판, 나머지 겹치는 것은 같은 파일).

| 무엇 | 파일 | 원본 | 화면에서 |
| --- | --- | --- | --- |
| 영웅 시트 13 | `hero-<id>` (960×576, 5칸 × 3줄, 칸 192) | 열두길 | 전투 영웅 — 앞줄 서기(0)·공격(3) 칸. 못 읽으면 `shared/images/zodiac/full/<id>.png` → 코드 그림 |
| 영웅 컷인 13 | `cut-<id>` (400×400) | 핑거 | 전설 카드 컷인 · 고양이 패시브 · 영웅 고르기 큰 그림 |
| 영웅 아이콘 13 | `ic-u-<id>` | 열두길 | 영웅 전용 카드 그림 (전용1·전용2 같은 그림) |
| 보스 12 + 최종 | `b-<boss>` (640) · `b-final` (512) | 열두길(원본은 디펜스) | 전투 요괴 · 지도 맨 위 보스 얼굴 |
| 보스 공격 동작 | `b-<boss>-atk` · `b-final-atk` (가로 2칸, 칸 448) | 열두길 | 보스·정예의 공격 행동(예고 → 내려치기) · 2단계 컷인 |
| 보스 맞은 모습 | `b-<boss>-hit` | 핑거 | 맞으면 0.26초 이 그림 |
| 요괴 15 | `e-<id>` | 열두길 | 전투 요괴 |
| 정예 모습 9 | `e-<id>-elite` | 열두길 | `e-fox-elite` = 갈림길의 여우 정예 '천년 여우'(4단계). 나머지 8장은 아직 안 씀 (PROGRESS '물어볼 것' 14) |
| 요괴 맞은 모습 9 | `e-<id>-hit` | 핑거 | 맞으면 잠깐 이 그림 (없으면 분홍으로 물들임) |
| 아이콘 86 | `ic-*` (무기 `ic-w-<종류>-0~11` 포함) | 열두길 | 카드·부적·물약 그림 (데이터의 `art`) |
| 효과 19 | `fx-*` | 열두길 14 · 핑거 5 (`boom` `coin` `fang` `heal` `shield`) | 카드 그림 · 카드를 쓸 때 효과 (`fxForCard`) · 맞음 `fx-claw` · 방어 `fx-shield` · 회복 `fx-heal` · 쓰러짐 `fx-pop` · 승리 `fx-coin` |
| 날아가는 것 7 | `p-*` | 열두길 | 카드·부적 그림 |
| 상태이상 4 | `st-fire|mud|poison|water` (오토타일셋 4x4, 칸 120) | 열두길 | 꽉 찬 칸(6번)을 동그랗게 잘라 상태 아이콘 (`makeStatusIcons`) — 약화·힘은 코드 그림 |
| 지역 배경 4 | `bg-<지역>` (480×270) | 핑거 | 전투 배경 (위 580 을 꽉 채움) |
| 지도 바닥 4 | `tile-<지역>` (512) | 열두길 | 지도 바탕에 옅게 |
| 장면 | `shop` · `forge` (720×320) · `story-1~4` · `ending-1~4` · `finale-1~4` (720×400) · `chest` · `exit` | 열두길 | 상점 · 쉼터 · 이야기 · 보물 · 3막 클리어 일반 엔딩 `ending-2` → `ending-3` · 숨은 4막 입구 `ending-4` · 진짜 엔딩 `finale-1` → `finale-2` → `finale-4` · 4막에서 쓰러짐 `finale-1` (4단계). `ending-1` · `finale-3` · `exit` 는 아직 안 씀 |
| 카드 뒷면 | `back` (360×512) | `shared/images/cards/back.png` | 뽑을 더미 · 카드 보상 아이콘 |

### 스펙 목록에 있는데 원본에 없는 그림 (코드로 대신함)

- 맞은 모습 없음: `e-acorn-hit` · `e-lynx-hit` · `e-firecart-hit` · `e-catfish-hit` · `e-ferryman-hit` · `e-bomber-hit` → 맞으면 분홍으로 물들임.
- 정예 모습 없음: `e-acorn-elite` · `e-imp-elite` · `e-firecart-elite` · `e-catfish-elite` · `e-ferryman-elite` · `e-bomber-elite` (지금은 정예 모습을 쓰지 않는다).
- 의도 시트에 '방해' 칸만 있고 약화·힘 상태 아이콘 그림은 없다 → 코드 그림(글자 동그라미).

### 원본 asset id

복사한 파일의 SpriteCook asset id 는 원본 게임의 `spritecook-assets.json` 에 있다. 아래 표는 파일 해시(`sha12`)가 같은 항목, 없으면 이름(라벨)으로 찾은 항목이다 — '디펜스'는 열두길·핑거가 시아디펜스에서 복사해 온 그림(원본 목록 `games/defense/spritecook-assets.json`, 그 앞은 `games/survival`).
`ic-*` 처럼 시트에서 자른 그림은 그 시트의 id 다. `back` 은 공용 카드 뒷면이라 목록에 없다.

| 그림 | 복사한 곳 | 찾은 목록 | asset id |
| --- | --- | --- | --- |
| `b-bigDokkaebi-atk` | 열두길 | 열두길 | `81b54b4f-ad13-4477-869d-23ea05429eaa` |
| `b-bigDokkaebi-hit` | 핑거 | 핑거 (이름) | `ac0551d9-2061-4660-9164-70ff722491bb` |
| `b-bigDokkaebi` | 열두길 | 디펜스 (이름) | `993f3a16-07d7-4965-a00a-97b517281e2c` |
| `b-bulgasal-atk` | 열두길 | 열두길 | `40165d01-6a64-41e2-ba8b-1b1ffddde91c` |
| `b-bulgasal-hit` | 핑거 | 핑거 (이름) | `d44ef59b-73cd-4441-8325-1ac3d0b6f575` |
| `b-bulgasal` | 열두길 | 디펜스 (이름) | `8f821b7c-583f-461d-b7e2-1cf385858018` |
| `b-centipede-atk` | 열두길 | 열두길 | `7d683636-c7e3-42f3-a32b-38080cb625be` |
| `b-centipede-hit` | 핑거 | 핑거 (이름) | `a9362050-8391-42a6-bdfc-494c1fa79287` |
| `b-centipede` | 열두길 | 디펜스 (이름) | `2721618d-053e-4602-9868-6fb4b286880f` |
| `b-dueoksini-atk` | 열두길 | 열두길 | `cacd713b-d265-4eda-94bd-cfce4e226627` |
| `b-dueoksini-hit` | 핑거 | 핑거 (이름) | `3125c9ad-1b8d-4074-836b-a7d426217a27` |
| `b-dueoksini` | 열두길 | 디펜스 (이름) | `94bb1654-a1bc-4244-babc-02994a5504f7` |
| `b-final-atk` | 열두길 | 열두길 | `a236ca0d-8573-460a-b0ca-b132ea70904a` |
| `b-final` | 열두길 | 열두길 | `b95d130f-e387-476f-a179-24857b250a97` |
| `b-gangcheori-atk` | 열두길 | 열두길 | `fc2a461c-0da4-43f9-8745-bb59590085cc` |
| `b-gangcheori-hit` | 핑거 | 핑거 (이름) | `fa5ea4d6-46a2-4d89-9dba-1b2ab6a27cec` |
| `b-gangcheori` | 열두길 | 디펜스 (이름) | `1981ae1f-a195-4918-9ade-5e0f61f4d4d8` |
| `b-guardCaptain-atk` | 열두길 | 열두길 | `c126d325-22ab-41be-99b6-dcca9c049d77` |
| `b-guardCaptain-hit` | 핑거 | 핑거 (이름) | `d154c55f-d36d-4f0e-b2fe-9a2ee486183f` |
| `b-guardCaptain` | 열두길 | 디펜스 (이름) | `2b994bef-1cdf-43d9-8579-dddbcf5fb96f` |
| `b-gumiho-atk` | 열두길 | 열두길 | `d86888b5-c29b-485a-ba72-5043e4d62222` |
| `b-gumiho-hit` | 핑거 | 핑거 (이름) | `ab43a3e7-2159-4c7a-a70c-22e18c20993a` |
| `b-gumiho` | 열두길 | 디펜스 (이름) | `dc032871-6e0e-45bf-b355-0734dd8a4420` |
| `b-imugi-atk` | 열두길 | 열두길 | `0db1f889-6376-4e15-bf87-ee47a66dd6a7` |
| `b-imugi-hit` | 핑거 | 핑거 (이름) | `68ba5fcf-684d-498b-977b-32decca339df` |
| `b-imugi` | 열두길 | 디펜스 (이름) | `8a736dd3-f0be-4cfe-8b3a-e5575866cad2` |
| `b-jangsanbeom-atk` | 열두길 | 열두길 | `39902e26-6f8a-4db2-be68-8ea5192cd141` |
| `b-jangsanbeom-hit` | 핑거 | 핑거 (이름) | `c69d2e64-773a-4a12-b8c0-6a478c617134` |
| `b-jangsanbeom` | 열두길 | 디펜스 (이름) | `ffdd573c-54c4-4f37-9e39-09d4572ebb05` |
| `b-reaper-atk` | 열두길 | 열두길 | `f37ae72f-6957-4eec-82bd-c59c1da353d7` |
| `b-reaper-hit` | 핑거 | 핑거 (이름) | `888fac95-b9f3-4dfb-9b5c-ba98d460c972` |
| `b-reaper` | 열두길 | 디펜스 (이름) | `0db263b3-0e95-43d0-8f17-979eed089828` |
| `b-yagwanggwi-atk` | 열두길 | 열두길 | `4ad446ec-36a0-48f4-8741-a9ad3f57acd0` |
| `b-yagwanggwi-hit` | 핑거 | 핑거 (이름) | `204abb50-8700-4026-b6ad-d46f3edf9ef2` |
| `b-yagwanggwi` | 열두길 | 디펜스 (이름) | `c048f379-e201-4289-bb8c-602d3b704915` |
| `b-yeomra-atk` | 열두길 | 열두길 | `b57a072c-649f-4ad3-b360-0ed4faf46be4` |
| `b-yeomra-hit` | 핑거 | 핑거 (이름) | `8d27b7aa-c852-473d-97af-71cd252baf1a` |
| `b-yeomra` | 열두길 | 디펜스 (이름) | `80eb8231-bcc4-4799-898f-b7c62e04e4ea` |
| `back` | shared/images/cards | — | 목록에 없음 (원본 게임 note 참고) |
| `bg-bamboo` | 핑거 | 핑거 (이름) | `06f7c80c-360e-46c0-91a8-e4b4408f961a` |
| `bg-field` | 핑거 | 핑거 (이름) | `26bb0cf6-c761-4e0e-bdc4-e04b7389b1e6` |
| `bg-palace` | 핑거 | 핑거 (이름) | `c8980bd7-4616-40c6-8976-32655886bef3` |
| `bg-underworld` | 핑거 | 핑거 (이름) | `a4831b92-1aa7-4b8c-95de-4cc649f278e9` |
| `card-frame` | 카드배틀(새 그림) | 카드배틀 | `b7fb98dd-6d74-46e6-b358-352c1afd7f49` |
| `chest` | 열두길 | 열두길 | `d8716a84-295b-4696-b6d8-9e7dc8a64401` |
| `cut-cat` | 핑거 | 핑거 (이름) | `22f459d3-627c-47b7-a97f-943125774330` · `4b3ae64a-9a50-48a2-9451-e0fc5d5f42ef` |
| `cut-dog` | 핑거 | 핑거 (이름) | `e96f60c2-a988-49c4-a9ae-16bb99c71ca7` · `f2870d57-044a-48b9-b26c-1e554a7be70b` |
| `cut-dragon` | 핑거 | 핑거 (이름) | `d9a9bddd-898a-4c23-a627-2091db7748ec` · `16ef52e3-7076-4ad5-b951-6601626c7675` |
| `cut-horse` | 핑거 | 핑거 (이름) | `e10a654c-9872-49c5-92fe-93495a9f5bab` · `59b4e125-18ec-49cc-bbd7-4742c55011c6` |
| `cut-monkey` | 핑거 | 핑거 (이름) | `0a2dd3fb-9201-4879-b208-0f6136e5cbd9` · `74bfe249-0047-47da-a31a-7fd1c0278337` |
| `cut-ox` | 핑거 | 핑거 (이름) | `dc9c62d0-0f58-4ef0-b235-7087a6900e89` · `523df5ae-ea75-4a05-8687-2d755c0ef00c` |
| `cut-pig` | 핑거 | 핑거 (이름) | `dd5b5bed-3332-4fe7-b959-bec948aabdf1` · `eec9b534-38b9-4086-a6b0-b13a3dc0ff76` |
| `cut-rabbit` | 핑거 | 핑거 (이름) | `b79acc56-c452-4e58-b2c6-de6796d190a5` · `2fffc97e-a29c-408c-8550-db1724903d17` |
| `cut-rat` | 핑거 | 핑거 (이름) | `165c2478-29f1-4e4d-8a49-b9b8e740f0c0` · `d08e55e9-08e2-448c-97ec-0534751b3884` |
| `cut-rooster` | 핑거 | 핑거 (이름) | `626ff7ea-e35a-4203-b885-2544b06db362` · `c6ed60e4-1bcf-486a-b45b-90c9ad2e70a9` |
| `cut-sheep` | 핑거 | 핑거 (이름) | `938dbc60-e3d0-4a5b-8eb6-ebbd78df0d3a` · `2b8746b5-6b27-434f-a5be-edb4a5ffdb21` |
| `cut-snake` | 핑거 | 핑거 (이름) | `b88d466d-9ae0-4ff4-b5a8-ac06487ca892` · `40965d49-0868-4c7e-805b-b7405d5125b2` |
| `cut-tiger` | 핑거 | 핑거 (이름) | `a6261882-f731-4903-97e4-fd5e5ecddfa1` · `94a98ed8-dd79-4fa5-a72c-f2d63c0df509` |
| `e-acorn` | 열두길 | 열두길 | `a673b512-10b2-4812-a405-f86fcaf17e21` |
| `e-bamboo-elite` | 열두길 | 열두길 | `d2fd563a-4da5-4d8b-a392-e5841ed5e274` |
| `e-bamboo-hit` | 핑거 | 핑거 (이름) | `78583847-b59d-4b18-b2c8-8580ea69e4e0` |
| `e-bamboo` | 열두길 | 디펜스 (이름) | `3aab5e5d-8ba8-4082-aeb0-926d3f4aad06` |
| `e-bomber` | 열두길 | 열두길 | `a673b512-10b2-4812-a405-f86fcaf17e21` |
| `e-catfish` | 열두길 | 열두길 | `a48b878b-4ac6-4c47-b841-c3be9c2a185e` |
| `e-club-elite` | 열두길 | 열두길 | `d2fd563a-4da5-4d8b-a392-e5841ed5e274` |
| `e-club-hit` | 핑거 | 핑거 (이름) | `0712999d-4d7d-43a4-8a04-a6e9aee9e06a` |
| `e-club` | 열두길 | 디펜스 (이름) | `62b7b590-300c-420b-9261-911fc1626dca` |
| `e-ferryman` | 열두길 | 열두길 | `d8716a84-295b-4696-b6d8-9e7dc8a64401` |
| `e-firecart` | 열두길 | 열두길 | `d8716a84-295b-4696-b6d8-9e7dc8a64401` |
| `e-fox-elite` | 열두길 | 열두길 | `d2fd563a-4da5-4d8b-a392-e5841ed5e274` |
| `e-fox-hit` | 핑거 | 핑거 (이름) | `3be8be95-be13-4f7e-8722-92b89c1e8e2c` |
| `e-fox` | 열두길 | 디펜스 (이름) | `81394565-9af2-44e3-8797-8fab12c56ebe` |
| `e-guard-elite` | 열두길 | 열두길 | `b72a5b14-9f2a-48c6-be41-10d79d20896f` |
| `e-guard-hit` | 핑거 | 핑거 (이름) | `d6544ea5-4320-4395-94fe-17d512284eff` |
| `e-guard` | 열두길 | 디펜스 (이름) | `b6214211-0b92-4350-8ca1-e043a8a2f158` |
| `e-imp-hit` | 핑거 | 핑거 (이름) | `0978eee4-96de-4224-bec2-781193f34df2` |
| `e-imp` | 열두길 | 디펜스 (이름) | `b1e84f6b-3e8b-4943-bd28-9993fa4eda7e` |
| `e-lynx-elite` | 열두길 | 열두길 | `b72a5b14-9f2a-48c6-be41-10d79d20896f` |
| `e-lynx` | 열두길 | 열두길 | `a48b878b-4ac6-4c47-b841-c3be9c2a185e` |
| `e-skeleton-elite` | 열두길 | 열두길 | `91db11eb-cc81-44ec-becb-3f23c9586cad` |
| `e-skeleton-hit` | 핑거 | 핑거 (이름) | `0cd94af8-8723-4a00-accc-a378f088f61b` |
| `e-skeleton` | 열두길 | 디펜스 (이름) | `03a1b633-3273-4df7-9adf-ac45c37f1bba` |
| `e-spirit-elite` | 열두길 | 열두길 | `b72a5b14-9f2a-48c6-be41-10d79d20896f` |
| `e-spirit-hit` | 핑거 | 핑거 (이름) | `550729a1-31fd-4124-9dd1-cd28fe61a0be` |
| `e-spirit` | 열두길 | 디펜스 (이름) | `c9d323f1-53d8-4302-ad67-b5c0506fe3cb` |
| `e-water-elite` | 열두길 | 열두길 | `d2fd563a-4da5-4d8b-a392-e5841ed5e274` |
| `e-water-hit` | 핑거 | 핑거 (이름) | `a8a394cd-72cb-42f2-9280-77d0d79ddc73` |
| `e-water` | 열두길 | 디펜스 (이름) | `5a2aea58-d06c-40c2-870a-daf2a26903bb` |
| `e-wisp-elite` | 열두길 | 열두길 | `b72a5b14-9f2a-48c6-be41-10d79d20896f` |
| `e-wisp-hit` | 핑거 | 핑거 (이름) | `8b35619b-4453-4799-9874-7051fa4e931e` |
| `e-wisp` | 열두길 | 디펜스 (이름) | `194a7edb-df1f-436a-86dd-d95e9c313709` |
| `ending-1` | 열두길 | 열두길 | `daf13b25-7698-4334-b8a4-e8d757916b71` |
| `ending-2` | 열두길 | 열두길 | `96c8186d-e177-48a3-9ec4-cd278978a46d` |
| `ending-3` | 열두길 | 열두길 | `be5dfd56-ebbd-4417-98e6-8a40512e61c0` |
| `ending-4` | 열두길 | 열두길 | `c3e5cdd5-3b61-4afc-b355-a3c57c6f9798` |
| `energy` | 카드배틀(새 그림) | 카드배틀 | `d7bd6070-3134-402a-9ebc-367951d1ff11` |
| `exit` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `finale-1` | 열두길 | 열두길 | `eb7b3dad-67ba-4913-8213-bac9249f875c` |
| `finale-2` | 열두길 | 열두길 | `739545d1-aad6-4d80-83d6-9936761f8dea` |
| `finale-3` | 열두길 | 열두길 | `17ba50b9-0236-4684-8697-53a37058eaf5` |
| `finale-4` | 열두길 | 열두길 | `40d306b6-eb22-4512-9ab2-598c203bc2a8` |
| `forge` | 열두길 | 열두길 | `bd6cc827-d3a0-4f7e-b023-87af3063c7ac` |
| `fx-arrowfall` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-bolt` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-boom` | 핑거 | 핑거 (이름) | `c9b05ab2-9c41-427f-8ca7-853fa27cc61e` |
| `fx-claw` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-coin` | 핑거 | 디펜스 (이름) | `20c9a483-1caf-4a27-8133-008407c1d199` |
| `fx-fang` | 핑거 | 핑거 (이름) | `22566317-0aed-49fd-b4a5-68c75b60b3c9` |
| `fx-flame` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-gust` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-heal` | 핑거 | 핑거 (이름) | `f2ea7a8b-44a6-4442-a662-5ac47026dabb` |
| `fx-poison` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-pool` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-pop` | 열두길 | 디펜스 (이름) | `fd452770-a657-46ba-ac04-ce1e0ef489ee` |
| `fx-rain` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-shield` | 핑거 | 핑거 (이름) | `898ac736-4ff5-45e4-9671-28d074c99231` |
| `fx-shock` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-slash` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `fx-spin` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-thrust` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `fx-wind` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `hero-cat` | 열두길 | 열두길 | `ca929c47-3f23-4da6-8ca1-76fe5397e376` |
| `hero-dog` | 열두길 | 열두길 | `55162a3a-2908-4e1d-9a72-0527612cdcfe` |
| `hero-dragon` | 열두길 | 열두길 | `53e27989-372e-4b93-b5ed-3b466b377cc5` |
| `hero-horse` | 열두길 | 열두길 | `8a477761-0df7-4cee-8f27-e7da229e1693` |
| `hero-monkey` | 열두길 | 열두길 | `394de4bf-22da-4aa2-bea8-6a39f3acbd4e` |
| `hero-ox` | 열두길 | 열두길 | `a5bc2269-63b8-45ff-82f9-98791a78b2f2` |
| `hero-pig` | 열두길 | 열두길 | `12718e23-77b6-4069-87fc-918685d6f305` |
| `hero-rabbit` | 열두길 | 열두길 | `4be311ae-5120-442e-b84c-ca8f5419e190` |
| `hero-rat` | 열두길 | 열두길 | `30980fd8-2548-429b-852c-27af978932dd` |
| `hero-rooster` | 열두길 | 열두길 | `2a79a650-6cd9-45d0-98d2-b3561473f6e7` |
| `hero-sheep` | 열두길 | 열두길 | `3697c679-a7d8-4406-9733-a41b3a663944` |
| `hero-snake` | 열두길 | 열두길 | `4c87d45c-b359-4c5f-85e6-aff10834fb05` |
| `hero-tiger` | 열두길 | 열두길 | `9dc334d3-ed1d-4986-bfdd-f91c5ff7fd63` |
| `ic-acc-coin` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-acc-crit` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-acc-mp` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-acc-potion` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-acc-speed` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-armor` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-bow` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-coin` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-fan` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-hp` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-key` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-mp` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-roll` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-sk-bolt` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `ic-sk-dash` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `ic-sk-fork` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `ic-sk-rain` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `ic-sk-spin` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `ic-sk-throw` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `ic-sk-tornado` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `ic-sk-triple` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `ic-spear` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-star` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-stone` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-sword` | 열두길 | 열두길 | `edf52e75-9ecb-4132-80d2-354dadd9d7ec` |
| `ic-u-cat` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-dog` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-dragon` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-horse` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-monkey` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-ox` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-pig` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-rabbit` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-rat` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-rooster` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-sheep` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-snake` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-u-tiger` | 열두길 | 열두길 | `52e095ff-e701-421d-877f-f526f16e5299` |
| `ic-w-bow-0` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-bow-1` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-bow-10` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-bow-11` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-bow-2` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-bow-3` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-bow-4` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-bow-5` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-bow-6` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-bow-7` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-bow-8` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-bow-9` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-fan-0` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-fan-1` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-fan-10` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-fan-11` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-fan-2` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-fan-3` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-fan-4` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-fan-5` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-fan-6` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-fan-7` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-fan-8` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-fan-9` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-spear-0` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-spear-1` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-spear-10` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-spear-11` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-spear-2` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-spear-3` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-spear-4` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-spear-5` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-spear-6` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-spear-7` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-spear-8` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-spear-9` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-sword-0` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-sword-1` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-sword-10` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-sword-11` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-sword-2` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-sword-3` | 열두길 | 열두길 | `9e865c9c-8a41-45b4-a66b-707bfe8dca32` |
| `ic-w-sword-4` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-sword-5` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-sword-6` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-sword-7` | 열두길 | 열두길 | `c5e8a9a7-b1c6-4192-b3ba-ca681045e686` |
| `ic-w-sword-8` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `ic-w-sword-9` | 열두길 | 열두길 | `190c9487-37a3-4f26-b03c-3b81bd74e215` |
| `intent` | 카드배틀(새 그림) | 카드배틀 | `5a1317c1-02b7-40f7-b993-a6df9d3fb81a` |
| `map-nodes` | 카드배틀(새 그림) | 카드배틀 | `a9388425-7c2f-4757-8bc8-baa01b38a2ad` |
| `p-arrow` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `p-burr` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `p-fire` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `p-foxorb` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `p-orb` | 열두길 | 열두길 | `52f2b05f-c5a1-4c65-b265-6c24c969a127` |
| `p-pollen` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `p-spear` | 열두길 | 열두길 | `c7a76e6d-13df-405c-9a47-178faf735dcb` |
| `shop` | 열두길 | 열두길 | `09c0ebed-24ee-45a3-9e08-0b8ad6329317` |
| `st-fire` | 열두길 | 열두길 | `b7e13507-98e3-43c1-a7ae-6a842185b738` |
| `st-mud` | 열두길 | 열두길 | `d6c2d9ac-829a-41a2-a879-e76f8a9ffc4f` |
| `st-poison` | 열두길 | 열두길 | `2bfbb15d-370d-427c-a4d1-ec6cb55cc904` |
| `st-water` | 열두길 | 열두길 | `d9effd1b-d182-40a8-bf9b-ad609f13f568` |
| `story-1` | 열두길 | 열두길 | `b29ab7aa-7cbb-4c88-a055-bd42949050cb` |
| `story-2` | 열두길 | 열두길 | `c860de03-c8d1-4dba-8988-fb7f0e6ec8be` |
| `story-3` | 열두길 | 열두길 | `fa32c6fc-9f83-47ac-8cea-a3f3029bd8db` |
| `story-4` | 열두길 | 열두길 | `c53b5b20-d3a4-49e9-8bff-fb7a719b7e96` |
| `tile-bamboo` | 열두길 | 디펜스 (이름) | `6f24295c-9825-45d7-8893-4a6220ca656f` |
| `tile-field` | 열두길 | 디펜스 (이름) | `12011533-d60f-496a-ba2e-814c7796d093` |
| `tile-palace` | 열두길 | 디펜스 (이름) | `9dfb4f17-c6b9-4a71-ac53-7a9235056a72` |
| `tile-underworld` | 열두길 | 디펜스 (이름) | `740e5a0f-f316-4d64-a1b6-f7fffb6e033a` |
