/** 問題清單的 15 個代碼。規格 §7.5.8、§7.5.9 */

import { describe, expect, it } from 'vitest';
import { collectIssues } from '../src/domain/issues';
import type { NavState, StorageStatus } from '../src/domain/issues';
import type { Project } from '../src/engine';
import { makeProject, member, role, weeks } from './helpers';

const OK_STORAGE: StorageStatus = { writable: true, backupKey: null };
const NO_NAV: NavState = { generatedFrom: null };

function codes(project: Project, nav = NO_NAV, storage = OK_STORAGE): string[] {
  return collectIssues(project, nav, storage).map((issue) => issue.code);
}

/** 一份沒有任何問題的專案 */
function healthy(): Project {
  return makeProject({
    roles: [role('r1'), role('r2', { perWeek: 2 })],
    members: [member('m1', ['r1', 'r2']), member('m2', ['r2'])],
    weeks: weeks(4),
  });
}

describe('沒問題的專案不產生任何項目', () => {
  it('乾淨', () => {
    expect(codes(healthy())).toEqual([]);
  });
});

describe('步驟 1', () => {
  it('term_dates_missing：日期空白', () => {
    const project = healthy();
    project.term.start = '';
    expect(codes(project)).toContain('term_dates_missing');
  });

  it('term_dates_missing：結束日早於起始日', () => {
    const project = healthy();
    project.term.start = '2026-06-01';
    project.term.end = '2026-01-01';
    expect(codes(project)).toContain('term_dates_missing');
  });

  it('term_dates_stale：產生之後又改了起訖日期', () => {
    const project = healthy();
    const nav: NavState = {
      generatedFrom: { start: '2025-01-01', end: project.term.end, weekday: 0 },
    };
    expect(codes(project, nav)).toContain('term_dates_stale');
  });

  it('term_dates_stale：沒改就不提示', () => {
    const project = healthy();
    const nav: NavState = {
      generatedFrom: { start: project.term.start, end: project.term.end, weekday: 0 },
    };
    expect(codes(project, nav)).not.toContain('term_dates_stale');
  });

  it('no_weeks：還沒產生聚會日', () => {
    const project = makeProject({ roles: [], members: [member('m1', [])], weeks: [] });
    expect(codes(project)).toContain('no_weeks');
  });

  it('week_tag_month_gap：某月聚會次數不足 N', () => {
    const project = healthy();
    project.weekTags = [
      { id: 'communion', label: '聖餐週', rule: { kind: 'nthMeetingOfMonth', n: 5 } },
    ];
    expect(codes(project)).toContain('week_tag_month_gap');
  });

  it('week_tag_month_gap：手動模式不檢查', () => {
    const project = healthy();
    project.weekTags = [{ id: 'communion', label: '聖餐週', rule: { kind: 'manual' } }];
    expect(codes(project)).not.toContain('week_tag_month_gap');
  });

  it('stale_unavailable：不行日期不是聚會日', () => {
    const project = healthy();
    project.members[0].unavailable = ['2026-01-05', project.term.weeks[0].date];
    const issues = collectIssues(project, NO_NAV, OK_STORAGE);
    const stale = issues.find((issue) => issue.code === 'stale_unavailable');
    expect(stale?.message).toContain('1 筆');
  });
});

describe('步驟 2', () => {
  it('role_unnamed', () => {
    const project = healthy();
    project.roles[0].name = '  ';
    expect(codes(project)).toContain('role_unnamed');
  });

  it('role_duplicate_name', () => {
    const project = healthy();
    project.roles[1].name = project.roles[0].name;
    expect(codes(project)).toContain('role_duplicate_name');
  });

  it('role_no_candidate', () => {
    const project = healthy();
    project.members = [];
    expect(codes(project)).toContain('role_no_candidate');
  });

  it('role_short_candidates：有人但不夠填滿', () => {
    const project = healthy();
    project.members = [member('m1', ['r1', 'r2'])];
    const issues = collectIssues(project, NO_NAV, OK_STORAGE);
    const short = issues.find((issue) => issue.code === 'role_short_candidates');
    expect(short?.message).toContain('1 人 / 需要 2 人');
    expect(issues.map((i) => i.code)).not.toContain('role_no_candidate');
  });
});

describe('步驟 3', () => {
  it('no_members', () => {
    const project = healthy();
    project.members = [];
    expect(codes(project)).toContain('no_members');
  });

  it('member_unnamed', () => {
    const project = healthy();
    project.members[0].name = '';
    expect(codes(project)).toContain('member_unnamed');
  });

  it('member_duplicate_name', () => {
    const project = healthy();
    project.members[1].name = project.members[0].name;
    expect(codes(project)).toContain('member_duplicate_name');
  });

  it('member_no_role', () => {
    const project = healthy();
    project.members[1].roles = [];
    const issues = collectIssues(project, NO_NAV, OK_STORAGE);
    expect(issues.find((i) => i.code === 'member_no_role')?.message).toContain('1 人');
  });
});

describe('儲存', () => {
  it('storage_unwritable', () => {
    expect(codes(healthy(), NO_NAV, { writable: false, backupKey: null })).toContain(
      'storage_unwritable',
    );
  });

  it('storage_unreadable 會把備份的 key 寫進訊息', () => {
    const issues = collectIssues(healthy(), NO_NAV, {
      writable: true,
      backupKey: 'church-roster/project/unreadable-x',
    });
    expect(issues.find((i) => i.code === 'storage_unreadable')?.message).toContain(
      'unreadable-x',
    );
  });
});

describe('等級與跳轉目標', () => {
  it('紅色項目是會擋住產生班表的那些', () => {
    const project = makeProject({ roles: [], members: [], weeks: [] });
    project.term.start = '';
    const alerts = collectIssues(project, NO_NAV, OK_STORAGE)
      .filter((issue) => issue.level === 'alert')
      .map((issue) => issue.code);
    expect(alerts).toEqual(['term_dates_missing', 'no_weeks', 'no_members']);
  });

  it('每個項目都指向一個步驟', () => {
    const project = healthy();
    project.members[0].name = '';
    for (const issue of collectIssues(project, NO_NAV, OK_STORAGE)) {
      expect(issue.step).toBeTruthy();
    }
  });
});
