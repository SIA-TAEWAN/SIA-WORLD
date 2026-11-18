# 작업 지시서: 시아맞고 · 시아카지노(세븐포커, 블랙잭) 추가

저장소: `C:\Claude\SIA-WORLD` (GitHub `SIA-TAEWAN/SIA-WORLD`, GitHub Pages 배포)
전제: 통합 로그인(`shared/auth.js`의 `requireLogin()`, `profiles` 테이블)이 이미 동작한다.
렌더링: Phaser 3 / 백엔드: Supabase (DB, Realtime, Edge Functions)

## 0. 시작 전에 할 것

1. 통합 로그인 작업이 끝났는지 확인 (`shared/auth.js`, `profiles` 존재 여부). 안 끝났으면 멈추고 알려줘.
2. `games/tank/`에서 Phaser 설정, 대기실/방 코드, Realtime 사용 방식을 조사해서 재사용할 수 있는 부분을 정리해줘.
3. 아래 단계별 계획을 확인받은 뒤 진행한다.
4. DB를 바꾸는 SQL, Edge Function 배포는 실행 전에 확인받는다. push는 내가 확인한 뒤에 한다.

## 진행 단계 (단계마다 동작 확인 후 다음으로)

| 단계 | 내용 |
|---|---|
| 1 | 공통: 지갑(칩·냥), 출석 보너스, 무료 충전, 랭킹, 로비 카드, 공통 방 시스템 |
| 2 | 시아맞고 (나 vs AI 먼저, 다음에 1:1 대결) |
| 3 | 블랙잭 |
| 4 | 세븐포커 |
| 5 | 십이지신 그래픽·컷인 연출 다듬기 |

그래픽은 처음엔 임시 이미지(색 박스 + 글자)로 만들고 규칙과 동작을 먼저 완성한다. 5단계에서 교체.

---

## 1. 폴더 구조

```
SIA-WORLD/
├── shared/
│   ├── wallet.js        ← 잔액 조회, 출석, 충전 호출
│   ├── room.js          ← 방 만들기/입장/레디/퇴장 (맞고·카지노 공용)
│   ├── zodiac.js        ← 십이지신 목록, 아바타 선택
│   └── cards/           ← 트럼프·화투 이미지와 공용 카드 렌더링
├── games/
│   ├── matgo/           ← 시아맞고
│   └── casino/
│       ├── index.html   ← 포커 / 블랙잭 선택
│       ├── poker/
│       └── blackjack/
└── supabase/
    ├── migrations/      ← SQL
    └── functions/
        ├── game-action/   ← 모든 게임 행동 처리 (딜러)
        └── game-timeout/  ← 턴 시간 초과 처리
```

`shared/games.js`에 추가:

```js
{ id: 'matgo',  name: '시아맞고',   desc: '십이지신 화투로 즐기는 맞고', path: 'games/matgo/',  image: 'shared/images/card-matgo.png',  open: true },
{ id: 'casino', name: '시아카지노', desc: '세븐포커와 블랙잭',          path: 'games/casino/', image: 'shared/images/card-casino.png', open: true },
```

## 2. 보안 원칙 (가장 중요)

- **카드 섞기, 패 나누기, 규칙 검사, AI 행동, 점수 계산, 정산은 전부 Edge Function에서** 한다.
- 브라우저는 화면 표시와 입력만 한다. 덱과 다른 사람의 비공개 패는 브라우저로 절대 보내지 않는다.
- 칩·냥 증감은 서버 함수만 할 수 있다 (`wallets`에 클라이언트 쓰기 권한 없음).
- AI도 공개 정보만 보고 판단한다.

## 3. 재화와 랭킹

| 항목 | 카지노 (칩) | 맞고 (냥) |
|---|---|---|
| 시작 금액 | 10,000 | 10,000 |
| 출석 보너스 (매일 첫 접속, 한국 시간 자정 기준) | +10,000 | +10,000 (칩과 함께 지급) |
| 무료 충전 | 하루 3번, 10,000으로 채움 | 하루 3번, 10,000으로 채움 |
| 랭킹 | 보유 칩 순 | 보유 냥 순 |
| 등급 | 해·달·별·구름 (기존 기준과 동일) | 해·달·별·구름 |

- 무료 충전 버튼은 보유량이 해당 방 최소 입장 금액(기본 단위 ×50)보다 적을 때만 활성화.
- 출석 보너스를 받으면 로비에 알림 표시.
- 칩과 냥은 서로 바꿀 수 없다. 구매·환전·선물 기능 없음.

### SQL 초안 (확인받고 실행)

```sql
create table public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  chips bigint not null default 10000 check (chips >= 0),
  nyang bigint not null default 10000 check (nyang >= 0),
  chips_refills_today int not null default 0,
  nyang_refills_today int not null default 0,
  refill_date date,
  last_attendance_date date
);
alter table public.wallets enable row level security;
create policy "wallet_read_own" on public.wallets for select using (auth.uid() = user_id);
-- insert/update 정책 없음: security definer 함수와 Edge Function(service role)만 변경

create table public.wallet_logs (
  id bigserial primary key,
  user_id uuid references public.profiles(id),
  currency text check (currency in ('chips','nyang')),
  amount bigint not null,
  reason text not null,          -- 'start' | 'attendance' | 'refill' | 'game'
  game_id text,
  created_at timestamptz default now()
);
alter table public.wallet_logs enable row level security;
create policy "wlog_read_own" on public.wallet_logs for select using (auth.uid() = user_id);
```

함수 (security definer, 한국 시간 `(now() at time zone 'Asia/Seoul')::date` 기준):
- `ensure_wallet()` — 지갑이 없으면 10,000/10,000으로 생성 (로비 진입 시 호출)
- `claim_attendance()` — 오늘 처음이면 chips +10,000, nyang +10,000, 로그 기록, 지급 여부 반환
- `refill(currency text, min_required bigint)` — 날짜가 바뀌었으면 횟수 초기화 → 잔액 < min_required 이고 오늘 3번 미만이면 10,000으로 채움

랭킹 뷰: `casino_ranking`(chips 내림차순), `matgo_ranking`(nyang 내림차순), `profiles.nickname` 조인.

## 4. 공통 방 규칙

| 항목 | 규칙 |
|---|---|
| 방 만들기 | 방 이름, 비밀번호(선택), 기본 단위 100 / 500 / 1,000 |
| AI 자동 채우기 | 포커·블랙잭: 방장 + AI 3명 / 맞고: 방장 + AI 1명 |
| 사람 입장 | AI 1명이 빠지고 그 자리에 앉음. AI가 없으면(사람으로 만석) 입장 불가 |
| 시작 | 사람이 모두 레디하면 자동 시작. AI는 항상 레디 |
| 게임 중 입장 | 이번 판 관전, 다음 판부터 AI 자리를 받아 참여 |
| 판 사이 | 결과 화면 → 대기 상태 → 다시 모두 레디하면 다음 판 |
| 턴 제한 | 20초. 초과 시 자동 행동 (포커: 체크, 불가면 다이 / 블랙잭: 스탠드 / 맞고: AI 로직으로 대신) |
| 게임 중 퇴장·끊김 | 이번 판은 AI가 대신, 결과는 나간 사람 지갑에 반영, 판 종료 후 자리는 AI로 |
| 방장 퇴장 | 먼저 들어온 사람이 방장. 사람이 0명이면 방 삭제 |
| 최소 입장 금액 | 기본 단위 ×50. 부족하면 입장 불가 + 무료 충전 안내 |
| AI 이름 | "AI 호랑이"처럼 십이지신. 같은 방에 같은 동물 중복 없음 |
| AI 재화 | AI는 무한 재화, 랭킹 제외 |

### 테이블 초안

```
casino_rooms / matgo_rooms : id, game('poker'|'blackjack'|'matgo'), name, password_hash, base_unit, host_id, status('waiting'|'playing'), created_at
room_seats    : room_id, seat_no, user_id(null=AI), ai_animal, avatar, ready, joined_at
game_states   : room_id, round_no, public_state jsonb, turn_seat, turn_deadline, updated_at   ← 방 참가자 모두 읽기
game_private  : room_id, seat_no, user_id, hand jsonb                                        ← RLS: user_id = auth.uid() 만 읽기
game_decks    : room_id, deck jsonb, meta jsonb                                              ← 클라이언트 접근 불가 (정책 없음)
```

- 비밀번호는 해시로 저장.
- Realtime 채널: `matgo:room-<id>`, `poker:room-<id>`, `blackjack:room-<id>` — 공개 상태 변경만 브로드캐스트.
- 방 목록도 Realtime으로 갱신.

### Edge Function `game-action`

- 입력: `{ roomId, action, payload }` (사용자 JWT로 호출)
- 처리: 권한·차례 확인 → 규칙 검사 → 상태 변경 → AI 차례면 AI 행동까지 이어서 실행 → 판이 끝나면 정산(지갑 + 로그) → 공개 상태 브로드캐스트
- 덱 셔플은 `crypto.getRandomValues` 기반 Fisher–Yates.
- 게임별 규칙 엔진은 `functions/_shared/matgo.ts`, `poker.ts`, `blackjack.ts`로 분리하고 **단위 테스트**를 작성 (족보 판정, 점수 계산, 정산).

### Edge Function `game-timeout`

- `turn_deadline`이 지난 방을 찾아 자동 행동 실행.
- 호출 방식(브라우저가 마감 시각에 호출 + 서버가 검증 / 또는 pg_cron)을 제안하고 확인받기.
- 무료 플랜 Edge Function 호출 한도를 확인해서 알려줘.

## 5. 시아맞고

화투 48장, 2인. 7점 이상에서 고/스톱. 정산 = 최종 점수 × 점당(기본 단위) × 배수. 진 사람은 가진 냥까지만 냄.

**방 구성**: 혼자(나 vs AI 보통) / 대결(사람이 들어오면 AI가 빠지고 1:1)

**진행**
1. 선: 첫 판 랜덤, 이후 이긴 사람 (나가리면 유지)
2. 각자 10장, 바닥 8장, 더미 20장
3. 손패 1장 내고 더미 1장 뒤집어 같은 달을 먹음
4. 7점 이상이면 고/스톱
5. 둘 다 손패를 다 쓸 때까지 아무도 못 나면 나가리 (다음 판 ×2)

**점수**

| 족보 | 점수 |
|---|---|
| 광 3장 (비광 없음) | 3 |
| 광 3장 (비광 포함) | 2 |
| 광 4장 / 5장 | 4 / 15 |
| 열끗 5장 | 1, 이후 장당 +1 |
| 고도리 (2·4·8월 열끗) | 5 |
| 띠 5장 | 1, 이후 장당 +1 |
| 홍단 / 청단 / 초단 | 각 3 |
| 피 10장 (쌍피 = 2장) | 1, 이후 장당 +1 |

**배수·특수 규칙**

| 규칙 | 효과 |
|---|---|
| 고 | 1고 +1, 2고 +2, 3고부터 매번 ×2 |
| 고박 | 고한 뒤 상대가 나면 고한 사람이 두 배로 물어줌 |
| 피박 | 승자가 피로 점수 + 패자 피 1~7장 → ×2 |
| 광박 | 승자가 광으로 점수 + 패자 광 0장 → ×2 |
| 멍박 | 승자 열끗 7장 이상 → ×2 |
| 흔들기 | 같은 달 3장 보유를 보여주고 냄 → ×2 |
| 폭탄 | 같은 달 3장 보유 + 바닥에 같은 달 → 한꺼번에 내면 ×2 + 상대 피 1장 |
| 총통 | 처음 받은 패에 같은 달 4장 → 즉시 7점 승리 |
| 뻑 | 같은 달 3장이 바닥에 쌓이면 못 먹고 남음 |
| 쪽·따닥·쓸·뻑 먹기 | 상대 피 1장 가져옴 |
| 국진 (9월 열끗) | 먹을 때 열끗/쌍피 선택 |
| 나가리 | 다음 판 ×2 |

**AI (보통)**
- 우선순위: 광 > 고도리·단 완성 > 쌍피 > 피
- 상대가 노리는 족보 패가 바닥에 있으면 먼저 가져감
- 뻑 날 수 있는 패는 되도록 피함
- 스톱 조건: 상대 5점 이상 또는 남은 손패 3장 이하, 아니면 고 (최대 2고)
- 약 15% 확률로 최선이 아닌 패를 냄

## 6. 세븐포커

트럼프 52장, 최대 4명. 7장 중 최고 5장으로 승부.

**진행**
1. 앤티 = 기본 단위
2. 4장 받고 1장 버림 → 남은 3장 중 1장 공개
3. 4구, 5구, 6구: 각 1장 공개로 받고 베팅
4. 7구(히든): 1장 비공개로 받고 마지막 베팅
5. 쇼다운

베팅 순서: 매 라운드 공개 카드 족보가 가장 높은 사람부터.

| 행동 | 내용 |
|---|---|
| 체크 | 이번 라운드 베팅이 없을 때 넘김 |
| 삥 | 기본 단위만큼 베팅 |
| 콜 | 앞 사람과 같은 금액 |
| 따당 | 앞 사람 베팅의 2배 |
| 하프 | 콜 금액 + 현재 판돈의 절반 |
| 다이 | 포기 |

- 한 라운드 레이즈(따당·하프) 최대 3번
- 칩 부족 시 올인, 사이드 팟 처리
- 혼자 남으면 공개 없이 승리

**족보**: 로티플 > 스티플 > 포카드 > 풀하우스 > 플러시 > 스트레이트(마운틴 > 백스트레이트 > 일반) > 트리플 > 투페어 > 원페어 > 하이카드.
동점이면 숫자, 그다음 무늬 ♠ > ◆ > ♥ > ♣.

**AI (보통)**: 내 족보 가능성 vs 상대 공개 카드 비교 → 강하면 레이즈, 애매하면 콜, 약하면 다이. 약 10% 블러핑.

## 7. 블랙잭

AI 딜러 1명 + 플레이어 최대 4명. 각자 딜러와 대결.

| 항목 | 규칙 |
|---|---|
| 덱 | 6덱, 75% 사용 시 다음 판 전 재셔플 |
| 점수 | A = 1/11, J·Q·K = 10 |
| 진행 | 베팅 → 플레이어 2장 공개, 딜러 1장 공개 + 1장 비공개 → 자리 순서대로 행동 → 딜러 → 정산 |
| 딜러 | 16 이하 히트, 17 이상 스탠드 (소프트 17 포함) |
| 블랙잭 | 3:2. 딜러도 블랙잭이면 푸시 |
| 일반 승리 / 푸시 | 1:1 / 베팅 반환 |
| 버스트 | 즉시 패배 |
| 더블다운 | 처음 2장일 때, 베팅 2배 + 1장만 더 |
| 스플릿 | 처음 2장 같은 점수, 1번만 |
| 인슈어런스·서렌더 | 없음 |
| 베팅 범위 | 기본 단위 ~ ×100 |

**AI 플레이어 (보통)**: 기본 전략표 따름, 약 10% 다른 선택. 베팅은 최소의 1~5배.

## 8. 십이지신 디자인

**화투 — 띠 순서**

| 월 | 동물 | 원래 그림 | 광 |
|---|---|---|---|
| 1 | 쥐 | 송학 | ○ |
| 2 | 소 | 매조 | |
| 3 | 호랑이 | 벚꽃 | ○ |
| 4 | 토끼 | 흑싸리 | |
| 5 | 용 | 난초 | |
| 6 | 뱀 | 모란 | |
| 7 | 말 | 홍싸리 | |
| 8 | 양 | 공산 | ○ |
| 9 | 원숭이 | 국화 | |
| 10 | 닭 | 단풍 | |
| 11 | 개 | 오동 | ○ |
| 12 | 돼지 | 비 | ○ (비광) |

- 달마다 4장의 종류(광·열끗·띠·피) 구성은 원래 화투와 동일. 그림만 교체.
- 원래 식물·배경은 패 배경에 연하게 남김.
- 구분 표시: 광 = 금빛 테두리 + '광', 띠 = 홍·청·초단 색 띠, 열끗 = 동물 크게, 피 = 발자국, 쌍피 = 발자국 2개.
- 고도리(2·4·8월 열끗 = 소·토끼·양)에 '고도리' 표시.

**트럼프 J·Q·K**

| 무늬 | J | Q | K |
|---|---|---|---|
| ♠ | 쥐 | 소 | 호랑이 |
| ◆ | 토끼 | 용 | 뱀 |
| ♥ | 말 | 양 | 원숭이 |
| ♣ | 닭 | 개 | 돼지 |

- 카드 뒷면: 십이지신 12마리가 원형으로 둘러선 문양
- 칩: 100 쥐, 1,000 호랑이, 10,000 용

**아바타·컷인**
- 방 입장 시 십이지신 아바타 선택 (마지막 선택이 기본값). 같은 방 중복 시 나중 사람이 다른 동물 선택. AI는 남은 동물.
- 컷인 연출: 맞고(고, 스톱, 피박·광박, 총통, 폭탄, 5광) / 포커(로티플, 스티플, 포카드, 큰 판돈) / 블랙잭(블랙잭, 더블다운 승리)
- 기존 시아탱크의 십이지신 캐릭터 이미지가 있으면 재사용하고, 위치를 알려줘.

## 9. 완료 기준 (단계별로 확인 방법도 알려줘)

**공통**
- [ ] 로비에 시아탱크·시아맞고·시아카지노 카드, 카지노에서 포커/블랙잭 선택 가능
- [ ] 처음 들어오면 10,000칩·10,000냥
- [ ] 하루 첫 접속 시 칩·냥 각 +10,000, 같은 날 재접속 시 지급 없음
- [ ] 무료 충전 하루 3번까지, 4번째는 막힘
- [ ] 카지노 랭킹(칩)과 맞고 랭킹(냥) 따로, 해·달·별·구름 표시
- [ ] 개발자 도구로 다른 사람 비공개 패와 덱을 볼 수 없음
- [ ] 브라우저에서 잔액을 바꿔도 실제 잔액은 그대로

**방과 인원**
- [ ] 포커·블랙잭 방 생성 시 AI 3명, 사람 입장마다 AI 1명 빠짐
- [ ] 맞고 방 생성 시 AI 1명, 사람 입장 시 1:1
- [ ] 사람 모두 레디 → 자동 시작
- [ ] 20초 초과 시 자동 행동
- [ ] 게임 중 퇴장 → 그 판은 AI 대행, 끝나면 AI 자리

**게임별**
- [ ] 맞고: 고/스톱, 피박·광박·멍박·고박, 흔들기·폭탄·총통, 나가리 2배 정산이 정확
- [ ] 세븐포커: 4장 시작 ~ 7구 히든, 올인·사이드 팟 정확
- [ ] 블랙잭: 딜러 17 스탠드, 3:2, 더블다운, 스플릿 정산 정확
- [ ] 규칙 엔진 단위 테스트 통과
- [ ] 화투 띠 순서 그림, 트럼프 J·Q·K 십이지신 적용

## 10. 작업 방식

- 단계마다: 계획 → 구현 → 내가 확인할 방법 안내 → 커밋
- 커밋 예: `feat(wallet): attendance and refill`, `feat(matgo): rules engine`, `feat(casino): blackjack`
- 막히거나 규칙이 애매하면 추측하지 말고 물어볼 것
