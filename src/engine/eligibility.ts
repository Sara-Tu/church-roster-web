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
import { monthOf, weeksBetween } from './dates';
import { nextPinOfRole, pinnedNextWeek, pinPairsAfter, pinsAfter } from './pins';
import type { ForbiddenComboEntry } from './rules';
import type { BlockReason, IsoDate, MemberId, RoleId } from './schema';

export type WeekAssignments = Readonly<Record<RoleId, MemberId[]>>;

/**
 * normal：一般排班，上限會預先扣掉之後還沒到的指定服事（規格 §7.12.3）。
 * pin：查指定服事本身有沒有違反規則 —— 不預扣（不然第一次指定就會被自己後面的
 * 指定擋下），也不看「指定日期以外不排」。
 */
export type CheckMode = 'normal' | 'pin';

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
  mode: CheckMode = 'normal',
): BlockReason | null {
  const pins = ctx.rules.pins;
  const reserve = mode === 'normal';

  if (excluded.has(memberId)) {
    return { kind: 'assigned_elsewhere', roleId: roleOfMember(weekAssignments, memberId) };
  }

  const member = ctx.memberById.get(memberId);
  if (member === undefined || !member.roles.includes(roleId)) return { kind: 'not_in_role' };

  if (ctx.unavailable.get(memberId)?.has(date)) return { kind: 'unavailable' };

  if (reserve) {
    for (const rule of pins.onlyPinned.get(memberId) ?? []) {
      if (rule.dates.has(date)) continue;
      if (rule.roleIds === null || rule.roleIds.has(roleId)) return { kind: 'pinned_dates_only' };
    }
  }

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
    if (used < 0) continue;
    const reserved = reserve
      ? pinsAfter(pins, memberId, date, { roleId: limit.roleId, month: monthOf(date) })
      : 0;
    if (used + reserved >= limit.max) {
      return withReserved(
        { kind: 'max_per_month', max: limit.max, roleId: limit.roleId },
        used < limit.max ? reserved : 0,
      );
    }
  }

  const termReserved = reserve ? pinsAfter(pins, memberId, date) : 0;
  for (const limit of ctx.rules.maxTotalPerTerm) {
    if (limit.memberId !== null && limit.memberId !== memberId) continue;
    const used = ctx.state.termTotalOf(memberId);
    if (used + termReserved >= limit.max) {
      return withReserved(
        { kind: 'max_total_per_term', max: limit.max },
        used < limit.max ? termReserved : 0,
      );
    }
  }

  const consecutive = consecutiveBlock(ctx, memberId, date, reserve);
  if (consecutive !== null) return consecutive;

  const roleReserved = reserve ? pinsAfter(pins, memberId, date, { roleId }) : 0;
  const roleUsed = ctx.state.termRoleOf(memberId, roleId);
  for (const limit of ctx.rules.maxPerTermRole) {
    if (limit.memberId !== memberId || limit.roleId !== roleId) continue;
    if (roleUsed + roleReserved >= limit.max) {
      return withReserved(
        { kind: 'max_per_term_role', max: limit.max },
        roleUsed < limit.max ? roleReserved : 0,
      );
    }
  }

  const frequency = ctx.rules.roleFrequency.get(roleId);
  if (frequency !== undefined) {
    if (roleUsed + roleReserved >= frequency.maxPerTerm) {
      return withReserved(
        { kind: 'role_frequency_total', max: frequency.maxPerTerm },
        roleUsed < frequency.maxPerTerm ? roleReserved : 0,
      );
    }
    if (ctx.state.weeksSinceRole(memberId, roleId, date) < frequency.minGapWeeks) {
      return { kind: 'role_frequency_gap', minGapWeeks: frequency.minGapWeeks };
    }
    if (reserve) {
      const next = nextPinOfRole(pins, memberId, roleId, date);
      if (next !== undefined && weeksBetween(date, next) < frequency.minGapWeeks) {
        return { kind: 'role_frequency_gap', minGapWeeks: frequency.minGapWeeks, ahead: true };
      }
    }
  }

  if (blockedByRoleCombination(ctx, memberId, roleId, weekAssignments)) {
    return { kind: 'forbidden_combination' };
  }

  return null;
}

/** reserved 是 0 就不加欄位，讓沒有指定服事時的物件跟以前一模一樣 */
function withReserved<T extends BlockReason>(reason: T, reserved: number): T {
  return reserved > 0 ? { ...reason, reserved } : reason;
}

/**
 * 「連續兩週服事」整梯次的次數上限。排這一週會新增幾次：上週有服事 +1、下週有
 * 指定 +1；之後的指定彼此相連的次數不管這週排不排都會發生，先扣掉（規格 §7.12.3）。
 * 沒有指定時就是原本的 `servedLastWeek && consecutiveOf >= max`。
 */
function consecutiveBlock(
  ctx: EngineContext,
  memberId: MemberId,
  date: IsoDate,
  reserve: boolean,
): BlockReason | null {
  const max = ctx.rules.maxConsecutiveWeeks;
  // 本週已經在服事（一人兩職）：再排一個位置不會多一次連續
  if (ctx.state.lastServedOf(memberId) === date) return null;

  const fromLastWeek = ctx.state.servedLastWeek(memberId, date) ? 1 : 0;
  const pins = ctx.rules.pins;
  const intoNextWeek = reserve && pinnedNextWeek(pins, memberId, date) ? 1 : 0;
  const added = fromLastWeek + intoNextWeek;
  if (added === 0) return null;

  const used = ctx.state.consecutiveOf(memberId);
  const ahead = reserve ? pinPairsAfter(pins, memberId, date) : 0;
  if (used + ahead + added <= max) return null;

  const withoutPins = fromLastWeek === 1 && used >= max;
  return withReserved({ kind: 'max_consecutive_weeks', max }, withoutPins ? 0 : ahead + intoNextWeek);
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
