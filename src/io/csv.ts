/**
 * CSV 下載：單純的「週次 × 位置」表，給要自己加工的人。規格 §9。
 *
 * 加 BOM、用 CRLF，Excel 直接開不會變亂碼也不會把欄位擠成一欄。
 */

import type { Project, RosterResult } from '../engine';
import { buildView, roleName } from '../domain/roster';

const BOM = '﻿';

function escape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function rosterCsv(project: Project, result: RosterResult): string {
  const view = buildView(project, result);
  const header = ['日期', ...view.roles.map(roleName)];
  const rows = view.weeks.map((week) => [
    week.label,
    ...week.cells.map((cell) => cell.names.join('、')),
  ]);
  return (
    BOM +
    [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n') +
    '\r\n'
  );
}
