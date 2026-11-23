import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAP_W, TILE } from '../src/data/balance';
import { BOSSES, BOSS_IDS, FINAL_BOSS, type BossMove } from '../src/data/bosses';
import { FINAL_GIFT } from '../src/data/economy';
import { ENEMY_IDS } from '../src/data/enemies';
import { ALL_MAPS, FINAL, MAPS, bossIdOf, envOf, mapKillMax, mapOf, mapsOf, nextMap } from '../src/data/maps';
import { FINAL_MAP, FINAL_NO, MAPS_PER_REGION, REGIONS, mapLevel, parseMapId } from '../src/data/regions';
import { mapRows } from '../src/data/sqlrows';
import { tierAtk } from '../src/data/weapons';
import {
  applyReport,
  checkReport,
  checkStart,
  cleared,
  continueMap,
  emptyProfile,
  finalOpen,
  heroesOf,
  mapOpen,
  mapReward,
  normalDone,
  whyText,
  type RunReport,
  type TwelveProfile,
} from '../src/game/progress';
import { createRun, type Warn } from '../src/game/sim';
import { ApiError, buyLocalCat, createLocalApi, localCatOwned, type Store } from '../src/net/api';
import { autoplay } from './bot';
import { lo, play } from './helpers';

/** 12지형까지 다 깬 기록 (keys = 모은 열쇠 수) */
function doneProfile(keys = REGIONS): TwelveProfile {
  const p = emptyProfile();
  p.level = 64;
  for (const m of MAPS) p.maps.normal[m.id] = { stars: 0, clears: 1, best: 100 };
  p.keys.normal = Array.from({ length: keys }, (_, i) => i + 1);
  return p;
}
const finalReport = (over: Partial<RunReport> = {}): RunReport => {
  const max = mapKillMax(FINAL, 'normal');
  return { run: '', map: FINAL_MAP, mode: 'normal', hero: 'rat', time: 300, cleared: true, kills: { ...max.kinds }, elites: max.elites, boss: true, chest: true, deaths: 0, ...over };
};
const memStore = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

describe('최종보스맵 (final)', () => {
  it("맵 id 'final' 은 12지형의 9번째 줄이고, 권장 레벨은 마지막 맵과 같다", () => {
    expect(parseMapId(FINAL_MAP)).toEqual({ region: REGIONS, no: FINAL_NO });
    expect(FINAL_NO).toBe(MAPS_PER_REGION + 1);
    expect(mapLevel(FINAL.region, FINAL.no, 'normal')).toBe(65);
    expect(mapLevel(FINAL.region, FINAL.no, 'hard')).toBe(99);
    expect(mapOf(FINAL_MAP)).toBe(FINAL);
    expect(nextMap('12-8')).toBe(FINAL);
    expect(nextMap(FINAL_MAP)).toBeNull();
    // 지형 맵 목록 · 12지형 화면에는 들어가지 않는다
    expect(MAPS.length).toBe(96);
    expect(MAPS.includes(FINAL)).toBe(false);
    expect(mapsOf(12).length).toBe(8);
    expect(ALL_MAPS.length).toBe(97);
  });

  it('맵 모양: 가로 16칸, 시작·출구·상자·보스·무리가 모두 걸어서 닿는 바닥이다', () => {
    for (const r of FINAL.rows) expect(r.length).toBe(MAP_W);
    const seen = new Set<string>([FINAL.start.join()]);
    const q = [FINAL.start];
    for (let h = 0; h < q.length; h++) {
      const [x, y] = q[h];
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (ny < 0 || ny >= FINAL.rows.length || nx < 0 || nx >= MAP_W || FINAL.rows[ny][nx] === '#' || seen.has(`${nx},${ny}`)) continue;
        seen.add(`${nx},${ny}`);
        q.push([nx, ny]);
      }
    }
    for (const c of [FINAL.exit, FINAL.chest, FINAL.boss!, ...FINAL.groups.map((g) => g.at)]) expect(seen.has(c.join()), c.join()).toBe(true);
    // 열두 길의 요괴가 다시 나온다 · 정예는 한 종류
    const kinds = new Set(FINAL.groups.flatMap((g) => g.list.map(([k]) => k)));
    expect(kinds.size).toBeGreaterThanOrEqual(12);
    for (const k of kinds) expect(ENEMY_IDS).toContain(k);
    expect(new Set(FINAL.groups.filter((g) => g.elite).map((g) => g.elite)).size).toBe(1);
  });

  it('지형 환경 효과도, 고향 보너스도 없다 (12지형으로 적혀 있지만)', () => {
    expect(envOf(FINAL)).toBe('none');
    expect(envOf(mapOf('12-8')!)).toBe('fire');
    const s = createRun(FINAL, 'normal', lo('pig', 'spear', 65));
    expect(s.env.id).toBe('none');
    expect(s.stats.home).toBe(false);
    expect(createRun(mapOf('12-8')!, 'normal', lo('pig', 'spear', 65)).stats.home).toBe(true);
  });

  it('열림: 12지형 보스를 잡고 그 모드의 열쇠 12개를 모아야 한다', () => {
    const fresh = emptyProfile();
    expect(mapOpen(fresh, FINAL_MAP)).toBe(false);
    expect(checkStart(fresh, FINAL_MAP, 'normal', 'rat')).toBe('map locked');
    const few = doneProfile(11);
    expect(finalOpen(few)).toBe(false);
    expect(checkStart(few, FINAL_MAP, 'normal', 'rat')).toBe('need keys');
    expect(whyText('need keys')).toContain('열쇠 12개');
    // 열쇠만 있고 12지형 보스를 못 잡았으면 잠김
    const noBoss = doneProfile();
    delete noBoss.maps.normal['12-8'];
    expect(checkStart(noBoss, FINAL_MAP, 'normal', 'rat')).toBe('map locked');
    const p = doneProfile();
    expect(finalOpen(p)).toBe(true);
    expect(mapOpen(p, FINAL_MAP)).toBe(true);
    expect(checkStart(p, FINAL_MAP, 'normal', 'rat')).toBeNull();
    expect(checkStart(p, FINAL_MAP, 'hard', 'rat')).not.toBeNull();
    // 이어하기: 열쇠를 다 모았으면 최종보스맵, 잡은 뒤에는 마지막 지형 맵
    expect(continueMap(few)).toBe('12-8');
    expect(continueMap(p)).toBe(FINAL_MAP);
    applyReport(p, finalReport(), 1);
    expect(continueMap(p)).toBe('12-8');
  });

  it('깨면 보통 모드 클리어: 처음에만 강화석 꾸러미, 열쇠·대원 합류는 없다', () => {
    const p = doneProfile();
    expect(checkReport(finalReport())).toBeNull();
    expect(checkReport(finalReport({ boss: false }))).toBe('bad result');
    expect(normalDone(p)).toBe(false);
    const stones = p.stones;
    const heroes = heroesOf(p).length;
    const r = applyReport(p, finalReport(), 4242);
    expect(r.first).toBe(true);
    expect(r.gift).toBe(FINAL_GIFT);
    expect(r.key).toBe(false);
    expect(r.joined).toBeNull();
    expect(p.stones).toBe(stones + r.stones);
    expect(r.stones).toBeGreaterThanOrEqual(FINAL_GIFT);
    expect(normalDone(p)).toBe(true);
    expect(cleared(p, FINAL_MAP, 'hard')).toBe(false);
    expect(p.keys.normal.length).toBe(REGIONS);
    expect(heroesOf(p).length).toBe(heroes);
    const again = applyReport(p, finalReport(), 4243);
    expect(again.first).toBe(false);
    expect(again.gift).toBe(0);
    // 쓰러진 판은 클리어가 아니다
    const q = doneProfile();
    applyReport(q, finalReport({ cleared: false, boss: false, chest: false }), 1);
    expect(normalDone(q)).toBe(false);
  });

  it('보상 표: 보스 경험치·엽전은 어둑시니 것, 서버 맵 표에 한 줄 더 (97줄)', () => {
    const row = mapReward(FINAL, 'normal');
    const sc = createRun(FINAL, 'normal', lo()).boss!;
    expect(row.level).toBe(65);
    expect(row.bossExp).toBe(sc.exp);
    expect(row.bossCoin).toBe(sc.coin);
    expect(row.bossExp).toBeGreaterThan(mapReward(mapOf('12-8')!, 'normal').bossExp);
    const rows = mapRows();
    expect(rows.length).toBe(97 * 2); // 보통 + 어려움
    expect(rows[96].startsWith(`('final', 'normal', 12, 9, 65, ${FINAL.par}, true, `)).toBe(true);
  });
});

describe('최종보스 어둑시니', () => {
  const def = BOSSES[FINAL_BOSS];
  const all: BossMove[] = [...def.moves, ...def.phases!.flatMap((p) => p.moves), ...def.hardMoves];

  it('지형 보스 목록에는 없고, 최종보스맵에서만 나온다', () => {
    expect((BOSS_IDS as readonly string[]).includes(FINAL_BOSS)).toBe(false);
    expect(bossIdOf(FINAL)).toBe(FINAL_BOSS);
    expect(bossIdOf(mapOf('12-8')!)).toBe('yeomra');
    expect(createRun(FINAL, 'normal', lo()).boss!.bossDef).toBe(def);
    expect(def.hp).toBeGreaterThan(BOSSES.yeomra.hp);
  });

  it('세 단계: 체력 66% · 33% 에서 넘어가고, 단계마다 커지고 빨라진다', () => {
    expect(def.phases!.map((p) => p.at)).toEqual([0.66, 0.33]);
    expect(def.phases![0].size).toBeGreaterThan(def.size);
    expect(def.phases![1].size).toBeGreaterThan(def.phases![0].size);
    expect(def.phases![1].gap).toBeLessThan(def.phases![0].gap);
    expect(def.phases![0].gap).toBeLessThan(def.gap);
    expect(def.lines.length).toBe(3);
    expect(def.last).not.toBe('');
  });

  it('앞 지형 보스들의 공격을 섞어 쓰고, 저만의 공격(열두 시 · 무너지는 봉인)이 있다. 예고는 모두 0.7초 이상', () => {
    const kinds = new Set(all.map((m) => m.t));
    // 지형 보스들의 고유 공격
    for (const t of ['barrage', 'cross', 'leap', 'rake', 'nova', 'march', 'spiral', 'wave', 'sweep', 'scorch', 'cage'] as const) expect(kinds.has(t), t).toBe(true);
    expect(kinds.has('clock')).toBe(true);
    expect(kinds.has('checker')).toBe(true);
    for (const id of BOSS_IDS) for (const m of [...BOSSES[id].moves, ...BOSSES[id].hardMoves]) expect(['clock', 'checker']).not.toContain(m.t);
    for (const m of all) expect(m.warn, m.t).toBeGreaterThanOrEqual(0.7);
    // 단계마다 고유 공격이 하나 이상
    expect(def.moves.some((m) => m.t === 'clock')).toBe(true);
    for (const ph of def.phases!) expect(ph.moves.some((m) => m.t === 'clock' || m.t === 'checker')).toBe(true);
  });

  /** 보스 앞에 대원을 세우고 보스를 깨운 판 */
  const fight = () => {
    const s = createRun(FINAL, 'normal', { ...lo('ox', 'sword', 65), weaponAtk: tierAtk(7) }, { seed: 5, god: true });
    for (const e of s.enemies) if (!e.bossDef) e.dead = true;
    const b = s.boss!;
    s.p.x = b.x;
    s.p.y = b.y + 5 * TILE;
    b.awake = true;
    b.cd = 0;
    return { s, b };
  };
  const bossWarns = (s: { warns: Warn[] }, id: number) => s.warns.filter((w) => w.src === id);

  it('열두 시: 둘레의 줄 12개가 대원 쪽부터 차례로 친다', () => {
    const { s, b } = fight();
    play(s, 0.05);
    const ws = bossWarns(s, b.id);
    expect(ws.length).toBe(12);
    expect(ws.every((w) => w.shape === 'line' && w.big)).toBe(true);
    // 첫 줄은 대원 쪽(아래), 뒤의 줄일수록 늦게
    expect(Math.sin(ws[0].ang)).toBeCloseTo(1, 1);
    for (let i = 1; i < ws.length; i++) expect(ws[i].total).toBeGreaterThan(ws[i - 1].total);
    expect(ws[0].total).toBeGreaterThanOrEqual(0.7);
    expect(new Set(ws.map((w) => Math.round(((w.ang % (Math.PI * 2)) + Math.PI * 2) * 100) % 628)).size).toBe(12);
  });

  it('체력이 66% 아래로 내려가면 2단계: 알림이 뜨고 공격 목록이 바뀐다 (33% 에서 3단계)', () => {
    const { s, b } = fight();
    play(s, 0.05);
    expect(b.phase).toBe(0);
    b.hp = b.maxHp * 0.6;
    b.busy = 0;
    s.events.length = 0;
    play(s, 0.05);
    expect(b.phase).toBe(1);
    expect(b.speed).toBe(def.phases![0].speed);
    expect(s.events.some((e) => e.e === 'phase' && e.n === 2)).toBe(true);
    // 넘어갈 때는 제 둘레를 한 번 친다 (예고 1.2초)
    expect(bossWarns(s, b.id).some((w) => w.shape === 'circle' && w.total === 1.2)).toBe(true);
    // 한 번에 한 단계씩
    b.hp = b.maxHp * 0.1;
    b.busy = 0;
    s.events.length = 0;
    play(s, 0.05);
    expect(b.phase).toBe(2);
    b.busy = 0;
    play(s, 0.05);
    expect(b.phase).toBe(2);
    expect(s.events.filter((e) => e.e === 'phase').length).toBe(1);
  });

  it('무너지는 봉인 (3단계 첫 공격): 바둑판 25칸 — 대원이 선 칸은 나중에 터진다', () => {
    const { s, b } = fight();
    b.phase = 2;
    b.move = 0;
    s.warns.length = 0;
    play(s, 0.02);
    const ws = bossWarns(s, b.id);
    expect(ws.length).toBe(25);
    const m = def.phases![1].moves[0] as Extract<BossMove, { t: 'checker' }>;
    const early = ws.filter((w) => w.total === m.warn);
    const late = ws.filter((w) => w.total === m.warn + m.gap);
    expect(early.length).toBe(12);
    expect(late.length).toBe(13);
    // 대원 자리의 원은 나중 것이고, 먼저 터지는 원은 대원에게 닿지 않는다
    const mine = ws.reduce((a, w) => (Math.hypot(w.x - s.p.x, w.y - s.p.y) < Math.hypot(a.x - s.p.x, a.y - s.p.y) ? w : a));
    expect(late).toContain(mine);
    for (const w of early) expect(Math.hypot(w.x - s.p.x, w.y - s.p.y)).toBeGreaterThan(w.r + 30);
    // 나중 칸끼리도 사이에 서 있을 틈이 있다 (칸 간격 > 원 지름)
    expect(m.cell).toBeGreaterThan(m.r * 2);
  });

  it('자동 조종으로 끝까지 깰 수 있다 (무적): 세 단계를 다 지나고 보스가 쓰러진다', { timeout: 60000 }, () => {
    const s = createRun(FINAL, 'normal', { ...lo('ox', 'sword', 65), weaponAtk: tierAtk(7) }, { seed: 11, god: true });
    const r = autoplay(s, 1500, { chest: true });
    expect(r.phase).toBe('clear');
    expect(s.bossDead).toBe(true);
    expect(s.boss!.phase).toBe(2);
    expect(s.chest).toBe(true);
    expect(r.time).toBeLessThan(FINAL.par * 3);
  });
});

describe('고양이 (테스트 모드: 구매를 흉내 낸다)', () => {
  it('보통 모드를 끝내도 열기 전에는 고를 수 없고, 연 뒤에는 대표 대원·판 시작이 된다', async () => {
    const store = memStore();
    const api = createLocalApi(store, 'k');
    const p = doneProfile();
    applyReport(p, finalReport(), 1);
    store.setItem('k', JSON.stringify(p));
    expect(normalDone(await api.loadProfile())).toBe(true);
    expect(localCatOwned(store)).toBe(false);
    await expect(api.setHero('cat')).rejects.toThrow(ApiError);
    await expect(api.start('1-1', 'normal', 'cat')).rejects.toThrow('hero locked');
    buyLocalCat(store);
    expect(localCatOwned(store)).toBe(true);
    expect((await api.setHero('cat')).hero).toBe('cat');
    expect((await api.start('1-1', 'normal', 'cat')).run).not.toBe('');
    expect((await api.towerStart(1, 'cat')).run).not.toBe('');
    // 최종보스맵도 고양이로
    expect((await api.start(FINAL_MAP, 'normal', 'cat')).run).not.toBe('');
  });
});

describe('SQL (089): 최종보스맵', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/089_twelve_full.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const sql078 = readFileSync(new URL('../../../supabase/migrations/078_twelve.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const fn = (name: string) => {
    const i = sql.lastIndexOf(`create or replace function public.${name}(`);
    return i < 0 ? '' : sql.slice(i, sql.indexOf('$$;', i));
  };

  it("twelve_start: 맵 표의 9번째 줄('final')은 열쇠 12개가 있어야 한다", () => {
    const body = fn('twelve_start');
    expect(body).toContain("raise exception 'need keys'");
    expect(body).toContain('from public.twelve_keys k where k.user_id = me and k.mode = p_mode) < 12');
    expect(body.indexOf("'need keys'")).toBeLessThan(body.indexOf("'map locked'"));
    expect(body).toContain('perform public._twelve_check_hero(me, p_hero);');
    expect(sql).toContain("('final', 'normal', 12, 9, 65, ");
  });

  it('twelve_finish: 최종보스의 선물은 boss_gift_final (12지형 것을 또 주지 않는다)', () => {
    expect(fn('twelve_finish')).toContain("public._twelve_const('boss_gift_' || case when mp.no > 8 then 'final' else mp.region::text end)");
    expect(sql).toContain(`when 'boss_gift_final' then ${FINAL_GIFT}`);
  });

  it("고양이 조건 · 보통 모드 클리어는 078 의 정의 그대로 'final' 기록을 본다", () => {
    expect(sql078).toContain("select public._twelve_cleared(p_user, 'normal', 'final')");
    expect(sql078).toContain("jsonb_build_object('have', case when public._twelve_normal_done(p_user) then 1 else 0 end, 'need', 1)");
    expect(sql).not.toContain('function public._cat_progress_twelve');
    expect(sql).not.toContain('function public._twelve_normal_done');
  });
});
