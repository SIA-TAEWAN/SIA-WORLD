const loc = typeof location !== 'undefined' ? location : null;
const params = new URLSearchParams(loc?.search ?? '');
/** 테스트 모드(?local=1): 개발 서버·내 컴퓨터에서만 로그인 없이, 기록은 이 기기에만 */
export const LOCAL_MODE = !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));
const num = (k: string, min: number, max: number) => (LOCAL_MODE && params.has(k) ? Math.max(min, Math.min(max, Math.floor(Number(params.get(k)) || 0))) : 0);
/** 개발용: 그 층에서 바로 시작 (?local=1&floor=5) */
export const DEV_FLOOR = num('floor', 1, 100);
/** 개발용: 그 레벨로 (?local=1&lv=10) */
export const DEV_LEVEL = num('lv', 1, 99);
/** 개발용 무적 (?local=1&god=1) */
export const DEV_GOD = LOCAL_MODE && params.get('god') === '1';
/** 개발용: 구슬을 갖고 시작 (?local=1&orbs=rat,ox · &awaken=rat,ox) */
export const DEV_ORBS = LOCAL_MODE ? (params.get('orbs') ?? '').split(',').filter(Boolean) : [];
export const DEV_AWAKEN = LOCAL_MODE ? (params.get('awaken') ?? '').split(',').filter(Boolean) : [];
/** 개발용: 엽전·조각 (?local=1&coins=1000&shards=5) */
export const DEV_COINS = num('coins', 0, 1e7);
export const DEV_SHARDS = num('shards', 0, 999);
/** 개발용: 엔딩 화면 (탑을 다 오른 상태로 — ?local=1&ending=1) */
export const DEV_ENDING = LOCAL_MODE && params.get('ending') === '1';
/** 개발용: 기기에 저장한 테스트 기록을 지우고 처음부터 (?local=1&reset=1 — 캐릭터 만들기부터) */
export const DEV_RESET = LOCAL_MODE && params.get('reset') === '1';
