import { describe, expect, it } from 'vitest';
import { zoneData } from '../src/data';
import { T, generateFloor } from '../src/game/floorgen';
import { checkFloor } from './reach';

describe('층 만들기', () => {
  it('같은 씨앗·같은 층이면 같은 층, 층·씨앗마다 다르다', () => {
    const a = generateFloor(77, 3);
    expect(generateFloor(77, 3)).toEqual(a);
    expect(generateFloor(77, 4).tiles).not.toEqual(a.tiles);
    expect(generateFloor(78, 3).tiles).not.toEqual(a.tiles);
  });

  it('층 구성: 구슬 받침대(2·7·…·47 · 52 말 · 57 돼지, 30·50·70·90층은 보스방에 숨은 전설 구슬), 휴식층 상점, 정예, 보스 (보스 뒤 계단), 100층 소원 구슬', () => {
    const orbs: Record<number, string> = { 2: 'rat', 7: 'ox', 12: 'dragon', 17: 'snake', 22: 'rabbit', 27: 'monkey', 30: 'turtle', 32: 'rooster', 37: 'sheep', 42: 'dog', 47: 'tiger', 50: 'phoenix', 52: 'horse', 57: 'pig', 70: 'whiteTiger', 90: 'blueDragon' };
    const bosses: Record<number, string> = { 10: 'golem', 20: 'imugi', 30: 'winterGeneral', 40: 'yeongdeung', 50: 'bulgasari', 60: 'noegong', 70: 'crowKing', 80: 'ggotgamgwan', 90: 'heukryong', 100: 'eodugsini' };
    for (let seed = 1; seed <= 20; seed++) {
      for (let f = 1; f <= 100; f++) {
        const m = generateFloor(seed, f);
        const kind = m.kind;
        const n = m.rooms.length;
        // 큰 길(시작 + 전투 3~4 + 구슬 + 계단) + 곁방 2~3
        if (kind === 'normal' || kind === 'elite') expect(n, `${seed}:${f}`).toBeGreaterThanOrEqual(7), expect(n).toBeLessThanOrEqual(10);
        if (kind === 'normal') expect(m.rooms.filter((r) => r.side).length, `${seed}:${f} 곁방`).toBeGreaterThanOrEqual(2);
        const ped = m.objs.find((o) => o.kind === 'pedestal');
        expect(ped?.orb, `${seed}:${f}`).toBe(orbs[f]);
        // 보스층 받침대는 숨어 있다 (보스를 쓰러뜨리면 솟아오른다)
        if (ped) expect(!!ped.hidden).toBe(kind === 'boss');
        if (ped?.hidden) expect(m.tiles[ped.y * m.w + ped.x]).toBe(T.FLOOR);
        expect(m.objs.some((o) => o.kind === 'shop')).toBe(f % 10 === 5);
        expect(m.rooms.some((r) => r.kind === 'elite')).toBe(f % 10 === 9);
        for (const [bf, id] of Object.entries(bosses)) expect(m.rooms.some((r) => r.spawns.some((s) => s.def === id)), `${seed}:${f} ${id}`).toBe(f === Number(bf));
        expect(m.stairsHidden).toBe(f % 10 === 0);
        expect(m.objs.some((o) => o.kind === 'wish' && o.hidden)).toBe(f === 100);
        // 전투방은 무리가 여럿 (한 무리 3~6마리)
        for (const r of m.rooms.filter((x) => x.kind === 'combat')) {
          const waves = new Set(r.spawns.map((s) => s.wave));
          expect(waves.size, `${seed}:${f} 무리`).toBeGreaterThanOrEqual(2);
          for (const w of waves) {
            const k = r.spawns.filter((s) => s.wave === w).length;
            expect(k).toBeGreaterThanOrEqual(3);
            expect(k).toBeLessThanOrEqual(6);
          }
        }
      }
    }
  });

  it('구역마다 그 구역 적만 (2~10구역), 정예는 x9층에만', () => {
    for (let zone = 2; zone <= 10; zone++) {
      const z = zoneData(zone * 10)!;
      for (let seed = 1; seed <= 10; seed++) {
        for (let f = zone * 10 - 9; f <= zone * 10 - 1; f++) {
          const ids = new Set(generateFloor(seed, f).rooms.flatMap((r) => r.spawns.map((s) => s.def)));
          for (const id of ids) expect([...z.enemies, ...(f % 10 === 9 ? [z.elite] : [])], `${f}층`).toContain(id);
          if (f % 10 === 9) expect(ids.has(z.elite)).toBe(true);
        }
      }
    }
  });

  it('구역 전투방 템플릿은 그 구역에서만 (이끼 · 서리 · 구름 · 잿불 · 천둥 · 은하 · 꽃밭 · 폭풍 · 소원)', () => {
    const ZONE: Record<string, number> = { moss: 2, frost: 3, cloud: 4, ember: 5, thunder: 6, galaxy: 7, flower: 8, storm: 9, wish: 10 };
    for (let seed = 1; seed <= 12; seed++) {
      for (let f = 11; f <= 100; f++) {
        const zone = Math.ceil(f / 10);
        for (const r of generateFloor(seed, f).rooms) {
          const m = r.tpl.match(/^combat-(moss|frost|cloud|ember|thunder|galaxy|flower|storm|wish)-/);
          if (m) expect(ZONE[m[1]], `${f}층 ${r.tpl}`).toBe(zone);
        }
        // 6구역부터 큰 길 전투방은 3개까지 (한 층 3분 안쪽)
        if (zone >= 6) expect(generateFloor(seed, f).rooms.filter((r) => r.kind === 'combat').length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('갇히는 곳이 없다: 계단·구슬·상점·상자에 닿고, 스위치·풍경·징은 쏠 자리가, 말뚝 너머 상자는 감아 건널 자리가, 구덩이는 굴릴 바위가 있다 (1~50층 × 씨앗 40개 — 51~100층은 floorgen100)', () => {
    const seen: Record<string, number> = {};
    for (let seed = 1; seed <= 40; seed++) for (let f = 1; f <= 50; f++) checkFloor(generateFloor(seed * 7919, f), `${seed}:${f}`, seen);
    for (const k of ['post', 'bell', 'gong', 'pit', 'cold']) expect(seen[k], k).toBeGreaterThan(0);
  }, 60_000);

  it('51~100층에도 적이 있다 (구역마다 적 · 정예 · 보스)', () => {
    for (const f of [51, 55, 60, 75, 89, 100]) {
      const m = generateFloor(5, f);
      expect(m.rooms.length).toBeGreaterThanOrEqual(2);
      expect(m.rooms.some((r) => r.spawns.length > 0) || f % 10 === 5).toBe(true);
    }
  });
});
