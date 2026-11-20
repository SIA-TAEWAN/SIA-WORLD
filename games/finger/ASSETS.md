# 시아핑거 — 그림·소리 현황과 나중에 만들 것

## 지금 쓰는 것 (1~3단계)

- **대원 구슬:** 공용 십이지 얼굴 `shared/images/zodiac/face/<id>.png` 을 코드로 동그랗게 잘라 구슬 안에 넣는다 (`src/scenes/art.ts` 의 `makeBall`). 테두리 색이 타입: 반사형 = 팀 파랑(`teamA`), 관통형 = 주황(`accent`). 얼굴을 못 읽으면 흰 구슬에 이름 첫 글자.
- **요괴·보스·바닥·효과:** 시아돌격대 `games/charge/public/art` 의 파일을 그대로 복사해 `public/art/` 에 두었다. 돌격대 파일은 시아디펜스 `games/defense/public/art` 와 같은 파일이다 (원래는 시아서바이벌·시아디펜스에서 SpriteCook 으로 만든 것. asset id 는 `games/defense/spritecook-assets.json`).
  - 요괴 9종 `e-imp` · `e-wisp` · `e-club` · `e-water` · `e-fox` · `e-bamboo` · `e-guard` · `e-skeleton` · `e-spirit` (작은 대장은 지역 요괴 그림을 크게: 1~3지역 방망이 · 4~6 물귀신 · 7~9 수문장 · 10~12 해골)
  - 보스 12종 `b-*` (지역 순서 = `BOSS_IDS`)
  - 바닥 4종 `tile-field` · `tile-bamboo` · `tile-palace` · `tile-underworld` (3지역씩)
  - `fx-pop`(터짐) · `fx-coin`(엽전 주머니) · `p-shuriken`(표창)
- **코드로 그리는 것:** 방 테두리 · 돌기둥 · 체력 바 · 머리 위 남은 턴 숫자 · 공격 예고(빨간 원·점선) · 보스 약점 표시(노란 점) · 조준 점선 · 힘 게이지 · 회복 구슬 · 콤보 효과(레이저·폭발·표창 줄 등) · 아래 파티 줄과 필살기 버튼.
- **그림을 못 읽으면:** `src/scenes/art.ts` 의 `ensureArt` 가 같은 키로 코드 그림(둥근 요괴 · 체크 바닥 · 노란 터짐 · 엽전 · 표창)을 만든다.
- **소리:** 공용 `shared/sound.js` 효과음 — 벽 튕김 `volleyWall`(연속으로 튕길수록 높아진다) · 타격 `survPop` · 쓰러뜨림 `survSlash` · 요괴 공격 `survHurt` · 웨이브 `survLevel` · 필살기 `cutin` · 회복 `tankHeal` · 엽전 `coin` · 콤보 `tankLaser`/`tankBoom` · `win`/`lose`/`click`. 폰이면 쓰러뜨릴 때·맞을 때 짧은 진동.

## 나중에 (7단계, SpriteCook)

PRD "그림과 소리" 표 그대로: 구슬형 대원 12종 + 필살기 컷인, 요괴 맞을 때 표정, 방 테두리·벽, 장애물 4종(돌기둥·가시밭·빨래판·순간이동 구멍), 레이저·폭발·표창·회복 효과, 로비 카드·메인 그림.
