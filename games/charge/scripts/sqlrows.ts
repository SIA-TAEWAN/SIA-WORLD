/** SQL 표 줄 출력: npm run sqlrows (061_charge.sql 의 _charge_stages · _charge_upgrades · _charge_leaders 에 붙여 넣는다) */
import { leaderRows, stageRows, upgradeRows } from '../src/data/sqlrows';

console.log('-- stages\n' + stageRows().join(',\n'));
console.log('-- upgrades\n' + upgradeRows().join(',\n'));
console.log('-- leaders\n' + leaderRows().join(',\n'));
