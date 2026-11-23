const loc = typeof location !== 'undefined' ? location : null;
const params = new URLSearchParams(loc?.search ?? '');
/** 테스트 모드(?local=1): 개발 서버·내 컴퓨터에서만 로그인 없이, 기록은 이 기기에만 */
export const LOCAL_MODE = !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));
/** 개발용: 메뉴를 건너뛰고 그 맵으로 (?local=1&map=1-3) */
export const DEV_MAP = LOCAL_MODE ? (params.get('map') ?? '') : '';
/** 개발용: 그 레벨로 본다 (?local=1&lv=50, 저장하지 않음) */
export const DEV_LEVEL = LOCAL_MODE ? Math.max(0, Math.min(99, Math.floor(Number(params.get('lv')) || 0))) : 0;
/** 개발용 무적 (?local=1&god=1) */
export const DEV_GOD = LOCAL_MODE && params.get('god') === '1';
/** 개발용: 모든 맵·대원이 열린 상태로 본다 (?local=1&all=1, 저장하지 않음) */
export const DEV_ALL = LOCAL_MODE && params.get('all') === '1';
/** 개발용: 어려움 모드로 본다 (?local=1&mode=hard, 저장하지 않음 — 보통 모드를 끝낸 것으로 친다) */
export const DEV_MODE = LOCAL_MODE && params.get('mode') === 'hard';
/** 개발용: 대원·무기를 정해서 본다 (?local=1&hero=tiger&weapon=bow) */
export const DEV_HERO = LOCAL_MODE ? (params.get('hero') ?? '') : '';
export const DEV_WEAPON = LOCAL_MODE ? (params.get('weapon') ?? '') : '';
