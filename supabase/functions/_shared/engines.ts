/** 게임별 규칙 엔진 목록 */
import { matgo } from './matgo.ts';
import { poker } from './poker.ts';
import { blackjack } from './blackjack.ts';
import type { AnyEngine, GameId } from './runner.ts';

export const ENGINES: Record<GameId, AnyEngine> = { matgo, poker, blackjack };
