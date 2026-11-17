-- 024: 시아탱크 대기실 동시 접속 정원 30 → 50 (관리자가 '정원 설정'으로 다시 바꿀 수 있다)
insert into public.app_settings (key, value, updated_at) values ('tank_lobby_max', '50'::jsonb, now())
on conflict (key) do update set value = excluded.value, updated_at = now();
