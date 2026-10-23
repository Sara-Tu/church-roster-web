/**
 * Excel 下載。規格 §9 與 §7.8.4。
 *
 * 四張工作表與全部樣式都照舊 Python 版的 `src/output.py` 搬過來 ——
 * 驗收條件是「跟現有的 r9 檔案欄位、樣式一致」，所以欄寬、列高、底色、
 * 斑馬紋的起始列都不能自己發揮。第五張「偏好沒達成」是新的，舊版沒有這張。
 *
 * exceljs 只在按下載的時候才載入（規格 §9：套件延後載入）。
 */

import type { Workbook, Worksheet } from 'exceljs';
import type { Project, Role, RosterResult } from '../engine';
import { buildView, formatMd, roleName } from '../domain/roster';
import type { PersonRow, RosterView } from '../domain/roster';

const FONT = '微軟正黑體';
const HEADER_FILL = '2F4F8F';
const COMMUNION_FILL = 'FFF2CC';
const ALT_FILL = 'F5F5F5';
const BORDER_COLOR = 'CCCCCC';

type Align = 'center' | 'left';

interface CellStyle {
  bold?: boolean;
  fill?: string | null;
  align?: Align;
}

function paint(
  ws: Worksheet,
  row: number,
  col: number,
  value: string | number,
  style: CellStyle = {},
): void {
  const { bold = false, fill = null, align = 'center' } = style;
  const target = ws.getCell(row, col);
  target.value = value;
  target.font = {
    name: FONT,
    size: 11,
    bold,
    color: { argb: `FF${fill === HEADER_FILL ? 'FFFFFF' : '000000'}` },
  };
  target.alignment = { horizontal: align, vertical: 'middle', wrapText: false };
  const side = { style: 'thin' as const, color: { argb: `FF${BORDER_COLOR}` } };
  target.border = { left: side, right: side, top: side, bottom: side };
  if (fill !== null) {
    target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${fill}` } };
  }
}

/** 舊版的斑馬紋從第一筆資料就開始（i % 2 === 0），不是從第二筆 */
function rowFill(index: number, tagged: boolean): string | null {
  if (tagged) return COMMUNION_FILL;
  return index % 2 === 0 ? ALT_FILL : null;
}

/** 服事表的欄寬：日期 10、一人的位置 10、兩人以上 16（預設 5 個位置剛好等於 r9） */
function rosterWidth(role: Role): number {
  return role.perWeek >= 2 ? 16 : 10;
}

/** 人員彙整（角色）的欄寬：日期會排成一長串的位置給 20，其餘 14 */
function summaryWidth(role: Role): number {
  return role.perWeek >= 2 && role.appliesTo.kind === 'all' ? 20 : 14;
}

function buildRosterSheet(ws: Worksheet, view: RosterView): void {
  paint(ws, 1, 1, '日期', { bold: true, fill: HEADER_FILL });
  view.roles.forEach((role, i) => {
    paint(ws, 1, i + 2, roleName(role), { bold: true, fill: HEADER_FILL });
  });

  ws.getColumn(1).width = 10;
  view.roles.forEach((role, i) => {
    ws.getColumn(i + 2).width = rosterWidth(role);
  });
  ws.getRow(1).height = 22;

  view.weeks.forEach((week, i) => {
    const row = i + 2;
    const fill = rowFill(i, week.tagged);
    paint(ws, row, 1, week.label, { fill });
    week.cells.forEach((cell, j) => {
      paint(ws, row, j + 2, cell.names.join('、'), { fill });
    });
    ws.getRow(row).height = 20;
  });
}

function buildRoleSheet(ws: Worksheet, view: RosterView, people: readonly PersonRow[]): void {
  const headers = ['姓名', '總次數', ...view.roles.map(roleName)];
  const widths = [10, 8, ...view.roles.map(summaryWidth)];
  headers.forEach((header, i) => {
    paint(ws, 1, i + 1, header, { bold: true, fill: HEADER_FILL });
    ws.getColumn(i + 1).width = widths[i];
  });
  ws.getRow(1).height = 22;

  people.forEach((person, i) => {
    const row = i + 2;
    const fill = rowFill(i, false);
    paint(ws, row, 1, person.name, { fill });
    paint(ws, row, 2, person.total, { fill });
    view.roles.forEach((role, j) => {
      const dates = person.byRole.find((item) => item.roleId === role.id)?.dates ?? [];
      paint(ws, row, j + 3, dates.map(formatMd).join('、'), { fill, align: 'left' });
    });
    ws.getRow(row).height = 20;
  });
}

function buildTimelineSheet(ws: Worksheet, view: RosterView, people: readonly PersonRow[]): void {
  const longest = people.reduce((max, person) => Math.max(max, person.timeline.length), 0);
  const columns = longest + 1;

  paint(ws, 1, 1, '姓名', { bold: true, fill: HEADER_FILL });
  if (columns > 1) ws.mergeCells(1, 2, 1, columns);
  paint(ws, 1, 2, '服事日期與職位', { bold: true, fill: HEADER_FILL });

  ws.getColumn(1).width = 10;
  for (let col = 2; col <= columns; col += 1) ws.getColumn(col).width = 11;
  ws.getRow(1).height = 22;

  const nameOf = new Map(view.roles.map((role) => [role.id, roleName(role)]));
  people.forEach((person, i) => {
    const row = i + 2;
    const fill = rowFill(i, false);
    paint(ws, row, 1, person.name, { fill });
    person.timeline.forEach((entry, j) => {
      const label = `${formatMd(entry.date)} ${nameOf.get(entry.roleId) ?? entry.roleId}`;
      paint(ws, row, j + 2, label, { fill, align: 'left' });
    });
    ws.getRow(row).height = 20;
  });
}

/**
 * 警告工作表。舊版只有表頭有樣式、資料列是原始格子（沒有字體也沒有框線），
 * 這裡照樣保留，不然跟 r9 比對會對不上。
 */
function buildWarningSheet(ws: Worksheet, view: RosterView): void {
  paint(ws, 1, 1, '日期', { bold: true, fill: HEADER_FILL });
  paint(ws, 1, 2, '警告訊息', { bold: true, fill: HEADER_FILL });
  view.warnings.forEach((note, i) => {
    ws.getCell(i + 2, 1).value = note.label;
    ws.getCell(i + 2, 2).value = note.message;
  });
}

/** 偏好沒達成：舊版沒有這張，所以樣式比照前三張做完整的 */
function buildSoftSheet(ws: Worksheet, view: RosterView): void {
  ['日期', '位置', '說明'].forEach((header, i) => {
    paint(ws, 1, i + 1, header, { bold: true, fill: HEADER_FILL });
  });
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 12;
  ws.getColumn(3).width = 60;
  ws.getRow(1).height = 22;

  view.soft.forEach((note, i) => {
    const row = i + 2;
    const fill = rowFill(i, false);
    paint(ws, row, 1, note.label, { fill });
    paint(ws, row, 2, note.roleName, { fill });
    paint(ws, row, 3, note.message, { fill, align: 'left' });
    ws.getRow(row).height = 20;
  });
}

async function newWorkbook(): Promise<Workbook> {
  const loaded = (await import('exceljs')) as unknown as Record<string, unknown>;
  const fallback = (loaded.default ?? {}) as Record<string, unknown>;
  const ctor = (loaded.Workbook ?? fallback.Workbook) as (new () => Workbook) | undefined;
  if (ctor === undefined) throw new Error('exceljs 載入失敗');
  return new ctor();
}

export async function buildWorkbook(project: Project, result: RosterResult): Promise<Workbook> {
  const view = buildView(project, result);
  // 舊版的人員彙整只列有排到班的人，沒排到的不佔一列
  const served = view.people.filter((person) => person.total > 0);

  const wb = await newWorkbook();
  buildRosterSheet(wb.addWorksheet('服事表'), view);
  buildRoleSheet(wb.addWorksheet('人員彙整（角色）'), view, served);
  buildTimelineSheet(wb.addWorksheet('人員彙整（時序）'), view, served);
  if (view.warnings.length > 0) buildWarningSheet(wb.addWorksheet('警告'), view);
  if (view.soft.length > 0) buildSoftSheet(wb.addWorksheet('偏好沒達成'), view);
  return wb;
}

export async function rosterXlsx(project: Project, result: RosterResult): Promise<Blob> {
  const wb = await buildWorkbook(project, result);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
