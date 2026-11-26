/**
 * 스펙의 src/data/*.json 이름 ↔ 규칙 코드의 데이터 모듈 (_shared/card/data/*.ts).
 * 데이터는 서버(Deno)도 읽어야 해서 .ts 가 원본이고, src/data/*.json 은 `npm run json` 이 만든 사본이다 (tests/data.test.ts 가 같은지 본다).
 */
import { CARDS, ENEMIES, EVENTS, HEROES, POTIONS, RELICS, ACTS, REGIONS } from '../game/rules';
import { CARD_ODDS, CARD_ODDS_MAGPIE, GOLD, NODE_RATIO, PRICES, ROWS_PER_ACT, ROW_WIDTH } from '../../../../supabase/functions/_shared/card/data/acts.ts';

export const JSON_TABLES: Record<string, unknown> = {
  'cards.json': CARDS,
  'heroes.json': HEROES,
  'enemies.json': ENEMIES,
  'relics.json': RELICS,
  'events.json': EVENTS,
  'potions.json': POTIONS,
  'acts.json': { acts: ACTS, regions: REGIONS, nodeRatio: NODE_RATIO, rowsPerAct: ROWS_PER_ACT, rowWidth: ROW_WIDTH, gold: GOLD, cardOdds: CARD_ODDS, cardOddsMagpie: CARD_ODDS_MAGPIE, prices: PRICES },
};

export const jsonText = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
