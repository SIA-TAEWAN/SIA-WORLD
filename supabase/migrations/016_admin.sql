-- 시아탱크 016: 관리자 계정 표시
-- 관리자는 AI 대전에서 필살기 게이지가 늘 가득, 랜덤 탱크는 언제나 열두빛.
-- 사용자는 profiles에서 닉네임만 고칠 수 있으므로(015의 column grant) 스스로 관리자가 될 수 없다.
alter table public.profiles add column if not exists is_admin boolean not null default false;
update public.profiles set is_admin = true where login_id = 'sosiaa';
