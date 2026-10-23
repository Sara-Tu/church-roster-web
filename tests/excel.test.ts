/**
 * Phase 4 的驗收測試（規格 §7.8.5）：Excel 的欄位與樣式要與舊 Python 版一致。
 *
 * golden-excel.json 由 tools/parity/make_excel_golden.py 產生 —— 它把匿名 fixture
 * 的班表餵給舊的 src/output.py，再把每一格 dump 成 JSON。這裡用同樣的規則 dump
 * TypeScript 版產生的工作簿來比對。改動 src/io/excel.ts 或 src/output.py 後要重跑腳本。
 */

import { describe, expect, it } from 'vitest';
import type { Cell, Worksheet } from 'exceljs';
import projectJson from './fixtures/sample-project.json';
import goldenExcel from './fixtures/golden-excel.json';
import { runScheduler } from '../src/engine';
import type { Project, RosterResult } from '../src/engine';
import { buildWorkbook } from '../src/io/excel';

const project = projectJson as unknown as Project;

/** 與 make_excel_golden.py 的 WARNINGS 一字不差 */
const WARNINGS: Record<string, string> = {
  '2026-07-05': '音控：候選人不足，只排到 1 人',
  '2026-08-02': '招待：找不到替補',
};

function withWarnings(result: RosterResult): RosterResult {
  return {
    ...result,
    // 舊版沒有「偏好沒達成」這張工作表，比對 golden 時要拿掉
    softViolations: [],
    weeks: result.weeks.map((week) => {
      const message = WARNINGS[week.date];
      return message === undefined
        ? week
        : { ...week, warnings: [{ roleId: null, code: 'legacy_warning', message }] };
    }),
  };
}

function hex(argb: string | undefined): string | null {
  return argb === undefined ? null : argb.slice(-6);
}

/**
 * dump 的規則與 make_excel_golden.py 一致：
 * 沒寫過的格子值當成空字串、字體只有 `微軟正黑體` 才記、openpyxl 的垂直置中叫 center。
 */
function dumpCell(cell: Cell): unknown {
  const raw = cell.value;
  const value = raw === null || raw === undefined ? '' : raw;

  const fill = cell.fill;
  const solid =
    fill !== undefined && fill.type === 'pattern' && fill.pattern === 'solid'
      ? hex(fill.fgColor?.argb)
      : null;

  const font = cell.font;
  const styled =
    font !== undefined && font.name === '微軟正黑體'
      ? {
          name: font.name,
          size: font.size,
          bold: Boolean(font.bold),
          color: hex(font.color?.argb),
        }
      : null;

  const alignment = cell.alignment;
  const align =
    alignment !== undefined && alignment.horizontal !== undefined
      ? {
          h: alignment.horizontal,
          v: alignment.vertical === 'middle' ? 'center' : alignment.vertical,
        }
      : null;

  return {
    v: value,
    fill: solid,
    font: styled,
    align,
    border: cell.border?.left?.style === 'thin',
  };
}

function dumpSheet(ws: Worksheet): unknown {
  const merges = [...ws.model.merges].sort();
  const widths = Array.from(
    { length: ws.columnCount },
    (_, i) => ws.getColumn(i + 1).width ?? null,
  );

  const rows = Array.from({ length: ws.rowCount }, (_, r) => {
    const row = ws.getRow(r + 1);
    const cells = Array.from({ length: ws.columnCount }, (_, c) => {
      const cell = row.getCell(c + 1);
      // 合併範圍裡非左上角的格子不比對（兩邊的樣式繼承做法不同）
      return cell.isMerged && cell.master !== cell ? null : dumpCell(cell);
    });
    return { height: row.height ?? null, cells };
  });

  return { name: ws.name, widths, merged: merges, rows };
}

describe('Excel 下載：與舊 Python 版的 r9 格式一致', () => {
  it('四張工作表逐格相同（值、底色、字體、對齊、框線、欄寬、列高、合併）', async () => {
    const result = withWarnings(runScheduler(project));
    const wb = await buildWorkbook(project, result);
    const dump = { sheets: wb.worksheets.map(dumpSheet) };
    expect(dump).toEqual(goldenExcel);
  });

  it('沒有警告也沒有偏好紀錄的時候只有三張工作表', async () => {
    const wb = await buildWorkbook(project, {
      ...runScheduler(project),
      softViolations: [],
    });
    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual([
      '服事表',
      '人員彙整（角色）',
      '人員彙整（時序）',
    ]);
  });

  it('有偏好沒達成的時候多一張工作表', async () => {
    const result = runScheduler(project);
    const wb = await buildWorkbook(project, {
      ...result,
      softViolations: [
        { date: '2026-07-05', roleId: 'r3', code: 'rotation_broken', message: '音控輪替被打斷' },
      ],
    });
    const sheet = wb.getWorksheet('偏好沒達成');
    expect(sheet).toBeDefined();
    expect(sheet?.getCell(2, 2).value).toBe('音控');
    expect(sheet?.getCell(2, 3).value).toBe('音控輪替被打斷');
  });
});
