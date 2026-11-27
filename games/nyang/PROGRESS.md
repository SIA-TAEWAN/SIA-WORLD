# 시아집사 진행 상황 (인계 문서)

PRD: `PRD.md`. 지금 끝난 것: **13장 1단계(서버 규칙) · 2단계(입양 · 방 · 밥/물/똥/쓰다듬기)**. 다음은 3단계부터.
dev 포트 **5303** (`npm run dev`, 폰은 `npm run dev -- --host` → `http://<PC의 IP>:5303/games/nyang/?local=1`).

## 파일 구조

| 파일 | 하는 일 |
|---|---|
| `src/data/balance.ts` | 모든 수치: `CONST`(SQL `_nyang_const`) · `LOVE_NEED` · `CAT_NEED`(`_nyang_table`) · 성격 5종 `PERSONALITIES`(`_nyang_personalities`) · 털 색 `COLORS`(`_nyang_ids('colors')`) · 사료 `FOODS`(`_nyang_foods`) · `SPOTS` · `kstDay` · `mix` · `shelterKittens` · 이름 규칙 |
| `src/data/poses.gen.ts` | `art/build.py` 가 만든 자세 그림 크기 · 발 기준점 (손으로 고치지 않는다) |
| `src/game/rules.ts` | 순수 규칙 (시각 t 는 인자, 초 단위 정수). SQL RPC 와 1:1 |
| `src/game/recolor.ts` | 털 픽셀만 목표 색으로 (순수 함수, `tests/recolor.test.ts`) |
| `src/net/api.ts` | `NyangApi` — 서버(Supabase RPC) / 로컬(`?local=1`, rules.ts + localStorage `siaNyang:local`) 두 구현, `errorText` |
| `src/net/world.ts` | 공용 shared 모듈 런타임 로드 (auth · supabase · sound) |
| `src/ui/room.ts` | 방 화면 전부 (배치 · 상태 그리기 · 고양이 머리(think) · 밥 끌기 · 물 · 화장실 확대 · 쓰다듬기 · 정보 창 · 설정 · 요약 카드 · 마중) |
| `src/ui/cat.ts` | `CatActor` — 자세 그림 + 코드 움직임(숨쉬기 · 깜빡임 · 걷기 통통 · 좌우 뒤집기), `Act`(idle · walk(then) · pose(ms, face) · pet · hold), 말풍선, `spotAt`(쓰다듬는 곳) |
| `src/ui/catart.ts` | **자세 → 그림 표 `POSE_IMAGE`** · `catArt(color, art, pattern)` 색×자세 캐시(objectURL) · `patternLayer`(무늬 층 자리, 지금은 빈 함수) |
| `src/ui/adopt.ts` | 입양 화면 (보호소 6마리 = 털 색 6 × 그날 성격) |
| `src/ui/props.ts` | 임시 SVG 물건 (밥그릇 · 물그릇 · 화장실 · 봉투 · 삽 · 방석 · 담요) |
| `src/ui/common.ts` | 소리 `sfx` · 진동 `buzz`(설정 `siaNyang:vibe`) · `toast` · `josa` · `floatAt` |
| `src/ui/gallery.ts` | 개발용 `?local=1&gallery=1`: 털 색 × 자세 전부 |
| `art/build.py` | `art/spritecook/poses/*.png` + `assets.json`(foot · scale) → `public/art/cat/<자세>.png`(같은 배율 · 여백) + `poses.gen.ts` |
| `scripts/pace.ts` · `sqlrows.ts` · `pg-expect.ts` · `pg-check.mjs` | 친밀도 곡선 · SQL 줄 뽑기 · PGlite 대조 |

## 상태 모델 (rules.ts ↔ 123_nyang.sql)

상태 4가지는 저장하지 않고 '마지막으로 돌본 기록'에서 계산한다 (0~10000):
배부름 `lin(fedAmount, fedAt, full_sec)` · 목마름 `lin(10000, waterAt, water_sec)`(waterAt+12h 면 상함) · 청결 `(4 − 똥) × 2500`, 똥 = `min(4, poopBase + ⌊(t−poopAt)/poop_sec⌋)` · 기분 `lin(moodVal, moodAt, mood_sec)`.
친밀도(1초 = 1점, 네 상태 모두 ≥ 5000 이고 안 아플 때) · 감기(바닥 24h) · 나음(cureAt)은 `settle`(SQL `_nyang_settle`)이 `calcAt` 부터 한 번에 반영 — 몇 번에 나눠 불러도 같다.

| rules.ts | SQL |
|---|---|
| `lin` · `linHalfAt` · `linZeroAt` | `_nyang_lin` · `_nyang_half_at` · `_nyang_zero_at` |
| `levelsOf` (화면용) | `_nyang_levels` |
| `settle` · `goodUntil` · `floorSince` | `_nyang_settle` |
| `loveLevel` · `spotKind` | `_nyang_level` · `_nyang_spot_kind` |
| `care`(하루 첫 돌보기 엽전 · 시아코인 하루 5) · `payLocal` | `_nyang_care` · `_nyang_pay` (`_grant_sia_coin(user,'nyang','care:<n>')`, 15초 간격으로 못 주면 `sia_due` 에 두고 다음 요청 때) |
| `visit` · `adopt` · `feed` · `water` · `clean` · `pet` · `cure` | `nyang_state(p_entry)` · `nyang_adopt` · `nyang_feed` · `nyang_water` · `nyang_clean` · `nyang_pet` · `nyang_cure` |

거절 글자(`RuleError` = SQL `raise exception`): `bad color` · `bad personality` · `bad name` · `no room` · `no cat` · `bad food` · `bowl full` · `water fresh` · `no poop` · `bad spot` · `too soon` · `bad cure` · `not sick` · `already curing` · `need care` · `need login`.
시아코인 = '필요한 돌보기' = 상태가 절반 아래 → 절반 이상으로 돌아오게 한 것 (똥은 3개 → 2개가 되는 한 번).

## 마이그레이션 `supabase/migrations/123_nyang.sql` (아직 push 안 함 — 뒤 단계 함수도 이 파일에 이어서 쓴다)

- 표: `nyang_profiles`(엽전 coins, items · furniture · layout jsonb 는 4·5단계용, visit_at, bonus_day, care_days, sia_*), `nyang_cats`(user_id+slot 키, color, **pattern(나중 무늬, 지금 null)**, 돌보기 기록, love, love_at(랭킹용 예약), sick_at/cure_at, pet_*, seen jsonb(도감 예약)), `nyang_pots`(4단계), `nyang_album`(5단계). 모두 RLS + revoke, 직접 쓰기 없음.
- 내부: `_nyang_const` · `_nyang_table` · `_nyang_ids` · `_nyang_personalities` · `_nyang_foods` · `_nyang_now`(서버 시각, 이것만 씀) · `_nyang_day` · `_nyang_mix` · `_nyang_lin/_half_at/_zero_at` · `_nyang_levels` · `_nyang_settle` · `_nyang_level` · `_nyang_spot_kind` · `_nyang_me`(프로필 만들고 잠금) · `_nyang_cat`(잠그고 settle) · `_nyang_save` · `_nyang_pay` · `_nyang_care` · `_nyang_json`.
- 화면용(authenticated): `nyang_state` · `nyang_adopt` · `nyang_feed` · `nyang_water` · `nyang_clean` · `nyang_pet` · `nyang_cure`. `game_open:nyang` = false.
- 잠금 순서: nyang_profiles → nyang_cats → wallets. 새 RPC 는 `_nyang_me()` → `_nyang_cat()` → 바꾸고 `_nyang_save` → `_nyang_care` → `_nyang_pay` → `_nyang_json` 순서를 따른다.
- **PL/pgSQL 함정**: `if … < case when … then … end then` 은 IF 가 CASE 안의 `then` 에서 끊겨 문법 오류 — 변수로 빼라. 변수 이름이 열 이름(`seq` 등)과 같으면 ambiguous.

## 검사

- `npm test`: `rules.test.ts`(시간 계산 · 친밀도 · 쓰다듬기 · 돌보기 · 감기 · 입양) · `sql.test.ts`(SQL 값 · 표 · 식 · 권한이 데이터와 같은지 — 새 마이그레이션이 함수를 다시 정의하면 `FILES` 에 더한다) · `recolor.test.ts`.
- PGlite (저장소 밖에 설치): `npx vite-node scripts/pg-expect.ts > <pg>/nyang-expect.json && node scripts/pg-check.mjs <pg>` — 001~123 적용 후 권한 · `game_open` · **465단계를 기기 규칙과 대조(확인 1284개 모두 통과, 2026-11-27)**. `_nyang_now()` 를 설정 값 `nyang.now` 로 바꿔 시각을 맞춘다. 새 RPC 는 `pg-expect.ts` 의 순서와 `pg-check.mjs` 의 `CALL` 에 더한다.
- `npm run pace`: 성격 5종 × 하루 2·3·4번. 지금(놀아 주기 · 츄르 없이) **10단계: 하루 2번 58~67일 · 3번 40~48일** · 감기 0번 · 시아코인 하루 5개. 3단계에서 놀이 · 츄르 · 빗질 친밀도를 넣으면 빨라지니 `LOVE_NEED` 를 다시 맞출 것.

## 로컬 모드 · 개발 설정 (localhost / dev 서버만)

`?local=1` 로그인 없이, rules.ts 로 기기 안에서. `&time=10` 시간 10배(저장된 시계를 이어 받아 다시 잰다) · `&skip=6h`(s · m · h · d, 한 번만 — 주소에서 지운다) · `&love=7` 첫 고양이 친밀도 7단계로(한 번) · `&reset=1` 처음부터 · `&gallery=1` 털 색 × 자세 그림.

## 그림

- 자세 그림 13장(`art/spritecook/poses/`, assets.json 의 foot · scale) → `python art/build.py` → `public/art/cat/`. 모든 자세가 같은 배율이라 화면 배율 하나(`cat.floor.scale`)로 그리고 foot 을 바닥 점에 둔다. `jump` 는 anchor `air` (40px 띄움).
- 게임 속 자세 → 그림: `src/ui/catart.ts` 의 `POSE_IMAGE` (sit · blink · walk1/2 · loaf · sleep · eat · drink(=eat) · stretch · pounce · jump · beg · knead · belly). 새 자세 그림이 오면 assets.json 에 넣고 build.py → 이 표에 한 줄.
- 털 색: `recolorFur` — 털(불투명 · min>185 · r−b<14)을 목표색 × (원래색/흰털)로, 작고(220px 미만) 둘레 70% 이상이 어두운 털 덩어리(눈 반짝임)는 그대로, 털 옆 2px 경계는 밝기로 섞인 정도만큼. 검정(92,90,104)도 외곽선 · 눈이 보이는 것을 화면으로 확인했다.
- 무늬(줄무늬)는 `catArt(color, art, pattern)` 의 `patternLayer` 에서 색을 바꾼 canvas 위에 그리면 된다 (DB `nyang_cats.pattern`).
- 방 · 물건은 임시 SVG(`props.ts`) + CSS. 색은 `--nyang-*`(shared/theme.css · theme.js `NYANG` · DESIGN.md 에 한 줄 더함).

## 다음 단계에서 붙일 자리

- 3단계 놀아 주기 · 츄르 · 빗질 · 사진: 정보 창의 `[data-soon]` 버튼(`room.ts` `paintSheet`). 성격 데이터에 `toy` · `churu` 이미 있음. 서버는 `nyang_play` · `nyang_churu` · `nyang_brush` 를 123 에 더하고, 하루 상한은 `pet_day/pet_love` 처럼 고양이 줄에 열을 더한다(아직 push 전이라 표 정의를 고쳐도 된다). 감기 낫게 하기 `cure(kind)` 는 지금 `'blanket'` 만 — `'medicine'` · `'churu'` 를 받게 넓힌다.
- 선물 · 행동 여러 가지 · 시간대: `room.ts` 의 `think()` (지금: 필요한 것 → 기분 낮음 → 밤 잠 → 걷기 · 식빵 · 기지개 · 꾹꾹이 · 점프). 마중은 `GREET_SEC`(6h), 요약 카드는 `SUMMARY_SEC`(3h).
- 4단계 정원 · 상점: 방을 옆으로 밀기(지금 방은 `touch-action:none`), `nyang_pots` 표, 엽전은 `nyang_profiles.coins`, 츄르 구매는 `_spend_sia_coin(user, 5, 'nyang', ref)`.
- 5단계 여러 마리: 규칙 · SQL 은 이미 4마리까지(`catRoom`, `CAT_NEED`). 화면은 지금 `state.cats[0]` 한 마리만 그린다 — `room.ts` 를 고양이마다 `CatActor` 로.
- 6단계: shared/games.js · presence `GAME_CHANNELS` · ranking-dialog 탭 · deploy.yml · 로비 카드. PWA head 블록은 index.html 에 이미 있다. 배경음 폴더 `shared/audio/bgm/nyang/`(README 표에 줄 있음). `playBgm('nyang', 밤이면 'boss')` 는 이미 부른다.

## 알려진 문제 · 임의로 정한 것

- 성격 5종의 수치 · 좋아하는 곳, 털 색 RGB, 친밀도 표, 감기 낫는 기준(네 상태 모두 70% 이상 · 물 안 상함), 쓰다듬기 간격 8초 · 하루 1800점, 하루 첫 돌보기 엽전 20, 모래 선물 20% · 3~10엽전은 모두 내가 정했다.
- 기분이 바닥인 채 24h 도 감기가 된다(PRD 그대로). 지금은 기분을 채우는 방법이 쓰다듬기뿐이라 하루 1번 오는 사람은 감기에 걸릴 수 있다 — 3단계 놀이 · 츄르 뒤에 pace 로 다시 볼 것.
- 보호소 고양이 목록은 서버가 확인하지 않는다 (아무 털 색 · 성격으로 입양 가능 — 친목용 규칙).
- 같은 고양이의 밥그릇 · 물그릇 · 화장실이 고양이마다 따로라는 모델이다 (여러 마리일 때 그릇을 나눌지 5단계에서 정할 것).
- 자세 그림의 쓰다듬는 곳(`spotAt`)은 정면 앉은 그림 비율로 어림한다. 담요 · 물 주전자 위치는 대강이다.
- 진동은 `navigator.vibrate` — 아이폰 사파리는 없음.
- 실제 Supabase 서버에서는 아직 돌려 보지 않았다 (PGlite 와 로컬 모드만).
