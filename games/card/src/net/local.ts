const loc = typeof location !== 'undefined' ? location : null;
const params = new URLSearchParams(loc?.search ?? '');
/** 테스트 모드(?local=1): 개발 서버·내 컴퓨터에서만 로그인 없이, 기록은 이 기기에만 */
export const LOCAL_MODE = !!loc && params.get('local') === '1' && (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(loc.hostname));
const str = (k: string) => (LOCAL_MODE ? (params.get(k) ?? '') : '');
/** 개발용: 판 씨앗 (?local=1&seed=123) */
export const DEV_SEED = LOCAL_MODE && params.has('seed') ? Math.floor(Number(params.get('seed')) || 0) >>> 0 : null;
/** 개발용: 바로 이 요괴들과 전투 (?local=1&foes=fox,acorn · &kind=boss) */
export const DEV_FOES = str('foes').split(',').filter(Boolean);
export const DEV_KIND = (['battle', 'elite', 'boss'].includes(str('kind')) ? str('kind') : 'battle') as 'battle' | 'elite' | 'boss';
/** 개발용: 엽전·부적 (?local=1&gold=500&relics=moonOrb,whetstone) */
export const DEV_GOLD = LOCAL_MODE && params.has('gold') ? Math.max(0, Math.floor(Number(params.get('gold')) || 0)) : null;
export const DEV_RELICS = str('relics').split(',').filter(Boolean);
/** 개발용: 기기에 저장한 판을 지우고 시작 (?local=1&reset=1) */
export const DEV_RESET = LOCAL_MODE && params.get('reset') === '1';
