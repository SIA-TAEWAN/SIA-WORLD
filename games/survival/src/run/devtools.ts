/**
 * 점검용 도구 (테스트 모드 ?local=1 에서만 window.__surv 로 쓴다).
 * 성능 재기: 적 N마리 + 투사체 M개를 화면에 채우고 프레임 시간을 본다.
 */
import { LIMIT } from '../data/balance';
import { ENEMIES } from '../data/enemies';
import { WEAPONS } from '../data/weapons';
import { addProjectile, rand, spawnEnemy } from '../game/core';
import { addWeapon } from '../game/levelup';
import { MODE, PROJ, type State } from '../game/state';
import { weaponReady } from '../game/weapons';

/** 죽지 않는 적 enemies 마리와 투사체 projectiles 개 이상으로 화면을 채운다 (무기 6종 5레벨, 나는 죽지 않는다) */
export function fillBench(s: State, enemies = 300, projectiles = 100) {
  // 새 요괴·보스가 더 나오지 않게 등장 표를 비운다
  s.map = { ...s.map, spawns: [], swarms: [], bosses: [] };
  s.stats.maxHp = 1e9;
  s.player.hp = 1e9;
  s.weapons.length = 0;
  for (let i = 0; i < WEAPONS.length && s.weapons.length < LIMIT.weapons; i++) if (weaponReady(WEAPONS[i]) && !WEAPONS[i].evolved) addWeapon(s, i, LIMIT.level);
  const kinds = ENEMIES.map((e, i) => (e.ready ? i : -1)).filter((i) => i >= 0);
  while (s.enemies.n < Math.min(enemies, LIMIT.enemyPool)) {
    // 화면 안에 고르게 (가로 720 × 세로 1500 정도)
    const e = spawnEnemy(s, kinds[s.enemies.n % kinds.length], s.player.x + (rand(s) - 0.5) * 700, s.player.y + (rand(s) - 0.5) * 1400);
    if (!e) break;
    e.hp = e.maxHp = 1e9;
    e.dmg = 0;
  }
  // 무기가 쏘는 것에 더해, 오래 도는 구슬로 투사체 수를 채운다
  let k = 0;
  while (s.projectiles.n < Math.min(projectiles, LIMIT.projectiles)) {
    const pr = addProjectile(s, PROJ.pearl, MODE.orbit, 6, -1, s.player.x, s.player.y, 0, 0, 12, 1, 1e9);
    if (!pr) break;
    pr.a = k * 0.4;
    pr.b = 140 + (k % 8) * 55;
    pr.c = 1.2 + (k % 5) * 0.3;
    pr.every = 20;
    k++;
  }
  return { enemies: s.enemies.n, projectiles: s.projectiles.n };
}
