const loc = typeof location !== 'undefined' ? location : null;
const params = new URLSearchParams(loc?.search ?? '');
/** 테스트 모드(?local=1): 개발 서버·내 컴퓨터에서만 로그인 없이, 기록은 이 기기에만 (&all=1 이면 모두 열림) */
export const LOCAL_MODE = !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));
