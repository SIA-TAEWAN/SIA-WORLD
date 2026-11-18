# SIA WORLD 디자인 가이드

SIA WORLD의 모든 게임(시아탱크, 시아맞고, 시아카지노, 시아레이스)은 이 문서를 따른다.
기준 화면: 시아탱크 **AI 1:1 설정** 화면.

> 아래 값은 시아탱크(`games/tank/src/style.css`)의 **실제 값**으로 고쳤다 (2026-11-17).
> 시아탱크에 없는 값(결과 색, 게임별 테이블 색, 룰렛 색)은 이 문서에서 새로 정한 값이다.
> 공통 값은 `shared/theme.css`(CSS 변수)와 `shared/theme.js`(Phaser용 숫자 색상)로 한 곳에서 관리한다. 두 파일을 함께 고친다.

---

## 1. 분위기

- **캐주얼, 밝고 귀여운 모바일 보드게임 앱** 느낌
- 두꺼운 갈색 외곽선 + 크림색 판 + 노란 강조색 = "스티커 / 장난감" 같은 질감
- 그림자보다 **외곽선과 아래쪽 두께**로 입체감을 낸다
- 차갑거나 고급스러운 카지노 느낌(검정·금색·네온)은 쓰지 않는다. 카지노도 **장난감 카지노**처럼 귀엽게

## 2. 색

| 이름 | 용도 | 실제 값 | 시아탱크 출처 |
|---|---|---|---|
| `--sky-top` | 배경 상단 (하늘) | `#4AA8FF` | `.screen` 배경 (`--sky`) |
| `--sky-mid` | 배경 가운데 (300px 지점) | `#9FD6FF` | `.screen` 배경 |
| `--sky-bottom` | 배경 하단 | `#FFE9B8` | `.screen` 배경 |
| `--sky-deep` | 진한 하늘 | `#1F6FD1` | `--sky-d` |
| `--panel` | 패널·카드 바탕 (크림) | `#FFF8E8` | `--cream` |
| `--panel-strong` | 선택된 카드 안쪽 | `#FFF4C2` | `.tank-card.sel` |
| `--outline` | 모든 외곽선 | `#2A1A10` | `--ink` (외곽선과 글자가 같은 색) |
| `--ink` | 본문 글자 | `#2A1A10` | `--ink` |
| `--ink-soft` | 설명 글자 | `#8A6A4A` | `.stat em`, `.shop-item small` |
| `--line-soft` | 선택 안 된 카드 외곽선 | `#E2D3B5` | `.tank-card`, `.map` |
| `--empty-line` | 빈 슬롯 점선 | `#C9B48E` | `.my-slot` |
| `--primary` | 주 버튼, 선택 상태 | `#FFD34D` | `--sun` |
| `--primary-light` | 주 버튼 그라데이션 위 | `#FFE066` | `.btn.primary` |
| `--primary-deep` | 주 버튼 그라데이션 아래·두께 | `#F0A500` | `--sun-d` |
| `--accent` | 포인트·금액 강조 | `#F0A500` | `.shop-item .price` |
| `--pink` | 특수 태그 (필살 등) | `#FF4D6D` | `--red` (`.wl li.ult b` 필살 태그) |
| `--track` | 게이지 빈 부분 | `#EEE2C8` | `.stat i` |
| `--white` | 버튼·칩 바탕 | `#FFFFFF` | `.btn` |
| `--team-a` / `--team-b` | 팀 색 | `#3D8BFF` / `#FF4D6D` | `ui/teams.ts` |
| `--pill` | 상단 바 닉네임 알약 바탕 | `rgba(0,0,0,0.25)` | `.bar .me` |
| `--dim` | 팝업 뒤 어둡게 | `--outline` 55% | (새로 정함) |

게임별 보조색 (배경·테이블 등 넓은 면에만 사용):

| 게임 | 보조색 | 근사값 |
|---|---|---|
| 시아맞고 | 담요 초록 | `#7CC08A` (테두리 `--outline`) · 체크 무늬 밝은 칸 `#8FCC9B`(`--matgo-mat-light`) · 바닥 자리·먹은 패 칸 `#5FA772`(`--matgo-mat-dark`) |
| 세븐포커·홀덤 | 민트 테이블 | `#6CC6B5` |
| 블랙잭 | 하늘 테이블 | `#7FB8E8` |
| 시아레이스 | 트랙 주황 | `#F9A873` (어두운 점·구분 `#E08A4F`, `--race-track`) |
| 룰렛 | 계절 4색 | 봄 `#9CC7F2` · 여름 `#F7C1A8` · 가을 `#A9DDC6` · 겨울 `#C9D1DD` |

결과 색 (시아탱크에 없음, 새로 정한 값): 승리 `#4CB86A`, 패배 `#E86A5A`, 무승부 `#9A8C7E`.

## 3. 글꼴

- 시아탱크 실제 글꼴: **`Jua`** (Google Fonts) — `font-family: 'Jua', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif` (`--font`)
- 제목·버튼·이름·본문 모두 `Jua` 하나 (시아탱크는 굵기 변화 없이 `font-weight: normal`). 긴 본문이 필요하면 `Gowun Dodum`
- 화면 제목: **흰 글자 + 진한 갈색 외곽선 2px** (`-webkit-text-stroke: 2px; paint-order: stroke fill`)
- 로고: **노란 글자(`--primary`) + 외곽선 3px + 아래 그림자 5px**
- 컷인 글자: 흰 글자 + 외곽선 3px
- 숫자 강조(포인트, 칩, 냥): `--accent` 색, 크게

| 용도 | 크기 (시아탱크) |
|---|---|
| 로고 | 56px |
| 화면 제목 | 26px |
| 패널 제목 | 20px |
| 큰 버튼 | 22px |
| 버튼 | 18px |
| 본문 | 15~16px |
| 설명 | 11~13px |

## 4. 모양

| 요소 | 모서리 | 외곽선 | 아래 두께 | 시아탱크 출처 |
|---|---|---|---|---|
| 큰 패널 (입장·결과) | 28px | 4px `--outline` | 8px | `.entry-card`, `.result-card` |
| 패널 | 20px | 3px `--outline` | 5px | `.card` |
| 캐릭터 카드 | 16px | 3px `--line-soft` (선택: `--outline` + 안쪽 3px `--primary`) | 없음 | `.tank-card` |
| 버튼 | 16px | 3px `--outline` | 4px | `.btn` |
| 작은 버튼 | 12px | 3px `--outline` | 3px | `.small-btn` |
| 목록 항목·선택 버튼 | 12px | 2px `--outline` | 선택 시 3px | `.shop-item`, `.seg button` |
| 알약 (포인트 표시 등) | 999px | 3px `--outline` | 없음 | `.my-points` |
| 키 배지 (Q/W/E) | 6px | 없음, 바탕 `--outline`, 흰 글자 | 없음 | `.key` |

- **입체감**: `box-shadow: 0 <두께> 0 var(--outline)`. 누르면 3px 내려가고(`translateY(3px)`) 두께가 1px로 줄어든다 (80ms).
- 흐린 그림자(blur)는 쓰지 않는다.
- 빈 슬롯은 **점선 외곽선**(2px dashed `--empty-line` `#C9B48E`) + 연한 글자 "비어있음".

## 5. 컴포넌트

**주 버튼 (게임 시작, 레디, 베팅 확정)**
- 바탕 `--primary` → `--primary-deep` 세로 그라데이션, 외곽선 3px, 아래 두께 5px
- 글자 크게(22px) + 오른쪽 ▶ 아이콘
- 화면 아래 가운데 고정

**보조 버튼**: 흰 바탕, 외곽선, 아래 두께 3px.
**선택 상태**: 바탕 `--primary`, 외곽선 그대로. 캐릭터 카드는 바탕 `--panel-strong` + 외곽선 3px.

**캐릭터 선택 카드**
- 정사각형, 위에 캐릭터, 아래 이름
- 선택하면 노란 바탕 + 굵은 외곽선

**정보 패널** (선택한 캐릭터 상세)
- 위쪽 하늘색 영역에 캐릭터 크게
- 이름(크게) + 동물·설명(작게, `--ink-soft`)
- 능력치 게이지: 트랙 `--track`, 채움 `--primary` → `--accent` 그라데이션, 둥근 끝

**목록 항목** (아이템 상점처럼)
- 왼쪽 아이콘, 가운데 이름 + 설명, 오른쪽 가격(`--accent`) + 보조 정보

**썸네일 카드** (맵 선택처럼)
- 그림 배경 + 흰 글자 제목 + 흰 설명
- 글자에는 진한 그림자/외곽선을 줘서 그림 위에서도 읽히게

**태그**: 작은 알약, 분홍(`--pink`) 바탕 + 흰 글자 (예: 필살, NEW, 2배)

**상단 바**: 왼쪽 "← 돌아가기"(투명 버튼, 흰 글자), 가운데 화면 제목(흰 글자 + 외곽선 2px), 오른쪽 닉네임 알약 (시아탱크 실제: `rgba(0,0,0,0.25)` 바탕 + 흰 글자, 모서리 12px)
**사운드 버튼**: 오른쪽 아래 원형 흰 버튼, 외곽선

## 6. 캐릭터 (십이지신)

모든 게임은 시아탱크 캐릭터를 같이 쓴다. 이름도 그대로.

| 띠 | 이름 | 띠 | 이름 |
|---|---|---|---|
| 쥐 | 찍찍이 | 말 | 따각이 |
| 소 | 우직이 | 양 | 몽실이 |
| 호랑이 | 어흥이 | 원숭이 | 재롱이 |
| 토끼 | 깡총이 | 닭 | 꼬꼬댁 |
| 용 | 여의룡 | 개 | 멍뭉이 |
| 뱀 | 스르르 | 돼지 | 꿀꿀이 |

- 스타일: 둥글고 통통한 2등신 치비, 굵은 갈색 외곽선, 볼 터치, 밝은 단색 채색
- 시아탱크에서는 탱크에 타고 있다. 카드 게임에서는 **탱크 없이 상반신/전신 버전**을 쓴다 (없으면 만들어야 함)
- AI 이름 표시: "AI 어흥이" 형식
- 아바타는 원형 프레임(흰 바탕 + 외곽선)에 얼굴 위주로

## 7. 카드 게임 전용

**테이블**
- 게임별 보조색의 둥근 판 + 굵은 외곽선. 펠트 질감 대신 **평평한 단색 + 가장자리 크림색 테두리**
- 자리마다 아바타 + 닉네임 알약 + 보유 칩/냥

**시아맞고 담요** (`games/matgo/main.ts`의 `drawMat` · `playerPanel` · `captured` · `deck`)
- 담요: 담요 초록 바탕 + 연한 체크 무늬(`--matgo-mat-light`) + 굵은 외곽선·아래 두께 + 가장자리 크림색 바느질 선(점선 2px)
- 바닥: 패 놓는 칸 12개를 어두운 면(`--matgo-mat-dark`) + 바느질 테두리로 표시. 더미는 도톰하게 쌓고 남은 장수는 노란 배지
- 자리 판: 큰 원형 아바타 + 이름 + 꼬리표(내 차례 `--pink` · 고 `--team-a` · 흔들기 `--accent` · 레디 `--win`) + 큰 점수 방울. 차례인 판은 `--primary` 바탕 + 깜빡이는 흰 테두리, '내 차례!' 꼬리표가 통통 튄다
- 먹은 패: 광 · 열끗 · 띠 · 피 칸(너비 고정). 칸 위 꼬리표에 `장수/점수 나는 장수` (예: 피 4/10), 점수가 나면 꼬리표가 `--primary`
- 조작부: 얼굴이 붙은 말풍선 알약 + 큰 버튼 한 줄 (처음 높이 휴대폰 104px · PC 112px, `GameUI.controlsMin`). 자리 줄은 숨긴다 (`.table-page[data-game='matgo']`)
- 결과 창: 승·패 색 머리띠(이긴 캐릭터) → 금액 → 점수 내역 → 계산식 알약(배수는 `--pink`)

**트럼프**
- 앞면: `--white` 바탕, 모서리 10px, 외곽선 2px
- 숫자·무늬: ♠♣ `--outline`, ♥◆ `#E8564A`
- J·Q·K: 십이지신 캐릭터 그림 (♠ 찍찍이·우직이·어흥이 / ◆ 깡총이·여의룡·스르르 / ♥ 따각이·몽실이·재롱이 / ♣ 꼬꼬댁·멍뭉이·꿀꿀이)
- 뒷면: `--primary` 바탕에 12띠가 원형으로 둘러선 문양

**화투**
- 크림 바탕, 모서리 8px, 외곽선 2px (세로로 긴 비율 유지)
- 1월 찍찍이 ~ 12월 꿀꿀이, 원래 화투 식물·배경은 연하게
- 광: 금색(`--accent`) 테두리 + '광' 도장 / 띠: 홍·청·초단 색 띠 / 열끗: 캐릭터 크게 / 피: 발자국 / 쌍피: 발자국 2개
- 띠 색은 새 색 없이 기존 값을 쓴다: 홍단 `#E8564A`(트럼프 빨강) · 청단 `#3D8BFF`(팀 파랑) · 초단 `#4CB86A`(승리 초록) · 비띠 `#8A6A4A`(설명 글자)
- 달 표시: 왼쪽 위 키 배지 모양 (바탕 `--outline`, 흰 숫자)

**칩**
- 둥근 칩, 외곽선 2px, 가장자리 점무늬
- 100 찍찍이(하늘 `#6FD8FF`) · 500 깡총이(분홍 `#FF8FB1`) · 1,000 어흥이(주황 `#FF9A2E`) · 10,000 여의룡(초록 `#3FBF8F`) — 시아탱크 캐릭터·랜덤 선택 색에서 가져옴

**룰렛 휠**
- 12칸 계절 4색, 칸마다 캐릭터 얼굴, 가운데 원에 "십이지신 룰렛"
- 양 칸은 진한 점, 음 칸은 빈 점

## 8. 움직임

| 상황 | 움직임 (실제 값) |
|---|---|
| 버튼 누름 | 2px 내려감, 100ms |
| 카드 받기 | 덱에서 날아와 살짝 돌며 감속 착지 (420ms). 여러 장은 한 장씩 차례로 (포커 0.2초, 맞고 0.13초, 블랙잭 처음 0.3초 · 그 뒤 0.65초) |
| 카드 뒤집기 | 가로로 납작해졌다 펴지며 살짝 들림 (360ms) |
| 카드 이동 (패 내기·가져가기) | 천천히 떠서 포물선, 날며 조금 기울었다 반듯하게 (560ms) |
| 맞고 한 차례 | 낸 패 → 바닥 '찰싹'(0초) → 더미 패 뒤집으며 바닥(0.76초) → 짝지어 가져가기(1.65초), 다음 차례는 2.5초 뒤 |
| 칩 이동 | 포물선으로 날아감 (520ms, 여러 개는 70ms 간격), 도착 시 '짤랑' |
| AI 행동 | 0.8초 간격, 자리 위 말풍선 ("어흥이 콜!"), 사람 행동은 0.35초 |
| 새 판 | 판을 먼저 새로 펴고 가운데 '새 판 시작!' 알약(주 버튼 색, 0.9초) → 그 뒤에 베팅·앤티를 하나씩 |
| 블랙잭 스플릿 | 두 장이 두 핸드로 갈라짐(560ms) → 첫 핸드에 한 장 → (첫 핸드가 끝나면) 둘째 핸드에 한 장. 한 동작이 끝나야 다음 동작 |
| 결과 | 카드·칩 연출이 끝난 뒤 결과 창 (최소 2초 이상 보임, 다음 판은 레디 또는 룰렛은 10초 뒤) |
| 컷인 | 화면 가운데로 캐릭터가 튀어나오고, 뒤에 방사형 노란 빛, 흰 글자 + 외곽선 큰 문구 (1.2초) |
| 승리 | 별·색종이 파티클 |

**기준**
- 카드·칩은 순간이동하지 않고 날아가서 도착한다.
- 카드 공개는 한 장씩 차례대로.
- 서버 응답이 한꺼번에 와도 화면은 순서대로 하나씩 재생한다 (games/lib/shell.ts의 연출 재생기: GameUI.replay → 말풍선·칩·소리 → 새 상태).
- 앞 동작의 연출이 끝나기 전에 다음 동작을 시작하지 않는다. 내 조작 버튼도 앞선 연출이 다 끝난 뒤에 켠다 (`TableCtx.myTurn`). 블랙잭은 사건마다 중간 화면을 만들어 한 동작씩 보여 준다 (`GameUI.rewind`).

컷인 문구 예: "고!", "스톱!", "피박!", "블랙잭!", "로티플!", "올인!", "당첨!"

### 효과음
- 모든 소리는 `shared/sound.js` 한 곳에서 관리 (ZzFX 방식으로 코드로 생성, 외부 파일 없음). 분위기: 짧고 통통 튀는 밝은 소리.
- `shared/sounds/<이름>.ogg` 또는 `.mp3`를 넣으면 그 소리를 처음 낼 때 파일로 바뀐다. 이름: click, toggle, coin, turn, tick, cutin, win, lose, deal, flip, slap, chip, fold, bust, spinTick, spinStop, tankFire, tankBoom, tankBigBoom, tankLaser, tankBuild, tankHeal, tankTurn, tankWin, raceReady, raceGo, raceFoul, step, jump, land, mud, hurdleHit, slip, logHit, boost, goal, rankShow, newRecord, volleyHit, volleyWall, volleyNet, volleyServe, volleySpeed, volleyPoint, volleyMiss, volleyCount, volleyGo.
- 배경음은 게임마다 코드로 만든 짧은 반복곡. 시아레이스는 `shared/sounds/bgmLobby|bgmRace|bgmResult.ogg`(또는 `.mp3`)를 넣으면 그 파일로 바뀐다. 배경음 켜기/끄기는 효과음과 따로 저장한다 (`sia:bgm`).
- 오른쪽 아래 원형 사운드 버튼으로 켜기/끄기 (브라우저에 저장, 시아탱크와 같은 설정). 첫 클릭 전에는 소리를 내지 않는다.
- 같은 소리는 이름마다 최소 간격(칩 70ms 등), 동시에 6개까지.

## 9. 하지 말 것

- 흐린 그림자, 유리 효과(glassmorphism), 네온, 금속 질감
- 얇은 선(1px 이하) 외곽선
- 검정 바탕의 어두운 카지노 화면
- 캐릭터 없이 기호만 있는 화면 (어느 화면이든 캐릭터가 하나 이상 보이게)
- 이 문서에 없는 새 색을 넓은 면에 쓰기

## 10. 작업 규칙 (Claude Code)

1. 작업 전 `games/tank/`에서 실제 색·글꼴·외곽선 값을 찾아 이 문서의 근사값을 고치고, `shared/theme.css` / `shared/theme.js`를 만든다.
2. 새 화면은 반드시 `shared/theme.*`의 값만 쓴다 (색 코드를 직접 쓰지 않기).
3. 캐릭터 이미지는 `games/tank/`의 기존 파일을 `shared/images/zodiac/`로 옮겨 같이 쓴다. 카드 게임용 탱크 없는 버전이 없으면 목록을 정리해서 알려준다.
4. 그림이 아직 없는 부분은 이 문서의 색·외곽선 규칙을 지킨 임시 그림으로 만들고, 교체할 이미지 목록을 남긴다.

## 11. 이미지 현황 · 교체할 이미지 목록 (2026-11-17 갱신)

**SpriteCook으로 만든 그림** (원본 시트와 asset id: `art/spritecook/`, `art/spritecook/spritecook-assets.json`)
- 탱크 없는 십이지신 전신 12장 → `shared/images/zodiac/full/*.png` (트럼프 J·Q·K, 화투 광·열끗, 컷인, 로비·카지노 장식)
- 원형 아바타용 얼굴 12장 (전신에서 잘라냄) → `shared/images/zodiac/face/*.png` (이름패, 칩, 카드 뒷면 12띠, 동물 고르기)
- **전통 화투 48장 + 뒷면** → `shared/images/hwatu/cards/<카드 id>.png` (맞고 화면은 이 그림을 쓴다. 광에만 작은 '광' 도장)
- 화투 12달 식물 → `shared/images/hwatu/plant-01~12.png` (예전 코드 그림 화투용, 지금은 대체됨)
- 로비 카드 `shared/images/card-matgo.png`, `card-casino.png`
- 시아탱크 원본 그림(`games/tank/public/tanks`)은 시아탱크 게임 화면에서 그대로 쓰고, `shared/images/zodiac/*.png`(탱크 버전)는 `tankUrl()`로만 쓴다.

**시아탱크 (SpriteCook, 2026-11-17)** — 원본 asset id: `games/tank/spritecook-assets.json`
- 맵 5종 배경 `games/tank/public/bg/{valley,sky,sphinx,ledge,target}.jpg` (+ `-s.jpg` 맵 선택 썸네일). 전투 화면에서는 CSS 배경 + 시차 스크롤, 위에 하늘색 안개 한 겹
- 땅 질감 `public/tex/{soil,sand,rock}.png` (흙 부분에 바둑판으로 깔고 깊이에 따라 어둡게)
- 아이콘 `public/icons/*.png`: 특수 벽 배지 4, 아이템 4, 보급 상자·낙하산·비행기, 바람
- 대기실 그림 `public/lobby.jpg`
- 전투 HUD는 어두운 남색 → 크림 판 + 갈색 외곽선 (`style.css` 끝 "DESIGN.md 맞춤" 블록)

**시아레이스 (SpriteCook, 2026-11-18)** — 원본 시트와 asset id: `games/running/art/`, `games/running/spritecook-assets.json`
- 방해물 6종 `games/running/public/art/{hurdle,banana,log,mudShort,mudLong,boost}.png`
- 이펙트·표지 `public/art/{splash,dust,star,spark,marker,flag}.png`, 트랙 바닥 `track.png`, 배경 2겹 `sky.png`·`stands.png`
- 로비 카드 `shared/images/card-race.png`
- 캐릭터는 `shared/images/zodiac/full/*.png` 한 장을 코드로 움직인다 (달리기 흔들림·점프·넘어짐·미끄러짐·골인). 출발선·결승선 띠, 색종이, 부스트 잔상은 코드 그림

**시아배구 (코드 그림, 2026-11-18)** — 만들 그림 목록: `games/volleyball/ASSETS.md`
- 배경 3종(낮의 풀밭 마당 · 노을 지는 기와지붕 마을 · 밤의 달과 등불), 공, 네트, 이펙트는 모두 코드 그림 (`games/volleyball/src/scenes/backdrop.ts`, `art.ts`). `public/art/bg-0~2.png` 등을 넣으면 그 그림으로 바뀐다
- 캐릭터는 `shared/images/zodiac/full/*.png` 한 장을 코드로 움직인다 (대기·이동·점프·착지·타격)
- 로비 카드 `shared/images/card-volleyball.png`는 임시 그림 (SpriteCook으로 교체 예정)
- 넓은 면 보조색: 새 색 없이 기존 값만 쓴다 (풀밭 = 맞고 담요 초록, 노을 바닥 = 레이스 트랙 주황, 밤 = `--sky-deep` · `--team-a`, 은빛 바닥 = 룰렛 겨울)

**아직 코드로 그리는 부분** (필요하면 SpriteCook 그림으로 교체)
| 위치 | 지금 |
|---|---|
| 카드 뒷면 (`cardBack`) | 노란 바탕 + 얼굴 12장 원형 |
| 칩 4종 (`chipStack`) | 색 칩 + 점무늬 + 얼굴 |
| 트럼프 숫자 카드 무늬, 화투 띠·광 도장·달 배지 | 도형 + 글자 |
| 테이블 (`drawTable`) | 단색 판 + 크림 테두리 (맞고는 `drawMat`: 체크 담요 + 바느질 선) |
