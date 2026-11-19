# 시아디펜스 — 그림·소리 현황과 나중에 만들 것

요괴 9종·보스 12종은 **시아서바이벌에서 만든 SpriteCook 그림**(`games/survival/public/art/e-*.png` `b-*.png`)을 그대로 복사해 쓴다 (`public/art/`, asset id 는 `spritecook-assets.json`).
캐릭터는 공용 십이지 그림(`shared/images/zodiac/full/<id>.png` 전신, `face/<id>.png` 얼굴) 한 장을 코드로 움직인다 (숨쉬기·공격할 때 내밀기·좌우 뒤집기).
**8단계에 SpriteCook 으로 만든 것** (Nano Banana 2.1, 22장 · 264 크레딧. 원본 `art/`, asset id `spritecook-assets.json`, 만드는 법 `python art/build.py`):
바닥 무늬 4종(`tile-*`) · 배치 칸(`slot` `slotOn`) · 투사체 7종(`p-*`) · 이펙트 5종(`fx-pop` `fx-wool` `fx-coin` `fx-slash` `fx-bell`) · 메인 그림(`main`) · 지역 지도 그림(`map`) · 로비 카드(`shared/images/card-defense.png`).
아직 **코드로 그리는 것**: 길(굵은 선 + 테두리 + 가운데 점) · 입구/출구 표지판 · 사거리 원 · 고리·원판·광선(색을 입혀 쓰는 흰 그림) · 강화 별 · 체력 바.
- 판 위의 그림: `src/scenes/art.ts` (받은 그림 이름 `ART_FILES` + 못 받았을 때의 코드 그림) · `src/scenes/GameScene.ts` 의 `drawBoard`(길·표지판)
- 메뉴의 그림: 메인의 `.hero`(받은 그림 `main.png`, 못 받으면 CSS 로 그린 길 위의 캐릭터와 요괴) · 지역 지도 위의 `map.png` · 스테이지 축소 그림 `.thumb`(코드) · HUD 아이콘은 이모지

새 그림은 SpriteCook으로 만들어 원본을 `games/defense/art/<이름>.png` 에 두고 `art/build.py` 의 표에 크기를 적어 `public/art/` 로 만든 다음,
`src/scenes/art.ts`의 `ART_FILES`(와 어느 판에서나 쓰면 `COMMON_ART`)에 그 이름(확장자 빼고)을 적는다. 그러면 그 그림을 먼저 쓰고, 못 불러올 때만 코드 그림으로 대신한다 (시아서바이벌과 같은 방식).
파일을 넣지 않은 이름은 `ART_FILES`에 적지 않는다 (판마다 404 요청이 나간다).
**그림의 크기는 코드 그림과 같아야 한다** (화면에는 배율로 그리기 때문이다. 바닥 무늬만 예외: 160보다 크면 한 장이 4칸을 덮게 줄여 쓴다).

스타일: 굵은 갈색 외곽선(`#2A1A10`), 밝은 단색, 흐린 그림자 없음, 장난감·스티커 느낌, 2등신 (DESIGN.md).
요괴도 무섭지 않고 **귀엽게**. 배경은 투명. 캐릭터·요괴는 모두 **오른쪽을 보게** 그린다 (코드가 좌우를 뒤집는다).

## 화면 기준

- 기준 화면 720×1280 (세로). 판은 가로 9칸 × 세로 11칸, 한 칸 80px → 720×880. 위 150px 은 HUD, 아래 250px 은 캐릭터 카드.
- 판은 위에서 내려다본 모습 (탑뷰에 가까운 3/4 시점). 길 너비 64px, 배치 칸 68×68px.
- 그림은 화면에 그려지는 크기의 **2배**로 만든다 (휴대폰 3배 화면에서도 선명하게).

## 1. 요괴 9종 · 보스 12종 — 그림 있음 (시아서바이벌 것)

| 이름(`ART_FILES`) | 내용 | 화면 크기 | 지금 쓰는 곳 |
|---|---|---|---|
| `e-imp` `e-wisp` | 꼬마 도깨비 · 도깨비불 | 64 · 54 | 1지역 |
| `e-club` `e-water` `e-fox` `e-bamboo` `e-guard` `e-skeleton` `e-spirit` | 방망이 도깨비 · 물귀신 · 여우불 · 죽순 요괴 · 수문장 요괴 · 해골 병사 · 원혼 | 60~84 | 2~12지역 |
| `b-bigDokkaebi` | 큰 도깨비 | 128 | 1-5 |
| `b-dueoksini` `b-bulgasal` `b-jangsanbeom` `b-centipede` `b-gumiho` `b-guardCaptain` `b-yagwanggwi` `b-imugi` `b-reaper` `b-gangcheori` `b-yeomra` | 2~12지역 보스 (왕지네의 마디·구미호의 분신은 같은 그림을 작게) | 120~148 | 2-5 ~ 12-5 |

더 만들면 좋은 것 (없어도 된다. 지금은 같은 그림을 코드로 움직이거나 색을 입힌다):

| 파일 | 내용 | 크기 | 지금 |
|---|---|---|---|
| `e-<id>-walk.png` × 9 | 걷기 4프레임 가로 시트 | 프레임 128×128 | 한 장을 통통 튀게 |
| `e-bamboo-hide.png` · `e-skeleton-down.png` · `e-spirit-ghost.png` | 숨은 죽순 · 쓰러진 해골 · 무적 상태의 원혼 | 128×128 | 같은 그림을 작고 흐리게 · 눕혀서 흐리게 · 흐리게 |
| `b-centipede-seg.png` · `b-gumiho-clone.png` | 왕지네의 마디 · 구미호의 분신 | 128×128 | 보스 그림을 작게 |
| `b-bigDokkaebi-dash.png` | 큰 도깨비 돌진 자세 | 256×256 | 벼를 때 부들부들 + 돌진 중 노란 색조 |

## 2. 십이지 캐릭터 공격 동작 (12종)

지금: 전신 그림 한 장(`shared/images/zodiac/full`) + 코드 움직임. 정식 동작을 만들면 `GameScene.drawTowers` 가 시트를 쓰도록 바꾼다.

| 파일 | 내용 | 크기 |
|---|---|---|
| `char-<id>-idle.png` × 12 | 서 있는 모습 2프레임 (오른쪽 보기). id: rat ox tiger rabbit dragon snake horse sheep monkey rooster dog pig | 프레임 192×192 (시트 384×192) |
| `char-<id>-attack.png` × 12 | 공격 3프레임: 쥐 표창 던지기 · 소 방울 울리기 · 호랑이 발톱 휘두르기 · 토끼 떡 던지기 · 용 여의주 광선 · 뱀 독 뱉기 · 말 활 쏘기 · 양 구름 불기 · 원숭이 돌 던지기 · 닭 울기 · 개 짖기(강아지 보내기) · 돼지 엽전 세기 | 프레임 192×192 (시트 576×192) |

## 3. 투사체 · 이펙트

| 이름 | 내용 | 화면 크기 | 파일 크기 | 지금 |
|---|---|---|---|---|
| `p-shuriken` | 쥐의 표창 (빙글빙글 돈다) | 24 | 48×48 | **SpriteCook** |
| `p-cake` | 토끼의 달떡 (흰 떡) | 32 | 64×64 | **SpriteCook** |
| `p-venom` | 뱀의 독 방울 | 24 | 48×48 | **SpriteCook** |
| `p-arrow` | 말의 화살 (오른쪽을 본다. 코드가 나는 쪽으로 돌린다) | 32×16 | 64×32 | **SpriteCook** |
| `p-stone` | 원숭이가 던지는 것 (복숭아) | 24 | 48×48 | **SpriteCook** |
| `p-feather` | 닭의 깃털 | 24 | 48×48 | **SpriteCook** |
| `p-puppy` | 개가 보내는 강아지 (오른쪽으로 달린다) | 35 | 64×64 | **SpriteCook** |
| `fx-pop` | 요괴가 쓰러질 때의 번쩍임 | 60 안팎 | 192×192 | **SpriteCook** |
| `fx-wool` | 흰 연기 (되살아남 · 독 번짐 · 되팔기) | 범위 지름 | 192×192 | **SpriteCook** |
| `fx-coin` | 돼지가 기운을 벌 때 떠오르는 엽전 | 38 | 64×64 | **SpriteCook** |
| `fx-slash` | 호랑이의 발톱 자국 (3줄, 공격 방향으로 돌린다) | 75~150 | 256×256 | **SpriteCook** (못 받으면 코드 `slash`: 흰 호 세 줄) |
| `fx-bell` | 소의 방울 (울릴 때 소 머리 위로 흔들리며 떠오른다. 퍼지는 고리는 코드 `ring`) | 40 | 96×96 | **SpriteCook** |
| `ring` | 소의 방울 · 요괴 통과 · 보스의 멈춤 · 배치/강화 (색을 입혀 쓴다) | 사거리 지름 | 256×256 | 코드 (흰 고리) |
| `disc` | 달떡이 터진 자리 · 양털 구름 | 범위 지름 | 256×256 | 코드 (흰 원판) |
| `beam` | 용의 여의주 광선 (손에서 사거리 끝까지 뻗는 띠) | 길이 = 사거리 | 256×40 | 코드 (노란 띠 + 흰 심) |
| `dizzy` | 멈춘 요괴 머리 위의 별 | 22 | 40×40 | 코드 (노란 별) |
| `p-fire` | 불덩이 (원본만 있다 — 불 공격이 생기면 쓴다) | - | - | 쓰지 않음 |

## 4. 바닥 무늬 · 길 · 배치 칸

바닥은 받은 무늬(`tile-<배경>`, 512×512 한 장이 판의 4칸)를 DESIGN.md 의 바탕색과 절반쯤 섞어 옅게 깐다 (캐릭터·요괴가 잘 보이게. `art/build.py` 의 `TILES`).
길은 코드로 그린 굵은 선(테두리 + 바닥색 + 가운데 점)이다 — 스테이지마다 길 모양이 달라 타일 세트보다 선이 깔끔하다.

| 이름 | 내용 | 파일 크기 | 지금 |
|---|---|---|---|
| `tile-field` | 들판 바닥 (1~3지역): 풀밭과 작은 꽃 | 512×512 이음매 없는 타일 | **SpriteCook** (바탕 `#7CC08A`) |
| `tile-bamboo` | 대숲 바닥 (4~6지역): 이끼와 댓잎 | 512×512 | **SpriteCook** (바탕 `#6CC6B5`) |
| `tile-palace` | 궁궐 바닥 (7~9지역): 네모난 돌바닥 | 512×512 | **SpriteCook** (바탕 `#7FB8E8`) |
| `tile-underworld` | 저승 바닥 (10~12지역): 갈라진 바위와 푸른 불씨 | 512×512 | **SpriteCook** (바탕 `#C9D1DD`) |
| `slot` · `slotOn` | 빈 배치 칸 (돌 받침 + 더하기 표시) · 캐릭터가 놓인 받침 (같은 그림을 노랗게) | 136×136 | **SpriteCook** (slotOn 은 build.py 가 만든다) |
| `road-<배경>` × 4 | 길 타일 세트: 곧은 길 · 굽이 · 갈림 (길 너비 64, 칸 80) | 칸 160×160, 시트 4×4 | 코드 (굵은 선) |
| `sign-enter` · `sign-village` | 입구(요괴가 나오는 굴) · 출구(마을 입구 문) | 160×160 | 코드 (분홍 '요괴' · 노랑 '마을' 글자 표지판) |
| `deco-<배경>-1~4` | 길가 꾸밈 (대나무 · 등불 · 비석 등) | 128×128 | 없음 |

## 5. 지역 지도 · 메인

| 이름 | 내용 | 파일 크기 | 지금 |
|---|---|---|---|
| `map` | 지역 지도 그림: 들판 → 대숲 → 궁궐 → 저승으로 이어지는 길 (지역 목록 맨 위) | 960×400 | **SpriteCook** |
| `main` | 메인 화면 그림: 마을 앞을 지키는 십이지와 산에서 내려오는 요괴 | 540×960 | **SpriteCook** (못 받으면 CSS 로 그린 길 + 캐릭터 3 + 요괴 4) |
| `map-region-<1~12>` | 지역별 스테이지 지도 (굽잇길 위에 스테이지 5곳, 맨 위가 보스) | 720×900 | 코드 (배경색 체크 무늬 + SVG 굽잇길 + 둥근 스테이지 단추) |
| `node-stage` · `node-boss` · `node-locked` | 스테이지 단추 | 128×128 | 코드 (흰 원 + 숫자 / 보스 그림 / 자물쇠) |
| `icon-endless` | 끝없는 고개 입구 | 128×128 | ♾️ 이모지 |

## 6. 캐릭터 카드 · HUD 아이콘

| 이름 | 내용 | 만들 크기 | 지금 |
|---|---|---|---|
| `card-<id>` × 12 | 판 아래의 캐릭터 카드 그림 (얼굴 + 무기) | 192×192 | `shared/images/zodiac/face/<id>.png` 원형 얼굴 |
| `icon-life` · `icon-energy` · `icon-coin` · `icon-star` | 생명 · 기운 · 엽전 · 별 | 64×64 | 이모지 ❤️ ✨ 🪙 ⭐ / 글자 ★ |
| `icon-upgrade` · `icon-sell` · `icon-speed` · `icon-pause` | 강화 · 되팔기 · 배속 · 일시정지 | 64×64 | 글자 · 이모지 |
| `pip-1~3` | 강화 단계 별 | 96×36 | 노란 별 1~3개 (코드 그림) |
| `shared/images/card-defense.png` | SIA WORLD 게임 선택 화면의 카드 | 640×400 | **SpriteCook** (`art/card.png` 의 가운데를 16:10 으로 잘라 줄임) |

## 7. 소리

효과음은 `shared/sound.js` 에 이미 있는 소리를 빌려 쓴다 (`src/ui/gameView.ts` 의 `run.onEvent`. 공용 모듈은 건드리지 않았다).
시아디펜스 전용 이름을 공용 모듈에 더하면 아래 표의 왼쪽 이름으로 바꾼다.

| 이름(나중에) | 쓰는 곳 | 지금 쓰는 소리 |
|---|---|---|
| `defPlace` · `defUpgrade` · `defSell` | 배치 · 강화 · 되팔기 | `tankBuild` · `survLevel` · `coin` |
| 캐릭터별 공격음 10종 | 합쳐서 0.11초에 한 번, 작게 (`ui/sfx.ts` 의 `attackSfx`). 양·돼지는 없다 | `survShot`(쥐 1.3 · 말 0.7 · 원숭이 1.6) · `tankTurn`(소) · `survSlash`(호랑이 1 · 닭 1.7) · `survPop`(토끼 0.85 · 뱀 1.4 · 개 1.1) · `tankLaser`(용) — 숫자는 높낮이 |
| `defLeak` | 요괴 통과 경고음 (+ 화면 가장자리 번쩍, 생명 5 이하면 가장자리가 계속 깜빡인다) | `survHurt` |
| `defWave` · `defStart` | 웨이브 시작 · 판 시작 | `turn` · `raceGo` |
| `defBossWarn` · `defBossDash` · `defBossDown` | 보스 경고 · 특수 행동 · 처치 | `survBossWarn` · `cutin` · `survBossDown` |
| `defClear` · `defFail` · `defStar` | 클리어 · 실패 · 결과의 별 | `win` · `lose` · `coin` |

배경음은 `src/ui/music.ts` 가 코드로 연주하는 반복곡이다 (시아서바이벌의 연주기). 메인 · 배경 4종(들판·대숲·궁궐·저승) · 보스.
`shared/sounds/` 에 아래 이름의 `.ogg`(또는 `.mp3`)를 넣으면 그 파일을 반복 재생한다:
`bgmDefMain` · `bgmDefField` · `bgmDefBamboo` · `bgmDefPalace` · `bgmDefUnderworld` · `bgmDefBoss`.
소리 버튼(오른쪽 아래 🔊)은 효과음과 배경음을 함께 켜고 끈다 (공용 설정 `sia:sound` · `sia:bgm`).
