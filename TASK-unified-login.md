# 작업 지시서: SIA WORLD 통합 로그인 + 로비 + 시아탱크 연동

이 저장소(`C:\Claude\SIA-WORLD`, GitHub `SIA-TAEWAN/SIA-WORLD`)에 통합 로그인을 붙인다.
배포: GitHub Pages → `https://sia-taewan.github.io/SIA-WORLD/`
시아탱크는 `games/tank/`에 있다 (Phaser 3 + Supabase).

## 0. 먼저 조사하고 보고할 것 (코드 수정 전)

1. `games/tank/`에서 Supabase 연결 코드(URL, anon key)가 어디 있는지
2. 지금 ID를 입력받는 화면과, 그 ID가 쓰이는 곳(대기실, 방, 실시간 채널, 랭킹 저장)
3. 랭킹 관련 테이블 이름과 컬럼 (일반 랭킹, 백발백중 랭킹)
4. 로그인 화면에 있는 게임 설명(백발백중 설명 포함)의 위치
5. `/`로 시작하는 절대 경로 사용처 (GitHub Pages 하위 경로에서 깨짐)

조사 결과를 요약해서 보여주고, DB를 바꾸는 SQL은 실행 전에 나에게 확인받는다.

## 1. 폴더 구조

```
SIA-WORLD/
├── index.html          ← 통합 로그인 + 로비 (한 페이지에서 상태에 따라 전환)
├── shared/
│   ├── supabase.js     ← Supabase 클라이언트 (시아탱크의 URL/anon key를 옮겨옴)
│   ├── auth.js         ← signUp, signIn, signOut, getCurrentUser, requireLogin
│   ├── games.js        ← 게임 목록
│   └── images/         ← 로고, 게임 카드 이미지 (card-tank.png)
└── games/
    └── tank/
```

- 빌드 도구 없이 순수 HTML + ES 모듈(`<script type="module">`)로 작성한다.
- 모든 경로는 상대 경로로 쓴다 (`./shared/...`, `../../shared/...`).

## 2. Supabase 설정

### 2-1. 대시보드 (내가 직접 할 일 — 안내만 해줘)
- Authentication → Providers → Email: **Confirm email 끄기**

### 2-2. SQL (실행 전 확인받기)

```sql
-- 공통 회원 정보
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text unique not null,
  nickname text unique not null,
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "profiles_read_all"   on public.profiles for select using (true);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
```

## 3. 회원가입 / 로그인 (`shared/auth.js`)

- 아이디는 내부적으로 `${loginId}@sia-world.local` 이메일로 바꿔서 Supabase Auth에 넣는다.
  사용자에게는 아이디만 보인다. (Supabase가 이 도메인을 거부하면 알려주고 대안을 제안할 것)
- 회원가입 입력: 아이디, 비밀번호, 비밀번호 확인, 닉네임
  - 아이디: `^[a-z0-9]{4,16}$`, 중복 불가
  - 비밀번호: 6자 이상
  - 닉네임: 한글·영문·숫자 2~8자, 중복 불가
  - 가입 전 `profiles`에서 아이디·닉네임 중복을 확인하고, 중복이면 해당 칸 아래에 안내
- 가입 성공 → `profiles` insert → 기존 랭킹 이어받기(6장) → 로비로 이동
- 로그인 실패 메시지는 하나로: "아이디 또는 비밀번호가 맞지 않아요"
- 세션은 Supabase 기본 설정(localStorage)으로 유지 → 브라우저를 닫았다 열어도 로그인 유지
- `requireLogin()`:
  - 로그인 상태면 `{ userId, loginId, nickname }` 반환
  - 아니면 `index.html?redirect=<현재 경로+쿼리>`로 이동
- `redirect` 값은 SIA-WORLD 안의 상대 경로만 허용 (`http`, `//`로 시작하면 무시하고 로비로)

## 4. 로비 (`index.html`)

- 로그인 안 됨 → 로그인 폼 (회원가입 전환 링크 포함)
- 로그인 됨 → 로비
  - 상단: SIA WORLD 로고, 내 닉네임, 로그아웃 버튼
  - 본문: `shared/games.js`의 `open: true` 게임을 카드로 표시 (이미지 + 이름 + 한 줄 소개)
  - 카드 클릭 → 해당 `path`로 이동
- 로그인 성공 시 `redirect` 파라미터가 있으면 그 주소로, 없으면 로비로
- 로그아웃 → 세션 삭제 후 로그인 폼

```js
// shared/games.js
export const GAMES = [
  { id: 'tank', name: '시아탱크', desc: '십이지신과 함께하는 포격 대전',
    path: 'games/tank/', image: 'shared/images/card-tank.png', open: true },
];
```

카드 이미지가 아직 없으면 임시 이미지를 만들어 두고 알려줄 것.

## 5. 시아탱크 연동 (`games/tank/`)

| 항목 | 변경 |
|---|---|
| 접속 | 시작 시 `requireLogin()` 호출, ID 입력 화면 제거, 바로 대기실 |
| 표시 이름 | `profiles.nickname` 사용 |
| 플레이어 식별 | 실시간 채널·방에서 `userId`로 식별, 화면 표시는 닉네임 |
| 랭킹 저장 | `user_id` 기준으로 저장 (닉네임을 바꿔도 기록 유지) |
| 게임 설명 | 로그인 화면에 있던 설명(백발백중 포함)을 대기실의 **게임 설명** 버튼(팝업)으로 이동 |
| 나가기 | 상단에 **SIA WORLD로** 버튼 → `../../index.html` |
| Supabase | 자체 연결 코드 대신 `shared/supabase.js` 사용 |
| 경로 | 절대 경로를 상대 경로로 수정 |

- 친구가 보낸 방 초대 링크(쿼리 포함)로 들어온 비로그인 사용자는 로그인 후 그 방으로 돌아와야 한다.
- 방 만들기, 대기실 최대 10명, 2:2 대전, AI 대전, 백발백중 등 게임 기능은 그대로 둔다.

## 6. 기존 랭킹 이어받기

기존 랭킹 기록은 ID 문자열로 저장되어 있다. **같은 아이디로 가입하면 그 기록을 이어받는다.**

1. 시아탱크 랭킹 테이블(일반, 백발백중 모두)에 `user_id uuid references profiles(id)` 추가,
   기존 ID 문자열 컬럼은 `legacy_id`로 이름 변경(또는 복사). 기존 기록의 `user_id`는 null.
2. 아래 형태의 함수를 만들어 가입 직후 `supabase.rpc('claim_legacy_records')` 호출:

```sql
create or replace function public.claim_legacy_records()
returns void language plpgsql security definer set search_path = public as $$
declare my_login text;
begin
  select login_id into my_login from profiles where id = auth.uid();
  if my_login is null then return; end if;
  update <tank_ranking_table> set user_id = auth.uid()
   where legacy_id = my_login and user_id is null;
  -- 백발백중 랭킹 테이블도 같은 방식으로
end $$;
```

3. 한 번 이어받은 기록(`user_id`가 채워진 기록)은 다시 가져갈 수 없다.
4. 기존 ID가 아이디 규칙에 맞지 않으면 자동으로 이어받지 못한다 (관리자가 수동 연결).
5. 랭킹 화면은 `user_id`가 있으면 `profiles.nickname`, 없으면 `legacy_id`를 표시한다.

`<tank_ranking_table>` 등 실제 테이블 이름은 0장 조사 결과로 채운다.

## 7. 완료 기준 (직접 확인 방법도 함께 알려줘)

- [ ] 아이디·비밀번호·닉네임으로 가입하면 바로 로비가 나온다
- [ ] 중복 아이디·닉네임은 가입되지 않는다
- [ ] 브라우저를 닫았다 열어도 로그인이 유지된다
- [ ] 로비에 시아탱크 카드 1개가 보이고, 누르면 ID 입력 없이 내 닉네임으로 대기실에 들어간다
- [ ] 비로그인 상태로 `games/tank/`에 들어가면 로그인 화면으로 갔다가, 로그인 후 시아탱크로 돌아온다
- [ ] 방 초대 링크로 들어오면 로그인 후 그 방에 들어간다
- [ ] 로그아웃하면 시아탱크에서도 로그아웃 상태가 된다
- [ ] 시아탱크 랭킹과 백발백중 랭킹이 닉네임 기준으로 제대로 표시된다
- [ ] 기존 ID와 같은 아이디로 가입하면 이전 랭킹 기록이 그대로 보인다
- [ ] `https://sia-taewan.github.io/SIA-WORLD/`에서 경로 깨짐 없이 동작한다

## 8. 작업 방식

- 0장 조사 → 계획 보고 → 확인 후 진행
- 단계별로 커밋 (예: `feat: shared auth`, `feat: lobby`, `feat(tank): unified login`)
- 커밋 후 push는 내가 확인한 뒤에 한다
