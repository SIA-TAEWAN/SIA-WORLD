# 시아탱크

설치·회원가입 없이 링크 하나로 즐기는 브라우저 턴제 포격 게임. 각도·파워·바람을 계산해 맞히고, 포탄이 지형을 부순다.

## 지금 되는 것 (PRD 1~2단계)

- **핵심 엔진**: 픽셀 비트맵 지형 파괴, 중력·바람 탄도, 데미지 공식(직격 +20%), 탱크 낙하·추락 탈락
- **턴 규칙**: 딜레이 기반 턴 순서, 턴당 30초, 필살기 게이지
- **탱크 4대 × 무기 3종**: 볼트 / 드릴러 / 스패로우 / 버블 (수치는 `src/data/*.json`)
- **맵 3종**: 밸리 / 스카이 / 스핑크스 (+ 랜덤)
- **아이템 4종 + 상점**: 더블샷, 파워업, 수리킷, 순간이동 (매 판 1,000포인트, 3칸, 판매 가능)
- **AI 1:1**: 쉬움 / 보통 / 어려움, 그리고 한 기기 2인 대전
- **화면**: 입장 → AI 1:1 설정(탱크·상대·맵·상점) → 게임 → 결과
- **조작**: PC 키보드 + 모바일 터치 버튼, 화면 드래그로 맵 둘러보기

온라인 대기실·게임방(3단계, Supabase)은 아직이다. 엔진이 고정 프레임·시드 기반이라 "턴 입력만 주고받기" 구조를 그대로 올릴 수 있다.

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
  scenes/    GameScene.ts (Phaser 렌더링·턴 진행), art.ts (코드로 그린 카툰 그래픽)
  ui/        hud.ts, input.ts, sfx.ts (합성 효과음), storage.ts
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
