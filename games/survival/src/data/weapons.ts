/**
 * 무기 (PRD 4장). 무기마다 "동작 종류(kind)" 와 레벨별 수치만 적는다.
 * 동작 종류의 실제 움직임은 src/game/weapons.ts 의 BEHAVIORS 에 등록한다.
 * 새 무기 = 여기에 한 항목 + (새 동작이면) BEHAVIORS 에 작은 함수 하나.
 */

/** 레벨 한 줄. 동작 종류마다 쓰는 값이 다르다 (안 쓰는 값은 비워 둔다) */
export interface WeaponLevel {
  /** 한 번 맞을 때 피해 */
  dmg: number;
  /** 재사용 대기시간 (장판은 피해 간격) */
  cd: number;
  /** 한 번에 나가는 수 (표창·달떡·구슬·독 지대·황금 복돼지) */
  count?: number;
  /** 뚫고 지나가는 적 수 (0이면 처음 맞은 적에서 사라짐) */
  pierce?: number;
  /** 투사체 속도 */
  speed?: number;
  /** 투사체 반지름 (여의봉은 굵기) */
  size?: number;
  /** 투사체가 사라지기까지 (초) */
  life?: number;
  /** 범위 반지름 (장판·폭발·독 지대·구슬이 도는 거리) */
  radius?: number;
  /** 닿는 거리 (발톱), 던지는 거리 (달떡·독안개) */
  range?: number;
  /** 부채꼴 각도 (도) */
  arc?: number;
  /** 유지 시간 (구슬·독 지대) */
  dur?: number;
  /** 같은 적을 다시 때리기까지 (초) */
  every?: number;
  /** 도는 빠르기 (라디안/초) */
  spin?: number;
  /** 카드에 적는 설명 */
  text: string;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** 임시 아이콘 (정식 그림은 ASSETS.md) */
  icon: string;
  desc: string;
  /** 동작 종류 (src/game/weapons.ts 의 BEHAVIORS 열쇠) */
  kind: string;
  /** 지속 피해 무기인가 (뱀의 '지속 피해 +10%' 대상) */
  dot?: boolean;
  /** 진화 무기인가 (레벨업 카드에 나오지 않고 보물상자로만 얻는다) */
  evolved?: boolean;
  /** 동작까지 만들어졌나 */
  ready: boolean;
  /** 레벨 1~5 (진화 무기는 한 줄) */
  levels: WeaponLevel[];
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'shuriken', name: '표창', icon: '✴️', desc: '가까운 적에게 날아간다', kind: 'seek', ready: true,
    levels: [
      { dmg: 17, cd: 0.42, count: 1, pierce: 0, speed: 540, size: 10, life: 1.3, text: '가까운 적에게 표창을 던진다' },
      { dmg: 24.5, cd: 0.42, count: 1, pierce: 0, speed: 540, size: 10, life: 1.3, text: '더 아프게' },
      { dmg: 18, cd: 0.42, count: 2, pierce: 0, speed: 560, size: 10, life: 1.3, text: '표창 1개 더 (하나하나는 조금 약하게)' },
      { dmg: 24, cd: 0.38, count: 2, pierce: 0, speed: 560, size: 11, life: 1.3, text: '더 아프게, 조금 더 빨리' },
      { dmg: 23, cd: 0.38, count: 3, pierce: 0, speed: 580, size: 11, life: 1.3, text: '표창 1개 더' },
    ],
  },
  {
    id: 'bell', name: '방울', icon: '🔔', desc: '주변에 피해 장판을 두른다', kind: 'aura', dot: true, ready: true,
    levels: [
      { dmg: 3.45, cd: 0.5, radius: 120, text: '내 주변의 적이 계속 피해를 입는다' },
      { dmg: 3.6, cd: 0.5, radius: 130, text: '장판이 넓어진다' },
      { dmg: 5.1, cd: 0.48, radius: 130, text: '더 아프게' },
      { dmg: 5.5, cd: 0.46, radius: 145, text: '장판이 더 넓어진다' },
      { dmg: 6.1, cd: 0.44, radius: 160, text: '더 아프고 더 넓게' },
    ],
  },
  {
    id: 'claw', name: '발톱', icon: '🐾', desc: '앞쪽을 부채꼴로 벤다', kind: 'cone', ready: true,
    levels: [
      { dmg: 13.5, cd: 0.9, range: 130, arc: 115, text: '앞쪽을 부채꼴로 벤다' },
      { dmg: 18.5, cd: 0.9, range: 136, arc: 115, text: '더 아프게' },
      { dmg: 17, cd: 0.86, range: 152, arc: 135, text: '더 넓고 길게 벤다' },
      { dmg: 19.5, cd: 0.78, range: 156, arc: 135, text: '더 아프게, 더 자주' },
      { dmg: 20, cd: 0.74, range: 172, arc: 155, text: '더 넓고 길게 벤다' },
    ],
  },
  {
    id: 'mooncake', name: '달떡', icon: '🌕', desc: '포물선으로 던져 터뜨린다', kind: 'lob', ready: true,
    levels: [
      { dmg: 12, cd: 1.15, count: 1, radius: 74, range: 300, text: '달떡을 던져 떨어진 자리를 터뜨린다' },
      { dmg: 17, cd: 1.15, count: 1, radius: 76, range: 300, text: '더 아프게' },
      { dmg: 14, cd: 1.3, count: 2, radius: 76, range: 310, text: '달떡 1개 더 (조금 천천히)' },
      { dmg: 15, cd: 1.3, count: 2, radius: 90, range: 320, text: '더 크게 터진다' },
      { dmg: 15.5, cd: 1.4, count: 3, radius: 90, range: 330, text: '달떡 1개 더' },
    ],
  },
  {
    id: 'pearl', name: '여의주', icon: '🔮', desc: '내 주위를 쉬지 않고 도는 구슬', kind: 'orbit', ready: true,
    levels: [
      { dmg: 9.1, cd: 4, dur: 4, count: 2, radius: 98, every: 0.4, spin: 3.4, size: 14, text: '구슬 2개가 내 주위를 돈다' },
      { dmg: 8.8, cd: 4, dur: 4, count: 3, radius: 98, every: 0.4, spin: 3.4, size: 14, text: '구슬 1개 더' },
      { dmg: 11.2, cd: 4, dur: 4, count: 3, radius: 104, every: 0.4, spin: 3.6, size: 15, text: '더 아프고 더 넓게 돈다' },
      { dmg: 12.2, cd: 4, dur: 4, count: 4, radius: 104, every: 0.4, spin: 3.6, size: 15, text: '구슬 1개 더' },
      { dmg: 13.7, cd: 4, dur: 4, count: 5, radius: 116, every: 0.38, spin: 3.8, size: 16, text: '구슬 1개 더, 더 넓게 돈다' },
    ],
  },
  {
    id: 'mist', name: '독안개', icon: '☁️', desc: '바닥에 독 지대를 깐다', kind: 'pool', dot: true, ready: true,
    levels: [
      { dmg: 4.5, cd: 2.6, dur: 3.0, every: 0.5, count: 1, radius: 78, range: 280, text: '적이 있는 바닥에 독 지대를 깐다' },
      { dmg: 6.5, cd: 2.6, dur: 3.0, every: 0.5, count: 1, radius: 78, range: 280, text: '더 아프게' },
      { dmg: 6.5, cd: 3.6, dur: 3.0, every: 0.5, count: 2, radius: 80, range: 300, text: '독 지대 1개 더 (조금 천천히)' },
      { dmg: 7, cd: 3.4, dur: 3.5, every: 0.5, count: 2, radius: 84, range: 300, text: '더 아프고 더 오래 남는다' },
      { dmg: 7, cd: 3.6, dur: 3.5, every: 0.5, count: 3, radius: 86, range: 320, text: '독 지대 1개 더' },
    ],
  },

  // ───── 진화 무기 (data/evolutions.ts) ─────
  {
    id: 'shurikenEvo', name: '천병만마 표창', icon: '🌟', desc: '수많은 표창이 적을 모두 뚫고 지나간다', kind: 'seek', evolved: true, ready: true,
    levels: [{ dmg: 14, cd: 0.34, count: 5, pierce: 99, speed: 660, size: 13, life: 1.5, text: '표창 5개가 적을 모두 뚫는다' }],
  },
  {
    id: 'pearlEvo', name: '용왕의 구슬', icon: '🐉', desc: '큰 구슬 6개가 쉬지 않고 돈다', kind: 'orbit', evolved: true, ready: true,
    levels: [{ dmg: 20, cd: 4, dur: 4, count: 6, radius: 132, every: 0.3, spin: 4.2, size: 20, text: '큰 구슬 6개가 쉬지 않고 돈다' }],
  },
  {
    id: 'clawEvo', name: '백호의 발톱', icon: '🐯', desc: '사방을 한꺼번에 벤다', kind: 'cone', evolved: true, ready: true,
    levels: [{ dmg: 20, cd: 0.8, range: 180, arc: 360, text: '사방을 한꺼번에 벤다' }],
  },

  // ───── 나머지 캐릭터 6종의 시작 무기 ─────
  {
    id: 'hoof', name: '말발굽', icon: '🐴', desc: '지나간 자리에 충격파를 남긴다', kind: 'trail', ready: true,
    levels: [
      { dmg: 6.4, cd: 0.7, radius: 92, text: '내가 지나간 자리에 충격파가 터진다' },
      { dmg: 9, cd: 0.7, radius: 96, text: '더 아프게' },
      { dmg: 9.9, cd: 0.62, radius: 108, text: '더 넓게, 더 자주' },
      { dmg: 12.7, cd: 0.56, radius: 114, text: '더 아프게, 더 자주' },
      { dmg: 13.5, cd: 0.5, radius: 124, text: '더 아프고 더 넓게' },
    ],
  },
  {
    id: 'wool', name: '양털 구름', icon: '🐑', desc: '구름으로 적을 느리게 한다', kind: 'slowCloud', dot: true, ready: true,
    levels: [
      { dmg: 3.35, cd: 2.8, dur: 3.2, every: 0.5, count: 1, radius: 86, range: 280, text: '적이 있는 곳에 구름을 띄운다. 구름 속의 적은 느려진다' },
      { dmg: 4.6, cd: 2.8, dur: 3.2, every: 0.5, count: 1, radius: 90, range: 280, text: '더 아프게' },
      { dmg: 4.6, cd: 3.9, dur: 3.2, every: 0.5, count: 2, radius: 90, range: 300, text: '구름 1개 더 (조금 천천히)' },
      { dmg: 5.2, cd: 3.7, dur: 3.6, every: 0.5, count: 2, radius: 96, range: 300, text: '더 아프고 더 오래 남는다' },
      { dmg: 5.4, cd: 3.9, dur: 3.6, every: 0.5, count: 3, radius: 98, range: 320, text: '구름 1개 더' },
    ],
  },
  {
    id: 'staff', name: '여의봉', icon: '🐵', desc: '곧게 뻗어 적을 모두 꿰뚫는다', kind: 'lance', ready: true,
    levels: [
      { dmg: 12.6, cd: 1.0, range: 250, size: 44, text: '겨눈 쪽으로 여의봉이 길게 뻗는다' },
      { dmg: 18.3, cd: 1.0, range: 260, size: 46, text: '더 아프게' },
      { dmg: 18.8, cd: 0.92, range: 300, size: 54, text: '더 길고 굵게' },
      { dmg: 24.7, cd: 0.82, range: 310, size: 58, text: '더 아프게, 더 자주' },
      { dmg: 30, cd: 0.76, range: 340, size: 66, text: '더 길고 굵게' },
    ],
  },
  {
    id: 'feather', name: '깃털', icon: '🪶', desc: '여러 방향으로 한꺼번에 쏜다', kind: 'radial', ready: true,
    levels: [
      { dmg: 8.3, cd: 0.9, count: 5, pierce: 0, speed: 420, size: 9, life: 1.1, text: '깃털 5개를 사방으로 쏜다' },
      { dmg: 12, cd: 0.9, count: 5, pierce: 0, speed: 420, size: 9, life: 1.1, text: '더 아프게' },
      { dmg: 13, cd: 0.9, count: 7, pierce: 0, speed: 440, size: 9, life: 1.1, text: '깃털 2개 더' },
      { dmg: 16.6, cd: 0.8, count: 7, pierce: 0, speed: 440, size: 10, life: 1.1, text: '더 아프게, 더 자주' },
      { dmg: 18.3, cd: 0.8, count: 9, pierce: 0, speed: 460, size: 10, life: 1.1, text: '깃털 2개 더' },
    ],
  },
  {
    id: 'puppy', name: '동료 강아지', icon: '🐶', desc: '적을 쫓아가 무는 소환수', kind: 'minion', ready: true,
    levels: [
      { dmg: 12.5, cd: 1, count: 1, speed: 300, size: 16, every: 0.4, text: '강아지 한 마리가 적을 쫓아가 문다' },
      { dmg: 16.2, cd: 1, count: 1, speed: 310, size: 16, every: 0.4, text: '더 아프게' },
      { dmg: 11.9, cd: 1, count: 2, speed: 320, size: 16, every: 0.4, text: '강아지 1마리 더 (한 마리는 조금 약하게)' },
      { dmg: 16.7, cd: 1, count: 2, speed: 330, size: 17, every: 0.38, text: '더 아프게' },
      { dmg: 16.9, cd: 1, count: 3, speed: 340, size: 17, every: 0.4, text: '강아지 1마리 더' },
    ],
  },
  {
    id: 'piggy', name: '복돼지 돌진', icon: '🐷', desc: '일정 간격으로 돌진해 부딪친다', kind: 'dash', ready: true,
    levels: [
      { dmg: 14.4, cd: 1.5, speed: 620, size: 30, life: 0.6, text: '복돼지가 겨눈 쪽으로 돌진해 닿는 적을 모두 친다' },
      { dmg: 19.3, cd: 1.5, speed: 620, size: 32, life: 0.6, text: '더 아프게' },
      { dmg: 24.4, cd: 1.35, speed: 660, size: 38, life: 0.62, text: '더 크게, 더 자주' },
      { dmg: 29, cd: 1.2, speed: 680, size: 40, life: 0.64, text: '더 아프게, 더 자주' },
      { dmg: 32.8, cd: 1.1, speed: 700, size: 46, life: 0.66, text: '더 크고 더 아프게' },
    ],
  },

  // ───── 진화 무기 2차 (data/evolutions.ts). 서버 도감 목록에는 093_survival_codex_evo.sql 에서 들어갔다 ─────
  {
    id: 'bellEvo', name: '수호의 범종', icon: '🛎️', desc: '넓고 묵직한 종소리가 쉬지 않고 울린다', kind: 'aura', dot: true, evolved: true, ready: true,
    levels: [{ dmg: 8.6, cd: 0.4, radius: 200, text: '넓고 묵직한 종소리가 쉬지 않고 울린다' }],
  },
  {
    id: 'mooncakeEvo', name: '한가위 보름달떡', icon: '🌝', desc: '보름달떡 다섯 개가 크게 터진다', kind: 'lob', evolved: true, ready: true,
    levels: [{ dmg: 16.5, cd: 1.4, count: 5, radius: 120, range: 340, text: '보름달떡 5개가 크게 터진다' }],
  },
  {
    id: 'hoofEvo', name: '천리마의 발굽', icon: '🏇', desc: '지나간 자리마다 큰 충격파가 잇달아 터진다', kind: 'trail', evolved: true, ready: true,
    levels: [{ dmg: 14, cd: 0.42, radius: 165, text: '지나간 자리마다 큰 충격파가 잇달아 터진다' }],
  },
  {
    id: 'piggyEvo', name: '황금 복돼지', icon: '🐖', desc: '황금 복돼지 세 마리가 한꺼번에 돌진한다', kind: 'dash', evolved: true, ready: true,
    levels: [{ dmg: 26, cd: 1.0, count: 3, speed: 720, size: 50, life: 0.7, text: '황금 복돼지 3마리가 한꺼번에 돌진한다' }],
  },
];

export const WEAPON_INDEX: Record<string, number> = Object.fromEntries(WEAPONS.map((w, i) => [w.id, i]));
/** 준비되지 않은 무기를 가진 캐릭터가 대신 들고 시작하는 무기 (지금은 12종 모두 준비돼 있어 쓰이지 않는다) */
export const FALLBACK_WEAPON = 'shuriken';

/**
 * 서버 도감 목록(_survival_codex_ids — 최신 정의는 093)에 아직 없는 무기. 서버는 모르는 id 를 버리므로 서버 도감에는 적히지 않고,
 * 도감 화면은 이 기기에서 만들어 본 기록(net/made.ts)으로 보여 준다. 지금은 없다: 진화 2차 4종은 093 에서 서버 목록에 들어갔다.
 * 새 무기를 서버 목록보다 먼저 내야 할 때만 여기에 적고, 목록에 넣는 마이그레이션이 나가면 뺀다 (tests/sql.test.ts 가 맞춰 본다).
 */
export const DEVICE_CODEX: readonly string[] = [];
/** 서버 도감에 적히는 무기 id (서버 목록과 같은 순서) */
export const SERVER_CODEX_WEAPONS: string[] = WEAPONS.map((w) => w.id).filter((id) => !DEVICE_CODEX.includes(id));
