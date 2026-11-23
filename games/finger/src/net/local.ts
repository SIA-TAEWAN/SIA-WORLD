const loc = typeof location !== 'undefined' ? location : null;
const params = new URLSearchParams(loc?.search ?? '');
/** 테스트 모드(?local=1): 개발 서버·내 컴퓨터에서만 로그인 없이 */
export const LOCAL_MODE = !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));
/** 개발용 배속 (?local=1&speed=4). 테스트 모드가 아니면 늘 1 */
export const DEV_SPEED = LOCAL_MODE ? Math.max(1, Math.min(8, Number(params.get('speed')) || 1)) : 1;
/** 개발용 자동 조종 (?local=1&auto=1) */
export const DEV_AUTO = LOCAL_MODE && params.get('auto') === '1';
/** 개발용: 처음부터 모든 것이 열린 프로필 (?local=1&all=1) */
export const DEV_ALL = LOCAL_MODE && params.get('all') === '1';
/** 테스트 모드에서 고양이는 연 것으로 본다. ?local=1&cat=0 이면 잠긴 상태 */
export const DEV_CAT_LOCKED = LOCAL_MODE && params.get('cat') === '0';
