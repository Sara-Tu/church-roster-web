/**
 * 排班過程的累計器。規格 §6.4.5，一對一對應現有 Python 引擎的六個 dict，
 * 差別只在 key 用 id 而不是姓名。
 */

import { daysBetween, monthOf, weeksBetween } from './dates';
import type { IsoDate, MemberId, RoleId } from './schema';

/** 現有引擎用 999 代表「從來沒排過」，沿用同一個值以維持排序 key 一致 */
export const NEVER_SERVED_WEEKS = 999;

export class SchedulerState {
  private readonly monthlyTotal = new Map<string, number>();
  private readonly monthlyByRole = new Map<string, number>();
  private readonly termByRole = new Map<string, number>();
  private readonly termTotal = new Map<MemberId, number>();
  private readonly lastServedByRole = new Map<string, IsoDate>();
  private readonly lastServedAny = new Map<MemberId, IsoDate>();
  private readonly consecutiveCount = new Map<MemberId, number>();

  monthlyTotalOf(memberId: MemberId, date: IsoDate): number {
    return this.monthlyTotal.get(`${memberId}|${monthOf(date)}`) ?? 0;
  }

  monthlyRoleOf(memberId: MemberId, roleId: RoleId, date: IsoDate): number {
    return this.monthlyByRole.get(`${memberId}|${roleId}|${monthOf(date)}`) ?? 0;
  }

  termRoleOf(memberId: MemberId, roleId: RoleId): number {
    return this.termByRole.get(`${memberId}|${roleId}`) ?? 0;
  }

  termTotalOf(memberId: MemberId): number {
    return this.termTotal.get(memberId) ?? 0;
  }

  weeksSinceRole(memberId: MemberId, roleId: RoleId, date: IsoDate): number {
    const last = this.lastServedByRole.get(`${memberId}|${roleId}`);
    return last === undefined ? NEVER_SERVED_WEEKS : weeksBetween(last, date);
  }

  /** 上一次服事（任何角色）是否剛好在七天前 */
  servedLastWeek(memberId: MemberId, date: IsoDate): boolean {
    const previous = this.lastServedAny.get(memberId);
    return previous !== undefined && daysBetween(previous, date) === 7;
  }

  consecutiveOf(memberId: MemberId): number {
    return this.consecutiveCount.get(memberId) ?? 0;
  }

  record(memberId: MemberId, roleId: RoleId, date: IsoDate): void {
    const month = monthOf(date);
    bump(this.monthlyTotal, `${memberId}|${month}`);
    bump(this.monthlyByRole, `${memberId}|${roleId}|${month}`);
    bump(this.termByRole, `${memberId}|${roleId}`);
    bump(this.termTotal, memberId);
    this.lastServedByRole.set(`${memberId}|${roleId}`, date);

    // 同一週被指派第二個角色時（成對角色的例外人員）不會再加一次連續週數，
    // 因為此時 lastServedAny 已經是本週日期，相隔 0 天而不是 7 天。
    if (this.servedLastWeek(memberId, date)) {
      bump(this.consecutiveCount, memberId);
    }
    this.lastServedAny.set(memberId, date);
  }
}

function bump<K>(counter: Map<K, number>, key: K): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}
