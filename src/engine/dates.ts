/**
 * 日期工具。規格 §6.1：一律用 YYYY-MM-DD 字串 + epoch-day 整數相減，
 * 不建立 Date 物件做日曆運算，避開 JavaScript 的時區陷阱。
 */

import type { IsoDate } from './schema';

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** 格式與日曆都要正確（2026-02-30 不算合法） */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const matched = ISO_PATTERN.exec(value);
  if (!matched) return false;
  const [, y, m, d] = matched;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

export function toEpochDay(value: IsoDate): number {
  const matched = ISO_PATTERN.exec(value);
  if (!matched) throw new Error(`日期格式不是 YYYY-MM-DD：${value}`);
  const [, y, m, d] = matched;
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) / MS_PER_DAY;
}

/** 1–12。沿用現有引擎的 `date.month`，不含年份（見規格 §6.4.5） */
export function monthOf(value: IsoDate): number {
  const matched = ISO_PATTERN.exec(value);
  if (!matched) throw new Error(`日期格式不是 YYYY-MM-DD：${value}`);
  return Number(matched[2]);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** 對應 Python 的 `(current - last).days // 7`（floor division） */
export function weeksBetween(from: IsoDate, to: IsoDate): number {
  return Math.floor(daysBetween(from, to) / 7);
}

/** epoch day 轉回 YYYY-MM-DD */
export function fromEpochDay(day: number): IsoDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = 星期日。epoch day 0（1970-01-01）是星期四，所以要補 4 */
export function weekdayOf(value: IsoDate): number {
  return (((toEpochDay(value) + 4) % 7) + 7) % 7;
}

export function addDays(value: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(value) + days);
}
