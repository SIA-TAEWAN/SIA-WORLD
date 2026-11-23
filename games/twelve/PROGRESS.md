# 시아열두길 — 진행 상황 (다음 단계를 맡는 사람이 먼저 읽을 것)

마지막 갱신: 2026-11-23 · **1~5단계 끝** (핵심 전투 · 무기/스킬/대원/물약 · 1지형 · 장비/드랍 · 쉼터/성장/서버 저장). 다음은 6단계(2~3지형 · `npm run pace`).
브랜치 `feature/twelve` 는 고양이 PR #9(071~077)가 들어간 `origin/main` 위로 rebase 했다 (푸시하지 않음).

## 해 보기

```bash
cd games/twelve
npm run dev      # http://localhost:5297/games/twelve/?local=1
npm test         # 182개
npm run build
npm run gen      # src/data/maps/r01.ts 다시 만들기 (맵 생성)
npm run sqlgen   # src/data 의 숫자로 supabase/migrations/078_twelve.sql 의 표(gen 블록)를 다시 쓴다
```

개발 옵션 (`?local=1` 뒤에): `&map=1-3`(바로 그 맵) · `&lv=50` · `&god=1`(무적) · `&all=1`(모두 열림) · `&hero=tiger` · `&weapon=bow`(가방의 그 종류 무기를 든다).
개발 옵션으로 하는 판은 저장하지 않는다. 테스트 모드에서는 콘솔의 `__twelve` 가 지금 판 상태(RunState)다.
테스트 모드의 기록은 `localStorage['sia-twelve-local-v2']` (지우면 처음부터. 엽전·장비를 넣어 보려면 이 값을 고친다).
PC 키: WASD/방향키 이동, J 공격, K·L 스킬, U 고유 스킬, 스페이스 구르기, 1·2 물약, Esc 일시정지.

## 만든 것

- **1~3단계:** 패키지 골격, 전투 시뮬레이션, 무기 4종·스킬·대원 13종, 1지형 맵 8개·요괴 5종·정예·보스, 별 3개, 메인 → 지도 → 지형 → 맵 → 결과, 설정.
- **4단계 (장비·드랍):** 일반·레어 무기(4종 × 12등급)·방어구·장신구, 가방 40칸·보관함·잠금, 장비 비교(초록 ▲ · 빨강 ▼), 드랍표, 확정 보정(레어: 정예 100/보스 8, 아직 없는 것부터 · 열쇠: 40%, 3번째 확정), 레어 특수 효과 7가지, 레어 빛기둥·소리·진동, 자동 줍기, 결과 화면의 얻은 것.
- **5단계 (쉼터·성장·저장):** 상점(일반 장비 · 물약 소·중·대 · 가방 늘리기 · 팔기), 대장간(강화 +1~+9 항상 성공 · 분해 → 강화석), 경험치 표와 맵 레벨 차이 보정, 10레벨마다 스킬 강화 안내, 대원 합류·바꾸기, 지형 별 24개 보상 장신구, 고양이 구매 자리, **서버 저장 `078_twelve.sql`** + `createSupabaseApi`.

## 파일 위치

| 파일 | 내용 |
|---|---|
| `src/data/economy.ts` | **밸런스 숫자 모음**: 지형별 장비 등급, 장비 능력치·강화, 레어 효과(FX), 드랍 확률(DROP)·확정 보정(PITY), 가방, 값(사기·팔기·분해·강화), 물약 |
| `src/data/growth.ts` | 레벨별 기본 능력치, **경험치 곡선 `EXP_CURVE`**, 목표 표 `GROWTH_TARGETS`(PRD 성장 표), 레벨 차이 보정 `EXP_PENALTY`, `Loadout` → `playerStats` |
| `src/data/items.ts` | 장비 목록 216개(이름·id 규칙), `itemStats`(강화 포함), `regionRares` · `starReward` |
| `src/data/sqlrows.ts` · `scripts/sqlgen.ts` | 서버 표 줄 만들기 (`npm run sqlgen`) |
| `src/game/drops.ts` | 드랍 판정 (`roll(seed, 종류, 순번)` · `normalDrop` · `eliteDrop` · `bossDrop` · `rollRun`) |
| `src/game/progress.ts` | 프로필(`TwelveProfile`), 맵 열림, 보상 표(`mapReward`), 결과 검사·적기(`checkReport` · `applyReport`), 가방 도구 |
| `src/game/rules.ts` | 착용·잠금·보관함, 상점(`buy` · `sell`), 대장간(`enhance` · `scrap`) |
| `src/game/sim.ts` | 전투 (레어 효과 · 물약 소·중·대 `stock`/`used` · 드랍 `drops`/`loot`/`picks`) |
| `src/net/api.ts` | `TwelveApi`: `createLocalApi`(기기) · `createSupabaseApi`(RPC, 못 보낸 결과 보관·다시 보내기) · `normalize` |
| `src/net/world.ts` | 공용 모듈 연결 + 고양이(`loadOwnedCharacters` · `buyCharacter`) |
| `src/ui/app.ts` | 화면 전부 (끝부분: 가방 `showBag` · 상점 `showShop` · 대장간 `showSmith` · 장비 팝업 `itemPopup`) |
| `supabase/migrations/078_twelve.sql` | 표 8개 + RPC 12개 + 랭킹 뷰 2개 + `_cat_progress_twelve` + `game_open:twelve`(닫힘) |
| `scripts/pg-expect.ts` · `scripts/pg-check.mjs` | SQL 을 실제로 돌려 기기 규칙과 맞춰 보는 도구 (아래) |
| `tests/` | sim · skills · heroes · enemies · maps · progress · **items**(장비·드랍·가방·상점·대장간) · **api**(서버 연결·성장) · **sql**(078 대조) |

## 서버 (078_twelve.sql)

- **RPC:** `twelve_state()` · `twelve_start(map, mode, hero)` → `{run, seed}` · `twelve_finish(run, report)` → `{state, result}` · `twelve_set_hero` · `twelve_equip` · `twelve_unequip` · `twelve_lock` · `twelve_claim` · `twelve_sell` · `twelve_scrap` · `twelve_enhance` · `twelve_buy(what, n)`. 모두 `{…state}`(= `TwelveProfile` 모양)를 돌려준다.
- **화면이 보내는 것:** 종류별 잡은 수 · 정예 수 · 보스 · 시간 · 상자 · 쓰러진 횟수 · 쓴 물약. 경험치·엽전·드랍·확정 보정·열쇠·별·시아코인은 서버가 계산한다.
- **표는 손으로 고치지 않는다:** `-- <gen:이름>` 블록은 `npm run sqlgen` 이 만든다. `tests/sql.test.ts` 가 블록마다 대조하므로, `src/data` 숫자를 바꾸고 sqlgen 을 안 돌리면 테스트가 깨진다.
- **규칙이 두 곳에 있다:** `progress.ts`(checkReport · applyReport) · `drops.ts` · `rules.ts` ↔ `twelve_finish` 와 상점·대장간 RPC. 한쪽을 바꾸면 다른 쪽도 바꾸고 아래 확인 도구를 돌릴 것.
- **078 은 아직 푸시 전이라 고쳐도 된다.** 배포된 뒤에는 새 번호 마이그레이션에 함수를 다시 정의하고 `scripts/sqlgen.ts` 의 `FILE` 과 `tests/sql.test.ts` 가 읽는 파일을 바꾼다.

### SQL 을 실제로 돌려 보기 (PGlite)

PGlite 는 저장소에 넣지 않았다 (`npm test` 에는 없다). 아무 폴더에 한 번 설치해 두고 쓴다.

```bash
mkdir ~/pg && cd ~/pg && npm init -y && npm i @electric-sql/pglite     # 한 번만
cd games/twelve
npx vite-node scripts/pg-expect.ts > ~/pg/expect.json                  # 기기 규칙으로 계산한 기대값
node scripts/pg-check.mjs ~/pg                                         # 001~078 적용 → 확인
```

마이그레이션 전체를 적용한 뒤 ① `_twelve_roll` = `roll` ② 권한(직접 쓰기·내부 함수 거절) ③ 시작·끝 검사(잠긴 맵, 최대치 초과, 너무 빠름, 겹침, 너무 늦음, 시아코인 조건) ④ **정해 둔 57단계(1지형 전부 → 보스 반복 → 쓰러짐 → 확정 보정 → 상점 → 대장간 → 가방 꽉 참 → 보관함)를 기기 규칙과 서버가 단계마다 같은 기록을 내는지** ⑤ 고양이(조건 → 구매 → 선택)를 본다. 2026-11-23 에 모두 통과했다.
순서를 더하려면 `scripts/pg-expect.ts` 에 `play(…)` · `rpc(…)` 줄을 더하면 된다.

## 다음 단계가 알아야 할 것

- **밸런스(6단계 `npm run pace`):** 숫자는 PRD 초안 그대로다. 고칠 곳은 `economy.ts` · `growth.ts`(`EXP_CURVE`) · `enemies.ts`/`bosses.ts`(exp·coin) · `regions.ts`(`mapLevel` · `mapScale`). 고친 뒤 `npm run sqlgen`. `pace` 도구는 아직 없다 — 맵 보상은 `mapReward(map, mode)`, 드랍은 `rollRun` 으로 계산할 수 있다.
- **새 지형 더하기:** `mapgen.ts` 의 `REGION_GEN` → `npm run gen` → `maps.ts` 의 `LIST` · `REGIONS_READY` → `npm run sqlgen` (맵 줄이 늘어난다. 서버는 표에 있는 맵만 시작할 수 있다).
- **어려움 모드:** `HARD_READY` 를 켜면 sqlgen 이 어려움 맵 줄도 만든다. 모드를 바꾸는 RPC(`twelve_set_mode`)와 화면은 아직 없다 (`profile.mode` 는 늘 `normal`). 열쇠·확정 보정·별·맵 기록은 이미 모드별로 저장한다.
- **최종보스:** 맵 id 는 `'final'` 로 약속했다 (`FINAL_MAP`, `_twelve_normal_done`, `_cat_progress_twelve`). 지금 `MapId` 타입·`parseMapId`·`_twelve_maps` 는 `'지형-맵'` 만 다루므로 7단계에서 넓혀야 한다. 열쇠 12개 검사도 그때.
- **끝없는 탑:** `twelve_tower` 표와 `twelve_tower_ranking` 뷰만 있다. 시작·끝 RPC, 층 최소 시간 검사, 10층마다 시아코인은 8단계.
- **랭킹:** `twelve_level_ranking` 뷰(level · exp · mode · hero · region · hard_done · place · total)가 있다. `shared/ranking-dialog.js` 탭과 메인의 랭킹 버튼(지금 '준비 중')은 로비 등록 때.
- **로비 등록(shared/games.js · presence · deploy.yml · CLAUDE.md)은 아직 안 했다.** `shared/characters.js` 의 `CHARACTER_GAMES` 와 071 의 `_character_games` 에는 이미 `'twelve'` 가 있다.
- **고양이:** 보통 모드를 끝내기 전에는 대원 화면에 보이지 않는다. 끝낸 뒤 '시아코인 100개로 열기' 버튼이 나온다 (`buyCharacter('cat')` → 071 의 `buy_character('twelve','cat')`, 조건은 `_cat_progress_twelve`). 최종보스가 없어 화면으로는 못 봤고 pg-check 로 서버 쪽만 확인했다. '13번째 대원' 이야기 장면은 없다.
- **레어 효과 더하기:** `economy.ts` 의 `FX` 에 숫자, `sim.ts` 의 `hitEnemy`(무기) · `hurtPlayer`(방어구)에 동작, `items.ts` 의 `FX_NAME` · `FX_DESC`. 방어구 '수호'의 지형 환경 피해 절반(`FX.ward.env`)은 환경 효과가 생기는 6단계에서 붙인다.
- **전투 화면의 드랍은 미리보기다.** 서버가 준 씨앗으로 같은 규칙을 돌려 보여 주고, 실제로 받는 것은 `twelve_finish` 의 결과다(결과 화면). 개발 판·통신 실패 판은 기기 씨앗이라 저장되지 않는다.
- **성능:** 드랍 그림 글자(Text)는 떨어질 때 한 번 만들고 주우면 지운다. 프레임마다 새로 만들지 말 것.

## 알려진 문제 · 아직 안 한 것

- **밸런스는 초안.** 경험치가 빠르다 — 1지형을 한 바퀴 돌고 보스를 몇 번 더 잡으면 Lv15 (PRD 는 4지형 끝에 Lv25). 강화석·엽전·장비 값도 맞춰 보지 않았다. 일반 장비 드랍(3%)이 맵마다 1~3개 나와 가방이 금방 찬다.
- **한꺼번에 팔기·분해가 없다.** 장비를 하나씩 눌러야 한다 (서버 RPC 는 여러 개를 받는다: `twelve_sell(bigint[])`).
- **정예를 보스보다 나중에 잡으면** 확정 보정 경계에서 전투 화면의 빛기둥과 결과가 다를 수 있다 (서버는 정예 → 보스 순서로 판정).
- **서버 RPC 를 진짜 Supabase 에서 불러 보지 않았다.** PGlite 확인과 `createSupabaseApi` 단위 테스트(가짜 RPC)만 했다. 게임은 닫혀 있고 로비에도 없으니, 배포 뒤 관리자 계정으로 한 판 해 볼 것.
- **맵 도중에 앱을 닫으면** 그 판에서 쓴 물약은 빠지지 않는다 (판이 끝나지 않아 서버가 모른다).
- 실제 폰·아이폰 사파리 확인(10단계), 이야기 장면·보스 대사, 지형 환경 효과, 소리 추가(레어 드랍은 기존 `newRecord` 를 빠르게 튼다)는 아직.
- `CLAUDE.md` 의 열두길 설명·마이그레이션 번호 갱신은 로비 등록 때.
