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
      // 每一組為什麼不能用（規格 §7.10.1）。第 1 組是本週實際用的那一組
      groups: [
        { index: 0, members: ['m1'], used: true, reason: null },
        {
          index: 1,
          members: ['m2'],
          used: false,
          reason: { kind: 'short_handed', available: 0, need: 1 },
        },
        // 第 3 組沒釘、也排得上，只是輪替順序還沒輪到
        { index: 2, members: ['m3'], used: false, reason: null },
      ],
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
  // 0.3.6 起排得上的人會先被排進去（規格 §7.11），所以名單上只剩真的卡住的人
  it('這天不行的人列出原因，排得上的那個人已經先排進去了', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1', { perWeek: 2 })],
        members: [member('m1', ['r1'], [weekDate(0)]), member('m2', ['r1'])],
        weeks: weeks(1),
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m2']);
    expect(blockedOf(result, 0, 'r1')).toEqual([
      { memberId: 'm1', reason: { kind: 'unavailable' } },
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

  // `no_partner` 在 0.3.6 之後是防禦性的死路徑：成對位置配不出一對時會各排各的，
  // 真的排得上的人一定被排掉了，剩下的人都有實際的原因（規格 §7.11）
  it('成對位置兩個都排不上時，逐人列出原因', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1', { pairsWith: 'r2' }), role('r2')],
        members: [member('m1', ['r1'], [weekDate(0)])],
        weeks: weeks(1),
      }),
    );
    expect(result.weeks[0].assignments).toEqual({ r1: [], r2: [] });
    expect(reasonOf(result, 0, 'r1', 'm1')).toEqual({ kind: 'unavailable' });
  });

  it('結果頁把原因翻成中文', () => {
    const project = makeProject({
      roles: [{ ...role('r1', { perWeek: 2 }), name: '聖餐' }],
      members: [
        { ...member('m1', ['r1'], [weekDate(0)]), name: '小明' },
        { ...member('m2', ['r1']), name: '小華' },
      ],
      weeks: weeks(1),
    });
    const view = buildView(project, runScheduler(project));
    expect(view.weeks[0].cells[0].names).toEqual(['小華']);
    expect(view.warnings[0].message).toBe('聖餐只排到 1 人（需要 2 人）');
    expect(view.warnings[0].blocked).toEqual([
      { name: '小明', reason: '這天不行', servable: false },
    ]);
  });

  it('結果頁翻出「湊不成組合」的原因', () => {
    const project = makeProject({
      roles: [{ ...role('r1', { perWeek: 3 }), name: '聖餐' }],
      members: [
        { ...member('m1', ['r1']), name: '小明' },
        { ...member('m2', ['r1']), name: '小華' },
      ],
      weeks: weeks(1),
      constraints: [
        rule({
          type: 'forbidden_together',
          roleId: 'r1',
          memberIds: ['m1', 'm2'],
          mode: 'any_two',
        }),
      ],
    });
    const view = buildView(project, runScheduler(project));
    expect(view.warnings[0].blocked).toEqual([
      { name: '小華', reason: '排得上，但跟這一週已經排定的人湊不成合法的組合', servable: false },
    ]);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 0.3.5 需求 A：偏好沒排到的原因（規格 §7.10.1）
// ════════════════════════════════════════════════════════════════════════════

/** 偏好警告裡這一筆帶的逐組原因 */
function groupsOf(result: RosterResult, code: string) {
  return result.softViolations.find((item) => item.code === code)?.groups ?? [];
}

describe('偏好沒排到的原因', () => {
  it('沒用到固定組合時，每一組分別卡在哪裡', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [
          member('m1', ['r1'], [weekDate(0)]),
          member('m2', ['r1'], [weekDate(0)]),
          member('m3', ['r1']),
        ],
        weeks: weeks(1),
        constraints: [
          rule(
            { type: 'rotation_groups', roleId: 'r1', groups: [['m1'], ['m2']], cycleBy: 'week' },
            { hard: false },
          ),
        ],
      }),
    );

    expect(result.weeks[0].assignments.r1).toEqual(['m3']);
    expect(groupsOf(result, 'rotation_fallback')).toEqual([
      {
        index: 0,
        members: ['m1'],
        used: false,
        reason: { kind: 'short_handed', available: 0, need: 1 },
      },
      {
        index: 1,
        members: ['m2'],
        used: false,
        reason: { kind: 'short_handed', available: 0, need: 1 },
      },
    ]);
  });

  it('同一組連續太多週也會寫進出局理由', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        // 第二週第 2 組的人不行，第 1 組又已經連續一週
        members: [member('m1', ['r1']), member('m2', ['r1'], [weekDate(1)])],
        weeks: weeks(2),
        constraints: [
          rule(
            { type: 'rotation_groups', roleId: 'r1', groups: [['m1'], ['m2']], cycleBy: 'week' },
            { hard: false },
          ),
          rule({ type: 'max_consecutive_same_group', roleId: 'r1', max: 1 }),
        ],
      }),
    );

    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m1']]);
    expect(groupsOf(result, 'rotation_fallback')).toEqual([
      { index: 0, members: ['m1'], used: false, reason: { kind: 'too_consecutive', max: 1 } },
      {
        index: 1,
        members: ['m2'],
        used: false,
        reason: { kind: 'short_handed', available: 0, need: 1 },
      },
    ]);
  });

  it('動用最後手段人員時，列出整個人員池分別卡在哪裡', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1'], [weekDate(0)]), member('m2', ['r1'])],
        weeks: weeks(1),
        constraints: [
          rule(
            { type: 'substitute_priority', roleId: 'r1', prefer: [], lastResort: ['m2'] },
            { hard: false },
          ),
        ],
      }),
    );

    const note = result.softViolations.find((item) => item.code === 'last_resort_used');
    expect(note?.message).toBe('r1動用了最後手段人員：m2');
    expect(note?.blocked).toEqual([
      { memberId: 'm1', reason: { kind: 'unavailable' } },
      // 排得上 —— 他就是本週排的那一個
      { memberId: 'm2', reason: null },
    ]);
  });

  it('結果頁把組的理由翻成中文，用到的那一組標出來', () => {
    const project = makeProject({
      roles: [role('r1')],
      members: [member('m1', ['r1']), member('m2', ['r1']), member('m3', ['r1'])],
      weeks: weeks(4),
      constraints: [
        rule(
          {
            type: 'rotation_groups',
            roleId: 'r1',
            groups: [['m1'], ['m2'], ['m3']],
            cycleBy: 'week',
            pinnedSlots: [null, 1, null],
          },
          { hard: false },
        ),
        // 第 2 組釘在當月第 1 次聚會，但那一週他還不能服事
        rule({ type: 'availability_window', memberId: 'm2', from: weekDate(1) }),
      ],
    });

    const view = buildView(project, runScheduler(project));
    const note = view.soft.find((item) => item.message.includes('沒能排在'));
    expect(note?.groups).toEqual([
      { label: '第 1 組', names: 'm1', reason: '這一週用的就是這一組', used: true },
      {
        label: '第 2 組',
        names: 'm2',
        reason: '這一組只有 0 人能來，這個位置要 1 人',
        used: false,
      },
      { label: '第 3 組', names: 'm3', reason: '可以用，只是輪替順序還沒輪到', used: false },
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 0.3.5 需求 B：最少排幾次（規格 §7.10.2、§7.10.3）
// ════════════════════════════════════════════════════════════════════════════

function missedOf(result: RosterResult): string[] {
  return result.softViolations
    .filter((item) => item.code === 'min_per_term_missed')
    .map((item) => item.message);
}

describe('min_per_term：引擎', () => {
  /** 兩個人輪一個位置，沒有別的規則 */
  function twoWeeks(constraints: Constraint[] = []): Project {
    return makeProject({
      roles: [role('r1')],
      members: [member('m1', ['r1']), member('m2', ['r1'])],
      weeks: weeks(2),
      constraints,
    });
  }

  it('沒設下限時，排序與沒有這個欄位時完全相同', () => {
    const result = runScheduler(twoWeeks());
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2']]);
    expect(missedOf(result)).toEqual([]);
  });

  it('還沒達標的人會被提到候選名單最前面', () => {
    const result = runScheduler(
      twoWeeks([
        rule({ type: 'min_per_term', memberId: 'm2', min: 2, roleId: null }, { hard: false }),
      ]),
    );
    // 沒有這條規則的話第一週是 m1
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m2'], ['m2']]);
    expect(missedOf(result)).toEqual([]);
  });

  it('達不到就記一筆，訊息寫出實際排到幾次', () => {
    const result = runScheduler(
      twoWeeks([
        rule({ type: 'min_per_term', memberId: 'm1', min: 5, roleId: null }, { hard: false }),
      ]),
    );
    expect(missedOf(result)).toEqual(['m1整梯次只排到 2 次，設定是至少 5 次']);
  });

  it('不會為了湊下限而違反上限', () => {
    const result = runScheduler(
      twoWeeks([
        rule({ type: 'min_per_term', memberId: 'm1', min: 2, roleId: null }, { hard: false }),
        rule({ type: 'max_total_per_term', memberId: 'm1', max: 1 }),
      ]),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2']]);
    expect(missedOf(result)).toEqual(['m1整梯次只排到 1 次，設定是至少 2 次']);
  });

  it('只算某個位置的下限，不會把人從別的位置挪開', () => {
    const project = makeProject({
      roles: [role('r1'), role('r2')],
      members: [member('m1', ['r1', 'r2']), member('m2', ['r1', 'r2'])],
      weeks: weeks(1),
      constraints: [
        rule({ type: 'one_role_per_week' }),
        // m1 的 r2 至少一次：不該為了這個把 m1 從 r1 擠掉
        rule({ type: 'min_per_term', memberId: 'm1', min: 1, roleId: 'r2' }, { hard: false }),
      ],
    });
    const result = runScheduler(project);
    expect(result.weeks[0].assignments.r1).toEqual(['m1']);
    expect(result.weeks[0].assignments.r2).toEqual(['m2']);
    expect(missedOf(result)).toEqual(['m1整梯次只排到 0 次，設定是至少 1 次']);
  });

  it('沒達標那一筆掛在最後一次聚會，位置留給欄位顯示', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1'), role('r2')],
        members: [member('m1', ['r1']), member('m2', ['r2'])],
        weeks: weeks(2),
        constraints: [
          rule({ type: 'min_per_term', memberId: 'm1', min: 9, roleId: 'r1' }, { hard: false }),
        ],
      }),
    );
    const note = result.softViolations.find((item) => item.code === 'min_per_term_missed');
    expect(note?.date).toBe(weekDate(1));
    expect(note?.roleId).toBe('r1');
  });
});

describe('min_per_term：卡片與欄位檢查', () => {
  function withRules(constraints: Constraint[]): Project {
    return makeProject({
      roles: [role('r1'), role('r2')],
      members: [member('m1', ['r1']), member('m2', ['r1']), member('m3', ['r1'])],
      weeks: weeks(4),
      constraints,
    });
  }

  const min = (
    body: { memberId?: string; min?: number; roleId?: string | null } = {},
  ): Constraint =>
    rule(
      {
        type: 'min_per_term',
        memberId: body.memberId ?? 'm1',
        min: body.min ?? 2,
        roleId: body.roleId === undefined ? null : body.roleId,
      },
      { hard: false },
    );

  it('卡片那一行分得出算不算位置', () => {
    const base = withRules([]);
    expect(describeConstraint(base, min())).toBe('m1 整梯次至少 2 次（所有位置合計）');
    expect(describeConstraint(base, min({ roleId: 'r1' }))).toBe('m1 整梯次至少 2 次（只算 r1）');
  });

  it('沒選人、次數填 0 都算沒填好', () => {
    const base = withRules([]);
    expect(validateConstraint(base, min({ memberId: '' }))).toContain('還沒選人');
    expect(validateConstraint(base, min({ min: 0 }))).toContain('最少次數要填 1 以上的整數');
    expect(validateConstraint(base, min())).toEqual([]);
  });

  it('和整梯次總次數上限打架', () => {
    const rules = [min({ min: 3 }), rule({ type: 'max_total_per_term', memberId: 'm1', max: 2 })];
    const issues = validateConstraint(withRules(rules), rules[0]).join();
    expect(issues).toContain('打架');
    expect(issues).toContain('上限 2 次');
  });

  it('和每月上限打架時會算進梯次有幾個月', () => {
    // 四週都在一月，每月最多一次 → 整梯次最多就是 1 次
    const rules = [
      min({ min: 2 }),
      rule({ type: 'max_per_month', memberId: null, max: 1, roleId: null }),
    ];
    expect(validateConstraint(withRules(rules), rules[0]).join()).toContain(
      '這個梯次有 1 個月，最多只排得到 1 次',
    );
  });

  it('和某個位置的次數上限打架', () => {
    const byRole = [
      min({ min: 3, roleId: 'r1' }),
      rule({ type: 'max_per_term_role', memberId: 'm1', roleId: 'r1', max: 1 }),
    ];
    expect(validateConstraint(withRules(byRole), byRole[0]).join()).toContain('打架');

    const byFrequency = [
      min({ min: 3, roleId: 'r1' }),
      rule({ type: 'role_frequency', roleId: 'r1', minGapWeeks: 1, maxPerTerm: 2 }),
    ];
    expect(validateConstraint(withRules(byFrequency), byFrequency[0]).join()).toContain('打架');
  });

  it('超過這個位置的週數就排不出來', () => {
    const rules = [min({ min: 5, roleId: 'r1' })];
    expect(validateConstraint(withRules(rules), rules[0])).toEqual([
      'r1整梯次只有 4 週，排不到 5 次',
    ]);
  });

  it('每人每週只排一個位置時，總次數的上限就是週數', () => {
    const rules = [min({ min: 5 }), rule({ type: 'one_role_per_week' })];
    expect(validateConstraint(withRules(rules), rules[0])).toEqual([
      '每人每週只排一個位置，整梯次只有 4 週，排不到 5 次',
    ]);
  });

  it('所有人的下限加起來超過名額', () => {
    const rules = [
      min({ memberId: 'm1', min: 2, roleId: 'r1' }),
      min({ memberId: 'm2', min: 2, roleId: 'r1' }),
      min({ memberId: 'm3', min: 2, roleId: 'r1' }),
    ];
    expect(validateConstraint(withRules(rules), rules[0])).toEqual([
      'r1整梯次只有 4 個名額，3 個人的下限加起來是 6 次',
    ]);
  });

  it('停用的規則不算進打架', () => {
    const rules = [
      min({ min: 3 }),
      rule({ type: 'max_total_per_term', memberId: 'm1', max: 2 }, { enabled: false }),
    ];
    expect(validateConstraint(withRules(rules), rules[0])).toEqual([]);
  });

  it('進階 JSON 讀得進來，位置可以省略', () => {
    const parsed = parseConstraintsJson(
      JSON.stringify([
        { id: 'c1', hard: false, enabled: true, type: 'min_per_term', memberId: 'm1', min: 3 },
      ]),
      withRules([]),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.constraints[0]).toEqual({
        id: 'c1',
        hard: false,
        enabled: true,
        type: 'min_per_term',
        memberId: 'm1',
        min: 3,
        roleId: null,
      });
    }
  });
});
