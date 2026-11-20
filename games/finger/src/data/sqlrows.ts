import { HERO_UNLOCKS, LEVEL_TABLE, STAGE_REWARDS, UPGRADES } from './growth';

/**
 * SQL 표(067_finger.sql)에 들어갈 줄을 게임 데이터에서 만든다 (npm run sqlrows · tests/sql.test.ts).
 */
/** ('1-1', 1, 1, 28, 8, 45) = 스테이지, 지역, 번호, 클리어, 별마다, 첫 클리어 */
export const stageRows = () => STAGE_REWARDS.map((s) => `('${s.id}', ${s.region}, ${s.no}, ${s.clear}, ${s.star}, ${s.first})`);
/** ('hp', 20, 60, 30) = 항목, 최대 단계, 첫 비용, 단계마다 더하는 값 */
export const upgradeRows = () => UPGRADES.map((u) => `('${u.key}', ${u.max}, ${u.base}, ${u.step})`);
/** (1, 30) = 레벨, 다음 레벨 비용 */
export const levelRows = () => LEVEL_TABLE.map(([lv, c]) => `(${lv}, ${c})`);
/** ('rat', 0) = 대원, 합류 지역 */
export const heroRows = () => HERO_UNLOCKS.map(([id, r]) => `('${id}', ${r})`);
