# 시아집사 진행 상황 (인계 문서)

PRD: `PRD.md`. 지금 끝난 것: **13장 1단계(서버 규칙) · 2단계(입양 · 방 · 밥/물/똥/쓰다듬기) · 3단계(놀아 주기 · 츄르 · 빗질 · 친밀도 행동 · 선물 · 시간대 행동 · 마중 · 행동 도감 기록)**. 다음은 4단계(정원 · 상점)부터.
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
| `src/ui/room.ts` | 방 화면 (배치 · 상태 그리기 · 밥 끌기 · 물 · 화장실 확대 · 쓰다듬기 · 정보 창(놀이 · 츄르 · 빗질 고르기) · 선물 줍기 · 바닥 누르면 따라오기 · 설정 · 요약 카드 · 문 앞 마중). 고양이마다 `CatView`(여러 마리 구조, 돌보기 물건은 첫 고양이 것) |
| `src/ui/ctx.ts` | 방 화면 공용 자리 `RoomCtx`(api · 상태 · 좌표 · 물건 · `saw`(도감) · `tray`(아래 띠 바꾸기) · `walkTo`) · `CatView` |
| `src/ui/behavior.ts` | 고양이 머리 `think`: 아픔(재채기) → 밥/물/화장실 → 심심함(등 돌린 식빵, 상자 있으면 상자 속) → 밤엔 80% 잠(10단계면 집사 옆) → 시간대별 비율로 행동 고르기(`PICKS`). `follow`(바닥 누르기, 4단계부터) |
| `src/ui/play.ts` | 놀아 주기 미니게임 30초 (낚싯대 · 레이저 · 공 · 상자), 잡은 수를 서버 상한 안에서만 센다 |
| `src/ui/treats.ts` | 츄르(달려와 조르기 → 누르고 있는 동안 짜기 · 핥기 → 입맛 다시기 · 하트) · 빗질(빗을 끌어 등 쓸기 → 털 뭉치) · 하루 다 먹었으면 고개 돌리기 |
| `src/ui/cat.ts` | `CatActor` — 자세 그림 + 코드 움직임(숨쉬기 · 깜빡임 · 걷기 통통 · 좌우 뒤집기), `Act`(idle · walk(then, arrive) · pose(ms, face) · pet · hold), 말풍선, `spotAt`(쓰다듬는 곳). 3단계: 얼굴 연출 `setFx`(sparkle 눈 반짝 · lick 혀 낼름 · smack 입맛 다시기 — `FACE` 표의 눈 · 입 자리, 정면 그림 beg · sit · sit-blink 만) · `mouthPoint` · `wiggle`(엉덩이 실룩) · `lift`(점프 높이) · `sink`(상자 속으로 가라앉고 바닥 아래는 clip-path 로 자름) · `perky`(꼬리 세우고 통통) |
| `src/ui/catart.ts` | **자세 → 그림 표 `POSE_IMAGE`** · `catArt(color, art, pattern)` 색×자세 캐시(objectURL) · `patternLayer`(무늬 층 자리, 지금은 빈 함수) |
| `src/ui/adopt.ts` | 입양 화면 (보호소 6마리 = 털 색 6 × 그날 성격) |
| `src/ui/props.ts` | 임시 SVG 물건 (밥그릇 · 물그릇 · 화장실 · 봉투 · 삽 · 방석 · 담요 · 3단계: 깃털 · 털실 공 · 상자 · 탁자 + 컵 · 츄르(맛 색) · 빗 · 선물 4종) |
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
| `playStart` · `play` | `nyang_play_start(p_slot, p_toy)` · `nyang_play(p_slot, p_catches)` |
| `brush` · `churu` | `nyang_brush(p_slot)` · `nyang_churu(p_slot, p_flavor)` |
| `rollPresent`(visit 안) · `gift` | `_nyang_roll_present`(nyang_state 안, entry 일 때) · `nyang_gift(p_slot)` |
| `seen` | `nyang_seen(p_slot, p_behavior)` |
| `itemCount` · `addItem` · `hasToy` | `_nyang_item` · `_nyang_add_item` · `_nyang_has_toy` |

거절 글자(`RuleError` = SQL `raise exception`): `bad color` · `bad personality` · `bad name` · `no room` · `no cat` · `bad food` · `bowl full` · `water fresh` · `no poop` · `bad spot` · `too soon` · `bad cure` · `not sick` · `already curing` · `need care` · `need login` · 3단계: `bad toy` · `no toy` · `no play` · `brushed today` · `bad flavor` · `churu full` · `no churu` · `no present` · `bad behavior` · `too early` · `no medicine`.

**3단계 규칙**
- 보관함 `nyang_profiles.items` = `{ 'toy:laser' · 'churu:tuna' · 'seed:daisy' · 'fur' · 'medicine' … : 개수 }` (0 개 이하가 되면 열쇠를 지운다). 가구는 `furniture`(id 배열). 상점(4단계)은 여기에 더하기만 하면 된다.
- 놀아 주기: `nyang_play_start` 가 `play_at` · `play_toy` 를 적고, `nyang_play` 가 잡은 수를 `min(보낸 수, 15, ⌊(지금 − 시작)/2초⌋)` 로 센다 (180초 지나면 `no play`). 잡을 때마다 기분 +700(좋아하는 장난감 +1000), 친밀도 +1200(+1600), 친밀도는 고양이마다 하루 24000 까지. 아플 때는 기분 절반 · 친밀도 0. 낚싯대는 처음부터, 나머지는 `toy:<id>` 가 있어야.
- 빗질: 고양이마다 한국 날짜 하루 한 번, 기분 +3000 · 친밀도 +12000 · 털 뭉치(`fur`) 2~4 (`mix(day*4+slot, 5)`).
- 츄르: 고양이마다 하루 2개, `churu:<맛>` 하나를 쓴다. 기분 +6000(좋아하는 맛 +8000) · 친밀도 +2500(+3500). 아플 때 주면 친밀도 없이 바로 낫기 시작(`cure_at = t + 2h`, cured). 첫 고양이를 입양하면 그 고양이가 좋아하는 맛 3개(`start_churu`).
- 감기 약 간식: `nyang_cure(slot, 'medicine')` — 보관함 `medicine` 하나, 네 상태를 채우지 않아도 된다 (상점 4단계에서 팔면 된다).
- 선물: `nyang_state(true)` 때 고양이마다, 지난번에 굴린 때(`present_at`, 입양 때 = 입양 시각)에서 4시간이 지났고 바닥에 선물이 없고 안 아프면 한 번 굴린다(`pseq` 증가). 확률 20% + 단계 × 6% (1단계 26% · 10단계 80%). 엽전 55%(5 + 단계×2 + 0~10) · 씨앗 25%(데이지 · 캣그라스 · 해바라기 1~2개) · 장난감 15%(없는 것만, 다 있으면 엽전) · 가구 5%(발바닥 러그 · 생선 쿠션 · 털실 바구니). `present` jsonb 로 바닥에 두고 `nyang_gift` 로 줍는다.
- 행동 도감: `nyang_seen` 이 `seen` jsonb 배열에 처음 본 행동 id 를 더한다 (`_nyang_behaviors()` = `BEHAVIORS`, 단계가 모자라면 `too early`). 화면은 행동을 시작할 때 `ctx.saw` 로 한 번만 부른다 (앨범 · 도감 화면은 5단계).
시아코인 = '필요한 돌보기' = 상태가 절반 아래 → 절반 이상으로 돌아오게 한 것 (똥은 3개 → 2개가 되는 한 번).

## 마이그레이션 `supabase/migrations/123_nyang.sql` (아직 push 안 함 — 뒤 단계 함수도 이 파일에 이어서 쓴다)

- 표: `nyang_profiles`(엽전 coins, items · furniture · layout jsonb 는 4·5단계용, visit_at, bonus_day, care_days, sia_*), `nyang_cats`(user_id+slot 키, color, **pattern(나중 무늬, 지금 null)**, 돌보기 기록, love, love_at(랭킹용 예약), sick_at/cure_at, pet_*, seen jsonb(도감 예약)), `nyang_pots`(4단계), `nyang_album`(5단계). 모두 RLS + revoke, 직접 쓰기 없음.
- 내부: `_nyang_const` · `_nyang_table` · `_nyang_ids`(colors · spots · toys · free_toys · churus · present_*) · `_nyang_personalities` · `_nyang_foods` · `_nyang_behaviors` · `_nyang_item` · `_nyang_add_item` · `_nyang_has_toy` · `_nyang_roll_present` · `_nyang_now`(서버 시각, 이것만 씀) · `_nyang_day` · `_nyang_mix` · `_nyang_lin/_half_at/_zero_at` · `_nyang_levels` · `_nyang_settle` · `_nyang_level` · `_nyang_spot_kind` · `_nyang_me`(프로필 만들고 잠금) · `_nyang_cat`(잠그고 settle) · `_nyang_save` · `_nyang_pay` · `_nyang_care` · `_nyang_json`.
- 화면용(authenticated): `nyang_state` · `nyang_adopt` · `nyang_feed` · `nyang_water` · `nyang_clean` · `nyang_pet` · `nyang_cure` · `nyang_play_start` · `nyang_play` · `nyang_brush` · `nyang_churu` · `nyang_gift` · `nyang_seen`. `game_open:nyang` = false.
- 3단계에서 표에 더한 열: `nyang_profiles.pseq` · `nyang_cats.play_at/play_toy/play_day/play_love/brush_day/churu_day/churu_n/present_at/present` (`seen` 은 1단계부터 있던 열을 쓴다).
- 잠금 순서: nyang_profiles → nyang_cats → wallets. 새 RPC 는 `_nyang_me()` → `_nyang_cat()` → 바꾸고 `_nyang_save` → `_nyang_care` → `_nyang_pay` → `_nyang_json` 순서를 따른다.
- **PL/pgSQL 함정**: `if … < case when … then … end then` 은 IF 가 CASE 안의 `then` 에서 끊겨 문법 오류 — 변수로 빼라. 변수 이름이 열 이름(`seq` 등)과 같으면 ambiguous.

## 검사

- `npm test`: `rules.test.ts`(시간 계산 · 친밀도 · 쓰다듬기 · 돌보기 · 감기 · 입양) · `sql.test.ts`(SQL 값 · 표 · 식 · 권한이 데이터와 같은지 — 새 마이그레이션이 함수를 다시 정의하면 `FILES` 에 더한다) · `recolor.test.ts`.
- PGlite (저장소 밖에 설치): `npx vite-node scripts/pg-expect.ts > <pg>/nyang-expect.json && node scripts/pg-check.mjs <pg>` — 001~123 적용 후 권한 · `game_open` · **939단계를 기기 규칙과 대조(확인 2246개 모두 통과, 3단계 RPC 포함, 2026-11-27)**. 보관함은 `setitem` 단계로 SQL 에서 맞춘다. `_nyang_now()` 를 설정 값 `nyang.now` 로 바꿔 시각을 맞춘다. 새 RPC 는 `pg-expect.ts` 의 순서와 `pg-check.mjs` 의 `CALL` 에 더한다.
- `npm run pace`: 성격 5종 × 하루 1 · 2 · 3번 × 츄르 0 · 2개(1번은 0 · 1개). 들를 때마다 밥 · 물 · 똥 · 놀이 한 판(낚싯대 10마리) · 쓰다듬기 3번, 하루 한 번 빗질. 들르는 시각은 정해진 무작위로 흔든다(하루 1번은 8~23시 아무 때, 2 · 3번은 ±1.5시간). 감기는 무작위 3가지의 합.
  **2026-11-27 결과 (LOVE_NEED 합 4,140,000)**: 10단계 — 하루 2번 62~66일(츄르 2개면 57~59일) · 하루 3번 53~56일(츄르 2개면 48~52일) · 하루 1번 101~117일. 감기 — 하루 1번 94번/1800일(약 19일에 한 번) · 하루 2 · 3번 0번.

## 로컬 모드 · 개발 설정 (localhost / dev 서버만)

`?local=1` 로그인 없이, rules.ts 로 기기 안에서. `&time=10` 시간 10배(저장된 시계를 이어 받아 다시 잰다) · `&skip=6h`(s · m · h · d, 한 번만 — 주소에서 지운다) · `&love=7` 첫 고양이 친밀도 7단계로(한 번) · `&reset=1` 처음부터 · `&gallery=1` 털 색 × 자세 그림 · 3단계: `&toys=1` 장난감 모두 · `&churu=5` 맛마다 츄르 5개 더 · `&gift=1` 첫 고양이가 선물을 물어 온 것처럼 (모두 한 번). 마중은 `&skip=7h`.

## 그림

- 자세 그림 13장(`art/spritecook/poses/`, assets.json 의 foot · scale) → `python art/build.py` → `public/art/cat/`. 모든 자세가 같은 배율이라 화면 배율 하나(`cat.floor.scale`)로 그리고 foot 을 바닥 점에 둔다. `jump` 는 anchor `air` (40px 띄움).
- 게임 속 자세 → 그림: `src/ui/catart.ts` 의 `POSE_IMAGE` (sit · blink · walk1/2 · loaf · sleep · eat · drink(=eat) · stretch · pounce · jump · beg · knead · belly). 새 자세 그림이 오면 assets.json 에 넣고 build.py → 이 표에 한 줄.
- 털 색: `recolorFur` — 털(불투명 · min>185 · r−b<14)을 목표색 × (원래색/흰털)로, 작고(220px 미만) 둘레 70% 이상이 어두운 털 덩어리(눈 반짝임)는 그대로, 털 옆 2px 경계는 밝기로 섞인 정도만큼. 검정(92,90,104)도 외곽선 · 눈이 보이는 것을 화면으로 확인했다.
- 무늬(줄무늬)는 `catArt(color, art, pattern)` 의 `patternLayer` 에서 색을 바꾼 canvas 위에 그리면 된다 (DB `nyang_cats.pattern`).
- 방 · 물건은 임시 SVG(`props.ts`) + CSS. 색은 `--nyang-*`(shared/theme.css · theme.js `NYANG` · DESIGN.md 에 한 줄 더함).

## 다음 단계에서 붙일 자리

- 4단계 상점: 장난감은 `items['toy:<id>'] = 1`, 츄르는 `items['churu:<맛>'] += n`(시아코인 5개씩 `_spend_sia_coin`), 약 간식 `items.medicine`. 받은 씨앗(`seed:<id>`) · 털 뭉치(`fur`)는 보관함에 이미 쌓인다. 정보 창 장난감 · 츄르 고르기의 '상점에서 (곧)' 글을 상점 단추로 바꾼다.
- 5단계: 앨범 · 도감 화면은 `cats[].seen`(본 순서) + `BEHAVIORS` 로 (못 본 것은 그림자). 사진 단추는 `data-soon`. 여러 마리는 `views` 가 이미 고양이마다 있다 — 돌보기 물건 · 정보 창 버튼을 고양이별로, 고양이끼리 어울리기(같이 자기 · 그루밍)를 `behavior.ts` 에.

- 4단계 정원 · 상점: 방을 옆으로 밀기(지금 방은 `touch-action:none`), `nyang_pots` 표, 엽전은 `nyang_profiles.coins`, 츄르 구매는 `_spend_sia_coin(user, 5, 'nyang', ref)`.
- 5단계 여러 마리: 규칙 · SQL 은 이미 4마리까지(`catRoom`, `CAT_NEED`). 화면은 지금 `state.cats[0]` 한 마리만 그린다 — `room.ts` 를 고양이마다 `CatActor` 로.
- 6단계: shared/games.js · presence `GAME_CHANNELS` · ranking-dialog 탭 · deploy.yml · 로비 카드. PWA head 블록은 index.html 에 이미 있다. 배경음 폴더 `shared/audio/bgm/nyang/`(README 표에 줄 있음). `playBgm('nyang', 밤이면 'boss')` 는 이미 부른다.

## 알려진 문제 · 임의로 정한 것

- 성격 5종의 수치 · 좋아하는 곳, 털 색 RGB, 친밀도 표, 감기 낫는 기준(네 상태 모두 70% 이상 · 물 안 상함), 쓰다듬기 간격 8초 · 하루 1800점, 하루 첫 돌보기 엽전 20, 모래 선물 20% · 3~10엽전은 모두 내가 정했다.
- 감기 조건을 '바닥인 채 24시간' → **28시간(`sick_sec` 100800)** 으로 늘렸다 (3단계 pace: 하루 1번이면 감기를 가장 먼저 부르는 건 기분이 아니라 물(6~7시간에 바닥)이었다. 24시간이면 하루 1번 방문자가 약 6일에 한 번 걸려 '숙제' 느낌 → 28시간이면 약 19일에 한 번, 하루 2번이면 0번). 기분 감소 속도는 그대로.
- 3단계 수치(놀이 · 빗질 · 츄르 · 쓰다듬기 친밀도, 선물 확률 · 종류, 첫 츄르 3개, 행동 단계: 무릎 3 · 따라다니기 4 · 배 보여 주기 6 · 꾹꾹이 8 · 같이 자기 10)는 모두 내가 정했다. 친밀도는 '하루 상한이 있는 돌보기(놀이 24000 · 쓰다듬기 6000 · 빗질 12000)'가 큰 몫이 되게 해서, 하루 2번이면 상한을 거의 채우고 3번째 방문은 조금만 빨라지게 했다 (2번 ≈ 64일, 3번 ≈ 55일).
- 미니게임 점수는 서버가 잡은 수만 상한(15개 · 2초에 하나)으로 자른다 — 화면을 고쳐 15개를 보내면 그대로 받는다 (친목용, 상한만).
- 선물은 '들어올 때' 굴린다 — 화면을 켜 둔 채로는 새 선물이 오지 않는다 (다음 입장 때). `&gift=1` 은 로컬 모드 전용 강제 선물.
- 상자 장난감: 고양이가 상자 속에 있을 때 귀 끝 · 꼬리가 상자 옆으로 조금 보일 수 있다 (자세 그림이 상자보다 넓음).
- 츄르 연출은 코드 연출(눈 반짝 ✦ · 분홍 혀 · 입맛 다시기 혀 흔들기)이다. 다른 에이전트가 만드는 `art/spritecook/churu/` 그림이 오면 `props.ts` 의 `churuTube` · `cat.ts` 의 `FACE` 자리를 바꾸면 된다.
- 보호소 고양이 목록은 서버가 확인하지 않는다 (아무 털 색 · 성격으로 입양 가능 — 친목용 규칙).
- 같은 고양이의 밥그릇 · 물그릇 · 화장실이 고양이마다 따로라는 모델이다 (여러 마리일 때 그릇을 나눌지 5단계에서 정할 것).
- 자세 그림의 쓰다듬는 곳(`spotAt`)은 정면 앉은 그림 비율로 어림한다. 담요 · 물 주전자 위치는 대강이다.
- 진동은 `navigator.vibrate` — 아이폰 사파리는 없음.
- 실제 Supabase 서버에서는 아직 돌려 보지 않았다 (PGlite 와 로컬 모드만).
