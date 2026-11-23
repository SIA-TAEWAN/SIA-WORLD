/**
 * 서든데스 숫자 (엔진 match.ts 가 쓴다). 설정 화면도 턴 수를 보여 주므로
 * 첫 화면 묶음에 엔진이 딸려 오지 않게 따로 둔다.
 */
/** 이 턴 수가 지나면 턴마다 물이 차오른다 */
export const SUDDEN_TURN = 30;
/** 물이 처음 나타나는 높이: 가장 낮은 탱크 발밑에서 이만큼 아래 */
export const SUDDEN_GAP = 24;
/** 한 바퀴(살아 있는 탱크 수만큼의 턴)에 오르는 높이 */
export const SUDDEN_RISE = 20;
/** 발이 잠긴 탱크가 한 바퀴에 입는 피해 (최대 체력 비율) */
export const SUDDEN_DAMAGE = 0.3;
/** 발밑에서 이만큼 잠기면 탈락 */
export const SUDDEN_DROWN = 30;
