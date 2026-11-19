import { RES_NAME } from '../data/balance';
import { BUILDING } from '../data/buildings';
import { josa } from '../data/goals';
import { AFF_BONUS, AFF_NEED, DRAGON_BONUS, RESIDENT, RESIDENTS, TASKS, affLevel, type ResidentDef, type ResidentId } from '../data/residents';
import { dailyBonus, residentOf, standing, workplace, type Building, type DailyTask, type VillageState } from '../game/rules';
import { zodiacFace } from '../net/world';
import { num } from './app';
import { icon } from './icons';

/**
 * 주민 · 부탁 · 오늘의 할 일 화면 (글과 모양만 만든다. 누르는 일은 ui/village.ts 가 받는다:
 *   data-assign="주민:건물" · data-rest="주민" · data-done="칸" · data-skip="칸" · data-daily="칸")
 */

const face = (id: string, cls = '') => `<img class="face ${cls}" src="${zodiacFace(id)}" alt="" />`;
/** 친밀도 하트 다섯 */
const hearts = (level: number) => `<span class="hearts">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= level ? 'on' : ''}">♥</i>`).join('')}</span>`;
/** 그 친밀도 단계의 보너스 값 */
export const bonusOf = (id: ResidentId, level: number) => (id === 'dragon' ? DRAGON_BONUS : AFF_BONUS)[level - 1];
const skill = (d: ResidentDef, level: number) => d.skill.replace('{n}', String(bonusOf(d.id, level)));

/** 그 주민이 일할 수 있는 건물 가운데 가장 좋은 것 (레벨이 높은 것) */
export function bestWorkplace(s: VillageState, id: ResidentId): Building | null {
  const work = RESIDENT[id].work;
  if (!work) return null;
  return s.buildings.filter((b) => b.type === work && standing(b)).sort((a, b) => b.level - a.level)[0] ?? null;
}

/** [주민]: 십이지 열두 명 */
export function residentsPanel(s: VillageState): string {
  const houses = s.buildings.filter((b) => b.type === 'house' && standing(b)).length;
  const rows = RESIDENTS.map((d) => {
    const r = residentOf(s, d.id);
    if (!r) {
      const next = s.residents.length === RESIDENTS.findIndex((x) => x.id === d.id);
      const why = s.profile.level < d.level ? `마을 레벨 ${d.level}에 이사 와요` : houses <= s.residents.length ? '빈 주민 집이 있으면 이사 와요' : '곧 이사 와요';
      return `<div class="p-row off">${face(d.id)}<div class="p-tx"><b>${d.nick} <small>${d.name}</small></b><span class="soft">${skill(d, 1)}</span></div><span class="lock">${next ? '다음 주민 · ' : '🔒 '}${why}</span></div>`;
    }
    const lv = affLevel(r.affinity);
    const need = AFF_NEED[lv] ?? null;
    const at = workplace(s, d.id);
    let side: string;
    if (!d.work) side = '<span class="lock on">늘 힘을 내요</span>';
    else if (at) side = `<button class="btn small" data-rest="${d.id}">쉬게 하기</button>`;
    else if (bestWorkplace(s, d.id)) side = `<button class="btn small primary" data-assign="${d.id}:${bestWorkplace(s, d.id)!.id}">배치</button>`;
    else side = `<span class="lock">${BUILDING[d.work].name}${josa(BUILDING[d.work].name, '이', '가')} 있어야 일해요</span>`;
    return `<div class="p-row">${face(d.id)}<div class="p-tx"><b>${d.nick} <small>${d.name}</small> ${hearts(lv)}</b>
        <span class="soft">${skill(d, lv)}</span>
        <span class="p-st">${at ? `<i class="tag work">${BUILDING[at.type].name}에서 일하는 중</i>` : d.work ? '<i class="soft">쉬는 중</i>' : ''}<small class="soft">${need === null ? '친밀도 가득 🎁' : `친밀도 ${r.affinity}/${need}`}</small></span></div>${side}</div>`;
  }).join('');
  return `<div class="sheet-head"><h3>🐭 주민</h3><span class="soft">${s.residents.length}/12명 · 집 ${houses}채</span><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
    <p class="soft note">주민 집을 지으면 마을 레벨에 맞춰 한 명씩 이사 와요. 부탁을 들어주면 친해지고, 다섯 단계가 되면 선물을 줘요</p><div class="b-list">${rows}</div>`;
}

/** 건물 판 안의 [주민 배치]: 그 건물이 일터인 주민들 */
export function workersBox(s: VillageState, b: Building): string {
  if (!standing(b)) return '';
  const defs = RESIDENTS.filter((d) => d.work === b.type);
  if (defs.length === 0) return '';
  return defs
    .map((d) => {
      const r = residentOf(s, d.id);
      if (!r) return `<div class="w-row off">${face(d.id)}<span class="w-tx"><b>${d.nick}</b><small class="soft">마을 레벨 ${d.level}에 이사 오면 여기서 일할 수 있어요</small></span></div>`;
      const here = workplace(s, d.id)?.id === b.id;
      return `<div class="w-row ${here ? 'on' : ''}">${face(d.id)}<span class="w-tx"><b>${d.nick} ${hearts(affLevel(r.affinity))}</b><small class="soft">${skill(d, affLevel(r.affinity))}</small></span>
        ${here ? `<button class="btn small" data-rest="${d.id}">쉬게 하기</button>` : `<button class="btn small primary" data-assign="${d.id}:${b.id}">${workplace(s, d.id) ? '여기로' : '배치'}</button>`}</div>`;
    })
    .join('');
}

const taskText = (t: DailyTask) => (TASKS.find((x) => x.task === t.task)?.text ?? '').replace('{n}', num(t.n));
const reward = (coin: number, exp: number, aff = 0) =>
  `<span class="costs"><span class="cost">${icon('coin')}${num(coin)}</span><span class="cost">${icon('exp')}${num(exp)}</span>${aff ? `<span class="cost aff">♥${aff}</span>` : ''}</span>`;

/** [부탁]: 주민 부탁 셋 + 오늘의 할 일 셋 */
export function requestsPanel(s: VillageState): string {
  const p = s.profile;
  let asks: string;
  if (s.residents.length === 0) asks = '<p class="soft empty">주민이 이사 오면 부탁을 해요. 먼저 주민 집을 지어 보세요</p>';
  else {
    asks = s.requests
      .map((q) => {
        if (q.state !== 'open' || !q.resident || !q.res) return `<div class="q-row wait"><span class="q-wait">💤</span><div class="p-tx"><b>새 부탁을 기다리는 중</b><span class="soft" data-live="wait-${q.slot}"></span></div></div>`;
        const d = RESIDENT[q.resident];
        const have = p.resources[q.res];
        const lack = have < q.n;
        return `<div class="q-row">${face(d.id)}<div class="p-tx"><b>${d.nick}</b>
            <span class="q-say">${icon(q.res)} ${RES_NAME[q.res]} ${num(q.n)}개만 구해 줘! <small class="${lack ? 'lack' : 'soft'}">(${num(Math.min(have, q.n))}/${num(q.n)})</small></span>${reward(q.coin, q.exp, q.aff)}</div>
          <span class="q-btns"><button class="btn small primary" data-done="${q.slot}" ${lack ? 'disabled' : ''}>들어주기</button><button class="btn small" data-skip="${q.slot}">넘기기</button></span></div>`;
      })
      .join('');
  }
  const all = s.daily.length >= 3 && s.daily.every((t) => t.claimed);
  const bonus = dailyBonus(p.level);
  const got = p.dailyBonusDay === p.dailyDay;
  const daily = s.daily
    .map((t) => {
      const done = t.progress >= t.n;
      return `<div class="d-row ${t.claimed ? 'off' : ''}"><div class="p-tx"><b>${taskText(t)}</b>
          <span class="bar"><i style="width:${Math.min(100, (t.progress / t.n) * 100)}%"></i><em>${num(t.progress)}/${num(t.n)}</em></span>${reward(t.coin, t.exp)}</div>
        ${t.claimed ? '<span class="lock on">받았어요</span>' : `<button class="btn small primary" data-daily="${t.slot}" ${done ? '' : 'disabled'}>받기</button>`}</div>`;
    })
    .join('');
  return `<div class="sheet-head"><h3>📜 부탁</h3><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
    <h4>주민 부탁</h4><div class="b-list">${asks}</div>
    <h4>오늘의 할 일 <small class="soft">날마다 새로 바뀌어요</small></h4><div class="b-list">${daily}
      <div class="d-row bonus ${got ? 'off' : ''}"><div class="p-tx"><b>셋을 모두 끝내면</b>${reward(bonus.coin, bonus.exp)}</div>
        ${got ? '<span class="lock on">받았어요</span>' : `<button class="btn small primary" data-daily="3" ${all ? '' : 'disabled'}>받기</button>`}</div></div>`;
}

/** 지금 받을 수 있는 것의 수 (아래 메뉴의 [부탁]에 띄우는 숫자) */
export function claimable(s: VillageState): number {
  const asks = s.requests.filter((q) => q.state === 'open' && q.res && s.profile.resources[q.res] >= q.n).length;
  const tasks = s.daily.filter((t) => !t.claimed && t.progress >= t.n).length;
  const bonus = s.daily.length >= 3 && s.daily.every((t) => t.claimed) && s.profile.dailyBonusDay !== s.profile.dailyDay ? 1 : 0;
  return asks + tasks + bonus;
}
