-- 시아탱크 004: 빈 방 정리를 모든 대기실에 대해 한다 (아무도 안 들르는 대기실의 방도 지워지도록)
create or replace function public.sweep_rooms(p_lobby text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.rooms where updated_at < now() - interval '2 minutes';
end $$;
