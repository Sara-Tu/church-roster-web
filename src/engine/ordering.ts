/**
 * 候選人排序。規格 §6.4.7。
 *
 * 排序 key 刻意不統一，逐角色鏡像現有 Python 引擎 —— 實測 golden 檔，音控 26 週
 * 裡有 9 週、招待有 7 週走替補或 fallback 路徑，任何 key 的差異都會直接改掉輸出。
 *
 * 每組 key 的最後一項都是 members 陣列順序，對應 Python `sorted` 的穩定性。
 */

import type { EngineContext } from './context';
import { monthOf } from './dates';
import { pinsAfter } from './pins';
import type { IsoDate, MemberId, RoleId } from './schema';

export type SortKey = number[];

export function stableSortBy<T>(items: readonly T[], keyOf: (item: T) => SortKey): T[] {
  return items
    .map((item, index) => ({ item, index, key: keyOf(item) }))
    .sort((a, b) => {
      const length = Math.max(a.key.length, b.key.length);
      for (let i = 0; i < length; i++) {
        const difference = (a.key[i] ?? 0) - (b.key[i] ?? 0);
        if (difference !== 0) return difference;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

function order(ctx: EngineContext, memberId: MemberId): number {
  return ctx.memberOrder.get(memberId) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * 有效次數＝已經排的次數＋之後還沒到的指定服事（規格 §7.12.3）。排序一律用這個，
 * 指定很多次的人才不會在前面又被優先排。沒有指定時就是原本的次數。
 */
function termRoleCount(ctx: EngineContext, memberId: MemberId, roleId: RoleId, date: IsoDate): number {
  return ctx.state.termRoleOf(memberId, roleId) + pinsAfter(ctx.rules.pins, memberId, date, { roleId });
}

function termTotalCount(ctx: EngineContext, memberId: MemberId, date: IsoDate): number {
  return ctx.state.termTotalOf(memberId) + pinsAfter(ctx.rules.pins, memberId, date);
}

function monthlyRoleCount(
  ctx: EngineContext,
  memberId: MemberId,
  roleId: RoleId,
  date: IsoDate,
): number {
  return (
    ctx.state.monthlyRoleOf(memberId, roleId, date) +
    pinsAfter(ctx.rules.pins, memberId, date, { roleId, month: monthOf(date) })
  );
}

/**
 * 「最少排幾次」還差幾次（規格 §7.10.2）。三個排序 key 的第一格都是 `-shortfall`，
 * 所以欠越多的人排越前面。
 *
 * 沒有人設下限時每個人都是 0，第一格全部相等，排序結果與加這個欄位之前逐格相同
 * —— Excel golden 比對因此不受影響。
 *
 * 只看「所有位置合計」與這個位置本身的下限：為了湊足音控的次數而把人優先排進
 * 領會，不會是使用者的本意。
 */
function shortfall(ctx: EngineContext, memberId: MemberId, roleId: RoleId, date: IsoDate): number {
  let worst = 0;
  for (const rule of ctx.rules.minPerTerm) {
    if (rule.memberId !== memberId) continue;
    if (rule.roleId !== null && rule.roleId !== roleId) continue;
    const done =
      rule.roleId === null
        ? termTotalCount(ctx, memberId, date)
        : termRoleCount(ctx, memberId, rule.roleId, date);
    worst = Math.max(worst, rule.min - done);
  }
  return Math.max(0, worst);
}

/** 成對指派的主角色：還差幾次才達下限的優先，再比服事次數，同分時距上次越久的優先 */
export function leaderKey(
  ctx: EngineContext,
  roleId: RoleId,
  date: IsoDate,
): (memberId: MemberId) => SortKey {
  return (memberId) => [
    -shortfall(ctx, memberId, roleId, date),
    termRoleCount(ctx, memberId, roleId, date),
    -ctx.state.weeksSinceRole(memberId, roleId, date),
    order(ctx, memberId),
  ];
}

/** 成對指派的配角、以及單純填滿的角色：下限沒達標的優先，再看整梯次服事次數 */
export function termCountKey(
  ctx: EngineContext,
  roleId: RoleId,
  date: IsoDate,
): (memberId: MemberId) => SortKey {
  return (memberId) => [
    -shortfall(ctx, memberId, roleId, date),
    termRoleCount(ctx, memberId, roleId, date),
    order(ctx, memberId),
  ];
}

/**
 * 輪替角色的替補與 fallback：
 * 最後手段的人排最後 → 下限沒達標的排最前 → 指定優先的人排最前 →
 * 本月該角色次數 → 整梯次該角色次數
 *
 * 下限刻意排在「最後手段」之後：留到最後才找的人，不會因為欠次數就被提前。
 */
export function substituteKey(
  ctx: EngineContext,
  roleId: RoleId,
  date: IsoDate,
): (memberId: MemberId) => SortKey {
  const rule = ctx.rules.substitutes.get(roleId);
  return (memberId) => [
    rule !== undefined && rule.lastResort.has(memberId) ? 1 : 0,
    -shortfall(ctx, memberId, roleId, date),
    rule !== undefined && rule.prefer.has(memberId) ? 0 : 1,
    monthlyRoleCount(ctx, memberId, roleId, date),
    termRoleCount(ctx, memberId, roleId, date),
    order(ctx, memberId),
  ];
}
