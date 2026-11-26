# 시아카드배틀 진행 기록

기준: `PRD.md` (사용자 스펙 + 메인이 정한 것). 개발 서버 `npm run dev` → `http://localhost:5299/games/card/?local=1`.

## 1단계 — 전투 시뮬레이션 + 카드 20장 + 요괴 4종 (완료)

- 규칙 코드 `supabase/functions/_shared/card/` (Deno 규칙: `.ts` 확장자 상대 import, Node/브라우저 전용 API 없음)
  - `rng.ts` 씨앗 난수(mulberry32, 상태 = 숫자 하나) · `hashSeed`
  - `types.ts` 카드·요괴·부적·사건 데이터 타입 — 효과는 작은 연산 목록(`Op` / `EOp` / `EvOp`)
  - `state.ts` 판·전투 상태(JSON), 입력(`Input`), 연출 사건(`SimEvent`)
  - `battle.ts` 전투 규칙 전부: 기력 3(이월 없음) · 5장 · 손패 10 · 더미 섞기 · 방어 · 화상/독/젖음/진흙/약화 + 힘 · 소멸 · 부적술 · 내림카드 · 의도(공격/방어/강화/방해/모름) · 보스 2단계 · 소환 · 피하기 · 부적 30개 효과 훅
  - `run.ts` `apply(run, input)` 하나로 입력 처리, 받아들인 입력만 `run.log` 에 쌓임
  - `data/*.ts` 카드·영웅·요괴·부적·물약·사건·막 데이터 → `games/card/src/data/*.json` 은 `npm run json` 이 만든 사본(`tests/data.test.ts` 가 같은지 확인)
- 화면 `games/card`: Vite + TS + Phaser 3, 세로 430×860 (`Scale.FIT`). 전투 화면 `src/scenes/BattleScene.ts`, 코드 그림 `src/scenes/art.ts`. 영웅은 `shared/images/zodiac/full/<id>.png` (못 읽으면 코드 그림).
  - 카드: 끌어서 요괴 위(대상 카드)·위쪽(그 밖)에 놓기, 또는 탭해서 고르고 한 번 더 탭(대상 카드는 요괴 탭)
  - 개발용 주소: `?local=1&foes=fox,acorn&kind=boss&seed=5&relics=moonOrb,whetstone`

## 입력 기록 형식 (5단계 서버 재실행용)

`run.log: Input[]` — `state.ts` 의 `Input` 참고. 예: `{t:'play', uid:5, target:1}` (uid = 덱 카드 번호, target = 요괴 번호), `{t:'end'}`, `{t:'potion', slot:0, target:2}`.
무작위는 전투마다 줄기 3개(`rng.draw` 섞기 · `rng.ai` 의도 · `rng.fx` 무작위 대상)로 나뉘어 있어, 한쪽을 더 쓰더라도 다른 쪽 순서는 바뀌지 않는다.
같은 씨앗 + 같은 입력 = 같은 상태 (`tests/battle.test.ts` '결정성').

## 남은 일

- 2단계: 지도·보상·상점·쉼터·보물·이야기, 1막 완성, 칸 진입마다 자동 저장
- 3단계: 기존 그림 연결 + 연출, 영웅 13명
- 4단계: 2~3막, 보스 12종 + 어둑시니, 부적 30(효과는 1단계에 다 넣음, 정식 확인), 이야기 12, 카드 86장
- 5단계: 서버 검증(card-finish, `109_card.sql`)·시아코인·랭킹·오늘의 도전·끝없는 모드·고양이
- 6단계: 새 그림 5장, 밸런스, 숙련 1~5, 연습 전투, 로비 공개

## 물어볼 것

(2단계 기록에 이어서 적음)
