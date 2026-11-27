# 시아집사 진행 상황 (인계 문서)

PRD: `PRD.md`. 지금 끝난 것: **13장 1단계(서버 규칙) · 2단계(입양 · 방 · 밥/물/똥/쓰다듬기) · 3단계(놀아 주기 · 츄르 · 빗질 · 친밀도 행동 · 선물 · 시간대 행동 · 마중 · 행동 도감 기록) · 4단계(베란다 정원 · 상점 · 보관함 · 엽전 경제 · SpriteCook 방/물건/식물/츄르 그림) · 5단계(꾸미기 · 가구 쓰기 · 추가 입양 · 여러 마리 · 앨범 · 행동 도감)**. 다음은 6단계(디자인 · 소리 · 랭킹 · SIA-WORLD 연결)부터.
dev 포트 **5303** (`npm run dev`, 폰은 `npm run dev -- --host` → `http://<PC의 IP>:5303/games/nyang/?local=1`).

## 파일 구조

| 파일 | 하는 일 |
|---|---|
| `src/data/balance.ts` | 모든 수치: `CONST`(SQL `_nyang_const`) · `LOVE_NEED` · `CAT_NEED`(`_nyang_table`) · 성격 5종 `PERSONALITIES`(`_nyang_personalities`) · 털 색 `COLORS`(`_nyang_ids('colors')`) · 사료 `FOODS`(`_nyang_foods`) · `SPOTS` · `kstDay` · `mix` · `shelterKittens` · 이름 규칙 |
| `src/data/poses.gen.ts` | `art/build.py` 가 만든 자세 그림 크기 · 발 기준점 (츄르 핥기 `lick-0~7` 포함, 손으로 고치지 않는다) |
| `src/data/world.gen.ts` | `art/build.py` 가 만든 방 · 베란다 · 물건 그림 크기(`WORLD_ART`) · 창 유리 자리(`WINDOW_GLASS`) · 베란다 선반 자리(`VERANDA`) |
| `src/game/rules.ts` | 순수 규칙 (시각 t 는 인자, 초 단위 정수). SQL RPC 와 1:1 |
| `src/game/recolor.ts` | 털 픽셀만 목표 색으로 (순수 함수, `tests/recolor.test.ts`) |
| `src/net/api.ts` | `NyangApi` — 서버(Supabase RPC) / 로컬(`?local=1`, rules.ts + localStorage `siaNyang:local`) 두 구현, `errorText` |
| `src/net/world.ts` | 공용 shared 모듈 런타임 로드 (auth · supabase · sound) |
| `src/ui/room.ts` | 방 화면 (4단계: 무대 `.stage > .slide` 안에 방 · 베란다를 나란히 두고 옆으로 밀기/🌱 단추로 이동, 벽 · 바닥 · 창 그림 층, 창밖 시간대 풍경, 그림 물건, 사료 봉투 누르기 = 사료 바꾸기, 약 간식 단추, 요약 카드에 수확 가능 · 배치 · 상태 그리기 · 밥 끌기 · 물 · 화장실 확대 · 쓰다듬기 · 정보 창(놀이 · 츄르 · 빗질 고르기) · 선물 줍기 · 바닥 누르면 따라오기 · 설정 · 요약 카드 · 문 앞 마중). 고양이마다 `CatView`(여러 마리 구조, 돌보기 물건은 첫 고양이 것) |
| `src/ui/ctx.ts` | 방 화면 공용 자리 `RoomCtx`(api · 상태 · 좌표 · 물건 · `saw`(도감) · `tray`(아래 띠 바꾸기) · `walkTo`) · `CatView` |
| `src/ui/behavior.ts` | 5단계: 가구 쓰기(캣타워 두 번 폴짝 → 꼭대기 · 숨숨집 쏙(구멍에 눈 반짝) · 방석/쿠션/바구니에서 자기 · 스크래처 긁기 · 책상 컵 떨어뜨리기 · 꽃병 냄새 · 러그 식빵) · 고양이끼리(서로 그루밍 = 혀 낼름 칸 · 꼭 붙어 자기 · 잡기 놀이) — 연출은 `hold/mine/release` 표(token)로 잡고, 쓰다듬기 · 밥 주기가 끼어들면 놓아준다 · `devAct`(개발용). 고양이 머리 `think`: 아픔(재채기) → 밥/물/화장실 → 심심함(등 돌린 식빵, 상자 있으면 상자 속) → 밤엔 80% 잠(10단계면 집사 옆) → 시간대별 비율로 행동 고르기(`PICKS`). `follow`(바닥 누르기, 4단계부터) |
| `src/ui/play.ts` | 놀아 주기 미니게임 30초 (낚싯대 · 레이저 · 공 · 상자), 잡은 수를 서버 상한 안에서만 센다 |
| `src/ui/treats.ts` | 츄르(달려와 조르기 → 누르고 있는 동안 짜기 · 핥기 → 입맛 다시기 · 하트) · 빗질(빗을 끌어 등 쓸기 → 털 뭉치) · 하루 다 먹었으면 고개 돌리기 |
| `src/ui/cat.ts` | `CatActor` — 자세 그림 + 코드 움직임(숨쉬기 · 깜빡임 · 걷기 통통 · 좌우 뒤집기), `Act`(idle · walk(then, arrive) · pose(ms, face) · pet · hold), 말풍선, `spotAt`(쓰다듬는 곳). 3단계: 얼굴 연출 `setFx`(sparkle 눈 반짝 · lick 혀 낼름 · smack 입맛 다시기 — `FACE` 표의 눈 · 입 자리, 정면 그림 beg · sit · sit-blink 만) · `mouthPoint` · `wiggle`(엉덩이 실룩) · `lift`(점프 높이) · `sink`(상자 속으로 가라앉고 바닥 아래는 clip-path 로 자름) · `perky`(꼬리 세우고 통통) |
| `src/ui/catart.ts` | **자세 → 그림 표 `POSE_IMAGE`** · `catArt(color, art, pattern)` 색×자세 캐시(objectURL) · `patternLayer`(무늬 층 자리, 지금은 빈 함수) |
| `src/ui/adopt.ts` | 입양 화면 (보호소 6마리 = 털 색 6 × 그날 성격) |
| `src/ui/props.ts` | 임시 SVG 물건 (밥그릇 · 물그릇 · 화장실 · 봉투 · 삽 · 방석 · 담요 · 3단계: 깃털 · 털실 공 · 상자 · 탁자 + 컵 · 츄르(맛 색) · 빗 · 선물 4종) |
| `src/ui/common.ts` | 소리 `sfx` · 진동 `buzz`(설정 `siaNyang:vibe`) · `toast` · `josa` · `floatAt` |
| `src/ui/gallery.ts` | 개발용 `?local=1&gallery=1`: 털 색 × 자세 전부 (핥기 8칸 포함) |
| `src/ui/art.ts` | 4단계: SpriteCook 그림 `worldUrl` · `artImg(이름, 대신 쓸 코드 그림)`(못 불러오면 SVG 로 바뀜) · `bgLayer`(배경 층, 실패하면 투명 → 아래 코드 배경) · 전체 주소로 만든다 |
| `src/ui/veranda.ts` | 4단계 베란다: 선반 2단 화분(4~12칸) · 빈 화분 → 씨앗 고르기 · 물뿌리개 끌어 기울이기(주둥이가 화분 위 0.65초 → `waterPot`) · 다 자라면 반짝 → 눌러 수확 · 칸 늘리기(＋) · 고양이가 가끔 따라와 냄새 맡기/나비 쫓기 |
| `src/ui/deco.ts` | 5단계 꾸미기: `Furnishing`(배치 → 가구 그림 el · 자리, 격자 칸 → 바닥 발 자리 `cellAt`, 벽 격자) · `applyStyles`(방 `data-wall/floor/window` → style.css 의 CSS 무늬) · `chooseVase`(꽃병 꽂기) · `openDeco`(격자 그리기 · 띠의 가구 끌어 놓기 · 놓인 가구 옮기기 · 아래 띠로 끌어 치우기 · 벽지/바닥/창문 탭 — 없는 것은 두 번 눌러 바로 사기 → [저장] = `nyang_place`) |
| `src/ui/album.ts` | 5단계 앨범(사진 다시 그리기 `photoHtml`: 찍은 시각의 하늘 + 바닥 + 자세 그림 · 같이 찍힌 고양이) · 크게 보기 · 지우기(두 번) · 행동 도감(모든 고양이가 본 것의 합, 못 본 것은 같은 자세의 까만 그림자 · 친밀도가 모자라면 'n단계') · `flash` |
| `src/ui/shop.ts` | 4단계 상점 · 보관함: 탭(사료 · 간식 · 츄르 · 씨앗 · 장난감 · 가구 · 보관함), 시아코인은 두 번 눌러야 삼, 보관함에서 팔기 · 고양이에게 주기(캣그라스/캣닢) · 보름달 등 바꾸기 |
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
| 5단계 `place` · `vase` · `photo` · `deletePhoto` · `ownsFurniture` · `ownsStyle` | `nyang_place(p_layout)` · `nyang_vase(p_flower)` · `nyang_photo(p_slot, p_behavior, p_pose, p_face, p_mate, p_mate_pose)` · `nyang_photo_delete(p_id)` · `_nyang_owns_furniture` · `_nyang_owns_style` |
| `visit` · `adopt` · `feed` · `water` · `clean` · `pet` · `cure` | `nyang_state(p_entry)` · `nyang_adopt` · `nyang_feed` · `nyang_water` · `nyang_clean` · `nyang_pet` · `nyang_cure` |
| `playStart` · `play` | `nyang_play_start(p_slot, p_toy)` · `nyang_play(p_slot, p_catches)` |
| `brush` · `churu` | `nyang_brush(p_slot)` · `nyang_churu(p_slot, p_flavor)` |
| `rollPresent`(visit 안) · `gift` | `_nyang_roll_present`(nyang_state 안, entry 일 때) · `nyang_gift(p_slot)` |
| `seen` | `nyang_seen(p_slot, p_behavior)` |
| `itemCount` · `addItem` · `hasToy` | `_nyang_item` · `_nyang_add_item` · `_nyang_has_toy` |
| 4단계 `topLevel` · `potGrown` | `_nyang_top_level` · `_nyang_pot_grown` |
| `plant` · `waterPot` · `harvest` · `expandPots` | `nyang_plant(p_pot, p_seed)` · `nyang_water_pot(p_pot)` · `nyang_harvest(p_pot)` · `nyang_expand_pots()` |
| `buy` · `sell` · `exchange` · `treat` | `nyang_buy(p_item, p_n)` · `nyang_sell(p_item, p_n)` · `nyang_exchange(p_id)` · `nyang_treat(p_slot, p_kind)` |
| `feed`(상점 사료면 보관함 `food:<id>` 하나 + 기분) | `nyang_feed` (다시 정의) |

거절 글자(`RuleError` = SQL `raise exception`): `bad color` · `bad personality` · `bad name` · `no room` · `no cat` · `bad food` · `bowl full` · `water fresh` · `no poop` · `bad spot` · `too soon` · `bad cure` · `not sick` · `already curing` · `need care` · `need login` · 3단계: `bad toy` · `no toy` · `no play` · `brushed today` · `bad flavor` · `churu full` · `no churu` · `no present` · `bad behavior` · `too early` · `no medicine` · 4단계: `no food` · `bad seed` · `bad pot` · `pot busy` · `no seed` · `no plant` · `pot ready` · `pot wet` · `not ready` · `max pots` · `no coins` · `not enough coin`(_spend_sia_coin) · `bad item` · `bad amount` · `locked` · `have it` · `no item` · `bad treat` · `treat full` · 5단계: `bad layout` · `not owned` · `bad flower` · `no vase` · `bad pose` · `album full` · `no photo`.

**5단계 규칙 (꾸미기 · 앨범 · 추가 입양)**
- 방 배치 `nyang_profiles.layout` = `{ items: [{id, x, y}], wall, floor, window, vase? }` (한 번도 저장 안 했으면 `{}` → 기본 배치 `DEFAULT_ITEMS` 중 가진 것). 바닥 격자 8 × 5(`grid_cols/rows`, x 0 = 왼쪽, y 0 = 벽 쪽), 벽 격자 8 × 2. 가구 `FURNITURE`(`_nyang_furniture`: 바닥/벽 · 칸 수). 막힌 칸 `BLOCKED`(`_nyang_ids('blocked')`, 'f<x>_<y>' · 'w<x>_<y>'): 밥 자리 = 바닥 0~2열 × 2~3줄, 화장실 = 4~5열 × 0줄, 벽은 창(2~5열) · 문(6~7열) → 벽 가구는 창 왼쪽 2칸 × 2줄. `nyang_place` 는 가구마다 (모양 → 모르는/두 번 'bad layout' → 없는 것 'not owned' → 격자 밖 · 겹침 'bad layout') 순서로, 그다음 wall · floor · window (없거나 null 이면 기본, 종류가 다르면 'bad layout', 없으면 'not owned'). 꽃병의 꽃은 그대로 둔다. 책상 · 방석은 처음부터, 상자는 장난감 상자가 있으면.
- 벽지 · 바닥 · 창문 `STYLES`(`_nyang_styles`): 기본 3개 + 엽전으로 사는 12개(상점 탭 '벽지·바닥' = `style:<id>`, 보관함에 1). 그림 없이 CSS(`style.css` 의 `[data-wall]` · `[data-floor]` · `[data-window]` — 색은 기존 값만: 룰렛 계절 색 · 팡팡 밤하늘 · 크림).
- 꽃병 `nyang_vase('sunflower' | 'rose' | '')`: 보관함의 꽃 하나를 쓴다 (빼면 사라짐). 꾸미기 밖에서 꽃병을 눌러도 된다.
- 사진 `nyang_photo`: 고양이 · 행동(`_nyang_behaviors`, 단계 확인) · 자세(`POSE_IDS` = `_nyang_ids('poses')`) · 방향(음수면 -1) · 같이 찍힌 고양이(0 = 없음, 자기 자신이면 'no cat') → `nyang_album`(user_id, id = `photo_seq`) 에 이름 · 털 색을 그때 것으로. 사람마다 `album_max` 60장('album full'), 지우면 다시. 처음 본 행동이면 그 고양이 `seen` 에도 (added). 상태 JSON 에 `album`(번호 순) · `profile.layout` · `profile.photoSeq`.
- 추가 입양은 1단계부터 서버에 있었다(`nyang_adopt`, `CAT_NEED` 4 · 7 · 10). 화면: 조건이 되면 방 오른쪽 위에 🐱 입양 단추 → 보호소(← 집으로) → 새 고양이와 함께 방을 다시 연다(`main.ts` `openRoom`).

**4단계 규칙 (정원 · 상점)**
- 화분: `nyang_profiles.pots`(4~12) 칸, `nyang_pots` 는 **심은 화분만** 줄이 있다(수확하면 지움). 자란 시간 = `min(grow_sec, grown + clamp(t − water_at, 0, water_sec))` — 물을 준 뒤 water_sec 동안만 자라고 마르면 멈춘다(시들지 않음). 물은 물이 남아 있으면 못 준다(`pot wet`), 다 자랐으면 `pot ready`. 그림 단계 = 다 자람 3, 아니면 ⌊자란/전체 × 3⌋. 심기 · 물 · 수확도 '하루 첫 돌보기 엽전'을 준다(시아코인은 아님).
- 씨앗은 '내 고양이 중 가장 높은 친밀도 단계'(`topLevel`, 저장된 love 기준)로 열린다. 선물로 받은 씨앗은 단계와 상관없이 심을 수 있다.
- 상점 `SHOP`(`_nyang_shop`): 엽전 · 시아코인 · 한 번에 받는 수(give) · 하나만(once: 장난감 · 가구) · 단계. 시아코인은 `_spend_sia_coin(me, sia×n, 'nyang', 'buy:<buy_seq+1>')`, `buy_seq` 는 시아코인으로 살 때만 오른다. 가구는 `furniture` 배열에 (`furniture:` 를 뗀 id).
- 기본 사료는 공짜 · 무제한(보관함을 쓰지 않음) — 엽전이 0 이어도 밥은 언제나. 참치 · 고급 사료는 5그릇 묶음, 먹으면 기분 +1500 / +3000.
- 팔기 `SELL`(`_nyang_sell`): 꽃 · 풀(보름달꽃 제외) · 털 뭉치(2). 바꾸기 `EXCHANGES`: 보름달꽃 3 → 보름달 등(하나만).
- 풀 주기 `treat`: 캣그라스(기분 +5000 · 친밀도 +1000) · 캣닢(+8000 · +2000, `nip_at` → 화면은 10분 동안 우다다 `behavior.ts`), 고양이마다 하루 2번(`treat_day`/`treat_n`). 아플 때는 친밀도 0.

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
- 화면용(authenticated): `nyang_state` · `nyang_adopt` · `nyang_feed` · `nyang_water` · `nyang_clean` · `nyang_pet` · `nyang_cure` · `nyang_play_start` · `nyang_play` · `nyang_brush` · `nyang_churu` · `nyang_gift` · `nyang_seen` · 4단계 `nyang_plant` · `nyang_water_pot` · `nyang_harvest` · `nyang_expand_pots` · `nyang_buy` · `nyang_sell` · `nyang_exchange` · `nyang_treat`. `game_open:nyang` = false.
- 5단계: 표 `nyang_album` 을 다시 정의(사진 번호 · 이름 · 털 색 · 자세 · 방향 · 같이 찍힌 고양이 — 아직 push 전이라 같은 파일에서 고쳤다), `nyang_profiles.photo_seq`, `_nyang_const` 에 grid · wall · album_max, `_nyang_ids` 에 poses · base_furniture · base_styles · blocked · vase_flowers, `_nyang_behaviors` 에 8줄, `_nyang_shop` 에 style 12줄, 새 데이터 함수 `_nyang_furniture` · `_nyang_styles`, `_nyang_json` 에 layout · photoSeq · album.
- 4단계: 표 `nyang_pots` 를 다시 정의(plant · planted_at not null, `calc_at` 없앰 — 아직 push 전이라 같은 파일에서 고쳤다), `nyang_profiles.pots` · `buy_seq`, `nyang_cats.treat_day` · `treat_n` · `nip_at`, `_nyang_foods` 에 mood · pack 열, 새 데이터 함수 `_nyang_plants` · `_nyang_shop` · `_nyang_sell` · `_nyang_exchanges` · `_nyang_treats`, `_nyang_table('pot_prices')`, `_nyang_json` 에 `pots` 배열 · profile.pots/buySeq · 고양이 treat 열.
- 3단계에서 표에 더한 열: `nyang_profiles.pseq` · `nyang_cats.play_at/play_toy/play_day/play_love/brush_day/churu_day/churu_n/present_at/present` (`seen` 은 1단계부터 있던 열을 쓴다).
- 잠금 순서: nyang_profiles → nyang_cats → wallets. 새 RPC 는 `_nyang_me()` → `_nyang_cat()` → 바꾸고 `_nyang_save` → `_nyang_care` → `_nyang_pay` → `_nyang_json` 순서를 따른다.
- **PL/pgSQL 함정**: `if … < case when … then … end then` 은 IF 가 CASE 안의 `then` 에서 끊겨 문법 오류 — 변수로 빼라. 변수 이름이 열 이름(`seq` 등)과 같으면 ambiguous.

## 검사

- `npm test`: `rules.test.ts`(시간 계산 · 친밀도 · 쓰다듬기 · 돌보기 · 감기 · 입양) · `sql.test.ts`(SQL 값 · 표 · 식 · 권한이 데이터와 같은지 — 새 마이그레이션이 함수를 다시 정의하면 `FILES` 에 더한다) · `recolor.test.ts`.
- PGlite (저장소 밖에 설치): `npx vite-node scripts/pg-expect.ts > <pg>/nyang-expect.json && node scripts/pg-check.mjs <pg>` — 001~123 적용 후 권한 · `game_open` · **1595단계를 기기 규칙과 대조(확인 3268개 모두 통과 — 5단계 꾸미기 무작위 배치 160번 · 꽃병 · 셋째/넷째 입양 · 사진 90번 · 지우기 포함, 2026-11-27)**. 엽전 · 시아코인 잔액은 `setcoins` · `setsia` 단계로 SQL 에서 맞추고, 끝에 `sia_coin_spends`('nyang') 수 = `buy_seq` 를 본다. 보관함은 `setitem` 단계로 SQL 에서 맞춘다. `_nyang_now()` 를 설정 값 `nyang.now` 로 바꿔 시각을 맞춘다. 새 RPC 는 `pg-expect.ts` 의 순서와 `pg-check.mjs` 의 `CALL` 에 더한다.
- `npm run pace`: 성격 5종 × 하루 1 · 2 · 3번 × 츄르 0 · 2개(1번은 0 · 1개). 들를 때마다 밥 · 물 · 똥 · 놀이 한 판(낚싯대 10마리) · 쓰다듬기 3번, 하루 한 번 빗질. 들르는 시각은 정해진 무작위로 흔든다(하루 1번은 8~23시 아무 때, 2 · 3번은 ±1.5시간). 감기는 무작위 3가지의 합.
  4단계부터 정원도 돌린다: 들를 때마다 수확 → 모두 팔기 → '하루 들르는 횟수 안에 다 자랄 수 있는 것' 중 이익이 큰 씨앗을 사서 심기 → 물, 엽전이 '다음 칸 값 + 씨앗 값'보다 많으면 화분을 늘린다.
  **엽전 (2026-11-27, 얌전이)**: 하루 2번 — 7일 175냥 · 7칸 / 14일 10칸 / 30일 12칸 · 4천냥, 이후 하루 약 300냥이 쌓임. 하루 3번 — 14일에 12칸. 하루 1번 — 30일 10칸 · 60일 12칸(하루 약 55~80냥). 장난감 · 가구(합 약 920냥 + 시아코인 60)는 하루 2번이면 3주 안팎에 모두 살 수 있다.
  **추가 입양 (5단계에 출력 추가, 첫 고양이 Lv4 · 7 · 10)**: 하루 2번 — 둘째 7일 · 셋째 24~25일 · 넷째 62~66일 / 하루 3번 — 6 · 20~22 · 53~56일 / 하루 1번 — 11~12 · 38~46 · 101~117일 (츄르 2개면 며칠씩 빠름).
  **2026-11-27 결과 (LOVE_NEED 합 4,140,000)**: 10단계 — 하루 2번 62~66일(츄르 2개면 57~59일) · 하루 3번 53~56일(츄르 2개면 48~52일) · 하루 1번 101~117일. 감기 — 하루 1번 94번/1800일(약 19일에 한 번) · 하루 2 · 3번 0번.

## 로컬 모드 · 개발 설정 (localhost / dev 서버만)

`?local=1` 로그인 없이, rules.ts 로 기기 안에서. `&time=10` 시간 10배(저장된 시계를 이어 받아 다시 잰다) · `&skip=6h`(s · m · h · d, 한 번만 — 주소에서 지운다) · `&love=7` 첫 고양이 친밀도 7단계로(한 번) · `&reset=1` 처음부터 · `&gallery=1` 털 색 × 자세 그림 · 3단계: `&toys=1` 장난감 모두 · `&churu=5` 맛마다 츄르 5개 더 · `&gift=1` 첫 고양이가 선물을 물어 온 것처럼 (모두 한 번). 마중은 `&skip=7h`. 4단계: `&coins=500` 엽전 더 · `&sia=50` 시아코인 더 · `&seeds=3` 씨앗 종류마다 3개 더 (모두 한 번). 정원은 `&skip=65m` 처럼 시간을 넘겨 확인. 5단계: `&furn=1` 가구 모두 + 상자 + 해바라기 · 장미 3송이 · `&cats=4` 그 수까지 바로 입양(첫 고양이 친밀도를 올린다) · 입양 단추는 `&love=4` 로. 콘솔 `__nyang.act(slot, 'tower' | 'hide' | 'scratch' | 'knock' | 'groom' | 'cuddle' | 'chase' | 'zoomies' …)` 로 행동을 바로 시킨다.

## 그림

- 자세 그림 13장(`art/spritecook/poses/`, assets.json 의 foot · scale) → `python art/build.py` → `public/art/cat/`. 모든 자세가 같은 배율이라 화면 배율 하나(`cat.floor.scale`)로 그리고 foot 을 바닥 점에 둔다. `jump` 는 anchor `air` (40px 띄움).
- 게임 속 자세 → 그림: `src/ui/catart.ts` 의 `POSE_IMAGE` (sit · blink · walk1/2 · loaf · sleep · eat · drink(=eat) · stretch · pounce · jump · beg · knead · belly). 새 자세 그림이 오면 assets.json 에 넣고 build.py → 이 표에 한 줄.
- 털 색: `recolorFur` — 털(불투명 · min>185 · r−b<14)을 목표색 × (원래색/흰털)로, 작고(220px 미만) 둘레 70% 이상이 어두운 털 덩어리(눈 반짝임)는 그대로, 털 옆 2px 경계는 밝기로 섞인 정도만큼. 검정(92,90,104)도 외곽선 · 눈이 보이는 것을 화면으로 확인했다.
- 무늬(줄무늬)는 `catArt(color, art, pattern)` 의 `patternLayer` 에서 색을 바꾼 canvas 위에 그리면 된다 (DB `nyang_cats.pattern`).
- 4단계 방 · 물건 · 식물 · 가구 · 츄르: `art/spritecook/<room|veranda|objects|plants|furniture|churu|card>/` + `assets-world.json`(용도 · 크기 · 자리) → `python art/build.py` → `public/art/world/*.webp`(물건 200px · 식물 160×248 같은 캔버스 · 가구 260px · 배경 768) + `public/art/cat/lick-0~7.png` + `world.gen.ts`. 방 배경은 벽(줄무늬 42px × 9 = 378px 를 가로 되풀이) · 바닥(늘림) · 창(유리 투명 + 뒤에 `view-<시간대>`) 세 조각으로 나눠 방 비율이 달라도 창이 잘리지 않게 했다. `_sheets/` · `*.html` · `lick-sheet` · `lick.webp` · `card-original` · `room/room.png` 은 `art/spritecook/.gitignore` 로 커밋하지 않는다. asset id 는 `spritecook-assets.json`.
- 코드 그림(`props.ts` SVG · CSS 벽/바닥/창/베란다 하늘)은 그림을 못 불러올 때 대신 보인다 (`artImg` · `bgLayer`).
- 츄르: 누르고 있는 동안 `lick0~7`(8fps)을 돌리고 `objects/churu-<맛>` 그림을 입 앞에(뜯은 입구 78% · 8% 를 축으로 222~230° 돌려 몸통이 오른쪽으로) 겹친다. 털 색 바꾸기는 핥기 칸에도 그대로 — 입 · 혀 분홍은 물들지 않는 것을 갤러리에서 6색 모두 확인했다.
- 엽전 그림(`objects/coin`)은 장식 한자가 있어 크게 쓰지 않는다 — 위 띠 · 선물 주머니는 코드 그림 그대로.
- 로비 카드 `shared/images/card-nyang.png` (640×400) 는 넣어 두었다 (로비 연결은 6단계).

## 다음 단계에서 붙일 자리

- 6단계: 디자인 다듬기(가구 · 고양이 크기 비, 커튼 · 벽지 무늬가 DESIGN.md 와 맞는지 Fable 검토), 소리(사진 찰칵 · 긁기 · 가구 효과음은 지금 기존 ZzFX 재사용), 랭킹(친밀도 합 → 돌본 날 → 먼저), SIA-WORLD 연결. 무늬(줄무늬)는 `catArt` 의 `patternLayer`.
- 5단계에서 '지난 단계에서 붙일 자리'로 적었던 것(꾸미기 · 앨범 · 여러 마리)은 모두 끝났다.

- (4단계 끝남) 상점: 장난감은 `items['toy:<id>'] = 1`, 츄르는 `items['churu:<맛>'] += n`(시아코인 5개씩 `_spend_sia_coin`), 약 간식 `items.medicine`. 받은 씨앗(`seed:<id>`) · 털 뭉치(`fur`)는 보관함에 이미 쌓인다. 정보 창 장난감 · 츄르 고르기의 '상점에서 (곧)' 글을 상점 단추로 바꾼다.



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
- 4단계에서 내가 정한 것: 식물 값(씨앗 4 · 5 · 10 · 15 · 25 · 50 / 팔 값 8 · 7 · 24 · 32 · 50 · 없음), 화분 값 100~800(합 3120), 사료 2종 값 · 기분, 약 간식 8, 장난감 60 · 40 · 30, 가구 40~400 · 십이지 선반 시아코인 60, 털 뭉치 2냥, 풀 주기 하루 2번 · 수치, 보름달꽃 3송이 = 보름달 등. 방석 · 책상은 기본 가구라 상점에서 뺐다.
- 엽전은 하루 2~3번 성실히 정원을 돌리면 한 달쯤 뒤 쓸 곳(화분 · 장난감 · 가구)보다 많이 쌓인다 (pace 하루 2번 약 300냥/일). 5단계 꾸미기(벽지 · 바닥 · 창문)를 엽전 쓸 곳으로 더하면 된다.
- 고양이가 베란다에 따라오는 것은 화면만의 연출이다 (방 쪽 고양이는 그대로 방에 있다고 본다). 아플 때 · 연출 중에는 오지 않는다.
- (5단계 고침) 베란다 화분 열을 왼쪽으로 모아(`0.085 + 열 × 0.13` W) 6번째 열의 큰 꽃이 오른쪽 위 무대 단추와 겹치지 않는다 (393×659 · 12칸 모두 장미/보름달꽃으로 확인, 겹침 0).
- 5단계에서 내가 정한 것: 격자 8 × 5 · 벽 8 × 2, 밥 자리 · 화장실 막힌 칸, 가구 칸 수 · 그림 크기(`deco.ts` 의 `ART`), 기본 배치(책상 0,0 · 방석 3,4 · 상자 6,3), 문을 오른쪽 벽으로 옮기고 창을 가운데로(왼쪽 벽 = 벽 가구 자리), 벽지 · 바닥 · 커튼 15종과 값(600~2,000냥, 합 12,500냥 — pace 하루 2번 30일 뒤 하루 약 350냥이 남으니 한 달쯤 모아 다 산다), 앨범 60장, 꽃병의 꽃은 빼면 사라짐, 사진은 하루 상한 없음, 도감에 sit · walk · tower · hide · scratch · groom · cuddle · chase 8개를 더해 28개.
- 여러 마리 화면: 밥그릇 · 물그릇은 고양이 수만큼 밥 자리(왼쪽 가운데)에 나란히(밥 뒤 · 물 앞 두 줄, 2마리부터 그릇 아래 털 색 점), 사료 봉투는 가장 가까운 밥그릇에 붓는다. 화장실은 하나에 모두의 똥 합(4개 넘으면 ×n), 확대 화면의 덩어리마다 주인이 있어 퍼내면 그 고양이의 청결. 아래 띠 고양이 단추는 '고양이 n마리' → 정보 창 위 이름표로 고양이를 바꾼다. 📷 는 한 마리면 바로, 여러 마리면 '찍을 고양이를 눌러요' 후 누른 고양이. 바닥 누르기는 따라오기 단계가 된 고양이 모두가 조금씩 비켜서 따라온다. 마중은 아프지 않은 고양이 모두가 문 앞으로.
- 성능 (393×659, Playwright WebKit = 소프트웨어 그리기): 고양이 4마리 update 스크립트는 한 장면에 0.02ms. 기기 픽셀 배율 1 에서는 4마리 우다다 중에도 63~64fps(95% 16ms). 배율 3(아이폰 흉내)에서는 고양이 없이도 34fps 인 환경이라 4마리 20fps 안팎 — GPU 로 그리는 실제 폰에서는 차이가 작을 것으로 보지만 실기기 확인이 필요하다. 줄인 것: 고양이 그림을 화면 크기 × 기기 배율 × 1.2 로 줄여 만든다(`setArtScale`), 바뀐 스타일만 쓴다(`CatActor.set`), 0.5초마다 하던 가구 자리 다시 잡기를 배치가 바뀔 때만.
- 고양이 행동 · 가구 연출은 화면만의 것이다 (서버는 도감 · 사진에 남는 행동 id 만 확인).
- 캣타워 꼭대기 높이(그림 높이의 74%) · 숨숨집 구멍 자리 · 꽃병 꽃(식물 그림 윗부분 잘라 쓰기)은 그림 기준 대강이다.
- 물뿌리개 주둥이 위치는 그림 기준 대강(손가락 왼쪽 45px)이다.
