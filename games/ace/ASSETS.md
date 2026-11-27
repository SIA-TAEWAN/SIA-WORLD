# 시아에이스 그림 목록

원칙: 기존 그림 재사용 우선. 탄·피격 효과·아이템 반짝임·기체 기울임은 코드(`src/scenes/art.ts`, 한 장 아틀라스 `art`).
보스는 한 장 그림 + 부술 부위는 코드로 위치·판정만. SpriteCook 그림은 아래 "SpriteCook 로 만든 것" 참고 (더 만들 때는 사용자 확인 뒤에만).

## 재사용 판단 (2026-11-27)

| 종류 | 있는 그림 | 탑뷰 슈팅에 그대로? | 쓰는 곳 |
|---|---|---|---|
| 십이지·고양이 얼굴 13 | `shared/images/zodiac/face/*.png` | ○ 그대로 | 조종석, 목숨 칩, 기체 고르기 칸, 랭킹 |
| 십이지·고양이 전신 13 | `shared/images/zodiac/full/*.png` | ○ (정면 그림이라 게임판 밖) | 기체 고르기 정보 판, 해금·컷인 |
| 컷인 13 | `games/card/public/art/cut-*.png` | ○ | 폭탄 컷인 |
| 요괴 잡몹 약 25종 | `games/{survival,card,twelve}/public/art/e-*.png` | △ 정면 그림 → 위에서 보는 비행 느낌은 아님. 둥근 몸이라 소형·중형기로 충분 | 소형기·중형기·운반기 |
| 보스 12 (+공격·피격 포즈) | `games/{survival,card}/public/art/b-*.png` | △ 중간 보스로 그대로 (구미호·이무기는 스테이지 4·6 보스 몸으로도) | 중간 보스 12, 보스 러시 |
| 최종 보스 | `games/twelve/public/art/b-final.png` | ○ 요괴왕 본체 | 12스테이지 |
| 12지형 바닥 | `games/twelve/public/art/floor-r01~r12.png` | △ 땅 무늬만 있음. 바다·구름·화산·하늘성은 코드로 물결·구름·용암 층을 얹는다 | 스테이지 바닥 (흐르는 TileSprite) |
| 폭발·효과 | `games/card/public/art/fx-*.png` | ○ (boom · coin · shield) | 큰 폭발, 금화 |
| 엽전 | `games/twelve/public/art/ic-coin.png` | ○ | 금화 아이템 |

## SpriteCook 로 만든 것 (2026-11-27)

모델 GPT 2.5 Flare · medium · 2K 투명 배경. 원본 시트 `art/spritecook/*.webp`, asset id 는 `spritecook-assets.json`,
`python art/build.py` 가 잘라서 `public/art/` 에 넣고 `art/preview.png` (전체 미리보기)를 만든다.

| 묶음 | 파일 (`public/art/`) | 크기 | 방법 | 쓴 크레딧 |
|---|---|---|---|---|
| 기체 13 | `ship-<id>.png` — rat ox tiger rabbit dragon snake horse sheep monkey rooster dog pig cat | 너비 200 (뱀·닭은 높이 230 에 맞춤), 기수 위쪽 | 2K 시트 3장 + 얼굴 줄 참조 1장씩 | 3 × 22 = 66 |
| 스테이지 보스 10 | `boss-<n>.png` — 1 게 전함 · 2 해룡 항모 · 3 천년 너구리 · 5 뇌신 비행선 · 7 모래벌레 요새 · 8 회오리 거인 · 9 설인 요새 · 10 해골 장군 비행탑 · 11 화산 거인 · 12 요괴왕 모함 | 480×620 안 (해룡 항모는 길어서 301×620), 얼굴 아래쪽 | 2K 한 장에 2마리 × 5장 + 그림체 참조 1 | 5 × 22 = 110 |
| 지상 목표 9 | `ground-<이름>.png` — bamboo sandtank gunboat harbor ice ruin lava swamp castle | 120×132 안, 포신 아래쪽 | 2K 시트 1장 + 그림체 참조 1 | 22 |
| 아이템 9 | `item-<이름>.png` — p b coin coinbig option life clock shield star | 64×64 안 | 2K 시트 1장 | 14 |
| 합계 | 41장 | | 시트 10장 | 212 (220 → 남은 8) |

- 보스의 포대 위치(부술 부위)와 핵 위치: `art/boss-parts.json` (`boss-<n>`: 포대 2~4개, `_core`: 핵). 미리보기의 분홍 동그라미가 그 위치.
- 조종사는 위에서 본 뒤통수라 얼굴이 안 보인다 (귀·뿔·갈기로 구분). 얼굴이 필요한 곳(기체 고르기 등)은 `shared/images/zodiac/face` 를 같이 쓴다.
- 구미호·이무기(스테이지 4·6)는 기존 그림 + 코드 비행선 그대로.
