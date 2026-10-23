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
import type { ForbiddenComboEntry } from './rules';
import type { BlockReason, IsoDate, MemberId, RoleId } from './schema';

export type WeekAssignments = Readonly<Record<RoleId, MemberId[]>>;

export function canServe(
  ctx: EngineContext,
  memberId: MemberId,
  roleId: RoleId,
  date: IsoDate,
  excluded: ReadonlySet<MemberId>,
  weekAssignments: WeekAssignments,
): boolean {
  return blockReason(ctx, memberId, roleId, date, excluded, weekAssignments) === null;
}

/**
 * canServe 的詳細版：回傳第一個擋住這個人的原因，null = 可以排。
 * 檢查順序與原本的 canServe 一字不差，所以排班結果不會因為這次改寫而變（規格 §7.9.4）。
 */
export function blockReason(
  ctx: EngineContext,
  memberId: MemberId,
  roleId: RoleId,
  date: IsoDate,
  excluded: ReadonlySet<MemberId>,
  weekAssignments: WeekAssignments,
): BlockReason | null {
  if (excluded.has(memberId)) {
    return { kind: 'assigned_elsewhere', roleId: roleOfMember(weekAssignments, memberId) };
  }

  const member = ctx.memberById.get(memberId);
  if (member === undefined || !member.roles.includes(roleId)) return { kind: 'not_in_role' };

  if (ctx.unavailable.get(memberId)?.has(date)) return { kind: 'unavailable' };

  for (const window of ctx.rules.windows.get(memberId) ?? []) {
    if (window.until !== undefined && date > window.until) return { kind: 'outside_window' };
    if (window.from !== undefined && date < window.from) return { kind: 'outside_window' };
  }

  for (const limit of ctx.rules.maxPerMonth) {
    // memberId 為 null ＝ 這一條套用到每一個人
    if (limit.memberId !== null && limit.memberId !== memberId) continue;
    const used =
      limit.roleId === null
        ? ctx.state.monthlyTotalOf(memberId, date)
        : limit.roleId === roleId
          ? ctx.state.monthlyRoleOf(memberId, roleId, date)
          : -1;
    if (used >= limit.max) {
      return { kind: 'max_per_month', max: limit.max, roleId: limit.roleId };
    }
  }

  for (const limit of ctx.rules.maxTotalPerTerm) {
    if (limit.memberId !== null && limit.memberId !== memberId) continue;
    if (ctx.state.termTotalOf(memberId) >= limit.max) {
      return { kind: 'max_total_per_term', max: limit.max };
    }
  }

  if (
    ctx.state.servedLastWeek(memberId, date) &&
    ctx.state.consecutiveOf(memberId) >= ctx.rules.maxConsecutiveWeeks
  ) {
    return { kind: 'max_consecutive_weeks', max: ctx.rules.maxConsecutiveWeeks };
  }

  for (const limit of ctx.rules.maxPerTermRole) {
    if (limit.memberId !== memberId || limit.roleId !== roleId) continue;
    if (ctx.state.termRoleOf(memberId, roleId) >= limit.max) {
      return { kind: 'max_per_term_role', max: limit.max };
    }
  }

  const frequency = ctx.rules.roleFrequency.get(roleId);
  if (frequency !== undefined) {
    if (ctx.state.termRoleOf(memberId, roleId) >= frequency.maxPerTerm) {
      return { kind: 'role_frequency_total', max: frequency.maxPerTerm };
    }
    if (ctx.state.weeksSinceRole(memberId, roleId, date) < frequency.minGapWeeks) {
      return { kind: 'role_frequency_gap', minGapWeeks: frequency.minGapWeeks };
    }
  }

  if (blockedByRoleCombination(ctx, memberId, roleId, weekAssignments)) {
    return { kind: 'forbidden_combination' };
  }

  return null;
}

/** 這個人本週已經被排在哪個位置。找不到就回 null（例如成對指派還沒寫進去的主角色） */
function roleOfMember(weekAssignments: WeekAssignments, memberId: MemberId): RoleId | null {
  for (const [roleId, members] of Object.entries(weekAssignments)) {
    if (members.includes(memberId)) return roleId;
  }
  return null;
}

/** 這一筆管不管得到這個位置。空集合＝不限位置 */
function covers(entry: ForbiddenComboEntry, roleId: RoleId): boolean {
  return entry.roleIds.size === 0 || entry.roleIds.has(roleId);
}

/** 這個人本週已經被排進他自己受限的位置了嗎（不限位置時＝有沒有被排進任何位置） */
function alreadyServing(entry: ForbiddenComboEntry, weekAssignments: WeekAssignments): boolean {
  for (const [roleId, members] of Object.entries(weekAssignments)) {
    if (members.includes(entry.memberId) && covers(entry, roleId)) return true;
  }
  return false;
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
    if (own === undefined || !covers(own, roleId)) continue;

    for (const other of combo) {
      if (other.memberId === memberId) continue;
      if (alreadyServing(other, weekAssignments)) return true;
    }
  }
  return false;
}

/**
 * 同一個位置一次排兩人以上時，那一批人選彼此之間也要查一次：這些人是一起選出來的，
 * weekAssignments 當下還沒寫進去，上面那個函式看不到他們。規格 §7.7.3。
 */
export function violatesRoleCombinationWithin(
  ctx: EngineContext,
  roleId: RoleId,
  members: readonly MemberId[],
): boolean {
  for (const combo of ctx.rules.forbiddenCombos) {
    let hits = 0;
    for (const memberId of members) {
      const entry = combo.find((item) => item.memberId === memberId);
      if (entry !== undefined && covers(entry, roleId) && ++hits >= 2) return true;
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
