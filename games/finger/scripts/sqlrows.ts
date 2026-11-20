/** SQL 표 줄 출력: npm run sqlrows (067_finger.sql 의 _finger_stages · _finger_upgrades · _finger_levels · _finger_heroes 에 붙여 넣는다) */
import { heroRows, levelRows, stageRows, upgradeRows } from '../src/data/sqlrows';

console.log('-- stages\n' + stageRows().join(',\n'));
console.log('-- upgrades\n' + upgradeRows().join(',\n'));
console.log('-- levels\n' + levelRows().join(',\n'));
console.log('-- heroes\n' + heroRows().join(',\n'));
