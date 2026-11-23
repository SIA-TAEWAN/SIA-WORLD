import type { ResId } from './balance';
import type { BuildingType } from './buildings';

/**
 * 주민 (십이지 12명 + 13번째 고양이, PRD 7장). 십이지 id · 순서는 shared/zodiac.js 와 같다. SQL 의 _village_residents 와 같아야 한다 (tests/sql.test.ts).
 * 마을 레벨이 되고 빈 주민 집이 있으면 순서대로 한 명씩 이사 온다.
 *   work 가 있는 주민: 그 건물에 배치하면 보너스 (친밀도 단계마다 커진다)
 *   work 가 '' 인 주민(닭 · 개 · 고양이): 이사 오기만 하면 된다
 * 고양이(buy)는 마을 레벨이 아니라 시아코인으로 산 것이 조건이다 (071 buy_character('village', 'cat'), 살 수 있는 조건은 땅 CAT_LAND_STAGE 단계).
 *   산 뒤 빈 집이 있으면 이사 오고, 주민 집을 하나 더(13채째) 지을 수 있다.
 */
export const RESIDENT_IDS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'sheep', 'monkey', 'rooster', 'dog', 'pig', 'cat'] as const;
export type ResidentId = (typeof RESIDENT_IDS)[number];

export interface ResidentDef {
  id: ResidentId;
  /** 띠 · 캐릭터 이름 (DESIGN.md 6장) */
  name: string;
  nick: string;
  /** 이사 오는 마을 레벨 (buy 인 주민은 0: 산 것이 조건) */
  level: number;
  /** 시아코인으로 사야 이사 오는 주민 (고양이) */
  buy?: boolean;
  /** 일터 ('' = 배치하지 않는다) */
  work: BuildingType | '';
  /** 잘하는 일 (화면 문구. {n} 자리에 보너스 값) */
  skill: string;
  /** 눌렀을 때의 한마디 */
  lines: string[];
}

export const RESIDENTS: ResidentDef[] = [
  { id: 'rat', name: '쥐', nick: '찍찍이', level: 1, work: 'storage', skill: '창고에 배치하면 그 창고의 용량 +{n}%', lines: ['곳간이 가득 차면 마음이 든든해요!', '찍찍! 오늘도 좋은 날이에요'] },
  { id: 'ox', name: '소', nick: '우직이', level: 2, work: 'paddy', skill: '논에 배치하면 그 논의 쌀 +{n}%', lines: ['논일은 저한테 맡기세요', '천천히, 하지만 꾸준히요'] },
  { id: 'tiger', name: '호랑이', nick: '어흥이', level: 3, work: 'lumber', skill: '벌목장에 배치하면 그 벌목장의 나무 +{n}%', lines: ['어흥! 나무쯤이야 한 손으로!', '숲이 저를 부르고 있어요'] },
  { id: 'rabbit', name: '토끼', nick: '깡총이', level: 5, work: 'mill', skill: '방앗간에 배치하면 떡을 {n}% 더 빨리', lines: ['쿵덕쿵덕, 떡방아는 제가 최고예요', '달에서도 떡을 찧었답니다'] },
  { id: 'dragon', name: '용', nick: '여의룡', level: 7, work: 'hall', skill: '마을 회관에 배치하면 짓는 시간 −{n}%', lines: ['여의주의 힘으로 뚝딱!', '마을이 쑥쑥 크는 게 보여요'] },
  { id: 'snake', name: '뱀', nick: '스르르', level: 9, work: 'jar', skill: '장독대에 배치하면 특산품을 {n}% 더 빨리', lines: ['장맛은 기다림이에요, 스르르…', '항아리 곁이 제일 편해요'] },
  { id: 'horse', name: '말', nick: '따각이', level: 11, work: 'market', skill: '장터에 배치하면 하루 판매 한도 +{n}%', lines: ['장터까지 따각따각 달려요!', '짐은 얼마든지 실어 주세요'] },
  { id: 'sheep', name: '양', nick: '몽실이', level: 13, work: 'pavilion', skill: '정자에 배치하면 정자의 힘이 한 칸 더 멀리', lines: ['정자에서 부는 바람이 참 좋아요', '몽실몽실, 다 같이 쉬어 가요'] },
  { id: 'monkey', name: '원숭이', nick: '재롱이', level: 15, work: 'quarry', skill: '채석장에 배치하면 그 채석장의 돌 +{n}%', lines: ['돌산 타기는 제 특기예요!', '끼끼! 반짝이는 돌을 찾았어요'] },
  { id: 'rooster', name: '닭', nick: '꼬꼬댁', level: 18, work: '', skill: '날마다 첫 수확이 {n}% 더 많이 (배치하지 않아도 돼요)', lines: ['꼬끼오! 아침이 밝았어요', '일찍 일어난 새가 쌀을 거둬요'] },
  { id: 'dog', name: '개', nick: '멍뭉이', level: 21, work: '', skill: '건물이 15시간 분량까지 쌓아 둬요 (배치하지 않아도 돼요)', lines: ['제가 밤새 지킬게요, 멍!', '주인님 오실 때까지 기다려요'] },
  { id: 'pig', name: '돼지', nick: '꿀꿀이', level: 24, work: 'market', skill: '장터에 배치하면 파는 값 +{n}%', lines: ['복을 가득 담아 왔어요, 꿀꿀', '좋은 값에 팔아 드릴게요'] },
  { id: 'cat', name: '고양이', nick: '야옹이', level: 0, buy: true, work: '', skill: '은혜 갚는 고양이: 주민 부탁의 엽전 · 경험치 +{n}% (배치하지 않아도 돼요)', lines: ['늦잠 자다 경주는 놓쳤지만, 은혜는 꼭 갚아요', '야옹~ 부탁을 들어주면 제가 더 얹어 드릴게요'] },
];
/** 시아코인으로 사는 주민 (고양이) */
export const CAT_ID = 'cat' satisfies ResidentId;
/** 고양이를 살 수 있는 조건: 땅 넓히기 이 단계 (3 = 14×14). SQL 의 _cat_progress_village 와 같아야 한다 (tests/sql.test.ts) */
export const CAT_LAND_STAGE = 3;
/** 고양이 값 (시아코인). shared/characters.js 의 CHARACTER_PRICE.cat · SQL _character_price 와 같다 */
export const CAT_PRICE = 100;
export const RESIDENT: Record<ResidentId, ResidentDef> = Object.fromEntries(RESIDENTS.map((r) => [r.id, r])) as Record<ResidentId, ResidentDef>;
export const isResidentId = (v: unknown): v is ResidentId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(RESIDENT, v);

/** 친밀도: 단계 n(1 … 5)이 되는 점수 */
export const AFF_NEED = [0, 10, 30, 60, 100];
/** 친밀도 단계별 보너스 (%). 용(짓는 시간)은 따로 */
export const AFF_BONUS = [10, 15, 20, 25, 30];
export const DRAGON_BONUS = [5, 8, 11, 14, 17];
/** 고양이(부탁의 엽전 · 경험치) 친밀도 단계별 보너스 (%). 가장 힘센 주민(말 · 닭)보다 조금 약하게: npm run pace 로 견줌 */
export const CAT_BONUS = [4, 6, 8, 10, 12];
export const affLevel = (points: number) => AFF_NEED.filter((n) => points >= n).length;
/** 생산량을 올리는 주민 (배치 · 친밀도가 바뀌면 그때까지 쌓인 양을 적어 둔다) */
export const RATE_WORKERS: readonly ResidentId[] = ['ox', 'tiger', 'monkey'];

/** 주민 부탁 · 오늘의 할 일의 기준 값 (SQL 의 _village_const 에도 있다) */
export const REQ = {
  /** 부탁 칸 수 */
  slots: 3,
  /** 들어준 뒤 · 넘긴 뒤 새 부탁이 올 때까지 (초) */
  wait_done: 1200,
  wait_skip: 3600,
  /** 사당이 있으면 친밀도를 이만큼(%) 더 */
  shrine_pct: 50,
  /** 개가 있으면 건물이 쌓아 두는 시간 (초): 15시간 */
  dog_cap_sec: 54000,
  /** 양이 정자에 있으면 정자의 둘레가 이만큼 더 */
  sheep_range: 1,
} as const;

/** 부탁에 나오는 자원: 기준 개수, 마을 레벨에 따라 늘어나는 정도(÷20), 나오기 시작하는 마을 레벨, 하나의 값어치(엽전 ×100). SQL 의 _village_asks */
export const ASKS: { res: ResId; base: number; grow: number; from: number; worth: number }[] = [
  { res: 'rice', base: 20, grow: 2, from: 1, worth: 40 },
  { res: 'wood', base: 16, grow: 2, from: 2, worth: 50 },
  { res: 'stone', base: 14, grow: 2, from: 4, worth: 90 },
  { res: 'cake', base: 5, grow: 1, from: 5, worth: 300 },
  { res: 'special', base: 1, grow: 0, from: 8, worth: 4000 },
];

/** 오늘의 할 일의 종류와 나오기 시작하는 마을 레벨. SQL 의 _village_tasks */
export type TaskKind = 'harvest' | 'construct' | 'request' | 'sell' | 'craft';
export const TASKS: { task: TaskKind; from: number; base: number; per: number; text: string }[] = [
  { task: 'harvest', from: 1, base: 6, per: 1, text: '수확 {n}번 하기' },
  { task: 'construct', from: 1, base: 1, per: 0, text: '건물을 짓거나 업그레이드 {n}번 하기' },
  { task: 'request', from: 1, base: 2, per: 0, text: '주민 부탁 {n}번 들어주기' },
  { task: 'sell', from: 3, base: 40, per: 10, text: '장터에서 엽전 {n}닢어치 팔기' },
  { task: 'craft', from: 5, base: 5, per: 1, text: '떡이나 특산품 {n}개 만들기' },
];

/** 무작위처럼 보이지만 정해진 수 (서버와 같은 식): 부탁 · 오늘의 할 일을 고를 때 쓴다 */
export const mix = (seq: number, k: number) => ((((seq * 7919 + k * 104729 + 12345) % 1000003) + 1000003) % 1000003);
