/**
 * 候選人排序。規格 §6.4.7。
 *
 * 排序 key 刻意不統一，逐角色鏡像現有 Python 引擎 —— 實測 golden 檔，音控 26 週
 * 裡有 9 週、招待有 7 週走替補或 fallback 路徑，任何 key 的差異都會直接改掉輸出。
 *
 * 每組 key 的最後一項都是 members 陣列順序，對應 Python `sorted` 的穩定性。
 */

import type { EngineContext } from './context';
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

/** 成對指派的主角色：服事次數少的優先，同分時距上次越久的優先 */
export function leaderKey(
  ctx: EngineContext,
  roleId: RoleId,
  date: IsoDate,
): (memberId: MemberId) => SortKey {
  return (memberId) => [
    ctx.state.termRoleOf(memberId, roleId),
    -ctx.state.weeksSinceRole(memberId, roleId, date),
    order(ctx, memberId),
  ];
}

/** 成對指派的配角、以及單純填滿的角色：只看整梯次服事次數 */
export function termCountKey(ctx: EngineContext, roleId: RoleId): (memberId: MemberId) => SortKey {
  return (memberId) => [ctx.state.termRoleOf(memberId, roleId), order(ctx, memberId)];
}

/**
 * 輪替角色的替補與 fallback：
 * 最後手段的人排最後 → 指定優先的人排最前 → 本月該角色次數 → 整梯次該角色次數
 */
export function substituteKey(
  ctx: EngineContext,
  roleId: RoleId,
  date: IsoDate,
): (memberId: MemberId) => SortKey {
  const rule = ctx.rules.substitutes.get(roleId);
  return (memberId) => [
    rule !== undefined && rule.lastResort.has(memberId) ? 1 : 0,
    rule !== undefined && rule.prefer.has(memberId) ? 0 : 1,
    ctx.state.monthlyRoleOf(memberId, roleId, date),
    ctx.state.termRoleOf(memberId, roleId),
    order(ctx, memberId),
  ];
}
