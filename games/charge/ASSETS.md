# 시아돌격대 — 그림·소리 현황과 나중에 만들 것

## 지금 쓰는 것 (1단계)

- 대원·대장: 공용 십이지 전신 그림 `shared/images/zodiac/full/<id>.png` 한 장을 작게(대원 34px, 대장 58px) 여러 장 그린다. 메뉴의 대장 고르기는 `face/<id>.png`.
- 요괴·보스·이펙트·바닥: **시아디펜스 그림을 그대로 복사**해 `public/art/` 에 두었다 (원래는 시아서바이벌·시아디펜스에서 SpriteCook 으로 만든 것).
  - `e-imp`(꼬마 도깨비) · `e-wisp`(도깨비불) · `e-club`(방망이 도깨비, 작은 대장 요괴로도 씀) · `b-bigDokkaebi`(1지역 보스)
  - `tile-field`(풀밭) · `p-shuriken`(총알) · `fx-pop`(맞을 때) · `fx-coin`(4단계 엽전용)
- 코드로 그리는 것: 길(흙색 + 굵은 테두리 + 가운데 점선) · 숫자 문(좋은 문 파랑 `teamA`, 나쁜 문 빨강 `teamB`) · 보스 체력 바 · 보스 공격 예고(빨간 깜빡임).
- 소리: 공용 `shared/sound.js` 효과음 (survShot · survPop · survHurt · boost · logHit · tick · survBossWarn · survBossDown · win · lose · click). 소리 파일이 없으면 공용 모듈이 만든 소리를 쓴다 (`shared/sounds/*.ogg` 404 는 정상).

## 나중에 만들 것 (7단계, SpriteCook)

- 대원이 뛰는 모습 (지금은 위아래로 흔들기만) · 숫자 문 그림(나무 문틀) · 장애물(통나무·회전 칼날·구덩이) · 상자 · 지역별 바닥 4종 · 메인 그림 · 로비 카드 `shared/images/card-charge.png`
- 스타일은 DESIGN.md: 굵은 갈색 외곽선(`#2A1A10`), 밝은 단색, 흐린 그림자 없음, 귀엽게, 배경 투명.
