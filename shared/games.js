// SIA WORLD 게임 목록. open: true인 게임만 로비에 카드로 보인다.
// path, image는 SIA WORLD 최상위 기준 상대 경로.
export const GAMES = [
  { id: 'tank', name: '시아탱크', desc: '십이지신과 함께하는 포격 대전',
    path: 'games/tank/', image: 'shared/images/card-tank.png', open: true },
  { id: 'matgo', name: '시아맞고', desc: '십이지신 화투로 즐기는 맞고',
    path: 'games/matgo/', image: 'shared/images/card-matgo.png', open: true },
  { id: 'casino', name: '시아카지노', desc: '세븐포커와 블랙잭',
    path: 'games/casino/', image: 'shared/images/card-casino.png', open: true },
];
