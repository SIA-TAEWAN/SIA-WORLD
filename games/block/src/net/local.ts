const loc = typeof location !== 'undefined' ? location : null;
const params = new URLSearchParams(loc?.search ?? '');
/** 테스트 모드(?local=1): 개발 서버·내 컴퓨터에서만 로그인 없이, 기록은 이 기기에만 (&seed=123 이면 같은 조각 순서) */
export const LOCAL_MODE = !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));
/** 시험용 고정 시드 (테스트 모드에서만) */
export const LOCAL_SEED = LOCAL_MODE && params.get('seed') ? Number(params.get('seed')) || 0 : null;
