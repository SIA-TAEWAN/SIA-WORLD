# 시아열두길 — 진행 상황 (다음 단계를 맡는 사람이 먼저 읽을 것)

마지막 갱신: 2026-11-23 · **1~3단계 끝** (핵심 전투 · 무기/스킬/대원/물약 · 1지형 완성). 다음은 4단계(장비·드랍).

## 해 보기

```bash
cd games/twelve
npm run dev      # http://localhost:5297/games/twelve/?local=1
npm test         # 122개
npm run build
npm run gen      # src/data/maps/r01.ts 다시 만들기 (맵 생성)
```

개발 옵션 (`?local=1` 뒤에): `&map=1-3`(바로 그 맵) · `&lv=50` · `&god=1`(무적) · `&all=1`(모두 열림) · `&hero=tiger` · `&weapon=bow`.
개발 옵션으로 하는 판은 저장하지 않는다. 테스트 모드에서는 콘솔의 `__twelve` 가 지금 판 상태(RunState)다 (화면 확인할 때 자리를 옮기는 용도).
PC 키: WASD/방향키 이동, J 공격, K·L 스킬, U 고유 스킬, 스페이스 구르기, 1·2 물약, Esc 일시정지.

## 만든 것

- **1단계:** 패키지 골격(돌격대와 같은 구성), 전투 시뮬레이션(이동·벽·물, 공격·조준 보정, 구르기 무적, 요괴 깨어남·길 찾기·공격 예고, 체력·마력, 쓰러짐, 출구·숨은 상자), 전투 화면(HUD · 조이스틱 · 버튼 · 키보드 · 작은 지도 · 피해 숫자).
- **2단계:** 무기 4종 기본 공격 + 스킬 2개씩, 대원 13종 표와 고유 스킬(고양이는 숨김), 물약 2칸, 대원·무기 고르기 화면.
- **3단계:** 1지형 맵 8개(생성 스크립트), 요괴 5종(4가지 행동) + 정예, 지형 보스(예고 공격 4가지 + 부하 부르기 + 어려움 전용 공격), 별 3개, 결과 화면, 메인 → 십이지 지도 → 지형 → 맵 → 결과 흐름(2~12지형·최종보스·가방·탑·랭킹은 '준비 중'), 설정(소리·진동·왼손잡이·피해 숫자), 기기 저장.

## 파일 위치

| 파일 | 내용 |
|---|---|
| `src/data/balance.ts` | 전투 기준 값(간격·타일·구르기·물약·피해 식) |
| `src/data/regions.ts` | **12지형 표**, 맵 id(`'지형-맵'`)·`parseMapId`, 모드(`normal`/`hard`), `mapLevel`(권장 레벨)·`mapScale`(요괴 배율), `REGIONS_READY`(열린 지형 수) · `HARD_READY` |
| `src/data/acts.ts` | 공격·스킬을 이루는 동작 조각 타입 (hit · shot · dash · zone · chain · heal · buff) |
| `src/data/weapons.ts` | 무기 4종(기본 공격 + 스킬 2), 착용 레벨 12단계 `TIER_LEVELS`, `tierAtk`(초안) |
| `src/data/heroes.ts` | 대원 13종: 능력치 배율 · 잘 다루는 무기 · 고향 · 합류 지형 · 고유 스킬 |
| `src/data/enemies.ts` · `bosses.ts` | 요괴 9종(행동 4가지) · 정예 배율 · 보스 12종(공격 목록, 어려움 전용 공격) |
| `src/data/growth.ts` | 레벨별 기본 능력치, 경험치 곡선(초안), `Loadout` → `playerStats` |
| `src/data/maps.ts` · `maps/r01.ts` · `mapgen.ts` | 맵 타입(`MapDef`)과 조회, 1지형 데이터(생성물), 조각을 이어 붙이는 생성기 |
| `src/game/sim.ts` | 전투 시뮬레이션 (순수 모듈, `createRun` · `step(s, input)` · `events`) |
| `src/game/progress.ts` | 프로필·맵 열림·별·보상 계산·결과 검사 (기기 저장 규칙 = 서버가 따라 할 규칙) |
| `src/net/api.ts` · `local.ts` · `world.ts` | `TwelveApi`(기기 저장 구현 + **서버 분기 자리**), 개발 옵션, 공용 모듈 연결 |
| `src/scenes/GameScene.ts` · `art.ts` | Phaser 화면(그리기만) · 그림 목록 |
| `src/ui/app.ts` · `controls.ts` | 메뉴·지도·지형·전투 HUD·결과 · 조이스틱/버튼/키보드 |
| `tests/` | sim · skills · heroes · enemies · maps · progress + `bot.ts`(자동 조종) · `helpers.ts` |

## 다음 단계가 알아야 할 것

- **마이그레이션은 `078_twelve.sql`** (공통 지침 갱신: 고양이 PR 이 071~077 을 쓴다). 아직 SQL 은 없다.
- **서버 연결 자리:** `net/api.ts` 의 `getApi` — 지금은 로그인해도 `createLocalApi`(기기 저장). `createSupabaseApi` 를 만들어 그 자리에 넣으면 된다. 화면은 `TwelveApi`(loadProfile · start · finish · setLoadout)만 쓴다.
- **서버가 받을 것:** `RunReport`(progress.ts) = 맵·모드·대원·무기·시간·클리어 여부·종류별 처치 수·정예 수·보스·상자·쓰러진 횟수. 경험치·엽전은 보내지 않는다 — `rewardOf` 가 맵 표로 계산하고(최대치는 `mapKillMax`), `checkReport` 가 거절 조건이다. SQL 표는 `mapKillMax` · `ENEMIES` · `BOSSES` · `mapScale` 에서 뽑으면 되고, `tests/sql.test.ts` 로 대조할 것. `LIMITS.clearMinTime`(20초)은 임시 값.
- **화면의 경험치·엽전(`s.exp` · `s.coins`)과 `rewardOf` 가 같다는 테스트**가 있다 (`progress.test.ts`). 요괴 보상 식을 바꾸면 둘 다 바꿀 것.
- **장비(4단계):** `Loadout`(growth.ts)에 `weaponAtk` · `armorHp` · `armorDef` 자리가 있다. 지금은 `loadoutOf(profile)` 가 "레벨에 맞는 등급의 일반 무기"를 만들어 준다 → 장착 장비로 바꾸면 된다. 레어 특수 효과(화상·흡혈·얼음 등)는 `OnHit`(acts.ts)의 `dot` · `slow` 와 `hitEnemy`(sim.ts)에 붙이면 된다. 무기 종류 고르기 UI(`showHeroes` 의 무기 줄)는 임시다.
- **물약:** 지금은 맵마다 3개씩 그냥 준다(`START_POTIONS`). 상점이 생기면 프로필의 물약 수를 `createRun(…, { potions })` 에 넘기고, 쓴 수(`s.potionsUsed` — 종류별로 나눠야 하면 고칠 것)를 결과에 실어야 한다.
- **드랍:** 요괴가 쓰러질 때 `kill` 이벤트(x, y, 정예·보스 여부)가 나온다. 엽전·아이템이 떨어지는 연출과 자동 줍기는 아직 없다.
- **새 지형 더하기:** `mapgen.ts` 의 `REGION_GEN` 에 이름·방 수를 넣고 `npm run gen` → `maps.ts` 의 `LIST` 에 `R02` 를 더하고 `REGIONS_READY` 를 올린다. 방 조각(`ROOMS` · `NOOKS`)은 지금 한 벌뿐이라 지형마다 다른 조각·환경 타일을 더해야 한다. 타일 글자를 늘리면 `sim.ts` 의 grid 값(0 바닥 · 1 벽 · 2 느려짐)과 `GameScene.makeChunk` 도 함께.
- **보스:** 12종 모두 같은 공격 목록(`BASE_MOVES`)을 쓴다. 지형별 패턴은 `bosses.ts` 의 `B(…, { moves })` 로 덮어쓰면 된다. 새 공격 모양은 `BossMove` + `bossAct`(sim.ts).
- **대원 합류:** `heroesOf(profile)` 가 맵 기록에서 계산한다(따로 저장하지 않음). 고양이는 `hidden` 이라 빠진다 — 구매 뒤 넣는 자리는 `heroesOf`.
- **성능:** 요괴는 판을 만들 때 한 번만 만들고 깨어난 것만 움직인다. 화면은 화면 안 요괴만 그림을 붙이고(재사용), 바닥은 16줄 조각 캔버스를 화면 가까이만 만들어 둔다. 요괴 137마리가 모두 깨어 있어도 한 간격 0.22ms(PC). 새 효과를 더할 때 프레임마다 Text 를 새로 만들지 말 것.

## 알려진 문제 · 아직 안 한 것

- **밸런스는 초안.** 자동 조종(`tests/bot.ts`)으로 1지형을 한 번 돌면 맵당 1~4분, 끝에 Lv11 쯤 된다 — PRD 곡선(4지형 Lv25)보다 초반 레벨이 빨리 오르고, 맵 한 판(5~6분)보다 짧다. 권장 레벨(1-8 = Lv6)과도 어긋난다. 5~6단계 `npm run pace` 에서 경험치·맵 길이를 맞출 것.
- **활·부채는 가까이 붙으면 약하다** (자동 조종이 맞으면서 싸우면 1-4 부터 권장 레벨로는 쓰러진다). 사람이 거리를 벌리면 다를 텐데 실제 플레이로 확인이 필요하다.
- **실제 폰에서 확인하지 않았다.** PC 크롬(Playwright, 420×800)으로 화면과 키보드 조작만 봤다. 터치 조이스틱·여러 손가락·아이폰 사파리·프레임 수는 10단계 확인 대상.
- 요괴 그림의 좌우(왼쪽 보기 기준으로 뒤집음)는 눈으로 확인하지 않았다.
- 이야기 장면·보스 대사(데이터 `lines` 만 있음), 드랍 연출, 지형 환경 효과, 레어 목록 표시, 랭킹·탑·가방은 없다.
- 맵 도중에 앱을 닫으면 다음에 들어올 때 "그 맵을 다시 시작해요" 안내만 뜬다 (그 판의 경험치는 기록되지 않는다).
- 로비 등록(shared/games.js 등)·CLAUDE.md 갱신은 뒤 단계 몫이라 하지 않았다.
