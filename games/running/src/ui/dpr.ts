/**
 * 기기 픽셀 배율. 캔버스는 화면 CSS 크기 × DPR 픽셀로 만들고 CSS로 줄여 보여 준다 (휴대폰에서 선명하게).
 * 게임 코드의 카메라 배율·화면 크기는 CSS 픽셀 기준으로 생각하고, Phaser에 넘길 때만 DPR을 곱한다.
 */
export const DPR = Math.min(3, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
