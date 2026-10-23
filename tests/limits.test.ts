/**
 * 0.3.4 的三件事：每月上限套用到每一個人、輪替群組釘在當月第幾次聚會、
 * 排不出來的原因。規格 §7.9
 */

import { describe, expect, it } from 'vitest';
import { runScheduler } from '../src/engine';
import type { BlockReason, Constraint, Project, RosterResult } from '../src/engine';
import { buildView } from '../src/domain/roster';
import {
  describeConstraint,
  parseConstraintsJson,
  validateConstraint,
} from '../src/domain/constraints';
import { assignmentsOf, makeProject, member, role, rule, weekDate, weeks } from './helpers';

/** 這一週這個位置的警告帶的逐人原因 */
function blockedOf(result: RosterResult, index: number, roleId: string) {
  const warning = result.weeks[index].warnings.find((item) => item.roleId === roleId);
  return warning?.blocked ?? [];
}

function reasonOf(result: RosterResult, index: number, roleId: string, memberId: string) {
  return blockedOf(result, index, roleId).find((entry) => entry.memberId === memberId)?.reason;
}

// ── 需求 1：每月最多幾次可以套用到每一個人 ──────────────────────────────────

describe('max_per_month 不指定人', () => {
  /** 四週都在 2026 年 1 月，每個人每月只能排一次 */
  function project(memberId: string | null): Project {
    return makeProject({
      roles: [role('r1')],
      members: [member('m1', ['r1']), member('m2', ['r1'])],
      weeks: weeks(4),
      constraints: [rule({ type: 'max_per_month', memberId, max: 1, roleId: 'r1' })],
    });
  }

  it('null ＝ 每一個人都受限，兩個人用完就排不出來', () => {
    const result = runScheduler(project(null));
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], [], []]);
    expect(reasonOf(result, 2, 'r1', 'm1')).toEqual({
      kind: 'max_per_month',
      max: 1,
      roleId: 'r1',
    });
  });

  it('指定人的時候只限那一個人', () => {
    const result = runScheduler(project('m1'));
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], ['m2'], ['m2']]);
    expect(result.weeks[2].warnings).toEqual([]);
  });

  it('跨月之後額度重新算', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1'])],
        // 2026-01-25 與 2026-02-01 是不同月
        weeks: weeks(2, '2026-01-25'),
        constraints: [rule({ type: 'max_per_month', memberId: null, max: 1, roleId: null })],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m1']]);
  });
});

// ── 需求 2：輪替群組釘在當月第幾次聚會 ──────────────────────────────────────

describe('rotation_groups 的 pinnedSlots', () => {
  /** 四週都在 1 月：當月第 1～4 次聚會 */
  function project(pinnedSlots?: (number | null)[], unavailable: string[] = []): Project {
    return makeProject({
      roles: [role('r1')],
      members: [
        member('m1', ['r1']),
        member('m2', ['r1'], unavailable),
        member('m3', ['r1']),
      ],
      weeks: weeks(4),
      constraints: [
        rule({
          type: 'rotation_groups',
          roleId: 'r1',
          groups: [['m1'], ['m2'], ['m3']],
          cycleBy: 'week',
          ...(pinnedSlots === undefined ? {} : { pinnedSlots }),
        }),
      ],
    });
  }

  it('沒釘的時候照原本的輪替順序（這次改動不影響舊設定）', () => {
    const result = runScheduler(project());
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], ['m3'], ['m1']]);
    expect(result.softViolations.filter((item) => item.code === 'pinned_group_missed')).toEqual([]);
  });

  it('釘在當月第 1 次聚會的組，第一週就先用它', () => {
    const result = runScheduler(project([null, 1, null]));
    expect(result.weeks[0].assignments.r1).toEqual(['m2']);
    expect(result.softViolations.filter((item) => item.code === 'pinned_group_missed')).toEqual([]);
  });

  it('-1 ＝ 當月最後一次聚會', () => {
    const result = runScheduler(project([null, -1, null]));
    expect(result.weeks[3].assignments.r1).toEqual(['m2']);
  });

  it('釘住的那一組排不出來時換別組，並記一筆偏好沒達成', () => {
    const result = runScheduler(project([null, 1, null], [weekDate(0)]));
    expect(result.weeks[0].assignments.r1).toEqual(['m1']);
    expect(result.softViolations).toContainEqual({
      date: weekDate(0),
      roleId: 'r1',
      code: 'pinned_group_missed',
      message: 'r1第 2 組沒能排在當月第 1 次聚會',
    });
  });

  it('釘在別週的組會被壓到最後，但不會被完全排除', () => {
    // 第 2 組釘在當月第 4 次聚會，前三週只有第 2 組的人有空
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1'], [weekDate(0)]), member('m2', ['r1'])],
        weeks: weeks(2),
        constraints: [
          rule({
            type: 'rotation_groups',
            roleId: 'r1',
            groups: [['m1'], ['m2']],
            cycleBy: 'week',
            pinnedSlots: [null, 4],
          }),
        ],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m2']);
  });
});

describe('pinnedSlots 的卡片文字與欄位檢查', () => {
  function rotation(pinnedSlots?: (number | null)[]): Constraint {
    return rule({
      type: 'rotation_groups',
      roleId: 'r1',
      groups: [['m1'], ['m2']],
      cycleBy: 'week',
      ...(pinnedSlots === undefined ? {} : { pinnedSlots }),
    });
  }

  const project = makeProject({
    roles: [role('r1')],
    members: [
      { ...member('m1', ['r1']), name: '小明' },
      { ...member('m2', ['r1']), name: '小華' },
    ],
    weeks: weeks(4),
  });

  it('釘選會寫進卡片那一行', () => {
    expect(describeConstraint(project, rotation([null, 2]))).toBe(
      'r1 依週次輪替：小明 → 小華；第 2 組固定在當月第 2 次聚會',
    );
    expect(describeConstraint(project, rotation([-1, null]))).toContain(
      '第 1 組固定在當月最後一次聚會',
    );
    expect(describeConstraint(project, rotation())).toBe('r1 依週次輪替：小明 → 小華');
  });

  it('兩組釘在同一次聚會、或填了範圍外的數字都算沒填好', () => {
    expect(validateConstraint(project, rotation([2, 2]))).toEqual(['有兩組固定在同一次聚會']);
    expect(validateConstraint(project, rotation([9, null]))).toEqual([
      '固定在第幾次聚會只能填 1 到 5，或 -1（當月最後一次）',
    ]);
    expect(validateConstraint(project, rotation([null, 1]))).toEqual([]);
  });

  it('進階 JSON 讀得進 pinnedSlots，也讀得進不指定人的每月上限', () => {
    const parsed = parseConstraintsJson(
      JSON.stringify([
        {
          type: 'rotation_groups',
          roleId: 'r1',
          groups: [['m1'], ['m2']],
          cycleBy: 'month',
          pinnedSlots: [null, -1],
        },
        { type: 'max_per_month', max: 1, roleId: 'r1' },
      ]),
      project,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rotationRule = parsed.constraints[0];
    expect(rotationRule.type === 'rotation_groups' && rotationRule.pinnedSlots).toEqual([null, -1]);
    const monthly = parsed.constraints[1];
    expect(monthly.type === 'max_per_month' && monthly.memberId).toBeNull();
  });
});

// ── 需求 4：排不出來的原因 ──────────────────────────────────────────────────

describe('排不出來的原因', () => {
  it('這天不行，另一個人其實排得上（是湊不滿才整個留空）', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1', { perWeek: 2 })],
        members: [member('m1', ['r1'], [weekDate(0)]), member('m2', ['r1'])],
        weeks: weeks(1),
      }),
    );
    expect(blockedOf(result, 0, 'r1')).toEqual([
      { memberId: 'm1', reason: { kind: 'unavailable' } },
      { memberId: 'm2', reason: null },
    ]);
  });

  it('本週已經排在別的位置', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1'), role('r2')],
        members: [member('m1', ['r1', 'r2'])],
        weeks: weeks(1),
        constraints: [rule({ type: 'one_role_per_week' })],
      }),
    );
    expect(reasonOf(result, 0, 'r2', 'm1')).toEqual({
      kind: 'assigned_elsewhere',
      roleId: 'r1',
    });
  });

  const cases: { name: string; constraint: Constraint; weeks: number; reason: BlockReason }[] = [
    {
      name: '某個位置整梯次上限',
      constraint: rule({ type: 'max_per_term_role', memberId: 'm1', roleId: 'r1', max: 1 }),
      weeks: 2,
      reason: { kind: 'max_per_term_role', max: 1 },
    },
    {
      name: '整梯次服事總次數上限',
      constraint: rule({ type: 'max_total_per_term', memberId: null, max: 1 }),
      weeks: 2,
      reason: { kind: 'max_total_per_term', max: 1 },
    },
    {
      name: '位置的間隔不足',
      constraint: rule({ type: 'role_frequency', roleId: 'r1', minGapWeeks: 4, maxPerTerm: 9 }),
      weeks: 2,
      reason: { kind: 'role_frequency_gap', minGapWeeks: 4 },
    },
    {
      name: '位置的整梯次次數用完',
      constraint: rule({ type: 'role_frequency', roleId: 'r1', minGapWeeks: 0, maxPerTerm: 1 }),
      weeks: 2,
      reason: { kind: 'role_frequency_total', max: 1 },
    },
    {
      name: '不在可服事的日期範圍',
      constraint: rule({ type: 'availability_window', memberId: 'm1', until: weekDate(0) }),
      weeks: 2,
      reason: { kind: 'outside_window' },
    },
    {
      name: '連續兩週服事的次數上限',
      constraint: rule({ type: 'max_consecutive_weeks_per_member', max: 1 }),
      weeks: 3,
      reason: { kind: 'max_consecutive_weeks', max: 1 },
    },
  ];

  for (const item of cases) {
    it(`${item.name}`, () => {
      const result = runScheduler(
        makeProject({
          roles: [role('r1')],
          members: [member('m1', ['r1'])],
          weeks: weeks(item.weeks),
          constraints: [item.constraint],
        }),
      );
      expect(reasonOf(result, item.weeks - 1, 'r1', 'm1')).toEqual(item.reason);
    });
  }

  it('不能同一週的規則', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1'), role('r2')],
        members: [member('m1', ['r1']), member('m2', ['r2'])],
        weeks: weeks(1),
        constraints: [
          rule({
            type: 'forbidden_role_combination',
            entries: [
              { memberId: 'm1', roleIds: [] },
              { memberId: 'm2', roleIds: [] },
            ],
          }),
        ],
      }),
    );
    expect(reasonOf(result, 0, 'r2', 'm2')).toEqual({ kind: 'forbidden_combination' });
  });

  it('成對位置找不到配角', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1', { pairsWith: 'r2' }), role('r2')],
        members: [member('m1', ['r1'])],
        weeks: weeks(1),
      }),
    );
    expect(reasonOf(result, 0, 'r1', 'm1')).toEqual({ kind: 'no_partner', roleId: 'r2' });
  });

  it('結果頁把原因翻成中文，排得上的人標示出來', () => {
    const project = makeProject({
      roles: [{ ...role('r1', { perWeek: 2 }), name: '聖餐' }],
      members: [
        { ...member('m1', ['r1'], [weekDate(0)]), name: '小明' },
        { ...member('m2', ['r1']), name: '小華' },
      ],
      weeks: weeks(1),
    });
    const view = buildView(project, runScheduler(project));
    expect(view.warnings[0].blocked).toEqual([
      { name: '小明', reason: '這天不行', servable: false },
      {
        name: '小華',
        reason: '排得上，但這個位置一次要 2 人，湊不滿所以整個留空',
        servable: true,
      },
    ]);
  });
});
