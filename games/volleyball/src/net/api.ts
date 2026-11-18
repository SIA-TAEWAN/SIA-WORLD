/**
 * 서버 연결. 지금(1·2단계)은 테스트 모드 표시만 있다.
 * 3단계(온라인 대전)에서 시아레이스(games/running/src/net/api.ts · channel.ts)처럼
 * 실시간 채널(방·대기실)과 결과 저장 함수를 여기에 넣는다.
 */

const params = new URLSearchParams(location.search);
/** 주소의 ?local=1 이면 로그인 없이 도는 테스트 모드 */
export const LOCAL_MODE = params.get('local') === '1';
