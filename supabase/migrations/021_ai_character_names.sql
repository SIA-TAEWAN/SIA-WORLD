-- SIA WORLD 021: AI 이름을 시아탱크 캐릭터 이름으로 ("AI 호랑이" → "AI 어흥이", DESIGN.md 6장)

create or replace function public._zodiac_name(p text) returns text language sql immutable as $$
  select case p when 'rat' then '찍찍이' when 'ox' then '우직이' when 'tiger' then '어흥이' when 'rabbit' then '깡총이'
    when 'dragon' then '여의룡' when 'snake' then '스르르' when 'horse' then '따각이' when 'sheep' then '몽실이'
    when 'monkey' then '재롱이' when 'rooster' then '꼬꼬댁' when 'dog' then '멍뭉이' when 'pig' then '꿀꿀이' else '?' end
$$;

-- 지금 있는 AI 자리 이름도 바꾼다
update public.room_seats set nickname = 'AI ' || public._zodiac_name(avatar) where user_id is null;
