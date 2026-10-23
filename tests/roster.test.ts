/** 結果頁與下載共用的檢視資料。規格 §7.8.2、§7.8.5 */

import { describe, expect, it } from 'vitest';
import {
  buildView,
  formatMd,
  rosterFilename,
  rosterInputHash,
  weekdayShort,
} from '../src/domain/roster';
import { rosterCsv } from '../src/io/csv';
import { runScheduler } from '../src/engine';
import type { Project, RosterResult } from '../src/engine';
import { makeProject, member, role, weekDate, weeks } from './helpers';

/** 四週、兩個位置：r1 每週一人，r2 只在第 1 與第 3 週（特殊週）兩人 */
function base(): Project {
  const term = weeks(4);
  term[0].tags = ['t1'];
  term[2].tags = ['t1'];
  return makeProject({
    weekTags: [{ id: 't1', label: '聖餐週', rule: { kind: 'manual' } }],
    roles: [role('r1'), { ...role('r2', { perWeek: 2, tagId: 't1' }), name: '聖餐' }],
    members: [
      member('m1', ['r1']),
      member('m2', ['r1']),
      member('m3', ['r2']),
      member('m4', ['r2']),
      member('m5', ['r1']),
    ],
    weeks: term,
  });
}

function emptyResult(weeksResult: RosterResult['weeks']): RosterResult {
  return { weeks: weeksResult, softViolations: [], fairness: { perMember: [] } };
}

describe('formatMd / weekdayShort', () => {
  it('MM/DD 與星期', () => {
    expect(formatMd('2026-07-05')).toBe('07/05');
    expect(weekdayShort('2026-07-05')).toBe('日');
    expect(weekdayShort('2026-07-06')).toBe('一');
  });
});

describe('buildView 依週次', () => {
  const project = base();
  const view = buildView(project, runScheduler(project));

  it('每一週一列，位置順序照步驟 2', () => {
    expect(view.weeks).toHaveLength(4);
    expect(view.weeks.map((week) => week.label)).toEqual(['01/04', '01/11', '01/18', '01/25']);
    expect(view.weeks[0].cells.map((cell) => cell.roleId)).toEqual(['r1', 'r2']);
  });

  it('特殊週才標記，只在特殊週的位置在一般週不算要排', () => {
    expect(view.weeks.map((week) => week.tagged)).toEqual([true, false, true, false]);
    expect(view.weeks[0].cells[1].applicable).toBe(true);
    expect(view.weeks[1].cells[1].applicable).toBe(false);
    expect(view.weeks[1].cells[1].names).toEqual([]);
  });

  it('人不夠的格子會算出缺幾人', () => {
    const project = makeProject({
      roles: [role('r1', { perWeek: 2 })],
      members: [member('m1', ['r1'])],
      weeks: weeks(1),
    });
    // 引擎是全有或全無（規格 §6.4.8），湊不滿整個位置就空著並留一筆警告
    const view = buildView(project, runScheduler(project));
    expect(view.weeks[0].cells[0].names).toEqual([]);
    expect(view.weeks[0].cells[0].missing).toBe(2);
    expect(view.warnings).toHaveLength(1);
  });

  it('名字用人員姓名，不是 id', () => {
    const project = base();
    project.members[0].name = '小明';
    const view = buildView(project, {
      ...emptyResult([{ date: weekDate(0), tags: [], assignments: { r1: ['m1'] }, warnings: [] }]),
    });
    expect(view.weeks[0].cells[0].names).toEqual(['小明']);
  });
});

describe('buildView 依人員', () => {
  it('依第一次服事日期排序，同一天再比姓名', () => {
    const project = makeProject({
      roles: [role('r1'), role('r2')],
      members: [member('m1', ['r1']), member('m2', ['r2']), member('m3', ['r1'])],
      weeks: weeks(2),
    });
    const view = buildView(
      project,
      emptyResult([
        { date: weekDate(0), tags: [], assignments: { r1: ['m3'], r2: ['m2'] }, warnings: [] },
        { date: weekDate(1), tags: [], assignments: { r1: ['m1'], r2: [] }, warnings: [] },
      ]),
    );
    // 第一週：m2 與 m3 同一天 → 比姓名（m2 在前）；m1 第二週才上
    expect(view.people.map((person) => person.memberId)).toEqual(['m2', 'm3', 'm1']);
    expect(view.people.map((person) => person.total)).toEqual([1, 1, 1]);
  });

  it('沒排到班的人列在最後並算進 idle', () => {
    const project = base();
    const view = buildView(
      project,
      emptyResult([{ date: weekDate(0), tags: [], assignments: { r1: ['m1'] }, warnings: [] }]),
    );
    expect(view.people[0].memberId).toBe('m1');
    expect(view.idle).toBe(4);
    expect(view.people.slice(1).every((person) => person.total === 0)).toBe(true);
  });

  it('時序同一天身兼兩個位置時照位置名稱排（跟舊 Excel 一樣）', () => {
    const project = makeProject({
      roles: [
        { ...role('r1'), name: '領會' },
        { ...role('r2'), name: '司琴' },
      ],
      members: [member('m1', ['r1', 'r2'])],
      weeks: weeks(1),
    });
    const view = buildView(
      project,
      emptyResult([
        { date: weekDate(0), tags: [], assignments: { r1: ['m1'], r2: ['m1'] }, warnings: [] },
      ]),
    );
    expect(view.people[0].timeline.map((entry) => entry.roleId)).toEqual(['r2', 'r1']);
  });
});

describe('buildView 公平性', () => {
  const project = base();
  const result = runScheduler(project);
  const view = buildView(project, result);

  it('每人每月次數的合計等於總指派數', () => {
    const assigned = result.weeks.reduce(
      (sum, week) => sum + Object.values(week.assignments).flat().length,
      0,
    );
    const counted = view.monthly.reduce((sum, row) => sum + row.total, 0);
    expect(counted).toBe(assigned);
    expect(view.months).toEqual(['2026-01']);
  });

  it('每個位置只統計有資格的人', () => {
    const spread = view.spread.find((item) => item.roleId === 'r2');
    expect(spread?.people).toBe(2);
    expect(spread?.total).toBe(4);
  });
});

describe('buildView 警告', () => {
  it('警告與偏好各自帶日期與位置名稱', () => {
    const project = base();
    const view = buildView(project, {
      weeks: [
        {
          date: weekDate(0),
          tags: [],
          assignments: {},
          warnings: [{ roleId: 'r2', code: 'insufficient_candidates', message: '人不夠' }],
        },
      ],
      softViolations: [
        { date: weekDate(1), roleId: null, code: 'rotation_broken', message: '輪替被打斷' },
      ],
      fairness: { perMember: [] },
    });
    expect(view.warnings).toEqual([
      { date: '2026-01-04', label: '01/04', roleName: '聖餐', message: '人不夠' },
    ]);
    expect(view.soft[0].roleName).toBe('');
  });
});

describe('rosterInputHash', () => {
  it('改了排班用得到的資料就會變', () => {
    const project = base();
    const before = rosterInputHash(project);
    expect(rosterInputHash(base())).toBe(before);
    expect(rosterInputHash({ ...project, members: project.members.slice(1) })).not.toBe(before);
  });

  it('改教會名稱、版號這類不影響排班的欄位不會變', () => {
    const project = base();
    const before = rosterInputHash(project);
    expect(
      rosterInputHash({ ...project, church: { name: '別的教會', note: '' }, revision: 9 }),
    ).toBe(before);
  });
});

describe('rosterFilename', () => {
  it('服事表_{梯次}_r{n}', () => {
    const project = base();
    expect(rosterFilename({ ...project, term: { ...project.term, name: '2026H2' } }, 3, 'xlsx')).toBe(
      '服事表_2026H2_r3.xlsx',
    );
  });

  it('梯次沒命名就只留版號，空白與斜線換成連字號', () => {
    const project = base();
    expect(rosterFilename({ ...project, term: { ...project.term, name: '' } }, 1, 'csv')).toBe(
      '服事表_r1.csv',
    );
    expect(
      rosterFilename({ ...project, term: { ...project.term, name: '2026 下 / 半年' } }, 1, 'csv'),
    ).toBe('服事表_2026-下-半年_r1.csv');
  });
});

describe('CSV', () => {
  it('第一列是日期加位置名稱，多人用「、」連接', () => {
    const project = base();
    const text = rosterCsv(
      project,
      emptyResult([
        { date: weekDate(0), tags: ['t1'], assignments: { r1: ['m1'], r2: ['m3', 'm4'] }, warnings: [] },
      ]),
    );
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.slice(1)).toBe('日期,r1,聖餐\r\n01/04,m1,m3、m4\r\n');
  });

  it('姓名裡有逗號或引號時會加引號', () => {
    const project = base();
    project.members[0].name = '小明, "阿明"';
    const text = rosterCsv(
      project,
      emptyResult([{ date: weekDate(0), tags: [], assignments: { r1: ['m1'] }, warnings: [] }]),
    );
    expect(text).toContain('"小明, ""阿明"""');
  });
});
