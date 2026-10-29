/**
 * 指定服事（規格 §7.12）：索引與預先扣除用的查詢。
 *
 * 引擎每週先把指定寫進班表，所以「之後還沒到的指定」一律是日期晚於這一週的那些。
 * 沒有任何指定時每個查詢都回 0 / false，排班結果與加這個模組之前逐格相同。
 */

import { addDays, daysBetween, monthOf } from './dates';
import type { Constraint, IsoDate, MemberId, RoleId } from './schema';

export interface Pin {
  memberId: MemberId;
  roleId: RoleId;
}

export interface OnlyPinnedRule {
  dates: Set<IsoDate>;
  /** null ＝ 所有位置 */
  roleIds: Set<RoleId> | null;
}

export interface PinIndex {
  /** 聚會日 → 這一天的指定，依卡片順序 */
  byDate: Map<IsoDate, Pin[]>;
  /** memberId → 這個人所有的指定，依日期排序 */
  byMember: Map<MemberId, { date: IsoDate; roleId: RoleId }[]>;
  /** 「指定日期以外不排」：memberId → 各張卡片 */
  onlyPinned: Map<MemberId, OnlyPinnedRule[]>;
}

export function emptyPinIndex(): PinIndex {
  return { byDate: new Map(), byMember: new Map(), onlyPinned: new Map() };
}

/** 收進 RuleIndex。同一人、同一位置、同一天重複指定只算一次 */
export function addPins(
  index: PinIndex,
  c: Extract<Constraint, { type: 'fixed_assignment' }>,
): void {
  const own = index.byMember.get(c.memberId) ?? [];
  for (const date of c.dates) {
    if (own.some((pin) => pin.date === date && pin.roleId === c.roleId)) continue;
    own.push({ date, roleId: c.roleId });
    const today = index.byDate.get(date) ?? [];
    today.push({ memberId: c.memberId, roleId: c.roleId });
    index.byDate.set(date, today);
  }
  own.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  index.byMember.set(c.memberId, own);

  if (c.onlyPinnedDates) {
    const rules = index.onlyPinned.get(c.memberId) ?? [];
    rules.push({
      dates: new Set(c.dates),
      roleIds: c.onlyRoleIds.length === 0 ? null : new Set(c.onlyRoleIds),
    });
    index.onlyPinned.set(c.memberId, rules);
  }
}

/** 日期晚於 `after` 的指定次數。roleId / month 有給就只算符合的 */
export function pinsAfter(
  index: PinIndex,
  memberId: MemberId,
  after: IsoDate,
  filter: { roleId?: RoleId | null; month?: number } = {},
): number {
  let count = 0;
  for (const pin of index.byMember.get(memberId) ?? []) {
    if (pin.date <= after) continue;
    if (filter.roleId != null && pin.roleId !== filter.roleId) continue;
    if (filter.month !== undefined && monthOf(pin.date) !== filter.month) continue;
    count++;
  }
  return count;
}

/** 這個位置在 `after` 之後的下一次指定 */
export function nextPinOfRole(
  index: PinIndex,
  memberId: MemberId,
  roleId: RoleId,
  after: IsoDate,
): IsoDate | undefined {
  return index.byMember.get(memberId)?.find((pin) => pin.date > after && pin.roleId === roleId)
    ?.date;
}

/** 下一週有沒有指定（任何位置） */
export function pinnedNextWeek(index: PinIndex, memberId: MemberId, date: IsoDate): boolean {
  const next = addDays(date, 7);
  return index.byMember.get(memberId)?.some((pin) => pin.date === next) ?? false;
}

/**
 * `after` 之後的指定彼此之間會造成幾次「連續兩週服事」。這幾次不管這一週排不排
 * 都一定會發生，所以要先扣掉
 */
export function pinPairsAfter(index: PinIndex, memberId: MemberId, after: IsoDate): number {
  const dates = [
    ...new Set(
      (index.byMember.get(memberId) ?? []).filter((pin) => pin.date > after).map((pin) => pin.date),
    ),
  ];
  let pairs = 0;
  for (let i = 1; i < dates.length; i++) {
    if (daysBetween(dates[i - 1], dates[i]) === 7) pairs++;
  }
  return pairs;
}
