/**
 * 서버 확인용 기대값: `npx vite-node scripts/pg-expect.ts > expect.json`
 * 정해 둔 순서(맵 깨기 · 쓰러지기 · 상점 · 대장간 · 가방)를 기기 규칙(src/game/progress.ts · rules.ts · drops.ts)으로 돌려,
 * 단계마다의 기록을 JSON 으로 낸다. scripts/pg-check.mjs 가 같은 순서를 078_twelve.sql 의 RPC 로 돌려 맞춰 본다.
 * 장비 id 는 서버와 기기가 다르게 붙으므로, 장비는 '번호 순서로 몇 번째인지'로 가리킨다.
 */
import { mapKillMax, mapOf } from '../src/data/maps';
import { roll } from '../src/game/drops';
import { applyReport, bagCount, emptyProfile, type FinishResult, type RunReport, type TwelveProfile } from '../src/game/progress';
import { buy, claim, enhance, equip, scrap, sell, setLock, unequip } from '../src/game/rules';

const p = emptyProfile();
const steps: unknown[] = [];

const sorted = (q: TwelveProfile) => [...q.items].sort((a, b) => Number(a.id) - Number(b.id));
/** 장비 id 를 순서 번호로 바꾼 기록 */
function canon(q: TwelveProfile) {
  const list = sorted(q);
  const at = (id: string | null) => (id === null ? null : list.findIndex((it) => it.id === id));
  return {
    level: q.level,
    exp: q.exp,
    coins: q.coins,
    stones: q.stones,
    mode: q.mode,
    hero: q.hero,
    bag: q.bag,
    potions: structuredClone(q.potions),
    eq: { weapon: at(q.eq.weapon), armor: at(q.eq.armor), acc: at(q.eq.acc) },
    items: list.map((it) => ({ base: it.base, plus: it.plus, lock: it.lock, box: it.box })),
    maps: structuredClone(q.maps),
    keys: structuredClone(q.keys),
    pity: structuredClone(q.pity),
    codex: [...q.codex].sort(),
  };
}
const canonResult = (r: FinishResult) => ({ ...r, siaCoin: undefined, items: r.items.map((it) => ({ base: it.base, box: it.box })) });
const idAt = (i: number) => sorted(p)[i].id;

function play(map: string, seed: number, over: Partial<RunReport> = {}) {
  const m = mapOf(map)!;
  const max = mapKillMax(m, 'normal');
  const report: RunReport = { run: '', map, mode: 'normal', hero: 'rat', time: 100, cleared: true, kills: { ...max.kinds }, elites: max.elites, boss: !!m.boss, chest: true, deaths: 0, ...over };
  const result = applyReport(p, report, seed);
  steps.push({ op: 'play', map, seed, report: { time: report.time, cleared: report.cleared, kills: report.kills, elites: report.elites, boss: report.boss, chest: report.chest, deaths: report.deaths, potions: report.potions ?? null }, result: canonResult(result), state: canon(p) });
}
/** RPC 하나: fn · 인자(items = 장비 순서 번호) · 기기 규칙의 결과(why = 거절 까닭) */
function rpc(fn: string, args: Record<string, unknown>, why: string | null) {
  steps.push({ op: 'rpc', fn, args, why, state: canon(p) });
}
const pity = (region: number, elite: number, boss: number, key: number) => {
  p.pity.normal[String(region)] = { elite, boss, key };
  steps.push({ op: 'pity', region, elite, boss, key });
};

// 1) 1지형을 처음부터 끝까지 (씨앗을 정해 두고)
for (let n = 1; n <= 8; n++) play(`1-${n}`, 1000 + n * 37);
// 2) 보스 다시 잡기: 열쇠 확정 보정(3번째) · 별 보상은 한 번만
for (let n = 0; n < 4; n++) play('1-8', 5000 + n * 911, { time: 400, deaths: 1, chest: false });
// 3) 쓰러진 판: 경험치만, 쓴 물약은 빠진다
play('1-5', 77, { cleared: false, kills: { imp: 3 }, elites: 0, chest: false, potions: [[2, 0, 0], [1, 0, 0]] });
// 4) 레어 확정 보정: 정예 100마리째 · 보스 8번째 (아직 없는 것부터)
pity(1, 99, 0, 0);
play('1-3', 31337);
pity(1, 0, 7, 0);
play('1-8', 4242);
// 5) 상점
rpc('twelve_buy', { p_what: 'potion:0:1', p_n: 2 }, buy(p, 'potion:0:1', 2));
rpc('twelve_buy', { p_what: 'potion:1:2', p_n: 99 }, buy(p, 'potion:1:2', 99));
rpc('twelve_buy', { p_what: 'w-bow-0', p_n: 1 }, buy(p, 'w-bow-0'));
rpc('twelve_buy', { p_what: 'w-bow-1', p_n: 1 }, buy(p, 'w-bow-1'));
rpc('twelve_buy', { p_what: 'r-n1-1', p_n: 1 }, buy(p, 'r-n1-1'));
rpc('twelve_buy', { p_what: 'bag', p_n: 1 }, buy(p, 'bag'));
// 6) 착용 · 잠금 · 대장간 (장비는 번호 순서로 가리킨다: 0 = 나무 칼, 2 = 나무 활, 4 = 나무 갑옷)
rpc('twelve_equip', { item: 2 }, equip(p, idAt(2)));
rpc('twelve_unequip', { p_slot: 'armor' }, unequip(p, 'armor'));
rpc('twelve_unequip', { p_slot: 'weapon' }, unequip(p, 'weapon'));
rpc('twelve_equip', { item: 4 }, equip(p, idAt(4)));
for (let n = 0; n < 3; n++) rpc('twelve_enhance', { item: 2 }, enhance(p, idAt(2)));
rpc('twelve_lock', { item: 1, p_on: true }, setLock(p, idAt(1), true));
rpc('twelve_sell', { items: [1] }, sell(p, [idAt(1)]));
rpc('twelve_sell', { items: [2] }, sell(p, [idAt(2)]));
rpc('twelve_lock', { item: 1, p_on: false }, setLock(p, idAt(1), false));
{
  const id = idAt(1);
  rpc('twelve_sell', { items: [1] }, sell(p, [id]));
}
{
  const id = idAt(2);
  rpc('twelve_scrap', { items: [2] }, scrap(p, [id]));
}
// 7) 가방 채우기 → 드랍이 보관함으로 → 꺼내기
p.coins += 30000;
steps.push({ op: 'coins', add: 30000 });
while (bagCount(p) < p.bag) rpc('twelve_buy', { p_what: 'a-0', p_n: 1 }, buy(p, 'a-0'));
rpc('twelve_buy', { p_what: 'a-0', p_n: 1 }, buy(p, 'a-0'));
for (let n = 0; n < 3; n++) play('1-8', 9000 + n * 13, { time: 300 });
rpc('twelve_claim', { items: [] }, claim(p, []));
{
  const last = sorted(p).findIndex((it) => !it.box && !Object.values(p.eq).includes(it.id) && it.base === 'a-0');
  const id = idAt(last);
  rpc('twelve_scrap', { items: [last] }, scrap(p, [id]));
}
rpc('twelve_claim', { items: [] }, claim(p, []));

const rolls = [[1, 1, 1], [123456789, 12, 1], [2147483647, 7, 250], [0, 3, 2]].map(([s, t, n]) => ({ seed: s, tag: t, n, value: roll(s, t, n) }));
console.log(JSON.stringify({ first: canon(emptyProfile()), rolls, steps }));
