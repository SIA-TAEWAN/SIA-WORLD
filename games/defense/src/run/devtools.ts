/**
 * 점검용 도구 (테스트 모드 ?local=1 에서만 window.__def 로 쓴다).
 * 성능 재기: 모든 배치 칸을 3단계 캐릭터로 채우고 죽지 않는 요괴 N마리를 길 위에 늘어놓은 뒤 프레임 시간을 본다.
 */
import { LIMIT, MAX_LV } from '../data/balance';
import { TOWERS, spentAt } from '../data/characters';
import { ENEMIES } from '../data/enemies';
import { spawnEnemy } from '../game/core';
import type { State } from '../game/state';

export function fillBench(s: State, enemies = 150) {
  // 새 요괴가 더 나오지 않고 판이 끝나지도 않게: 먼 뒤의 등장 하나만 남긴다
  s.spawns = [{ t: 1e9, kind: 0, boss: -1, route: 0, hpMul: 1 }];
  s.spawnI = 0;
  s.lives = s.startLives = 1e9;
  if (s.phase === 'prep') s.phase = 'play';
  s.towers.forEach((tw, i) => {
    tw.char = s.squad[i % s.squad.length];
    tw.lv = MAX_LV;
    tw.cd = 0;
    tw.spent = spentAt(TOWERS[tw.char], MAX_LV);
  });
  const n = Math.min(enemies, LIMIT.enemies);
  while (s.enemyN < n) {
    const route = s.enemyN % s.routes.length;
    // 길 전체에 고르게 늘어놓고 아주 천천히 걷게 한다
    const e = spawnEnemy(s, s.enemyN % ENEMIES.length, -1, route, 1, (s.routes[route].len * 0.9 * (s.enemyN + 0.5)) / n);
    if (!e) break;
    e.hp = e.maxHp = 1e9;
    e.speed = 4;
  }
  return { enemies: s.enemyN, towers: s.towers.length };
}
