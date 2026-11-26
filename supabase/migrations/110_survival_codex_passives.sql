-- 110: 시아서바이벌 — 세트용 패시브 4종(독주머니 venom · 약수 spring · 경전 scroll · 활시위 string)을 서버 도감 목록에 넣는다.
--
-- _survival_codex_ids 의 최신 정의(093_survival_codex_evo.sql)를 그대로 이어받아 passives 끝에 4개 id 만 더한다.
-- survival_finish 는 _survival_codex_merge 로 '목록에 있는 id 만' 합치므로, 이 파일이 나간 뒤로 판에서 얻은 4종이 서버 도감에 적힌다
-- (그전에는 모르는 id 라 버려졌고, 게임은 이 4종을 처음부터 보이게 했다). 표·다른 함수는 건드리지 않는다. 인자 형(text)이 같아 오버로드가 생기지 않는다.
-- 게임 쪽 목록: games/survival/src/data/passives.ts 의 PASSIVES · SERVER_CODEX_PASSIVES (tests/sql.test.ts 가 이 파일과 맞춰 본다).

create or replace function public._survival_codex_ids(p_kind text) returns text[]
language sql immutable as $$
  select case p_kind
    when 'enemies' then array['imp','wisp','club','water','fox','bamboo','guard','skeleton','spirit']
    when 'bosses' then array['bigDokkaebi','dueoksini','bulgasal','jangsanbeom','centipede','gumiho','guardCaptain','yagwanggwi','imugi','reaper','gangcheori','yeomra']
    when 'weapons' then array['shuriken','bell','claw','mooncake','pearl','mist','shurikenEvo','pearlEvo','clawEvo','hoof','wool','staff','feather','puppy','piggy','bellEvo','mooncakeEvo','hoofEvo','piggyEvo']
    when 'passives' then array['might','wind','shell','sleeve','fan','magnet','ginseng','knot','venom','spring','scroll','string']
    else array[]::text[]
  end
$$;
revoke all on function public._survival_codex_ids(text) from public, anon, authenticated;
