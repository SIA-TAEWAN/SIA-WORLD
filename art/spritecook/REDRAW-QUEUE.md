# SpriteCook 다시 그릴 목록

SpriteCook 크레딧이 없을 때 Fable 5.2 로 손수 그리거나 임시로 둔 그림, 그리고 SpriteCook 으로 다시 그리면 나아질 그림을 모아 둔다.
사용자가 "저장해둔 디자인을 SpriteCook 으로 그려줘" 라고 하면 이 목록을 위에서부터 전부 그린다.
그린 뒤에는 각 게임의 `spritecook-assets.json` 에 asset id 를 적고, 이 목록에서 지우거나 "완료" 로 옮긴다.

## 남은 항목

### 6. 시아의탑 1~5구역 — 남은 손볼 거리 (선택)
- 2026-11-25 SpriteCook 으로 다시 그리고 같은 날 손볼 거리(머리 · 옆 눈 · 돌갑옷 무사 · 손그림 타일 6칸 · 1층 바닥)도 고침 (`games/tower/art/build.py` 의 `fix` · `HAIR2`). 남은 것:
- 상투·올림 머리 장식은 칸 안에 넣으려고 1px 눌렀다 (생성본도 장식이 낮아지지 않았다)
- 3구역 무늬 바닥(눈 조각 · 반짝이)이 22층에서 아직 자주 보인다
- 1구역 물건 칸 바탕 바닥에 흰 점이 남았다 · 돌갑옷 무사 맞음 칸에 흰 점
- 타일·적은 손그림 구도를 고쳐 그린 것이라 변화가 작다 — 크게 바꾸려면 틀 없이 새로 그린다 (약 400~500 크레딧)

### 7. 시아의탑 6~10구역 그림 — 타일 새 8칸 + 테마 5장 · 적 34종 · 투사체 6종 · 엔딩 그림 (필수)
- 지금: Fable 5.2 손그림 (2026-11-25, 6번과 같은 `python games/tower/art/draw.py`). 규격·넣을 곳·확인 방법은 6번과 같다 (`games/tower/ASSETS.md`)
- 타일: 시트 10장 모두 688×16 (43칸). 뒤에 붙은 8칸 — 뇌석 2(돌기둥 + 쇠 갓 / 번개 감김) · 구름 덩이 · 쇠창살 · 거울 2(/ · \) · 짙은 구름 · 받침 위 소원 구슬
  - `tiles-thunder.png` 천둥 마루(먹구름 위 푸른 기와) · `tiles-galaxy.png` 은하 나루(오작교 다리 널 · 은하수) · `tiles-flower.png` 서천 꽃밭(풀밭 · 꽃 울타리 · 연못) · `tiles-storm.png` 칠성 폭풍단(제단 돌 · 북두칠성 · 폭풍 구름) · `tiles-wish.png` 소원의 정상(금빛 바닥 · 옥빛 궁궐 벽 · 금빛 구름) — 색은 `ASSETS.md` 의 6~10구역 항목
- 적 `enemy/<id>.png` (가로 4칸: 걷기 2 · 준비 · 맞음, 오른쪽을 본다. 준비 칸의 모습은 `ASSETS.md`):
  - 6구역: `drumimp` · `thunderbird` · `raincloud` · `flagspirit` · `drum` 16, `thunderGeneral` 24, `noegong` 32
  - 7구역: `magpie` · `starslime` · `starlet` · `weaver` · `comet` 16, `crowKnight` 24, `crowKing` 32 (`crowDecoy` 가 빌려 쓴다)
  - 8구역: `thornhand` · `butterfly` · `beetle` · `fairy` 16, `peacock` 24, `ggotgamgwan` 32
  - 9구역: `stormimp` · `hailjar` · `starshard` · `hawk` 16, `jangseung` 24, `heukryong` 32
  - 10구역: `skysoldier` · `crane` · `lantern` · `jadelion` · `wishlight` 16, `skygeneral` 24, `eodugsini` **48** (192×48, 마지막 보스)
- 투사체 `proj/<이름>.png`: `web` 8×8 · `crowfeather` 10×6 · `pollen` 6×6 · `petal` 8×6 · `storm` 12×12 · `shade` 10×10 (아직 코드가 읽지 않는다 — 연결 방법은 `ASSETS.md`)
- 엔딩 `ending.png` · `ending-bg.png` 120×90: 별 하늘 · 초승달 · 옥빛 궁궐 꼭대기 · 소원 구슬(을 든 대원). 다시 그릴 때는 더 큰 그림(예: 480×360)으로 그려도 된다 — 아직 코드가 읽지 않는다
- 문제: 새 테마 5장은 벽·물·문턱을 같은 틀에 색만 바꿔 그려 구역마다 개성이 약하고, 물건 칸은 1구역 그림 그대로다. 정예 3종(뇌우 장수 · 까마귀 무사 · 천상 장군)은 같은 뼈대의 색·무기 바꾸기, 새 3종(뇌조 · 까치 · 폭풍 매)과 도깨비 3종(북 · 혜성 · 바람)도 같은 뼈대다. 흑룡은 이무기 색 바꾸기. 베틀 거미는 보라색 토큰이 없어 연보라(`--charge-stun-tint`)로 그렸다. 꽃나비 날개가 네모지다
- 넣은 뒤: 6번과 같다

## 완료

- 시아마을 선물 장식물 `gift_cat` — SpriteCook `gemini-nano-banana-2.1` 로 다시 그림 (2026-11-25, asset `5bbada7d-86fb-430b-a62a-45db032af1ed`)
- 시아마을 새 기념물 7종 · 열두 지신 문 3단계 — SpriteCook (2026-11-25, `monE` · `monF` · `jisin` 시트, `games/village/spritecook-assets.json`). 함께 돌격대·핑거 기념물 6종 `monD` 도 그림
- 고양이 얼굴·전신 — SpriteCook 으로 외곽선 굵게·머리 약 62% (2026-11-25, asset `4b3ae64a-9a50-48a2-9451-e0fc5d5f42ef`)
- 시아핑거 고양이 `h-cat` · `cut-cat` — `gemini-3.1-flash-image` 로 다시 그림 (2026-11-25, `games/finger/spritecook-assets.json`)
- 시아탱크 고양이 탱크 — 귀 둘 + 금관, `tankArt.json` cx 다시 잼 (2026-11-25, asset `fa2aad45-0196-457d-a9b9-86ade525ac03`)
- 시아의탑 1~5구역 그림 전부 (캐릭터 레이어 18 · 타일 5장 · 적 32 · 구슬 16 · 로비 카드) — SpriteCook `gemini-nano-banana-2.1` (2026-11-25, 남은 손볼 거리는 6번)
