/**
 * 梯次（步驟 1）的純函式：產生聚會日、套用特殊週規則、統計。規格 §7.5.4。
 * 一律走 engine 的 epoch-day 工具，不自己建 Date 做日曆運算。
 */

import { fromEpochDay, isIsoDate, toEpochDay, weekdayOf } from '../engine';
import type { IsoDate, Week, WeekTagId } from '../engine';

export const WEEKDAY_LABELS = [
  '星期日',
  '星期一',
  '星期二',
  '星期三',
  '星期四',
  '星期五',
  '星期六',
] as const;

/** 特殊週規則的 n：1–5 代表當月第 N 次聚會，-1 代表當月最後一次 */
export const LAST_MEETING = -1;

/**
 * 從起始日之後的第一個指定星期開始，每七天一次，直到結束日（含）。
 * 起訖日不合法或結束日早於起始日時回傳空陣列。
 */
export function generateMeetingDates(
  start: string,
  end: string,
  weekday: number,
): IsoDate[] {
  if (!isIsoDate(start) || !isIsoDate(end)) return [];
  const first = toEpochDay(start);
  const last = toEpochDay(end);
  if (last < first) return [];

  const dates: IsoDate[] = [];
  for (
    let day = first + (((weekday - weekdayOf(start)) % 7) + 7) % 7;
    day <= last;
    day += 7
  ) {
    dates.push(fromEpochDay(day));
  }
  return dates;
}

export function toWeeks(dates: readonly IsoDate[]): Week[] {
  return dates.map((date) => ({ date, tags: [] }));
}

/** 依 YYYY-MM 分組，保持原本的先後順序 */
export function groupByMonth(weeks: readonly Week[]): Map<string, Week[]> {
  const grouped = new Map<string, Week[]>();
  for (const week of weeks) {
    const key = week.date.slice(0, 7);
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [week]);
    else bucket.push(week);
  }
  return grouped;
}

/** 依規則算出「哪幾天應該是特殊週」，以及哪幾個月湊不到第 N 次聚會 */
export function expectedTagged(
  weeks: readonly Week[],
  n: number,
): { dates: Set<IsoDate>; gaps: string[] } {
  const dates = new Set<IsoDate>();
  const gaps: string[] = [];

  for (const [month, inMonth] of groupByMonth(weeks)) {
    const index = n === LAST_MEETING ? inMonth.length - 1 : n - 1;
    if (index < 0 || index >= inMonth.length) {
      gaps.push(month);
      continue;
    }
    dates.add(inMonth[index].date);
  }

  return { dates, gaps };
}

/**
 * 套用規則：全部重算，不是疊加。其他標籤保留，只動這一個 tagId。
 */
export function applyNthMeetingRule(
  weeks: readonly Week[],
  tagId: WeekTagId,
  n: number,
): { weeks: Week[]; gaps: string[] } {
  const { dates, gaps } = expectedTagged(weeks, n);
  const next = weeks.map((week) => {
    const others = week.tags.filter((tag) => tag !== tagId);
    return { date: week.date, tags: dates.has(week.date) ? [...others, tagId] : others };
  });
  return { weeks: next, gaps };
}

/** 現況與規則的差異週數，給「會覆蓋你手動改過的 N 週」用 */
export function ruleDeviationCount(
  weeks: readonly Week[],
  tagId: WeekTagId,
  n: number,
): number {
  const { dates } = expectedTagged(weeks, n);
  let deviations = 0;
  for (const week of weeks) {
    if (week.tags.includes(tagId) !== dates.has(week.date)) deviations += 1;
  }
  return deviations;
}

export function countTagged(weeks: readonly Week[], tagId: WeekTagId): number {
  return weeks.filter((week) => week.tags.includes(tagId)).length;
}

/** 補登一次聚會，插在正確的位置以維持日期嚴格遞增；日期重複或不合法時回傳 null */
export function insertMeetingDate(weeks: readonly Week[], date: string): Week[] | null {
  if (!isIsoDate(date)) return null;
  if (weeks.some((week) => week.date === date)) return null;
  const next = [...weeks, { date, tags: [] }];
  next.sort((a, b) => (a.date < b.date ? -1 : 1));
  return next;
}
