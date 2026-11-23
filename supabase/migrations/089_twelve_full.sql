-- 089_twelve_full.sql — 시아열두길 2차: 4~12지형 · 최종보스 · 어려움 모드를 더하면서 바뀌는 표와 함수.
--
-- 078_twelve.sql 은 운영에 있으므로 고치지 않는다. 여기서 같은 함수를 create or replace 로 다시 정의한다 (뒤 정의가 이긴다).
--   · 표와 기준 값: `-- <gen:이름>` ~ `-- </gen:이름>` 사이는 games/twelve 의 `npm run sqlgen` 이 src/data 에서 만들어 넣는다
--     (손으로 고치지 않는다 — games/twelve/tests/sql.test.ts 가 078 + 089 를 합친 마지막 정의를 src/data 와 대조한다).
--   · 맵 표(_twelve_maps)에 줄이 있는 맵만 시작할 수 있다: 지형을 열 때마다 이 표가 늘어난다.

-- ---------- 1. 기준 값 · 표 (npm run sqlgen 이 채운다) ----------

create or replace function public._twelve_const(p_name text) returns numeric
language sql immutable as $$
  select case p_name
-- <gen:const>
    when 'max_level' then 99
    when 'max_time' then 3600
    when 'clear_min_time' then 20
    when 'time_slack' then 3
    when 'max_age' then 7200
    when 'coin_min_time' then 60
    when 'coin_level_gap' then 15
    when 'exit_pct' then 70
    when 'drop_potion' then 250
    when 'drop_gear' then 120
    when 'drop_elite_stone' then 3000
    when 'drop_elite_acc' then 500
    when 'drop_elite_rare' then 100
    when 'drop_boss_acc' then 3000
    when 'drop_boss_rare' then 1000
    when 'drop_key' then 4000
    when 'pity_elite' then 100
    when 'pity_boss' then 8
    when 'pity_key' then 3
    when 'bag_size' then 40
    when 'bag_step' then 8
    when 'bag_max' then 80
    when 'potion_max' then 20
    when 'max_plus' then 9
    when 'boss_gift_10' then 15
    when 'boss_gift_11' then 20
    when 'boss_gift_12' then 30
    when 'boss_gift_final' then 50
    when 'tower_cp' then 10
    when 'tower_elite_every' then 5
    when 'tower_min_time' then 2
    when 'tower_boss_min_time' then 4
    when 'tower_coin_base' then 20
    when 'tower_coin_step' then 6
    when 'tower_coin_elite' then 2
    when 'tower_coin_boss' then 5
    when 'tower_stone_rate' then 1000
    when 'tower_stone_elite' then 1
    when 'tower_stone_elite_step' then 50
    when 'tower_stone_boss' then 2
    when 'tower_stone_boss_step' then 10
    when 'tower_stone_max' then 12
    when 'tower_gear' then 400
    when 'tower_acc_elite' then 1500
    when 'tower_acc_boss' then 4000
    when 'tower_rare_elite' then 100
    when 'tower_rare_elite_step' then 2
    when 'tower_rare_elite_max' then 500
    when 'tower_rare_boss' then 800
    when 'tower_rare_boss_step' then 10
    when 'tower_rare_boss_max' then 3000
-- </gen:const>
  end
$$;
revoke all on function public._twelve_const(text) from public, anon, authenticated;

-- 맵: 권장 레벨 · 별 시간 · 보스 맵 · 셀 수 있는 요괴 수 · 정예 수 · 정예/보스 경험치·엽전 · 상자 엽전 · 종류별 [최대 수, 경험치, 엽전]
-- 준비된 맵만 들어 있다 (없는 맵은 시작할 수 없다)
create or replace function public._twelve_maps() returns table (
  map_id text, mode text, region int, no int, level int, par int, boss boolean, total int, elites int,
  elite_exp int, elite_coin int, boss_exp int, boss_coin int, chest_coin int, kinds jsonb
)
language sql immutable as $$
  select * from (values
-- <gen:maps>
    ('1-1', 'normal', 1, 1, 1, 260, false, 81, 0, 0, 0, 0, 0, 30, '{"imp":[81,4,2]}'::jsonb),
    ('1-2', 'normal', 1, 2, 2, 270, false, 95, 0, 0, 0, 0, 0, 35, '{"imp":[57,5,2],"wisp":[38,6,2]}'::jsonb),
    ('1-3', 'normal', 1, 3, 2, 270, false, 82, 1, 35, 21, 0, 0, 35, '{"imp":[40,5,2],"wisp":[20,6,2],"water":[21,6,3]}'::jsonb),
    ('1-4', 'normal', 1, 4, 3, 300, false, 97, 1, 47, 23, 0, 0, 39, '{"imp":[48,5,3],"wisp":[19,7,3],"water":[9,7,4],"fox":[20,8,4]}'::jsonb),
    ('1-5', 'normal', 1, 5, 4, 400, false, 115, 1, 87, 44, 0, 0, 44, '{"imp":[52,6,3],"wisp":[16,7,3],"club":[17,15,7],"water":[19,7,4],"fox":[10,9,4]}'::jsonb),
    ('1-6', 'normal', 1, 6, 4, 440, false, 130, 2, 87, 44, 0, 0, 44, '{"imp":[52,6,3],"wisp":[18,7,3],"club":[17,15,7],"water":[21,7,4],"fox":[20,9,4]}'::jsonb),
    ('1-7', 'normal', 1, 7, 5, 490, false, 155, 2, 96, 48, 0, 0, 48, '{"imp":[71,6,3],"wisp":[23,8,3],"club":[21,16,8],"water":[20,8,5],"fox":[18,10,5]}'::jsonb),
    ('1-8', 'normal', 1, 8, 6, 390, true, 69, 1, 105, 53, 263, 140, 53, '{"imp":[31,7,4],"wisp":[13,9,4],"club":[11,18,9],"water":[8,9,5],"fox":[5,11,5]}'::jsonb),
    ('2-1', 'normal', 2, 1, 6, 310, false, 98, 0, 0, 0, 0, 0, 53, '{"imp":[98,7,4]}'::jsonb),
    ('2-2', 'normal', 2, 2, 7, 350, false, 81, 0, 0, 0, 0, 0, 57, '{"imp":[39,8,4],"mud":[42,13,6]}'::jsonb),
    ('2-3', 'normal', 2, 3, 8, 340, false, 96, 1, 74, 37, 0, 0, 61, '{"imp":[47,8,4],"fox":[28,12,6],"mud":[20,14,6]}'::jsonb),
    ('2-4', 'normal', 2, 4, 8, 550, false, 143, 1, 123, 61, 0, 0, 61, '{"imp":[59,8,4],"club":[29,21,10],"fox":[22,12,6],"mud":[32,14,6]}'::jsonb),
    ('2-5', 'normal', 2, 5, 9, 550, false, 144, 1, 106, 53, 0, 0, 66, '{"imp":[63,9,4],"club":[21,22,11],"fox":[22,13,7],"bamboo":[17,18,9],"mud":[20,15,7]}'::jsonb),
    ('2-6', 'normal', 2, 6, 10, 580, false, 140, 2, 113, 56, 0, 0, 70, '{"imp":[69,9,5],"club":[26,23,12],"fox":[12,14,7],"bamboo":[18,19,9],"mud":[13,16,7]}'::jsonb),
    ('2-7', 'normal', 2, 7, 10, 630, false, 172, 2, 113, 56, 0, 0, 70, '{"imp":[79,9,5],"club":[25,23,12],"fox":[22,14,7],"bamboo":[23,19,9],"mud":[21,16,7]}'::jsonb),
    ('2-8', 'normal', 2, 8, 11, 450, true, 67, 1, 120, 60, 375, 200, 75, '{"imp":[33,10,5],"club":[6,25,13],"fox":[8,15,8],"bamboo":[11,20,10],"mud":[8,18,8]}'::jsonb),
    ('3-1', 'normal', 3, 1, 12, 480, false, 102, 0, 0, 0, 0, 0, 80, '{"guard":[102,27,13]}'::jsonb),
    ('3-2', 'normal', 3, 2, 12, 400, false, 97, 0, 0, 0, 0, 0, 80, '{"wisp":[38,13,5],"guard":[59,27,13]}'::jsonb),
    ('3-3', 'normal', 3, 3, 13, 400, false, 95, 1, 134, 67, 0, 0, 84, '{"wisp":[24,14,6],"guard":[53,28,14],"lynx":[17,22,11]}'::jsonb),
    ('3-4', 'normal', 3, 4, 14, 470, false, 125, 1, 159, 71, 0, 0, 89, '{"wisp":[21,15,6],"guard":[64,30,15],"spirit":[19,27,12],"lynx":[20,24,12]}'::jsonb),
    ('3-5', 'normal', 3, 5, 14, 560, false, 153, 1, 142, 71, 0, 0, 89, '{"wisp":[22,15,6],"bamboo":[12,24,12],"guard":[70,30,15],"spirit":[28,27,12],"lynx":[20,24,12]}'::jsonb),
    ('3-6', 'normal', 3, 6, 15, 590, false, 145, 2, 149, 74, 0, 0, 93, '{"wisp":[16,16,6],"bamboo":[24,25,12],"guard":[67,31,16],"spirit":[21,28,12],"lynx":[15,25,12]}'::jsonb),
    ('3-7', 'normal', 3, 7, 16, 570, false, 138, 2, 156, 78, 0, 0, 98, '{"wisp":[17,16,7],"bamboo":[17,26,13],"guard":[65,33,16],"spirit":[18,29,13],"lynx":[19,26,13]}'::jsonb),
    ('3-8', 'normal', 3, 8, 16, 450, true, 77, 1, 156, 78, 488, 260, 98, '{"wisp":[11,16,7],"bamboo":[7,26,13],"guard":[36,33,16],"spirit":[10,29,13],"lynx":[12,26,13]}'::jsonb),
    ('4-1', 'normal', 4, 1, 17, 400, false, 100, 0, 0, 0, 0, 0, 102, '{"skeleton":[100,27,14]}'::jsonb),
    ('4-2', 'normal', 4, 2, 18, 390, false, 103, 0, 0, 0, 0, 0, 107, '{"skeleton":[61,28,14],"shade":[42,32,14]}'::jsonb),
    ('4-3', 'normal', 4, 3, 19, 380, false, 110, 1, 111, 44, 0, 0, 111, '{"wisp":[33,19,7],"skeleton":[50,30,15],"shade":[26,33,15]}'::jsonb),
    ('4-4', 'normal', 4, 4, 19, 430, false, 136, 1, 133, 67, 0, 0, 111, '{"wisp":[23,19,7],"fox":[28,22,11],"skeleton":[59,30,15],"shade":[25,33,15]}'::jsonb),
    ('4-5', 'normal', 4, 5, 20, 450, false, 137, 1, 185, 92, 0, 0, 116, '{"wisp":[19,19,8],"fox":[18,23,12],"bamboo":[20,31,15],"skeleton":[59,31,15],"shade":[20,35,15]}'::jsonb),
    ('4-6', 'normal', 4, 6, 21, 500, false, 144, 2, 192, 96, 0, 0, 120, '{"wisp":[20,20,8],"fox":[22,24,12],"bamboo":[12,32,16],"skeleton":[71,32,16],"shade":[17,36,16]}'::jsonb),
    ('4-7', 'normal', 4, 7, 21, 570, false, 176, 2, 192, 96, 0, 0, 120, '{"wisp":[24,20,8],"fox":[21,24,12],"bamboo":[12,32,16],"skeleton":[99,32,16],"shade":[18,36,16]}'::jsonb),
    ('4-8', 'normal', 4, 8, 22, 390, true, 69, 1, 199, 100, 623, 332, 125, '{"wisp":[7,21,8],"fox":[13,25,12],"bamboo":[11,33,17],"skeleton":[29,33,17],"shade":[8,37,17]}'::jsonb),
    ('5-1', 'normal', 5, 1, 23, 260, false, 109, 0, 0, 0, 0, 0, 129, '{"water":[109,22,13]}'::jsonb),
    ('5-2', 'normal', 5, 2, 23, 360, false, 106, 0, 0, 0, 0, 0, 129, '{"water":[62,22,13],"catfish":[44,47,22]}'::jsonb),
    ('5-3', 'normal', 5, 3, 24, 400, false, 114, 1, 267, 133, 0, 0, 133, '{"water":[55,22,13],"guard":[31,44,22],"catfish":[27,49,22]}'::jsonb),
    ('5-4', 'normal', 5, 4, 25, 420, false, 126, 1, 138, 55, 0, 0, 138, '{"wisp":[24,23,9],"water":[55,23,14],"guard":[22,46,23],"catfish":[24,51,23]}'::jsonb),
    ('5-5', 'normal', 5, 5, 25, 460, false, 148, 1, 221, 110, 0, 0, 138, '{"wisp":[15,23,9],"water":[71,23,14],"bamboo":[26,37,18],"guard":[19,46,23],"catfish":[16,51,23]}'::jsonb),
    ('5-6', 'normal', 5, 6, 26, 520, false, 166, 2, 228, 114, 0, 0, 143, '{"wisp":[26,24,10],"water":[66,24,14],"bamboo":[28,38,19],"guard":[20,48,24],"catfish":[24,52,24]}'::jsonb),
    ('5-7', 'normal', 5, 7, 27, 530, false, 172, 2, 235, 118, 0, 0, 147, '{"wisp":[18,25,10],"water":[86,25,15],"bamboo":[21,39,20],"guard":[28,49,25],"catfish":[17,54,25]}'::jsonb),
    ('5-8', 'normal', 5, 8, 27, 440, true, 80, 1, 235, 118, 735, 392, 147, '{"wisp":[9,25,10],"water":[37,25,15],"bamboo":[15,39,20],"guard":[9,49,25],"catfish":[9,54,25]}'::jsonb),
    ('6-1', 'normal', 6, 1, 28, 480, false, 109, 0, 0, 0, 0, 0, 152, '{"mud":[109,35,15]}'::jsonb),
    ('6-2', 'normal', 6, 2, 29, 410, false, 96, 0, 0, 0, 0, 0, 156, '{"mud":[58,36,16],"toad":[38,52,26]}'::jsonb),
    ('6-3', 'normal', 6, 3, 29, 430, false, 105, 1, 281, 125, 0, 0, 156, '{"spirit":[25,47,21],"mud":[57,36,16],"toad":[22,52,26]}'::jsonb),
    ('6-4', 'normal', 6, 4, 30, 480, false, 123, 1, 193, 96, 0, 0, 161, '{"fox":[18,32,16],"spirit":[17,48,21],"mud":[63,37,16],"toad":[24,54,27]}'::jsonb),
    ('6-5', 'normal', 6, 5, 31, 580, false, 140, 1, 330, 165, 0, 0, 165, '{"club":[18,55,28],"fox":[19,33,17],"spirit":[22,50,22],"mud":[63,39,17],"toad":[17,55,28]}'::jsonb),
    ('6-6', 'normal', 6, 6, 31, 630, false, 146, 2, 330, 165, 0, 0, 165, '{"club":[21,55,28],"fox":[13,33,17],"spirit":[25,50,22],"mud":[69,39,17],"toad":[16,55,28]}'::jsonb),
    ('6-7', 'normal', 6, 7, 32, 680, false, 156, 2, 339, 169, 0, 0, 169, '{"club":[18,56,28],"fox":[19,34,17],"spirit":[16,51,23],"mud":[83,40,17],"toad":[18,56,28]}'::jsonb),
    ('6-8', 'normal', 6, 8, 33, 530, true, 75, 1, 348, 174, 870, 464, 174, '{"club":[8,58,29],"fox":[6,35,17],"spirit":[7,52,23],"mud":[41,41,17],"toad":[12,58,29]}'::jsonb),
    ('7-1', 'normal', 7, 1, 33, 500, false, 94, 0, 0, 0, 0, 0, 174, '{"guard":[94,58,29]}'::jsonb),
    ('7-2', 'normal', 7, 2, 34, 520, false, 127, 0, 0, 0, 0, 0, 179, '{"guard":[74,60,30],"bomber":[53,54,24]}'::jsonb),
    ('7-3', 'normal', 7, 3, 35, 520, false, 121, 1, 293, 146, 0, 0, 183, '{"guard":[50,61,31],"skeleton":[40,49,24],"bomber":[30,55,24]}'::jsonb),
    ('7-4', 'normal', 7, 4, 35, 610, false, 158, 1, 220, 110, 0, 0, 183, '{"fox":[29,37,18],"guard":[68,61,31],"skeleton":[34,49,24],"bomber":[26,55,24]}'::jsonb),
    ('7-5', 'normal', 7, 5, 36, 700, false, 165, 1, 375, 188, 0, 0, 188, '{"club":[22,63,31],"fox":[21,38,19],"guard":[77,63,31],"skeleton":[19,50,25],"bomber":[25,56,25]}'::jsonb),
    ('7-6', 'normal', 7, 6, 37, 650, false, 143, 2, 384, 192, 0, 0, 192, '{"club":[20,64,32],"fox":[17,38,19],"guard":[64,64,32],"skeleton":[19,51,26],"bomber":[21,58,26]}'::jsonb),
    ('7-7', 'normal', 7, 7, 37, 690, false, 153, 2, 384, 192, 0, 0, 192, '{"club":[17,64,32],"fox":[18,38,19],"guard":[72,64,32],"skeleton":[23,51,26],"bomber":[21,58,26]}'::jsonb),
    ('7-8', 'normal', 7, 8, 38, 600, true, 99, 1, 393, 197, 983, 524, 197, '{"club":[15,66,33],"fox":[12,39,20],"guard":[48,66,33],"skeleton":[11,52,26],"bomber":[12,59,26]}'::jsonb),
    ('8-1', 'normal', 8, 1, 39, 540, false, 99, 0, 0, 0, 0, 0, 201, '{"guard":[99,67,34]}'::jsonb),
    ('8-2', 'normal', 8, 2, 39, 410, false, 83, 0, 0, 0, 0, 0, 201, '{"guard":[43,67,34],"sleeper":[40,80,34]}'::jsonb),
    ('8-3', 'normal', 8, 3, 40, 450, false, 112, 1, 206, 82, 0, 0, 206, '{"wisp":[34,34,14],"guard":[51,69,34],"sleeper":[26,82,34]}'::jsonb),
    ('8-4', 'normal', 8, 4, 41, 660, false, 151, 1, 336, 168, 0, 0, 210, '{"wisp":[25,35,14],"guard":[81,70,35],"skeleton":[24,56,28],"sleeper":[20,84,35]}'::jsonb),
    ('8-5', 'normal', 8, 5, 41, 610, false, 156, 1, 252, 126, 0, 0, 210, '{"wisp":[22,35,14],"fox":[27,42,21],"guard":[73,70,35],"skeleton":[20,56,28],"sleeper":[13,84,35]}'::jsonb),
    ('8-6', 'normal', 8, 6, 42, 600, false, 142, 2, 257, 129, 0, 0, 214, '{"wisp":[23,36,14],"fox":[16,43,21],"guard":[64,72,36],"skeleton":[18,57,29],"sleeper":[19,86,36]}'::jsonb),
    ('8-7', 'normal', 8, 7, 43, 700, false, 169, 2, 263, 131, 0, 0, 219, '{"wisp":[21,37,15],"fox":[20,44,22],"guard":[79,73,37],"skeleton":[24,58,29],"sleeper":[23,88,37]}'::jsonb),
    ('8-8', 'normal', 8, 8, 43, 600, true, 91, 1, 263, 131, 1460, 730, 219, '{"wisp":[14,37,15],"fox":[11,44,22],"guard":[44,73,37],"skeleton":[8,58,29],"sleeper":[13,88,37]}'::jsonb),
    ('9-1', 'normal', 9, 1, 44, 650, false, 122, 0, 0, 0, 0, 0, 224, '{"guard":[122,75,37]}'::jsonb),
    ('9-2', 'normal', 9, 2, 45, 460, false, 90, 0, 0, 0, 0, 0, 228, '{"guard":[53,76,38],"acorn":[37,92,38]}'::jsonb),
    ('9-3', 'normal', 9, 3, 45, 540, false, 109, 1, 366, 182, 0, 0, 228, '{"guard":[51,76,38],"skeleton":[25,61,30],"acorn":[32,92,38]}'::jsonb),
    ('9-4', 'normal', 9, 4, 46, 640, false, 155, 1, 281, 140, 0, 0, 233, '{"fox":[38,47,23],"guard":[69,78,39],"skeleton":[29,62,31],"acorn":[18,94,39]}'::jsonb),
    ('9-5', 'normal', 9, 5, 47, 770, false, 174, 1, 480, 237, 0, 0, 237, '{"club":[16,80,40],"fox":[23,48,24],"guard":[85,80,40],"skeleton":[28,64,32],"acorn":[21,96,40]}'::jsonb),
    ('9-6', 'normal', 9, 6, 47, 710, false, 147, 2, 480, 237, 0, 0, 237, '{"club":[12,80,40],"fox":[15,48,24],"guard":[70,80,40],"skeleton":[23,64,32],"acorn":[25,96,40]}'::jsonb),
    ('9-7', 'normal', 9, 7, 48, 810, false, 180, 2, 491, 242, 0, 0, 242, '{"club":[16,82,40],"fox":[26,49,24],"guard":[90,82,40],"skeleton":[19,65,32],"acorn":[27,98,40]}'::jsonb),
    ('9-8', 'normal', 9, 8, 49, 690, true, 102, 1, 502, 246, 1673, 820, 246, '{"club":[19,84,41],"fox":[14,50,25],"guard":[48,84,41],"skeleton":[12,67,33],"acorn":[8,100,41]}'::jsonb),
    ('10-1', 'normal', 10, 1, 50, 560, false, 120, 0, 0, 0, 0, 0, 251, '{"skeleton":[120,68,33]}'::jsonb),
    ('10-2', 'normal', 10, 2, 50, 660, false, 128, 0, 0, 0, 0, 0, 251, '{"skeleton":[73,68,33],"yaksha":[55,120,50]}'::jsonb),
    ('10-3', 'normal', 10, 3, 51, 550, false, 102, 1, 472, 204, 0, 0, 255, '{"skeleton":[52,70,34],"spirit":[16,79,34],"yaksha":[33,122,51]}'::jsonb),
    ('10-4', 'normal', 10, 4, 52, 740, false, 161, 1, 536, 259, 0, 0, 259, '{"guard":[27,89,43],"skeleton":[81,71,35],"spirit":[30,80,35],"yaksha":[22,125,52]}'::jsonb),
    ('10-5', 'normal', 10, 5, 52, 670, false, 156, 1, 321, 156, 0, 0, 259, '{"fox":[19,54,26],"guard":[29,89,43],"skeleton":[73,71,35],"spirit":[20,80,35],"yaksha":[14,125,52]}'::jsonb),
    ('10-6', 'normal', 10, 6, 53, 690, false, 164, 2, 328, 158, 0, 0, 264, '{"fox":[21,55,26],"guard":[27,91,44],"skeleton":[75,73,35],"spirit":[21,82,35],"yaksha":[18,128,53]}'::jsonb),
    ('10-7', 'normal', 10, 7, 54, 650, false, 153, 2, 335, 161, 0, 0, 269, '{"fox":[21,56,27],"guard":[19,93,45],"skeleton":[73,74,36],"spirit":[20,84,36],"yaksha":[18,130,54]}'::jsonb),
    ('10-8', 'normal', 10, 8, 54, 610, true, 94, 1, 335, 161, 1862, 895, 269, '{"fox":[16,56,27],"guard":[13,93,45],"skeleton":[42,74,36],"spirit":[8,84,36],"yaksha":[14,130,54]}'::jsonb),
    ('11-1', 'normal', 11, 1, 55, 470, false, 100, 0, 0, 0, 0, 0, 273, '{"skeleton":[100,76,36]}'::jsonb),
    ('11-2', 'normal', 11, 2, 56, 540, false, 126, 0, 0, 0, 0, 0, 278, '{"skeleton":[78,78,37],"ferryman":[48,145,56]}'::jsonb),
    ('11-3', 'normal', 11, 3, 56, 420, false, 103, 1, 291, 167, 0, 0, 278, '{"water":[39,48,28],"skeleton":[42,78,37],"ferryman":[21,145,56]}'::jsonb),
    ('11-4', 'normal', 11, 4, 57, 620, false, 153, 1, 593, 282, 0, 0, 282, '{"water":[33,49,28],"guard":[24,99,47],"skeleton":[72,79,38],"ferryman":[23,148,56]}'::jsonb),
    ('11-5', 'normal', 11, 5, 58, 680, false, 158, 1, 605, 286, 0, 0, 286, '{"club":[22,101,48],"water":[23,50,29],"guard":[16,101,48],"skeleton":[76,81,38],"ferryman":[20,151,57]}'::jsonb),
    ('11-6', 'normal', 11, 6, 58, 670, false, 152, 2, 605, 286, 0, 0, 286, '{"club":[13,101,48],"water":[22,50,29],"guard":[18,101,48],"skeleton":[77,81,38],"ferryman":[20,151,57]}'::jsonb),
    ('11-7', 'normal', 11, 7, 59, 840, false, 200, 2, 617, 291, 0, 0, 291, '{"club":[27,103,49],"water":[27,51,29],"guard":[23,103,49],"skeleton":[99,82,39],"ferryman":[22,154,58]}'::jsonb),
    ('11-8', 'normal', 11, 8, 60, 580, true, 77, 1, 629, 296, 2096, 985, 296, '{"club":[13,105,49],"water":[6,52,30],"guard":[16,105,49],"skeleton":[34,84,39],"ferryman":[7,157,59]}'::jsonb),
    ('12-1', 'normal', 12, 1, 60, 500, false, 108, 0, 0, 0, 0, 0, 296, '{"skeleton":[108,84,39]}'::jsonb),
    ('12-2', 'normal', 12, 2, 61, 450, false, 112, 0, 0, 0, 0, 0, 300, '{"skeleton":[62,85,40],"firecart":[50,128,50]}'::jsonb),
    ('12-3', 'normal', 12, 3, 62, 490, false, 119, 1, 588, 244, 0, 0, 305, '{"skeleton":[63,87,41],"spirit":[30,98,41],"firecart":[25,131,51]}'::jsonb),
    ('12-4', 'normal', 12, 4, 62, 630, false, 166, 1, 653, 305, 0, 0, 305, '{"guard":[24,109,51],"skeleton":[77,87,41],"spirit":[40,98,41],"firecart":[24,131,51]}'::jsonb),
    ('12-5', 'normal', 12, 5, 63, 680, false, 154, 1, 665, 309, 0, 0, 309, '{"club":[21,111,51],"guard":[16,111,51],"skeleton":[72,89,41],"spirit":[23,100,41],"firecart":[21,133,51]}'::jsonb),
    ('12-6', 'normal', 12, 6, 64, 600, false, 141, 2, 406, 188, 0, 0, 314, '{"club":[17,113,52],"fox":[15,68,31],"guard":[17,113,52],"skeleton":[61,90,42],"spirit":[14,102,42],"firecart":[15,135,52]}'::jsonb),
    ('12-7', 'normal', 12, 7, 64, 720, false, 181, 2, 406, 188, 0, 0, 314, '{"club":[25,113,52],"fox":[22,68,31],"guard":[15,113,52],"skeleton":[81,90,42],"spirit":[19,102,42],"firecart":[17,135,52]}'::jsonb),
    ('12-8', 'normal', 12, 8, 65, 630, true, 97, 1, 414, 191, 2298, 1060, 318, '{"club":[10,115,53],"fox":[11,69,32],"guard":[18,115,53],"skeleton":[38,92,42],"spirit":[14,103,42],"firecart":[5,138,53]}'::jsonb),
    ('final', 'normal', 12, 9, 65, 720, true, 63, 2, 965, 382, 9192, 5300, 318, '{"imp":[4,46,21],"wisp":[3,57,21],"club":[3,115,53],"fox":[3,69,32],"guard":[6,115,53],"skeleton":[7,92,42],"spirit":[3,103,42],"mud":[2,80,32],"lynx":[3,92,42],"shade":[3,103,42],"catfish":[3,126,53],"toad":[3,115,53],"bomber":[3,103,42],"sleeper":[3,138,53],"acorn":[3,138,53],"yaksha":[4,161,64],"ferryman":[2,172,64],"firecart":[3,138,53]}'::jsonb)
-- </gen:maps>
  ) as t(map_id, mode, region, no, level, par, boss, total, elites, elite_exp, elite_coin, boss_exp, boss_coin, chest_coin, kinds)
$$;
revoke all on function public._twelve_maps() from public, anon, authenticated;

-- 레벨 n → n+1 에 필요한 경험치
create or replace function public._twelve_levels() returns table (level int, need bigint)
language sql immutable as $$
  select * from (values
-- <gen:levels>
    (1, 130),
    (2, 343),
    (3, 605),
    (4, 905),
    (5, 1237),
    (6, 1597),
    (7, 1982),
    (8, 2389),
    (9, 2818),
    (10, 3265),
    (11, 3732),
    (12, 4215),
    (13, 4715),
    (14, 5230),
    (15, 5761),
    (16, 6305),
    (17, 6864),
    (18, 7436),
    (19, 8020),
    (20, 8618),
    (21, 9227),
    (22, 9848),
    (23, 10480),
    (24, 11123),
    (25, 11778),
    (26, 12442),
    (27, 13118),
    (28, 13803),
    (29, 14498),
    (30, 15202),
    (31, 15917),
    (32, 16640),
    (33, 17373),
    (34, 18114),
    (35, 18864),
    (36, 19623),
    (37, 20390),
    (38, 21166),
    (39, 21950),
    (40, 22742),
    (41, 23542),
    (42, 24350),
    (43, 25165),
    (44, 25988),
    (45, 26819),
    (46, 27657),
    (47, 28502),
    (48, 29355),
    (49, 30215),
    (50, 31081),
    (51, 31955),
    (52, 32836),
    (53, 33723),
    (54, 34617),
    (55, 35518),
    (56, 36426),
    (57, 37339),
    (58, 38260),
    (59, 39186),
    (60, 40119),
    (61, 41059),
    (62, 42004),
    (63, 42956),
    (64, 43913),
    (65, 44877),
    (66, 45846),
    (67, 46822),
    (68, 47803),
    (69, 48790),
    (70, 49783),
    (71, 50781),
    (72, 51786),
    (73, 52795),
    (74, 53811),
    (75, 54831),
    (76, 55858),
    (77, 56889),
    (78, 57926),
    (79, 58969),
    (80, 60016),
    (81, 61069),
    (82, 62127),
    (83, 63191),
    (84, 64259),
    (85, 65333),
    (86, 66411),
    (87, 67495),
    (88, 68583),
    (89, 69677),
    (90, 70775),
    (91, 71879),
    (92, 72987),
    (93, 74100),
    (94, 75218),
    (95, 76341),
    (96, 77468),
    (97, 78600),
    (98, 79737)
-- </gen:levels>
  ) as t(level, need)
$$;
revoke all on function public._twelve_levels() from public, anon, authenticated;

-- 맵 레벨 차이 보정: 내 레벨 − 맵 권장 레벨이 gap 이상이면 경험치 pct%
create or replace function public._twelve_exp_penalty() returns table (gap int, pct int)
language sql immutable as $$
  select * from (values
-- <gen:penalty>
    (20, 5),
    (10, 25)
-- </gen:penalty>
  ) as t(gap, pct)
$$;
revoke all on function public._twelve_exp_penalty() from public, anon, authenticated;

-- 장비: 칸 · 등급(0~11) · 레어 · 강화 가능 · 상점 값(0 = 안 판다) · 파는 값 · 분해 강화석 · 엽전 획득 %
create or replace function public._twelve_items() returns table (base text, slot text, tier int, rare boolean, enhance boolean, buy int, sell int, scrap int, coin_pct int)
language sql immutable as $$
  select * from (values
-- <gen:items>
    ('w-sword-0', 'weapon', 0, false, true, 300, 30, 1, 0),
    ('w-spear-0', 'weapon', 0, false, true, 300, 30, 1, 0),
    ('w-bow-0', 'weapon', 0, false, true, 300, 30, 1, 0),
    ('w-fan-0', 'weapon', 0, false, true, 300, 30, 1, 0),
    ('a-0', 'armor', 0, false, true, 300, 30, 1, 0),
    ('c-mp-0', 'acc', 0, false, false, 0, 45, 1, 0),
    ('c-speed-0', 'acc', 0, false, false, 0, 45, 1, 0),
    ('c-crit-0', 'acc', 0, false, false, 0, 45, 1, 0),
    ('c-potion-0', 'acc', 0, false, false, 0, 45, 1, 0),
    ('c-coin-0', 'acc', 0, false, false, 0, 45, 1, 5),
    ('w-sword-1', 'weapon', 1, false, true, 1200, 120, 1, 0),
    ('w-spear-1', 'weapon', 1, false, true, 1200, 120, 1, 0),
    ('w-bow-1', 'weapon', 1, false, true, 1200, 120, 1, 0),
    ('w-fan-1', 'weapon', 1, false, true, 1200, 120, 1, 0),
    ('a-1', 'armor', 1, false, true, 1200, 120, 1, 0),
    ('c-mp-1', 'acc', 1, false, false, 0, 180, 1, 0),
    ('c-speed-1', 'acc', 1, false, false, 0, 180, 1, 0),
    ('c-crit-1', 'acc', 1, false, false, 0, 180, 1, 0),
    ('c-potion-1', 'acc', 1, false, false, 0, 180, 1, 0),
    ('c-coin-1', 'acc', 1, false, false, 0, 180, 1, 6),
    ('w-sword-2', 'weapon', 2, false, true, 2700, 270, 2, 0),
    ('w-spear-2', 'weapon', 2, false, true, 2700, 270, 2, 0),
    ('w-bow-2', 'weapon', 2, false, true, 2700, 270, 2, 0),
    ('w-fan-2', 'weapon', 2, false, true, 2700, 270, 2, 0),
    ('a-2', 'armor', 2, false, true, 2700, 270, 2, 0),
    ('c-mp-2', 'acc', 2, false, false, 0, 405, 2, 0),
    ('c-speed-2', 'acc', 2, false, false, 0, 405, 2, 0),
    ('c-crit-2', 'acc', 2, false, false, 0, 405, 2, 0),
    ('c-potion-2', 'acc', 2, false, false, 0, 405, 2, 0),
    ('c-coin-2', 'acc', 2, false, false, 0, 405, 2, 8),
    ('w-sword-3', 'weapon', 3, false, true, 6400, 480, 2, 0),
    ('w-spear-3', 'weapon', 3, false, true, 6400, 480, 2, 0),
    ('w-bow-3', 'weapon', 3, false, true, 6400, 480, 2, 0),
    ('w-fan-3', 'weapon', 3, false, true, 6400, 480, 2, 0),
    ('a-3', 'armor', 3, false, true, 6400, 480, 2, 0),
    ('c-mp-3', 'acc', 3, false, false, 0, 720, 2, 0),
    ('c-speed-3', 'acc', 3, false, false, 0, 720, 2, 0),
    ('c-crit-3', 'acc', 3, false, false, 0, 720, 2, 0),
    ('c-potion-3', 'acc', 3, false, false, 0, 720, 2, 0),
    ('c-coin-3', 'acc', 3, false, false, 0, 720, 2, 9),
    ('w-sword-4', 'weapon', 4, false, true, 12500, 750, 3, 0),
    ('w-spear-4', 'weapon', 4, false, true, 12500, 750, 3, 0),
    ('w-bow-4', 'weapon', 4, false, true, 12500, 750, 3, 0),
    ('w-fan-4', 'weapon', 4, false, true, 12500, 750, 3, 0),
    ('a-4', 'armor', 4, false, true, 12500, 750, 3, 0),
    ('c-mp-4', 'acc', 4, false, false, 0, 1125, 3, 0),
    ('c-speed-4', 'acc', 4, false, false, 0, 1125, 3, 0),
    ('c-crit-4', 'acc', 4, false, false, 0, 1125, 3, 0),
    ('c-potion-4', 'acc', 4, false, false, 0, 1125, 3, 0),
    ('c-coin-4', 'acc', 4, false, false, 0, 1125, 3, 11),
    ('w-sword-5', 'weapon', 5, false, true, 21600, 1080, 3, 0),
    ('w-spear-5', 'weapon', 5, false, true, 21600, 1080, 3, 0),
    ('w-bow-5', 'weapon', 5, false, true, 21600, 1080, 3, 0),
    ('w-fan-5', 'weapon', 5, false, true, 21600, 1080, 3, 0),
    ('a-5', 'armor', 5, false, true, 21600, 1080, 3, 0),
    ('c-mp-5', 'acc', 5, false, false, 0, 1620, 3, 0),
    ('c-speed-5', 'acc', 5, false, false, 0, 1620, 3, 0),
    ('c-crit-5', 'acc', 5, false, false, 0, 1620, 3, 0),
    ('c-potion-5', 'acc', 5, false, false, 0, 1620, 3, 0),
    ('c-coin-5', 'acc', 5, false, false, 0, 1620, 3, 12),
    ('w-sword-6', 'weapon', 6, false, true, 34300, 1470, 4, 0),
    ('w-spear-6', 'weapon', 6, false, true, 34300, 1470, 4, 0),
    ('w-bow-6', 'weapon', 6, false, true, 34300, 1470, 4, 0),
    ('w-fan-6', 'weapon', 6, false, true, 34300, 1470, 4, 0),
    ('a-6', 'armor', 6, false, true, 34300, 1470, 4, 0),
    ('c-mp-6', 'acc', 6, false, false, 0, 2205, 4, 0),
    ('c-speed-6', 'acc', 6, false, false, 0, 2205, 4, 0),
    ('c-crit-6', 'acc', 6, false, false, 0, 2205, 4, 0),
    ('c-potion-6', 'acc', 6, false, false, 0, 2205, 4, 0),
    ('c-coin-6', 'acc', 6, false, false, 0, 2205, 4, 14),
    ('w-sword-7', 'weapon', 7, false, true, 51200, 1920, 4, 0),
    ('w-spear-7', 'weapon', 7, false, true, 51200, 1920, 4, 0),
    ('w-bow-7', 'weapon', 7, false, true, 51200, 1920, 4, 0),
    ('w-fan-7', 'weapon', 7, false, true, 51200, 1920, 4, 0),
    ('a-7', 'armor', 7, false, true, 51200, 1920, 4, 0),
    ('c-mp-7', 'acc', 7, false, false, 0, 2880, 4, 0),
    ('c-speed-7', 'acc', 7, false, false, 0, 2880, 4, 0),
    ('c-crit-7', 'acc', 7, false, false, 0, 2880, 4, 0),
    ('c-potion-7', 'acc', 7, false, false, 0, 2880, 4, 0),
    ('c-coin-7', 'acc', 7, false, false, 0, 2880, 4, 15),
    ('w-sword-8', 'weapon', 8, false, true, 72900, 2430, 5, 0),
    ('w-spear-8', 'weapon', 8, false, true, 72900, 2430, 5, 0),
    ('w-bow-8', 'weapon', 8, false, true, 72900, 2430, 5, 0),
    ('w-fan-8', 'weapon', 8, false, true, 72900, 2430, 5, 0),
    ('a-8', 'armor', 8, false, true, 72900, 2430, 5, 0),
    ('c-mp-8', 'acc', 8, false, false, 0, 3645, 5, 0),
    ('c-speed-8', 'acc', 8, false, false, 0, 3645, 5, 0),
    ('c-crit-8', 'acc', 8, false, false, 0, 3645, 5, 0),
    ('c-potion-8', 'acc', 8, false, false, 0, 3645, 5, 0),
    ('c-coin-8', 'acc', 8, false, false, 0, 3645, 5, 17),
    ('w-sword-9', 'weapon', 9, false, true, 100000, 3000, 5, 0),
    ('w-spear-9', 'weapon', 9, false, true, 100000, 3000, 5, 0),
    ('w-bow-9', 'weapon', 9, false, true, 100000, 3000, 5, 0),
    ('w-fan-9', 'weapon', 9, false, true, 100000, 3000, 5, 0),
    ('a-9', 'armor', 9, false, true, 100000, 3000, 5, 0),
    ('c-mp-9', 'acc', 9, false, false, 0, 4500, 5, 0),
    ('c-speed-9', 'acc', 9, false, false, 0, 4500, 5, 0),
    ('c-crit-9', 'acc', 9, false, false, 0, 4500, 5, 0),
    ('c-potion-9', 'acc', 9, false, false, 0, 4500, 5, 0),
    ('c-coin-9', 'acc', 9, false, false, 0, 4500, 5, 18),
    ('w-sword-10', 'weapon', 10, false, true, 133100, 3630, 6, 0),
    ('w-spear-10', 'weapon', 10, false, true, 133100, 3630, 6, 0),
    ('w-bow-10', 'weapon', 10, false, true, 133100, 3630, 6, 0),
    ('w-fan-10', 'weapon', 10, false, true, 133100, 3630, 6, 0),
    ('a-10', 'armor', 10, false, true, 133100, 3630, 6, 0),
    ('c-mp-10', 'acc', 10, false, false, 0, 5445, 6, 0),
    ('c-speed-10', 'acc', 10, false, false, 0, 5445, 6, 0),
    ('c-crit-10', 'acc', 10, false, false, 0, 5445, 6, 0),
    ('c-potion-10', 'acc', 10, false, false, 0, 5445, 6, 0),
    ('c-coin-10', 'acc', 10, false, false, 0, 5445, 6, 20),
    ('w-sword-11', 'weapon', 11, false, true, 172800, 4320, 6, 0),
    ('w-spear-11', 'weapon', 11, false, true, 172800, 4320, 6, 0),
    ('w-bow-11', 'weapon', 11, false, true, 172800, 4320, 6, 0),
    ('w-fan-11', 'weapon', 11, false, true, 172800, 4320, 6, 0),
    ('a-11', 'armor', 11, false, true, 172800, 4320, 6, 0),
    ('c-mp-11', 'acc', 11, false, false, 0, 6480, 6, 0),
    ('c-speed-11', 'acc', 11, false, false, 0, 6480, 6, 0),
    ('c-crit-11', 'acc', 11, false, false, 0, 6480, 6, 0),
    ('c-potion-11', 'acc', 11, false, false, 0, 6480, 6, 0),
    ('c-coin-11', 'acc', 11, false, false, 0, 6480, 6, 21),
    ('r-n1-1', 'weapon', 0, true, true, 0, 120, 4, 0),
    ('r-n1-2', 'weapon', 0, true, true, 0, 120, 4, 0),
    ('r-n1-3', 'armor', 0, true, true, 0, 120, 4, 0),
    ('s-n1', 'acc', 0, true, false, 0, 45, 1, 0),
    ('r-n2-1', 'weapon', 0, true, true, 0, 120, 4, 0),
    ('r-n2-2', 'weapon', 0, true, true, 0, 120, 4, 0),
    ('r-n2-3', 'armor', 0, true, true, 0, 120, 4, 0),
    ('s-n2', 'acc', 0, true, false, 0, 45, 1, 0),
    ('r-n3-1', 'weapon', 1, true, true, 0, 480, 4, 0),
    ('r-n3-2', 'weapon', 1, true, true, 0, 480, 4, 0),
    ('r-n3-3', 'armor', 1, true, true, 0, 480, 4, 0),
    ('s-n3', 'acc', 1, true, false, 0, 180, 1, 0),
    ('r-n4-1', 'weapon', 2, true, true, 0, 1080, 6, 0),
    ('r-n4-2', 'weapon', 2, true, true, 0, 1080, 6, 0),
    ('r-n4-3', 'armor', 2, true, true, 0, 1080, 6, 0),
    ('s-n4', 'acc', 2, true, false, 0, 405, 2, 0),
    ('r-n5-1', 'weapon', 3, true, true, 0, 1920, 6, 0),
    ('r-n5-2', 'weapon', 3, true, true, 0, 1920, 6, 0),
    ('r-n5-3', 'armor', 3, true, true, 0, 1920, 6, 0),
    ('s-n5', 'acc', 3, true, false, 0, 720, 2, 14),
    ('r-n6-1', 'weapon', 3, true, true, 0, 1920, 6, 0),
    ('r-n6-2', 'weapon', 3, true, true, 0, 1920, 6, 0),
    ('r-n6-3', 'armor', 3, true, true, 0, 1920, 6, 0),
    ('s-n6', 'acc', 3, true, false, 0, 720, 2, 0),
    ('r-n7-1', 'weapon', 4, true, true, 0, 3000, 8, 0),
    ('r-n7-2', 'weapon', 4, true, true, 0, 3000, 8, 0),
    ('r-n7-3', 'armor', 4, true, true, 0, 3000, 8, 0),
    ('s-n7', 'acc', 4, true, false, 0, 1125, 3, 0),
    ('r-n8-1', 'weapon', 5, true, true, 0, 4320, 8, 0),
    ('r-n8-2', 'weapon', 5, true, true, 0, 4320, 8, 0),
    ('r-n8-3', 'armor', 5, true, true, 0, 4320, 8, 0),
    ('s-n8', 'acc', 5, true, false, 0, 1620, 3, 0),
    ('r-n9-1', 'weapon', 6, true, true, 0, 5880, 10, 0),
    ('r-n9-2', 'weapon', 6, true, true, 0, 5880, 10, 0),
    ('r-n9-3', 'armor', 6, true, true, 0, 5880, 10, 0),
    ('s-n9', 'acc', 6, true, false, 0, 2205, 4, 0),
    ('r-n10-1', 'weapon', 6, true, true, 0, 5880, 10, 0),
    ('r-n10-2', 'weapon', 6, true, true, 0, 5880, 10, 0),
    ('r-n10-3', 'armor', 6, true, true, 0, 5880, 10, 0),
    ('s-n10', 'acc', 6, true, false, 0, 2205, 4, 21),
    ('r-n11-1', 'weapon', 7, true, true, 0, 7680, 10, 0),
    ('r-n11-2', 'weapon', 7, true, true, 0, 7680, 10, 0),
    ('r-n11-3', 'armor', 7, true, true, 0, 7680, 10, 0),
    ('s-n11', 'acc', 7, true, false, 0, 2880, 4, 0),
    ('r-n12-1', 'weapon', 7, true, true, 0, 7680, 10, 0),
    ('r-n12-2', 'weapon', 7, true, true, 0, 7680, 10, 0),
    ('r-n12-3', 'armor', 7, true, true, 0, 7680, 10, 0),
    ('s-n12', 'acc', 7, true, false, 0, 2880, 4, 0),
    ('r-h1-1', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h1-2', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h1-3', 'armor', 8, true, true, 0, 9720, 12, 0),
    ('s-h1', 'acc', 8, true, false, 0, 3645, 5, 0),
    ('r-h2-1', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h2-2', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h2-3', 'armor', 8, true, true, 0, 9720, 12, 0),
    ('s-h2', 'acc', 8, true, false, 0, 3645, 5, 0),
    ('r-h3-1', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h3-2', 'weapon', 8, true, true, 0, 9720, 12, 0),
    ('r-h3-3', 'armor', 8, true, true, 0, 9720, 12, 0),
    ('s-h3', 'acc', 8, true, false, 0, 3645, 5, 0),
    ('r-h4-1', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h4-2', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h4-3', 'armor', 9, true, true, 0, 12000, 12, 0),
    ('s-h4', 'acc', 9, true, false, 0, 4500, 5, 0),
    ('r-h5-1', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h5-2', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h5-3', 'armor', 9, true, true, 0, 12000, 12, 0),
    ('s-h5', 'acc', 9, true, false, 0, 4500, 5, 27),
    ('r-h6-1', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h6-2', 'weapon', 9, true, true, 0, 12000, 12, 0),
    ('r-h6-3', 'armor', 9, true, true, 0, 12000, 12, 0),
    ('s-h6', 'acc', 9, true, false, 0, 4500, 5, 0),
    ('r-h7-1', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h7-2', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h7-3', 'armor', 10, true, true, 0, 14520, 14, 0),
    ('s-h7', 'acc', 10, true, false, 0, 5445, 6, 0),
    ('r-h8-1', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h8-2', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h8-3', 'armor', 10, true, true, 0, 14520, 14, 0),
    ('s-h8', 'acc', 10, true, false, 0, 5445, 6, 0),
    ('r-h9-1', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h9-2', 'weapon', 10, true, true, 0, 14520, 14, 0),
    ('r-h9-3', 'armor', 10, true, true, 0, 14520, 14, 0),
    ('s-h9', 'acc', 10, true, false, 0, 5445, 6, 0),
    ('r-h10-1', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h10-2', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h10-3', 'armor', 11, true, true, 0, 17280, 14, 0),
    ('s-h10', 'acc', 11, true, false, 0, 6480, 6, 32),
    ('r-h11-1', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h11-2', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h11-3', 'armor', 11, true, true, 0, 17280, 14, 0),
    ('s-h11', 'acc', 11, true, false, 0, 6480, 6, 0),
    ('r-h12-1', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h12-2', 'weapon', 11, true, true, 0, 17280, 14, 0),
    ('r-h12-3', 'armor', 11, true, true, 0, 17280, 14, 0),
    ('s-h12', 'acc', 11, true, false, 0, 6480, 6, 0)
-- </gen:items>
  ) as t(base, slot, tier, rare, enhance, buy, sell, scrap, coin_pct)
$$;
revoke all on function public._twelve_items() from public, anon, authenticated;

-- 착용 레벨: 등급 0~11 → Lv1, 9, 18, …, 99 (9단위)
create or replace function public._twelve_tier_level(p_tier int) returns int
language sql immutable as $$ select greatest(1, 9 * p_tier) $$;
revoke all on function public._twelve_tier_level(int) from public, anon, authenticated;

-- 지형(모드별): 드랍 등급 · 정예/보스 강화석 · 드랍 물약 크기 · 별 24개 보상 · 그 지형의 레어
create or replace function public._twelve_regions() returns table (mode text, region int, tier int, elite_stones int, boss_stones int, potion_size int, star_item text, rares text[])
language sql immutable as $$
  select * from (values
-- <gen:regions>
    ('normal', 1, 0, 1, 3, 0, 's-n1', array['r-n1-1', 'r-n1-2', 'r-n1-3']),
    ('normal', 2, 0, 1, 3, 0, 's-n2', array['r-n2-1', 'r-n2-2', 'r-n2-3']),
    ('normal', 3, 1, 1, 3, 0, 's-n3', array['r-n3-1', 'r-n3-2', 'r-n3-3']),
    ('normal', 4, 2, 1, 4, 0, 's-n4', array['r-n4-1', 'r-n4-2', 'r-n4-3']),
    ('normal', 5, 3, 1, 4, 1, 's-n5', array['r-n5-1', 'r-n5-2', 'r-n5-3']),
    ('normal', 6, 3, 1, 4, 1, 's-n6', array['r-n6-1', 'r-n6-2', 'r-n6-3']),
    ('normal', 7, 4, 1, 5, 1, 's-n7', array['r-n7-1', 'r-n7-2', 'r-n7-3']),
    ('normal', 8, 5, 1, 5, 1, 's-n8', array['r-n8-1', 'r-n8-2', 'r-n8-3']),
    ('normal', 9, 6, 1, 6, 2, 's-n9', array['r-n9-1', 'r-n9-2', 'r-n9-3']),
    ('normal', 10, 6, 1, 6, 2, 's-n10', array['r-n10-1', 'r-n10-2', 'r-n10-3']),
    ('normal', 11, 7, 1, 6, 2, 's-n11', array['r-n11-1', 'r-n11-2', 'r-n11-3']),
    ('normal', 12, 7, 1, 6, 2, 's-n12', array['r-n12-1', 'r-n12-2', 'r-n12-3']),
    ('hard', 1, 8, 1, 7, 2, 's-h1', array['r-h1-1', 'r-h1-2', 'r-h1-3']),
    ('hard', 2, 8, 1, 7, 2, 's-h2', array['r-h2-1', 'r-h2-2', 'r-h2-3']),
    ('hard', 3, 8, 1, 7, 2, 's-h3', array['r-h3-1', 'r-h3-2', 'r-h3-3']),
    ('hard', 4, 9, 1, 7, 2, 's-h4', array['r-h4-1', 'r-h4-2', 'r-h4-3']),
    ('hard', 5, 9, 1, 7, 2, 's-h5', array['r-h5-1', 'r-h5-2', 'r-h5-3']),
    ('hard', 6, 9, 1, 7, 2, 's-h6', array['r-h6-1', 'r-h6-2', 'r-h6-3']),
    ('hard', 7, 10, 1, 8, 2, 's-h7', array['r-h7-1', 'r-h7-2', 'r-h7-3']),
    ('hard', 8, 10, 1, 8, 2, 's-h8', array['r-h8-1', 'r-h8-2', 'r-h8-3']),
    ('hard', 9, 10, 1, 8, 2, 's-h9', array['r-h9-1', 'r-h9-2', 'r-h9-3']),
    ('hard', 10, 11, 1, 8, 2, 's-h10', array['r-h10-1', 'r-h10-2', 'r-h10-3']),
    ('hard', 11, 11, 1, 8, 2, 's-h11', array['r-h11-1', 'r-h11-2', 'r-h11-3']),
    ('hard', 12, 11, 1, 8, 2, 's-h12', array['r-h12-1', 'r-h12-2', 'r-h12-3'])
-- </gen:regions>
  ) as t(mode, region, tier, elite_stones, boss_stones, potion_size, star_item, rares)
$$;
revoke all on function public._twelve_regions() from public, anon, authenticated;

-- 강화: 등급 · 올라갈 단계 · 엽전 · 강화석
create or replace function public._twelve_enhance() returns table (tier int, plus int, coins int, stones int)
language sql immutable as $$
  select * from (values
-- <gen:enhance>
    (0, 1, 60, 1),
    (0, 2, 120, 1),
    (0, 3, 180, 2),
    (0, 4, 240, 2),
    (0, 5, 300, 3),
    (0, 6, 360, 3),
    (0, 7, 420, 4),
    (0, 8, 480, 4),
    (0, 9, 540, 5),
    (1, 1, 120, 1),
    (1, 2, 240, 1),
    (1, 3, 360, 2),
    (1, 4, 480, 2),
    (1, 5, 600, 3),
    (1, 6, 720, 3),
    (1, 7, 840, 4),
    (1, 8, 960, 4),
    (1, 9, 1080, 5),
    (2, 1, 180, 1),
    (2, 2, 360, 1),
    (2, 3, 540, 2),
    (2, 4, 720, 2),
    (2, 5, 900, 3),
    (2, 6, 1080, 3),
    (2, 7, 1260, 4),
    (2, 8, 1440, 4),
    (2, 9, 1620, 5),
    (3, 1, 480, 2),
    (3, 2, 960, 2),
    (3, 3, 1440, 3),
    (3, 4, 1920, 3),
    (3, 5, 2400, 4),
    (3, 6, 2880, 4),
    (3, 7, 3360, 5),
    (3, 8, 3840, 5),
    (3, 9, 4320, 6),
    (4, 1, 750, 2),
    (4, 2, 1500, 2),
    (4, 3, 2250, 3),
    (4, 4, 3000, 3),
    (4, 5, 3750, 4),
    (4, 6, 4500, 4),
    (4, 7, 5250, 5),
    (4, 8, 6000, 5),
    (4, 9, 6750, 6),
    (5, 1, 1080, 2),
    (5, 2, 2160, 2),
    (5, 3, 3240, 3),
    (5, 4, 4320, 3),
    (5, 5, 5400, 4),
    (5, 6, 6480, 4),
    (5, 7, 7560, 5),
    (5, 8, 8640, 5),
    (5, 9, 9720, 6),
    (6, 1, 1470, 3),
    (6, 2, 2940, 3),
    (6, 3, 4410, 4),
    (6, 4, 5880, 4),
    (6, 5, 7350, 5),
    (6, 6, 8820, 5),
    (6, 7, 10290, 6),
    (6, 8, 11760, 6),
    (6, 9, 13230, 7),
    (7, 1, 1920, 3),
    (7, 2, 3840, 3),
    (7, 3, 5760, 4),
    (7, 4, 7680, 4),
    (7, 5, 9600, 5),
    (7, 6, 11520, 5),
    (7, 7, 13440, 6),
    (7, 8, 15360, 6),
    (7, 9, 17280, 7),
    (8, 1, 2430, 3),
    (8, 2, 4860, 3),
    (8, 3, 7290, 4),
    (8, 4, 9720, 4),
    (8, 5, 12150, 5),
    (8, 6, 14580, 5),
    (8, 7, 17010, 6),
    (8, 8, 19440, 6),
    (8, 9, 21870, 7),
    (9, 1, 3000, 4),
    (9, 2, 6000, 4),
    (9, 3, 9000, 5),
    (9, 4, 12000, 5),
    (9, 5, 15000, 6),
    (9, 6, 18000, 6),
    (9, 7, 21000, 7),
    (9, 8, 24000, 7),
    (9, 9, 27000, 8),
    (10, 1, 3630, 4),
    (10, 2, 7260, 4),
    (10, 3, 10890, 5),
    (10, 4, 14520, 5),
    (10, 5, 18150, 6),
    (10, 6, 21780, 6),
    (10, 7, 25410, 7),
    (10, 8, 29040, 7),
    (10, 9, 32670, 8),
    (11, 1, 4320, 4),
    (11, 2, 8640, 4),
    (11, 3, 12960, 5),
    (11, 4, 17280, 5),
    (11, 5, 21600, 6),
    (11, 6, 25920, 6),
    (11, 7, 30240, 7),
    (11, 8, 34560, 7),
    (11, 9, 38880, 8)
-- </gen:enhance>
  ) as t(tier, plus, coins, stones)
$$;
revoke all on function public._twelve_enhance() from public, anon, authenticated;

-- 가방 늘리기: 지금 칸 수 → 값
create or replace function public._twelve_bag_prices() returns table (size int, price int)
language sql immutable as $$
  select * from (values
-- <gen:bag>
    (40, 300),
    (48, 1200),
    (56, 2700),
    (64, 4800),
    (72, 7500)
-- </gen:bag>
  ) as t(size, price)
$$;
revoke all on function public._twelve_bag_prices() from public, anon, authenticated;

-- 물약: 종류(0 체력 · 1 마력) · 크기(0 소 · 1 중 · 2 대) · 값
create or replace function public._twelve_potions() returns table (slot int, size int, price int)
language sql immutable as $$
  select * from (values
-- <gen:potions>
    (0, 0, 20),
    (0, 1, 80),
    (0, 2, 240),
    (1, 0, 20),
    (1, 1, 80),
    (1, 2, 240)
-- </gen:potions>
  ) as t(slot, size, price)
$$;
revoke all on function public._twelve_potions() from public, anon, authenticated;

-- 대원: 합류 지형 (0 = 처음부터, 1~9 = 그 지형 보스를 처음 잡으면, -1 = 시아코인으로 여는 추가 캐릭터)
create or replace function public._twelve_heroes() returns table (id text, join_region int)
language sql immutable as $$
  select * from (values
-- <gen:heroes>
    ('rat', 0),
    ('ox', 0),
    ('tiger', 0),
    ('rabbit', 1),
    ('dragon', 2),
    ('snake', 3),
    ('horse', 4),
    ('sheep', 5),
    ('monkey', 6),
    ('rooster', 7),
    ('dog', 8),
    ('pig', 9),
    ('cat', -1)
-- </gen:heroes>
  ) as t(id, join_region)
$$;
revoke all on function public._twelve_heroes() from public, anon, authenticated;

-- 처음 받는 장비 (첫 번째 = 드는 무기, 마지막 = 입는 갑옷) · 처음 받는 물약
create or replace function public._twelve_starter() returns text[]
language sql immutable as $$
-- <gen:starter>
  select array['w-sword-0', 'w-spear-0', 'w-bow-0', 'w-fan-0', 'a-0']::text[]
-- </gen:starter>
$$;
revoke all on function public._twelve_starter() from public, anon, authenticated;

create or replace function public._twelve_starter_potions() returns jsonb
language sql immutable as $$
-- <gen:starter_potions>
  select '[[5,0,0],[3,0,0]]'::jsonb
-- </gen:starter_potions>
$$;
revoke all on function public._twelve_starter_potions() from public, anon, authenticated;

-- 일반 장비 드랍 후보의 앞 글자 (뒤에 등급을 붙인다) · 장신구 능력. 순서가 드랍 판정에 쓰인다
create or replace function public._twelve_gear() returns text[]
language sql immutable as $$
-- <gen:gear>
  select array['w-sword-', 'w-spear-', 'w-bow-', 'w-fan-', 'a-']::text[]
-- </gen:gear>
$$;
revoke all on function public._twelve_gear() from public, anon, authenticated;

create or replace function public._twelve_acc() returns text[]
language sql immutable as $$
-- <gen:acc>
  select array['mp', 'speed', 'crit', 'potion', 'coin']::text[]
-- </gen:acc>
$$;
revoke all on function public._twelve_acc() from public, anon, authenticated;

-- ---------- 2. 판 시작 (078 의 twelve_start 를 다시 정의) ----------
-- 바뀐 것: 최종보스맵 'final' (맵 표에 12지형의 9번째 줄로 들어 있다 — 12-8 을 깨야 열린다) 은
-- 그 모드의 열쇠 12개를 모두 모아야 시작할 수 있다 ('need keys'). 그 밖에는 078 과 같다.
-- 보통 모드의 'final' 을 깨면 보통 모드 클리어다: 078 의 _twelve_normal_done · _cat_progress_twelve(고양이 조건 1/1)가 그 기록을 본다.

-- → { run, seed }. seed = 그 판의 드랍 씨앗 (화면이 무엇이 떨어질지 미리 그린다. 판정은 twelve_finish 가 다시 한다)
create or replace function public.twelve_start(p_map text, p_mode text, p_hero text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  mp record;
  pr public.twelve_profiles;
  rid uuid;
  v_seed int;
  v_pct int;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  if p_mode is null or p_mode not in ('normal', 'hard') then raise exception 'bad mode'; end if;
  select * into mp from public._twelve_maps() t where t.map_id = p_map and t.mode = p_mode;
  if not found then raise exception 'bad map'; end if;
  pr := public._twelve_profile_row(me);
  -- 최종보스맵 (src/game/progress.ts 의 checkStart): 12지형 보스를 잡았어도 열쇠 12개가 없으면 못 들어간다
  if mp.no > 8 and public._twelve_map_open(me, p_mode, mp.region, mp.no)
    and (select count(*) from public.twelve_keys k where k.user_id = me and k.mode = p_mode) < 12 then raise exception 'need keys'; end if;
  if not public._twelve_map_open(me, p_mode, mp.region, mp.no) then raise exception 'map locked'; end if;
  perform public._twelve_check_hero(me, p_hero);
  if pr.eq_weapon is null then raise exception 'no weapon'; end if;
  select coalesce(max(t.coin_pct), 0) into v_pct from public.twelve_items i join public._twelve_items() t on t.base = i.base
  where i.user_id = me and i.id = pr.eq_acc;
  v_seed := floor(random() * 2147483647)::int;
  insert into public.twelve_runs (user_id, map_id, mode, hero, seed, level, coin_pct)
  values (me, p_map, p_mode, p_hero, v_seed, pr.level, v_pct) returning id into rid;
  return jsonb_build_object('run', rid, 'seed', v_seed);
end $$;
revoke all on function public.twelve_start(text, text, text) from public, anon;
grant execute on function public.twelve_start(text, text, text) to authenticated;

-- ---------- 3. 맵 끝내기 (078 의 twelve_finish 를 다시 정의) ----------
-- 바뀐 것: 보스의 선물 — 대원 12종이 9지형 보스까지에서 다 모이므로, 10~12지형 보스를 (모드마다) 처음 잡으면
-- 합류 대신 강화석 꾸러미를 준다 (_twelve_const('boss_gift_<지형>')). 결과에 'gift' 가 더해졌다.
-- 최종보스(맵 표의 9번째 줄)를 처음 잡으면 _twelve_const('boss_gift_final'). 그 밖에는 078 과 같다.

create or replace function public.twelve_finish(p_run uuid, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  rn public.twelve_runs;
  pr public.twelve_profiles;
  mp record;
  rg record;
  v_time int; v_cleared boolean; v_elites int; v_boss boolean; v_chest boolean; v_deaths int;
  v_kills jsonb; v_used jsonb;
  k text; v jsonb; n numeric;
  normals int := 0;
  raw_exp bigint := 0; raw_coin bigint := 0;
  pct int; n_exp bigint; n_coins bigint;
  lv int; ex bigint; nd bigint; ups int := 0;
  elapsed numeric;
  pots int[]; used int[]; got_pots int[] := array[0, 0, 0, 0, 0, 0];
  n_stars int := 0; old_stars int := 0; new_stars int := 0; first boolean := false;
  pe int := 0; pb int := 0; pk int := 0; has_key boolean := false; got_key boolean := false;
  codex text[]; rare_list text[]; gear text[]; accs text[];
  base text; items jsonb := '[]'::jsonb; n_stones int := 0;
  star_item text; joined text; got_coin boolean := false; n_gift int := 0;
  seed bigint; r bigint; i int; idx int; cap int; pity boolean;
begin
  if me is null or not exists (select 1 from public.profiles where id = me) then raise exception 'need login'; end if;
  select * into rn from public.twelve_runs where id = p_run for update;
  if not found or rn.user_id <> me then raise exception 'no run'; end if;
  if rn.finished_at is not null then raise exception 'already finished'; end if;
  select * into mp from public._twelve_maps() t where t.map_id = rn.map_id and t.mode = rn.mode;
  if not found then raise exception 'bad map'; end if;

  -- 1) 보고 읽기 · 검사 (src/game/progress.ts 의 checkReport)
  begin
    v_time := (p_report ->> 'time')::int;
    v_cleared := (p_report ->> 'cleared')::boolean;
    v_elites := (p_report ->> 'elites')::int;
    v_boss := (p_report ->> 'boss')::boolean;
    v_chest := (p_report ->> 'chest')::boolean;
    v_deaths := (p_report ->> 'deaths')::int;
  exception when others then raise exception 'bad result';
  end;
  if v_time is null or v_cleared is null or v_elites is null or v_boss is null or v_chest is null or v_deaths is null then raise exception 'bad result'; end if;
  if v_time < 0 or v_time > public._twelve_const('max_time') then raise exception 'bad time'; end if;
  v_kills := coalesce(p_report -> 'kills', '{}'::jsonb);
  if jsonb_typeof(v_kills) <> 'object' then raise exception 'bad kills'; end if;
  for k, v in select key, value from jsonb_each(v_kills) loop
    if not (mp.kinds ? k) or jsonb_typeof(v) <> 'number' then raise exception 'bad kills'; end if;
    n := v::text::numeric;
    if n <> floor(n) or n < 0 or n > (mp.kinds -> k ->> 0)::int then raise exception 'bad kills'; end if;
    normals := normals + n::int;
    raw_exp := raw_exp + n::int * (mp.kinds -> k ->> 1)::int;
    raw_coin := raw_coin + n::int * (mp.kinds -> k ->> 2)::int;
  end loop;
  if v_elites < 0 or v_elites > mp.elites then raise exception 'bad kills'; end if;
  if v_boss and not mp.boss then raise exception 'bad kills'; end if;
  if v_deaths < 0 then raise exception 'bad result'; end if;
  cap := public._twelve_const('potion_max')::int;
  v_used := p_report -> 'potions';
  if v_used is null or jsonb_typeof(v_used) = 'null' then
    used := array[0, 0, 0, 0, 0, 0];
  else
    if jsonb_typeof(v_used) <> 'array' or jsonb_array_length(v_used) <> 2
      or jsonb_typeof(v_used -> 0) <> 'array' or jsonb_array_length(v_used -> 0) <> 3
      or jsonb_typeof(v_used -> 1) <> 'array' or jsonb_array_length(v_used -> 1) <> 3 then raise exception 'bad potions'; end if;
    if exists (
      select 1 from jsonb_array_elements(v_used) a, jsonb_array_elements(a) e
      where jsonb_typeof(e) <> 'number' or e::text::numeric <> floor(e::text::numeric) or e::text::numeric < 0 or e::text::numeric > cap
    ) then raise exception 'bad potions'; end if;
    select array_agg((e.value)::text::int order by a.ord, e.ord) into used
    from jsonb_array_elements(v_used) with ordinality a(value, ord), jsonb_array_elements(a.value) with ordinality e(value, ord);
  end if;
  if v_cleared then
    if v_time < public._twelve_const('clear_min_time') then raise exception 'too early'; end if;
    -- 출구가 열리는 조건: 보스 맵은 보스, 그 밖에는 요괴의 exit_pct%
    if (mp.boss and not v_boss) or (not mp.boss and normals + v_elites < ceil(mp.total * public._twelve_const('exit_pct') / 100.0)) then raise exception 'bad result'; end if;
  end if;
  elapsed := extract(epoch from (now() - rn.started_at));
  if elapsed < v_time - public._twelve_const('time_slack') then raise exception 'too early'; end if;
  if elapsed > public._twelve_const('max_age') then raise exception 'too late'; end if;
  if exists (
    select 1 from public.twelve_runs o
    where o.user_id = me and o.id <> rn.id and o.finished_at is not null
      and o.finished_at > rn.started_at + interval '2 seconds' and o.started_at < now() - interval '2 seconds'
  ) then raise exception 'overlap'; end if;

  -- 2) 경험치 · 엽전 (맵 표로 계산. src/game/progress.ts 의 rewardOf · applyReport)
  raw_exp := raw_exp + v_elites * mp.elite_exp + (case when v_boss then mp.boss_exp else 0 end);
  raw_coin := raw_coin + v_elites * mp.elite_coin + (case when v_boss then mp.boss_coin else 0 end) + (case when v_chest then mp.chest_coin else 0 end);
  pr := public._twelve_profile_row(me);
  select e.pct into pct from public._twelve_exp_penalty() e where pr.level - mp.level >= e.gap order by e.gap desc limit 1;
  n_exp := floor(raw_exp * coalesce(pct, 100) / 100.0);
  n_coins := case when v_cleared then floor(raw_coin * (100 + rn.coin_pct) / 100.0) else 0 end;
  lv := pr.level;
  ex := pr.exp + n_exp;
  while lv < public._twelve_const('max_level') loop
    select t.need into nd from public._twelve_levels() t where t.level = lv;
    exit when nd is null or ex < nd;
    ex := ex - nd;
    lv := lv + 1;
    ups := ups + 1;
  end loop;
  if lv >= public._twelve_const('max_level') then ex := 0; end if;
  -- 쓴 물약은 깨든 쓰러지든 빠진다
  select array_agg((e.value)::text::int order by a.ord, e.ord) into pots
  from jsonb_array_elements(pr.potions) with ordinality a(value, ord), jsonb_array_elements(a.value) with ordinality e(value, ord);
  for i in 1..6 loop pots[i] := greatest(0, pots[i] - used[i]); end loop;

  -- 3) 깬 판만: 맵 기록 · 드랍 · 확정 보정 · 열쇠 · 별 보상 · 대원 합류 (쓰러지면 그 맵의 엽전·아이템을 잃는다)
  if v_cleared then
    n_stars := (case when v_time <= mp.par then 1 else 0 end) | (case when v_deaths = 0 then 2 else 0 end) | (case when v_chest then 4 else 0 end);
    select m.stars into old_stars from public.twelve_maps m where m.user_id = me and m.mode = rn.mode and m.map_id = rn.map_id;
    first := old_stars is null;
    old_stars := coalesce(old_stars, 0);
    new_stars := n_stars & ~old_stars;
    -- 대원 합류: 이 지형 보스를 어느 모드에서든 처음 잡았다
    if mp.boss and first and not public._twelve_joined(me, mp.region) then
      select h.id into joined from public._twelve_heroes() h where h.join_region = mp.region;
    end if;
    -- 보스의 선물 (089): 대원이 합류하지 않는 지형(10~12)의 보스 · 최종보스를 이 모드에서 처음 잡으면 강화석 꾸러미 (src/data/economy.ts 의 BOSS_GIFT · FINAL_GIFT)
    if mp.boss and v_boss and first then
      n_gift := coalesce(public._twelve_const('boss_gift_' || case when mp.no > 8 then 'final' else mp.region::text end), 0)::int;
      n_stones := n_stones + n_gift;
    end if;
    insert into public.twelve_maps (user_id, mode, map_id, stars, clears, best) values (me, rn.mode, rn.map_id, n_stars, 1, v_time)
    on conflict (user_id, mode, map_id) do update set stars = public.twelve_maps.stars | excluded.stars, clears = public.twelve_maps.clears + 1,
      best = case when public.twelve_maps.best > 0 then least(public.twelve_maps.best, excluded.best) else excluded.best end;

    -- 드랍 (src/game/drops.ts 의 rollRun): 일반 요괴 → 정예 → 보스. 판정 종류 번호는 drops.ts 의 TAG 와 같다
    select * into rg from public._twelve_regions() t where t.mode = rn.mode and t.region = mp.region;
    seed := rn.seed;
    gear := public._twelve_gear();
    accs := public._twelve_acc();
    rare_list := rg.rares;
    select t.elite, t.boss, t.key into pe, pb, pk from public.twelve_pity t where t.user_id = me and t.mode = rn.mode and t.region = mp.region;
    pe := coalesce(pe, 0); pb := coalesce(pb, 0); pk := coalesce(pk, 0);
    select coalesce(array_agg(c.base), array[]::text[]) into codex from public.twelve_codex c where c.user_id = me;
    has_key := exists (select 1 from public.twelve_keys t where t.user_id = me and t.mode = rn.mode and t.region = mp.region);

    for i in 1..normals loop
      r := public._twelve_roll(seed, 1, i) % 10000;
      if r < public._twelve_const('drop_potion') then
        idx := (public._twelve_roll(seed, 2, i) % 2)::int * 3 + rg.potion_size + 1;
        if pots[idx] < cap then
          pots[idx] := pots[idx] + 1;
          got_pots[idx] := got_pots[idx] + 1;
        end if;
      elsif r < public._twelve_const('drop_potion') + public._twelve_const('drop_gear') then
        base := gear[(public._twelve_roll(seed, 2, i) % array_length(gear, 1))::int + 1] || rg.tier::text;
        items := items || public._twelve_grant(me, base);
      end if;
    end loop;

    for i in 1..v_elites loop
      if public._twelve_roll(seed, 3, i) % 10000 < public._twelve_const('drop_elite_stone') then n_stones := n_stones + rg.elite_stones; end if;
      if public._twelve_roll(seed, 4, i) % 10000 < public._twelve_const('drop_elite_acc') then
        base := 'c-' || accs[(public._twelve_roll(seed, 5, i) % array_length(accs, 1))::int + 1] || '-' || rg.tier::text;
        items := items || public._twelve_grant(me, base);
      end if;
      pe := pe + 1;
      base := null;
      if public._twelve_roll(seed, 6, i) % 10000 < public._twelve_const('drop_elite_rare') then pity := false;
      elsif pe >= public._twelve_const('pity_elite') then pity := true;
      else pity := null;
      end if;
      if pity is not null then
        -- 확정 보정은 아직 없는 것부터, 확률로 나온 것(또는 다 가졌으면)은 목록에서 아무거나
        if pity then select x into base from unnest(rare_list) with ordinality u(x, ord) where not (x = any(codex)) order by ord limit 1; end if;
        base := coalesce(base, rare_list[(public._twelve_roll(seed, 7, i) % array_length(rare_list, 1))::int + 1]);
        if not (base = any(codex)) then codex := codex || base; end if;
        pe := 0; pb := 0;
        items := items || public._twelve_grant(me, base);
      end if;
    end loop;

    if v_boss then
      n_stones := n_stones + rg.boss_stones;
      if public._twelve_roll(seed, 8, 1) % 10000 < public._twelve_const('drop_boss_acc') then
        base := 'c-' || accs[(public._twelve_roll(seed, 9, 1) % array_length(accs, 1))::int + 1] || '-' || rg.tier::text;
        items := items || public._twelve_grant(me, base);
      end if;
      pb := pb + 1;
      base := null;
      if public._twelve_roll(seed, 10, 1) % 10000 < public._twelve_const('drop_boss_rare') then pity := false;
      elsif pb >= public._twelve_const('pity_boss') then pity := true;
      else pity := null;
      end if;
      if pity is not null then
        if pity then select x into base from unnest(rare_list) with ordinality u(x, ord) where not (x = any(codex)) order by ord limit 1; end if;
        base := coalesce(base, rare_list[(public._twelve_roll(seed, 11, 1) % array_length(rare_list, 1))::int + 1]);
        if not (base = any(codex)) then codex := codex || base; end if;
        pe := 0; pb := 0;
        items := items || public._twelve_grant(me, base);
      end if;
      -- 열쇠: 확률, 같은 보스 pity_key 번째에는 확정. 이미 있으면 떨어지지 않는다
      if not has_key then
        pk := pk + 1;
        if public._twelve_roll(seed, 12, 1) % 10000 < public._twelve_const('drop_key') or pk >= public._twelve_const('pity_key') then
          got_key := true;
          pk := 0;
          insert into public.twelve_keys (user_id, mode, region) values (me, rn.mode, mp.region) on conflict do nothing;
        end if;
      end if;
    end if;

    insert into public.twelve_pity (user_id, mode, region, elite, boss, key) values (me, rn.mode, mp.region, pe, pb, pk)
    on conflict (user_id, mode, region) do update set elite = excluded.elite, boss = excluded.boss, key = excluded.key;

    -- 지형의 별 24개를 모두 모으면 그 지형 장신구 (모드마다 한 번)
    if not (rg.star_item = any(codex)) and (
      select coalesce(sum((m.stars & 1) + ((m.stars >> 1) & 1) + ((m.stars >> 2) & 1)), 0) from public.twelve_maps m
      where m.user_id = me and m.mode = rn.mode and m.map_id like mp.region::text || '-%'
    ) >= 24 then
      star_item := rg.star_item;
      codex := codex || star_item;
      items := items || public._twelve_grant(me, star_item);
    end if;
    insert into public.twelve_codex (user_id, base) select me, x from unnest(codex) x on conflict do nothing;

    -- 시아코인: 깬 맵마다 1. 너무 짧은 판, 내 레벨이 권장 레벨보다 coin_level_gap 이상 높은 맵은 없음 (중복·15초·하루 한도는 _grant_sia_coin 안에서)
    if v_time >= public._twelve_const('coin_min_time') and pr.level - mp.level < public._twelve_const('coin_level_gap') then
      got_coin := public._grant_sia_coin(me, 'twelve', p_run::text);
    end if;
  end if;

  update public.twelve_profiles set
    level = lv, exp = ex, coins = coins + n_coins, stones = stones + n_stones,
    potions = jsonb_build_array(jsonb_build_array(pots[1], pots[2], pots[3]), jsonb_build_array(pots[4], pots[5], pots[6])),
    cleared_maps = (select count(*) from public.twelve_maps m where m.user_id = me),
    level_at = case when lv <> pr.level then now() else level_at end,
    updated_at = now()
  where user_id = me;
  update public.twelve_runs set finished_at = now(), time = v_time, cleared = v_cleared, exp = n_exp, coins = n_coins, report = p_report where id = rn.id;

  return jsonb_build_object(
    'state', public._twelve_state_json(me),
    'result', jsonb_build_object(
      'exp', n_exp, 'coins', n_coins, 'ups', ups, 'level', lv, 'stars', n_stars, 'newStars', new_stars, 'first', first,
      'joined', joined, 'gift', n_gift, 'siaCoin', got_coin, 'items', items, 'stones', n_stones,
      'potions', jsonb_build_array(jsonb_build_array(got_pots[1], got_pots[2], got_pots[3]), jsonb_build_array(got_pots[4], got_pots[5], got_pots[6])),
      'key', got_key, 'starItem', star_item
    )
  );
end $$;
revoke all on function public.twelve_finish(uuid, jsonb) from public, anon;
grant execute on function public.twelve_finish(uuid, jsonb) to authenticated;
