# 시아탱크

설치·회원가입 없이 링크 하나로 즐기는 브라우저 턴제 포격 게임. 각도·파워·바람을 계산해 맞히고, 포탄이 지형을 부순다.

## 지금 되는 것 (PRD 1~4단계)

- **핵심 엔진**: 픽셀 비트맵 지형 파괴, 중력·바람 탄도, 데미지 공식(직격 +20%), 탱크 낙하·추락 탈락
- **턴 규칙**: 딜레이 기반 턴 순서, 턴당 30초, 필살기 게이지
- **탱크 4대 × 무기 3종**: 볼트 / 드릴러 / 스패로우 / 버블 (수치는 `src/data/*.json`)
- **맵 3종**: 밸리 / 스카이 / 스핑크스 (+ 랜덤)
- **아이템 4종 + 상점**: 더블샷, 파워업, 수리킷, 순간이동 (매 판 1,000포인트, 3칸, 판매 가능)
- **AI 1:1**: 쉬움 / 보통 / 어려움, 그리고 한 기기 2인 대전
- **화면**: 입장 → AI 1:1 설정(탱크·상대·맵·상점) → 게임 → 결과
- **조작**: PC 키보드 + 모바일 터치 버튼, 화면 드래그로 맵 둘러보기

- **온라인 대기실** (3단계): 링크 하나 = 대기실 하나(최대 10명, ID 중복 불가), 접속자 목록, 채팅, 아이템 상점, 게임방 목록
- **게임방**: 최대 4명, 탱크·팀(3명 이상일 때)·맵 선택, 누구나 시작, 1:1 / 2:1 / 2:2
- **동기화**: 턴마다 이동 기록·발사 입력만 주고받고 모든 기기가 같은 물리로 계산. 기준 기기가 턴 결과 지문을 보내고, 다르면 전체 상태를 받아 맞춤
- **접속 끊김**: 30초 동안 자리 유지(새로고침하면 자동으로 다시 들어감), 넘으면 AI가 이어서 조종하고 그 판에는 다시 못 들어옴. 기준 기기가 끊기면 다음 사람이 이어받음

- **그래픽** (4단계): 탱크 숨쉬기·눈 깜빡임·주행 흔들림·흙먼지·발사 반동·피격 흔들림, 무기별 포탄 모양과 꼬리, 파티클 폭발(섬광·불덩이·파편·연기), 맵별 배경(눈 덮인 산맥과 나무 / 구름 바다와 떠 있는 섬 / 피라미드·야자수, 벽돌 피라미드와 석상 얼굴)
- **소리**: 효과음과 배경음악(메뉴·대전 2곡) 모두 코드로 합성, 끔 상태는 기기에 기억
- **모바일**: 가로로 눕힌 휴대폰용 낮은 조작판, 보이는 영역 기준 카메라
- **로딩**: 첫 화면은 약 24KB(gzip)만 받고, 게임 엔진(Phaser)은 첫 화면이 뜬 뒤 미리 받아 둔다

## 온라인 설정 (Supabase)

1. Supabase 대시보드 → **SQL Editor**에 `supabase/migrations/001_rooms.sql`을 붙여넣고 Run
2. 로컬: `.env.local`에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable 키)
3. 배포: 저장소 Settings → Variables에 `SUPABASE_URL`, `SUPABASE_ANON_KEY`

다른 대기실은 주소에 `?l=코드`를 붙인다. 서버 없이 테스트하려면 `?local=1`(같은 브라우저 탭끼리 통신).

## 조작

| 동작 | PC | 모바일 |
| --- | --- | --- |
| 이동 | ← → | 왼쪽 아래 버튼 |
| 각도 | ↑ ↓ | 오른쪽 위/아래 버튼 |
| 무기 | 1, 2, 3 | 무기 칸 터치 |
| 아이템 | Q, W, E | 아이템 칸 터치 |
| 발사 | 스페이스 누르고 떼기 | 발사 버튼 누르고 떼기 |
| 둘러보기 | 마우스 드래그 | 화면 드래그 |

## 개발

```bash
npm install
npm run dev        # http://localhost:5173/sia-tank/
npm test           # 엔진 규칙·결정론 테스트
npm run balance    # AI끼리 자동 대전으로 탱크별 승률 측정 (예: npm run balance -- 4 normal)
npm run stats      # 탱크별 평균 피해·빗나감 비율
npm run build
```

`main` 브랜치에 push하면 GitHub Actions가 테스트·빌드 후 GitHub Pages에 배포한다.
(저장소 Settings → Pages → Source를 **GitHub Actions**로 설정)

## 구조

```
src/
  data/      tanks.json, weapons.json, items.json, maps.ts  ← 밸런스는 여기서 조정
  physics/   terrain.ts (비트맵 지형), shot.ts (탄도·충돌, 60fps 고정 스텝)
  game/      match.ts (턴·딜레이·데미지·팀·아이템), rng.ts (시드 난수), types.ts
  ai/        ai.ts (각도·파워 시뮬레이션 탐색 + 난이도별 오차), autoplay.ts
  scenes/    GameScene.ts (Phaser 렌더링·턴 진행), art.ts (코드로 그린 카툰 그래픽·배경), fx.ts (폭발·연기 파티클)
  net/       backend.ts(공통), supabase.ts, local.ts(탭 간 테스트), lobby.ts, room.ts, online.ts(동기화)
  ui/        offline.ts(입장·AI 설정·결과), online.ts(대기실·게임방), hud.ts, shop.ts, input.ts, sfx.ts, music.ts
supabase/    migrations/001_rooms.sql (rooms 테이블, RLS, 게임방 함수)
tools/       balance.ts, stats.ts
tests/       engine.test.ts
```

게임 규칙(`game/`, `physics/`)은 화면과 분리되어 Node에서도 돈다. 화면은 시뮬레이션이 만든 이벤트(폭발·피해·이동)를 재생할 뿐이다.

## 밸런스 (AI 보통 vs 보통, 맵 3종 × 모든 조합 144판)

| 탱크 | 승률 |
| --- | --- |
| 볼트 | 52.8% |
| 드릴러 | 52.8% |
| 스패로우 | 45.8% |
| 버블 | 47.2% |
