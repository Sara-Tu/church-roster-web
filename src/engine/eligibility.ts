/**
 * 硬性過濾：某個人在某一週能不能擔任某個角色。規格 §6.4.6。
 *
 * 與現有 Python 引擎的差別（都已確認不影響 parity，見規格 §6.4.6）：
 *   - max_per_term_role、role_frequency、forbidden_role_combination 原本只有部分
 *     角色會檢查，這裡對所有角色一律檢查
 *   - 多了「這個人真的有這個角色嗎」的檢查（舊版在 required_pair 與
 *     preferred_role_combination 的路徑上不檢查）
 */

import type { EngineContext } from './context';
import type { IsoDate, MemberId, RoleId } from './schema';

export type WeekAssignments = Readonly<Record<RoleId, MemberId[]>>;

export function canServe(
  ctx: EngineContext,
  memberId: MemberId,
  roleId: RoleId,
  date: IsoDate,
  excluded: ReadonlySet<MemberId>,
  weekAssignments: WeekAssignments,
): boolean {
  if (excluded.has(memberId)) return false;

  const member = ctx.memberById.get(memberId);
  if (member === undefined || !member.roles.includes(roleId)) return false;

  if (ctx.unavailable.get(memberId)?.has(date)) return false;

  for (const window of ctx.rules.windows.get(memberId) ?? []) {
    if (window.until !== undefined && date > window.until) return false;
    if (window.from !== undefined && date < window.from) return false;
  }

  for (const limit of ctx.rules.maxPerMonth) {
    if (limit.memberId !== memberId) continue;
    const used =
      limit.roleId === null
        ? ctx.state.monthlyTotalOf(memberId, date)
        : limit.roleId === roleId
          ? ctx.state.monthlyRoleOf(memberId, roleId, date)
          : -1;
    if (used >= limit.max) return false;
  }

  for (const limit of ctx.rules.maxTotalPerTerm) {
    if (limit.memberId !== null && limit.memberId !== memberId) continue;
    if (ctx.state.termTotalOf(memberId) >= limit.max) return false;
  }

  if (
    ctx.state.servedLastWeek(memberId, date) &&
    ctx.state.consecutiveOf(memberId) >= ctx.rules.maxConsecutiveWeeks
  ) {
    return false;
  }

  for (const limit of ctx.rules.maxPerTermRole) {
    if (limit.memberId !== memberId || limit.roleId !== roleId) continue;
    if (ctx.state.termRoleOf(memberId, roleId) >= limit.max) return false;
  }

  const frequency = ctx.rules.roleFrequency.get(roleId);
  if (frequency !== undefined) {
    if (ctx.state.termRoleOf(memberId, roleId) >= frequency.maxPerTerm) return false;
    if (ctx.state.weeksSinceRole(memberId, roleId, date) < frequency.minGapWeeks) return false;
  }

  if (blockedByRoleCombination(ctx, memberId, roleId, weekAssignments)) return false;

  return true;
}

/**
 * forbidden_role_combination：同一條規則裡，只要有別人本週已經擔任他自己受限的
 * 角色，這個人就不能擔任他受限的角色。取代 `scheduler.py` 只能處理兩個人的
 * `people[1 - i]`。
 */
function blockedByRoleCombination(
  ctx: EngineContext,
  memberId: MemberId,
  roleId: RoleId,
  weekAssignments: WeekAssignments,
): boolean {
  for (const combo of ctx.rules.forbiddenCombos) {
    const own = combo.find((entry) => entry.memberId === memberId);
    if (own === undefined || !own.roleIds.has(roleId)) continue;

    for (const other of combo) {
      if (other.memberId === memberId) continue;
      for (const otherRoleId of other.roleIds) {
        if ((weekAssignments[otherRoleId] ?? []).includes(other.memberId)) return true;
      }
    }
  }
  return false;
}

/** forbidden_together：同一角色同一週不得同時出現名單中的任兩人 */
export function violatesForbiddenTogether(
  ctx: EngineContext,
  roleId: RoleId,
  members: readonly MemberId[],
): boolean {
  for (const group of ctx.rules.forbiddenTogether.get(roleId) ?? []) {
    let hits = 0;
    for (const memberId of members) {
      if (group.has(memberId) && ++hits >= 2) return true;
    }
  }
  return false;
}

/** 同一組人連續出現在這個角色幾週（往回數到不同為止），對應 `_consecutive_pair_count` */
export function consecutiveSameGroup(
  previousWeeks: readonly { assignments: WeekAssignments }[],
  roleId: RoleId,
  members: readonly MemberId[],
): number {
  const target = new Set(members);
  let count = 0;
  for (let i = previousWeeks.length - 1; i >= 0; i--) {
    const assigned = previousWeeks[i].assignments[roleId] ?? [];
    if (!sameMembers(assigned, target)) break;
    count++;
  }
  return count;
}

function sameMembers(assigned: readonly MemberId[], target: ReadonlySet<MemberId>): boolean {
  const unique = new Set(assigned);
  if (unique.size !== target.size) return false;
  for (const memberId of unique) {
    if (!target.has(memberId)) return false;
  }
  return true;
}
