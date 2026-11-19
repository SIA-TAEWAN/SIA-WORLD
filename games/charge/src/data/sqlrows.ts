import { LEADERS } from './balance';
import { UPGRADES } from './growth';
import { STAGES, crateCoinsOf } from './stages';

/**
 * SQL 표(061_charge.sql)에 들어갈 줄을 게임 데이터에서 만든다 (npm run sqlrows · tests/sql.test.ts).
 * 줄 모양: ('1-1', 1, 1, 55, 115, 0)
 */
export const stageRows = () => STAGES.map((s) => `('${s.id}', ${s.region}, ${s.no}, ${s.stars[0]}, ${s.stars[1]}, ${crateCoinsOf(s.items)})`);
export const upgradeRows = () => UPGRADES.map((u) => `('${u.key}', ${u.max}, ${u.base}, ${u.step})`);
export const leaderRows = () => LEADERS.map((l) => `('${l.id}', ${l.starter ? 0 : l.unlockRegion}, ${l.coinMul})`);
