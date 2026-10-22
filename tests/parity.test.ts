/**
 * Phase 1 的驗收測試（規格 §6.3、§6.4.11）：
 * TypeScript 引擎跑匿名 fixture，輸出必須與現有 Python 引擎產生的 golden 檔深度相等。
 *
 * golden 檔由 tools/parity/make_fixture.py 產生，改動 src/scheduler.py 或 data/ 後要重跑。
 */

import { describe, expect, it } from 'vitest';
import projectJson from './fixtures/sample-project.json';
import goldenJson from './fixtures/golden-roster.json';
import { runScheduler } from '../src/engine';
import type { GoldenRoster, Project } from '../src/engine';

const project = projectJson as unknown as Project;
const golden = goldenJson as unknown as GoldenRoster;

describe('parity：TypeScript 引擎 vs 現有 Python 引擎', () => {
  const result = runScheduler(project);

  it('26 週的指派與 golden 檔逐格相同', () => {
    expect(result.weeks).toEqual(golden.weeks);
  });

  it('同一份輸入連跑兩次結果相同（決定性）', () => {
    expect(runScheduler(project).weeks).toEqual(result.weeks);
  });

  it('沒有任何 warning', () => {
    expect(result.weeks.flatMap((week) => week.warnings)).toEqual([]);
  });

  it('公平性統計涵蓋所有人員，總數等於指派數', () => {
    expect(result.fairness.perMember).toHaveLength(project.members.length);
    const assignments = golden.weeks.reduce(
      (sum, week) => sum + Object.values(week.assignments).flat().length,
      0,
    );
    const counted = result.fairness.perMember.reduce((sum, entry) => sum + entry.total, 0);
    expect(counted).toBe(assignments);
  });
});
