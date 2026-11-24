# 시아의탑 — 진행 상황

## 만든 것 (MVP: 캐릭터 만들기 + 1~10층)

- 패키지: `games/tower` (Vite + TS + Phaser 3.90, 개발 포트 5298). `npm test` · `npm run build` · `npm run bot -- <씨앗 수> [마지막 층]`
- 데이터(JSON, `src/data/`): `floors.json`(10층 구성 규칙 · 구역 10개, 1구역만 ready) · `rooms.json`(방 템플릿 20개, 15×11 글자 그리드) · `enemies.json` · `orbs.json`(16개, 쥐·소만 `implemented`) · `items.json`(상점·상자) · `growth.json`(능력치·경험치 곡선). 타입 붙인 로더 `src/data/index.ts`.
  100층까지 늘릴 때: `floors.json` 의 구역에 적·정예·보스를 채우고 `ready: true`, 새 적은 `enemies.json`, 새 방은 `rooms.json`. 새 AI·구슬 스킬만 코드.
- 시뮬레이션(순수 TS, 고정 1/60초, 씨앗 Rng): `src/game/floorgen.ts`(층 생성) · `sim.ts`(이동·충돌·3타 콤보·적 AI·문 잠김·퍼즐·상자·혼력·스킬·각성·정예·골렘·죽음·부활) · `progress.ts`(저장 모양·층 깨기·체크포인트·상점·구슬·각성).
- 화면: `src/ui/app.ts`(처음 화면·캐릭터 만들기·HUD·메뉴·상점·쓰러짐·10층 돌파) · `controls.ts`(조이스틱·버튼·키보드) · `preview.ts` · `src/scenes/GameScene.ts`(타일맵·레이어 캐릭터·정수 배율).
- 서버: `src/net/api.ts` — `tower_state()` · `tower_set_look(p_look)` · `tower_save(p_data, p_cleared)` 만 부른다. 통신 실패한 저장은 기기(`siatower:pending:<uid>`)에 보관했다가 다음 저장·시작 때 순서대로 다시 보낸다.
- 테스트: `tests/data` · `floorgen`(갇힘 없음 60씨앗 × 10층) · `rules` · `api` · `bot`(봇이 1→10층 실제 플레이, 씨앗 6개).
- 로비 카드 `shared/images/card-tower.png` (`scripts/make-card.py`, 임시).

## 밸런스 (봇 측정, `npm run bot -- 6`)

- 층당 레벨: 10층을 깨면 Lv 11 (첫 도전), 9층을 깬 뒤 Lv 9~10 → 평균 한 층에 1레벨
- 일반 적 타수: 평균 3.5~4.4 (계산 `hitsToKill` 은 1~10층 모두 3~5)
- 엽전: 한 구역에서 번 것 약 600~720냥 (회복약(대) 10~12개)
- 문지기 골렘: Lv10~11 봇 기준 100~180초. 첫 도전에서 봇이 쓰러지는 씨앗이 6개 중 2개 (체크포인트 1층부터 다시 → 두 번째에 깸)
- 한 층 봇 30~55초 (사람은 더 길다). PRD 의 "100층 약 10시간"(층당 6분)에는 아직 짧다 — 구역이 늘 때 방 수·적 수를 늘릴 것

## 개발용 주소 (개발 서버 localhost 에서만)

`http://localhost:5298/games/tower/?local=1` — 로그인·서버 없이, 기록은 이 기기(`siatower:local`)에만.

| 붙이는 값 | 뜻 |
|---|---|
| `&reset=1` | 기기 기록을 지우고 캐릭터 만들기부터 |
| `&floor=5` | 그 층에서 바로 시작 (레벨도 그 층에 맞추고, 3층 이상은 쥐 · 8층 이상은 소 구슬) |
| `&lv=10` | 레벨 |
| `&god=1` | 무적 |
| `&orbs=rat,ox` · `&awaken=rat` | 구슬 · 각성 |
| `&coins=1000` · `&shards=5` | 엽전 · 구슬 조각 |

예: 상점 `?local=1&floor=5&coins=900`, 골렘 `?local=1&floor=10`, 각성 시험 `?local=1&floor=8&awaken=rat,ox`.
콘솔에서 `__towerGame.scene.getScene('tower').run` 으로 시뮬레이션 상태를 볼 수 있다 (테스트 모드에서만).

## 남은 것

- 11층 이후 구역 내용(적·정예·보스·테마 타일), 용 이후 구슬 14개의 스킬
- 전용 그림(SpriteCook): ASSETS.md 의 목록
- 배경음 (지금은 효과음만)
- 서버 `104_tower.sql` · 로비 등록 · 랭킹 탭 · deploy.yml 은 메인 작업
