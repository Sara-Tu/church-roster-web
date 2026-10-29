/**
 * 0.4.1 的兩件事：指定服事與不行日期的 Excel。規格 §7.12
 */

import { describe, expect, it } from 'vitest';
import { runScheduler } from '../src/engine';
import type { Constraint, Project, RosterResult } from '../src/engine';
import { buildView } from '../src/domain/roster';
import {
  constraintNotices,
  describeConstraint,
  parseConstraintsJson,
  validateConstraint,
} from '../src/domain/constraints';
import { unavailableFilename, unavailableRows } from '../src/domain/unavailable';
import { buildUnavailableWorkbook, buildWorkbook } from '../src/io/excel';
import { removeMembers, removeRole, roleRemovalImpact } from '../src/store/cascade';
import { assignmentsOf, makeProject, member, role, rule, weekDate, weeks } from './helpers';

function pin(
  memberId: string,
  roleId: string,
  dates: string[],
  onlyRoleIds?: string[],
): Constraint {
  return rule({
    type: 'fixed_assignment',
    memberId,
    roleId,
    dates,
    onlyPinnedDates: onlyRoleIds !== undefined,
    onlyRoleIds: onlyRoleIds ?? [],
  });
}

function reasonOf(result: RosterResult, index: number, roleId: string, memberId: string) {
  const warning = result.weeks[index].warnings.find((item) => item.roleId === roleId);
  return warning?.blocked?.find((entry) => entry.memberId === memberId)?.reason;
}

function softCodes(result: RosterResult): string[] {
  return result.softViolations.map((violation) => violation.code);
}

/** m2 前 n 週都不行，用來逼出「m1 被上限擋下」的情況 */
function busy(n: number): string[] {
  return Array.from({ length: n }, (_, i) => weekDate(i));
}

// ── 引擎：一定排上、計次 ────────────────────────────────────────────────────

describe('§7.12.2 指定一定排上', () => {
  it('指定的人排上去，而且算進次數：之後輪到別人', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1']), member('m2', ['r1'])],
        weeks: weeks(3),
        constraints: [pin('m2', 'r1', [weekDate(0)])],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m2'], ['m1'], ['m1']]);
    expect(result.softViolations).toEqual([]);
  });

  it('跟規則衝突照樣排上，記一筆橘色提醒並附上原因', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1'], [weekDate(0)]), member('m2', ['r1'])],
        weeks: weeks(1),
        constraints: [pin('m1', 'r1', [weekDate(0)])],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m1']);
    expect(result.softViolations).toEqual([
      {
        date: weekDate(0),
        roleId: 'r1',
        code: 'pinned_over_rule',
        message: '指定m1擔任r1，但違反了其他規則',
        blocked: [{ memberId: 'm1', reason: { kind: 'unavailable' } }],
      },
    ]);
  });

  it('光是指定就超過上限：被標出來的是超過的那一次', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1'])],
        weeks: weeks(3),
        constraints: [
          rule({ type: 'max_total_per_term', memberId: 'm1', max: 2 }),
          pin('m1', 'r1', [weekDate(0), weekDate(1), weekDate(2)]),
        ],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m1'], ['m1']]);
    expect(result.softViolations.map((violation) => violation.date)).toEqual([weekDate(2)]);
    expect(result.softViolations[0].blocked?.[0].reason).toEqual({
      kind: 'max_total_per_term',
      max: 2,
    });
  });

  it('沒有任何指定時，班表與加這個功能之前相同', () => {
    const parts = {
      roles: [role('r1')],
      members: [member('m1', ['r1']), member('m2', ['r1'])],
      weeks: weeks(4),
    };
    const disabled = rule(
      {
        type: 'fixed_assignment',
        memberId: 'm2',
        roleId: 'r1',
        dates: [weekDate(0)],
        onlyPinnedDates: true,
        onlyRoleIds: [],
      },
      { enabled: false },
    );
    expect(runScheduler(makeProject({ ...parts, constraints: [disabled] })).weeks).toEqual(
      runScheduler(makeProject(parts)).weeks,
    );
  });
});

// ── 引擎：預先扣除 ──────────────────────────────────────────────────────────

describe('§7.12.3 預先扣除', () => {
  it('整梯次上限 3 次、指定 2 天：指定日期以外只排 1 次', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1']), member('m2', ['r1'], busy(4))],
        weeks: weeks(6),
        constraints: [
          rule({ type: 'max_total_per_term', memberId: 'm1', max: 3 }),
          pin('m1', 'r1', [weekDate(4), weekDate(5)]),
        ],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], [], [], [], ['m1'], ['m1']]);
    expect(reasonOf(result, 1, 'r1', 'm1')).toEqual({
      kind: 'max_total_per_term',
      max: 3,
      reserved: 2,
    });
  });

  it('每月上限只扣同一個月的指定', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1']), member('m2', ['r1'], busy(3))],
        weeks: weeks(4),
        constraints: [
          rule({ type: 'max_per_month', memberId: 'm1', max: 2, roleId: null }),
          pin('m1', 'r1', [weekDate(3)]),
        ],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], [], [], ['m1']]);
    expect(reasonOf(result, 1, 'r1', 'm1')).toEqual({
      kind: 'max_per_month',
      max: 2,
      roleId: null,
      reserved: 1,
    });
  });

  it('某個位置整梯次上限扣掉這個位置的指定', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1']), member('m2', ['r1'], busy(2))],
        weeks: weeks(3),
        constraints: [
          rule({ type: 'max_per_term_role', memberId: 'm1', roleId: 'r1', max: 2 }),
          pin('m1', 'r1', [weekDate(2)]),
        ],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], [], ['m1']]);
    expect(reasonOf(result, 1, 'r1', 'm1')).toEqual({
      kind: 'max_per_term_role',
      max: 2,
      reserved: 1,
    });
  });

  it('間隔週數也往後看：之後的指定太近就不排', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1']), member('m2', ['r1'], [weekDate(1)])],
        weeks: weeks(3),
        constraints: [
          rule({ type: 'role_frequency', roleId: 'r1', minGapWeeks: 2, maxPerTerm: 10 }),
          pin('m1', 'r1', [weekDate(2)]),
        ],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m2'], [], ['m1']]);
    expect(reasonOf(result, 1, 'r1', 'm1')).toEqual({
      kind: 'role_frequency_gap',
      minGapWeeks: 2,
      ahead: true,
    });
  });

  it('連續兩週：下一週起連著的指定也算進去', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1']), member('m2', ['r1'], [weekDate(1)])],
        weeks: weeks(4),
        constraints: [
          rule({ type: 'max_consecutive_weeks_per_member', max: 1 }),
          pin('m1', 'r1', [weekDate(2), weekDate(3)]),
        ],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m2'], [], ['m1'], ['m1']]);
    expect(reasonOf(result, 1, 'r1', 'm1')).toEqual({
      kind: 'max_consecutive_weeks',
      max: 1,
      reserved: 2,
    });
  });

  it('最少排幾次與排序都看有效次數：靠指定達標的人不會被提前', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1')],
        members: [member('m1', ['r1']), member('m2', ['r1'])],
        weeks: weeks(4),
        constraints: [
          rule({ type: 'min_per_term', memberId: 'm1', min: 2, roleId: null }),
          pin('m1', 'r1', [weekDate(2), weekDate(3)]),
        ],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m2'], ['m2'], ['m1'], ['m1']]);
    expect(softCodes(result)).not.toContain('min_per_term_missed');
  });

  it('紅色警告的原因寫出含之後指定的次數', () => {
    const project = makeProject({
      roles: [role('r1')],
      members: [member('m1', ['r1']), member('m2', ['r1'], busy(2))],
      weeks: weeks(3),
      constraints: [
        rule({ type: 'max_total_per_term', memberId: 'm1', max: 2 }),
        pin('m1', 'r1', [weekDate(2)]),
      ],
    });
    const view = buildView(project, runScheduler(project));
    expect(view.warnings[0].blocked.find((entry) => entry.name === 'm1')?.reason).toBe(
      '整梯次最多 2 次已經用完（含之後指定的 1 次）',
    );
  });
});

// ── 引擎：只能排指定日期 ────────────────────────────────────────────────────

describe('§7.12.4 只能排指定日期', () => {
  it('限制位置留空：整個梯次只服事指定的那幾天', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1'), role('r2')],
        members: [
          member('m1', ['r1', 'r2']),
          member('m2', ['r1', 'r2']),
          member('m3', ['r1', 'r2']),
        ],
        weeks: weeks(3),
        constraints: [
          rule({ type: 'one_role_per_week' }),
          pin('m1', 'r1', [weekDate(1)], []),
        ],
      }),
    );
    const served = result.weeks.flatMap((week, index) =>
      Object.entries(week.assignments)
        .filter(([, members]) => members.includes('m1'))
        .map(([roleId]) => `${index}:${roleId}`),
    );
    expect(served).toEqual(['1:r1']);
  });

  it('只限制選到的位置：其他位置照常排', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1'), role('r2')],
        members: [member('m1', ['r1', 'r2']), member('m2', ['r1'])],
        weeks: weeks(3),
        constraints: [pin('m1', 'r1', [weekDate(1)], ['r1'])],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m2'], ['m1'], ['m2']]);
    expect(assignmentsOf(result.weeks, 'r2')).toEqual([['m1'], ['m1'], ['m1']]);
  });

  it('不擋這個人其他卡片上的指定', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1'), role('r2')],
        members: [member('m1', ['r1', 'r2'])],
        weeks: weeks(2),
        constraints: [pin('m1', 'r1', [weekDate(0)], []), pin('m1', 'r2', [weekDate(1)])],
      }),
    );
    expect(result.weeks[1].assignments.r2).toEqual(['m1']);
    expect(softCodes(result)).not.toContain('pinned_over_rule');
  });
});

// ── 引擎：三種策略 ──────────────────────────────────────────────────────────

describe('§7.12.2 單純填滿', () => {
  const parts = {
    roles: [role('r1', { perWeek: 2 })],
    members: [member('m1', ['r1']), member('m2', ['r1']), member('m3', ['r1'])],
    weeks: weeks(1),
  };

  it('只補剩下的格子', () => {
    const result = runScheduler(
      makeProject({ ...parts, constraints: [pin('m3', 'r1', [weekDate(0)])] }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m3', 'm1']);
  });

  it('「不能同一個位置」把指定的人一起算進去', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          rule({ type: 'forbidden_together', roleId: 'r1', memberIds: ['m3', 'm1'], mode: 'any_two' }),
          pin('m3', 'r1', [weekDate(0)]),
        ],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m3', 'm2']);
  });

  it('一個人都補不上：只排到指定的人，記 partially_filled', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1', { perWeek: 2 })],
        members: [member('m1', ['r1']), member('m2', ['r1'], [weekDate(0)])],
        weeks: weeks(1),
        constraints: [pin('m1', 'r1', [weekDate(0)])],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m1']);
    expect(result.weeks[0].warnings).toEqual([
      {
        roleId: 'r1',
        code: 'partially_filled',
        message: 'r1只排到 1 人（需要 2 人）',
        blocked: [{ memberId: 'm2', reason: { kind: 'unavailable' } }],
      },
    ]);
  });
});

describe('§7.12.2 成對位置', () => {
  const members = [member('a', ['L']), member('b', ['L']), member('x', ['P']), member('y', ['P'])];
  const roles = [role('L', { pairsWith: 'P' }), role('P')];
  const prefer = rule({
    type: 'preferred_role_combination',
    when: { memberId: 'b', roleId: 'L' },
    prefer: { memberId: 'y', roleId: 'P' },
  });

  it('只指定主角色：配角照原本的順序配給他（偏好搭配）', () => {
    const result = runScheduler(
      makeProject({ roles, members, weeks: weeks(1), constraints: [prefer, pin('b', 'L', [weekDate(0)])] }),
    );
    expect(result.weeks[0].assignments).toEqual({ L: ['b'], P: ['y'] });
  });

  it('只指定配角：先找能跟他配的主角色', () => {
    const result = runScheduler(
      makeProject({ roles, members, weeks: weeks(1), constraints: [prefer, pin('y', 'P', [weekDate(0)])] }),
    );
    expect(result.weeks[0].assignments).toEqual({ L: ['b'], P: ['y'] });
  });

  it('兩格都指定：不再動', () => {
    const result = runScheduler(
      makeProject({
        roles,
        members,
        weeks: weeks(1),
        constraints: [prefer, pin('a', 'L', [weekDate(0)]), pin('x', 'P', [weekDate(0)])],
      }),
    );
    expect(result.weeks[0].assignments).toEqual({ L: ['a'], P: ['x'] });
    expect(result.weeks[0].warnings).toEqual([]);
  });

  it('配不出另一格：留空並記 partially_filled', () => {
    const result = runScheduler(
      makeProject({
        roles,
        members: [
          member('a', ['L']),
          member('x', ['P'], [weekDate(0)]),
          member('y', ['P'], [weekDate(0)]),
        ],
        weeks: weeks(1),
        constraints: [pin('a', 'L', [weekDate(0)])],
      }),
    );
    expect(result.weeks[0].assignments).toEqual({ L: ['a'], P: [] });
    expect(result.weeks[0].warnings.map((warning) => [warning.roleId, warning.code, warning.message])).toEqual([
      ['P', 'partially_filled', '無法排定P（L已排定）'],
    ]);
  });
});

describe('§7.12.2 輪替群組', () => {
  function project(pinned: string, unavailable: Record<string, string[]> = {}): Project {
    return makeProject({
      roles: [role('R', { perWeek: 2 })],
      members: ['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => member(id, ['R'], unavailable[id] ?? [])),
      weeks: weeks(1),
      constraints: [
        rule({
          type: 'rotation_groups',
          roleId: 'R',
          groups: [
            ['m1', 'm2'],
            ['m3', 'm4'],
          ],
          cycleBy: 'week',
        }),
        pin(pinned, 'R', [weekDate(0)]),
      ],
    });
  }

  it('指定的人所在的那一組優先', () => {
    const result = runScheduler(project('m3'));
    expect(result.weeks[0].assignments.R).toEqual(['m3', 'm4']);
    expect(result.softViolations).toEqual([]);
  });

  it('指定的人不在任何一組：照輪替順序由組員補，指定的人不算替補', () => {
    const result = runScheduler(project('m5'));
    expect(result.weeks[0].assignments.R).toEqual(['m5', 'm1']);
    expect(softCodes(result)).not.toContain('rotation_substituted');
  });

  it('那一組補不滿才找替補，替補名單裡沒有指定的人', () => {
    const result = runScheduler(project('m3', { m4: [weekDate(0)] }));
    expect(result.weeks[0].assignments.R).toEqual(['m3', 'm1']);
    const substituted = result.softViolations.find((item) => item.code === 'rotation_substituted');
    expect(substituted?.message).toBe('R的固定組合被拆開，由 m1 替補');
  });
});

// ── 卡片：說明、紅字、橘字 ──────────────────────────────────────────────────

describe('§7.12.5 卡片的欄位檢查', () => {
  const tag = { id: 't1', label: '聖餐週', rule: { kind: 'manual' as const } };
  function project(constraints: Constraint[], unavailable: string[] = []): Project {
    return makeProject({
      roles: [role('r1'), role('r2', { tagId: 't1' })],
      members: [member('m1', ['r1', 'r2'], unavailable), member('m2', ['r1']), member('m3', ['r1'])],
      weeks: [
        { date: weekDate(0), tags: ['t1'] },
        { date: weekDate(1), tags: [] },
      ],
      weekTags: [tag],
      constraints,
    });
  }

  it('說明寫出人、日期、位置與限制', () => {
    const card = pin('m1', 'r1', [weekDate(1), weekDate(0)], ['r1', 'r2']);
    expect(describeConstraint(project([card]), card)).toBe(
      'm1 在 01/04、01/11 擔任 r1；指定日期以外不排r1、r2',
    );
    const all = pin('m1', 'r1', [], []);
    expect(describeConstraint(project([all]), all)).toBe(
      'm1 在 （還沒選日期） 擔任 r1；指定日期以外不排任何位置',
    );
  });

  it('填完、沒有對不上的地方就沒有紅字', () => {
    const card = pin('m1', 'r1', [weekDate(0)]);
    expect(validateConstraint(project([card]), card)).toEqual([]);
  });

  it('紅字：沒登記、不行的日期、不是聚會日、位置那週不排', () => {
    const card = pin('m2', 'r2', [weekDate(1)]);
    expect(validateConstraint(project([card]), card)).toEqual([
      'm2沒有登記r2這個位置',
      'r2在 01/11 不排',
    ]);
    const off = pin('m1', 'r1', [weekDate(0), '2026-01-05']);
    expect(validateConstraint(project([off], [weekDate(0)]), off)).toEqual([
      '01/04 是m1不行的日期',
      '01/05 不是這個梯次的聚會日',
    ]);
  });

  it('紅字：同一天兩個位置（有一人兩職的例外就不算）', () => {
    const first = pin('m1', 'r1', [weekDate(0)]);
    const second = pin('m1', 'r2', [weekDate(0)]);
    expect(validateConstraint(project([first, second]), first)).toEqual([
      '01/04 m1同時被指定為r1和r2',
    ]);
    const dual = rule({ type: 'dual_role_exception', memberId: 'm1', roleIds: ['r1', 'r2'] });
    expect(validateConstraint(project([first, second, dual]), first)).toEqual([]);
  });

  it('紅字：指定的人數超過每週需要的人數', () => {
    const first = pin('m1', 'r1', [weekDate(1)]);
    const second = pin('m2', 'r1', [weekDate(1)]);
    expect(validateConstraint(project([first, second]), second)).toEqual([
      '01/11 指定為r1的有 2 人，每週只需要 1 人',
    ]);
  });

  it('橘字：超過上限、不能同一個位置、日期範圍；沒有衝突就沒有', () => {
    const card = pin('m1', 'r1', [weekDate(0), weekDate(1)]);
    expect(constraintNotices(project([card]), card)).toEqual([]);

    const total = rule({ type: 'max_total_per_term', memberId: 'm1', max: 1 });
    const month = rule({ type: 'max_per_month', memberId: null, max: 1, roleId: null });
    const window = rule({ type: 'availability_window', memberId: 'm1', until: weekDate(0) });
    const together = rule({
      type: 'forbidden_together',
      roleId: 'r1',
      memberIds: ['m1', 'm2'],
      mode: 'any_two',
    });
    const other = pin('m2', 'r1', [weekDate(1)]);
    const notices = constraintNotices(project([card, total, month, window, together, other]), card);
    expect(notices).toEqual([
      '整梯次指定了 2 次，超過「m1 整梯次最多 1 次」',
      '1 月指定了 2 次，超過「每一個人 每月最多 1 次（所有位置合計）」',
      '01/11 不在「m1 只能排在 2026-01-04（含）之前」的範圍內',
      '01/11 跟「r1 的 m1、m2 之中，任兩人不能同一週」衝突',
    ]);
    // 橘字不擋產生班表
    expect(validateConstraint(project([card, total, month, window, together]), card)).toEqual([]);
  });
});

describe('§7.12.6 刪除連動', () => {
  const base = makeProject({
    roles: [role('r1'), role('r2'), role('r3')],
    members: [member('m1', ['r1', 'r2', 'r3']), member('m2', ['r1'])],
    weeks: weeks(2),
  });

  it('刪人、刪卡片的位置：整張移除', () => {
    const card = pin('m1', 'r1', [weekDate(0)]);
    const project = { ...base, constraints: [card] };
    expect(removeMembers(project, ['m1']).constraints).toEqual([]);
    expect(removeRole(project, 'r1').constraints).toEqual([]);
  });

  it('刪掉「限制哪些位置」裡的位置：從清單拿掉，拿到空了改回照常排', () => {
    const card = pin('m1', 'r1', [weekDate(0)], ['r2', 'r3']);
    const project = { ...base, constraints: [card] };
    expect(roleRemovalImpact(project, 'r2')).toEqual({ removed: 0, modified: 1 });

    const once = removeRole(project, 'r2');
    expect(once.constraints[0]).toMatchObject({ onlyPinnedDates: true, onlyRoleIds: ['r3'] });
    const twice = removeRole(once, 'r3');
    expect(twice.constraints[0]).toMatchObject({ onlyPinnedDates: false, onlyRoleIds: [] });
  });
});

describe('§7.12.1 限制條件 JSON', () => {
  it('省略「指定日期以外」的欄位＝照常排', () => {
    const project = makeProject({
      roles: [role('r1')],
      members: [member('m1', ['r1'])],
      weeks: weeks(1),
    });
    const parsed = parseConstraintsJson(
      JSON.stringify([
        { type: 'fixed_assignment', memberId: 'm1', roleId: 'r1', dates: [weekDate(0)] },
      ]),
      project,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.constraints[0]).toMatchObject({
        type: 'fixed_assignment',
        hard: true,
        onlyPinnedDates: false,
        onlyRoleIds: [],
      });
    }
  });
});

// ── 不行日期的 Excel ────────────────────────────────────────────────────────

describe('§7.12.7 不行日期的 Excel', () => {
  const project = makeProject({
    roles: [role('r1')],
    members: [
      member('m1', ['r1'], [weekDate(2), weekDate(0), '2025-12-28']),
      member('m2', ['r1']),
      { ...member('m3', ['r1'], [weekDate(1)]), name: '  ' },
    ],
    weeks: weeks(3),
  });

  it('一人一列，日期排序、只列聚會日；沒有的人留空', () => {
    expect(unavailableRows(project)).toEqual([
      { name: 'm1', dates: '01/04、01/18' },
      { name: 'm2', dates: '' },
      { name: '（未命名）', dates: '01/11' },
    ]);
  });

  it('檔名帶梯次名稱', () => {
    expect(unavailableFilename(project)).toBe('不行日期_測試梯次.xlsx');
  });

  it('步驟 4 的獨立檔只有一張「人｜不行日期」', async () => {
    const wb = await buildUnavailableWorkbook(project);
    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual(['不行日期']);
    const sheet = wb.getWorksheet('不行日期');
    expect([sheet?.getCell(1, 1).value, sheet?.getCell(1, 2).value]).toEqual(['人', '不行日期']);
    expect([sheet?.getCell(2, 1).value, sheet?.getCell(2, 2).value]).toEqual(['m1', '01/04、01/18']);
    expect(sheet?.getCell(3, 2).value).toBe('');
  });

  it('班表的 Excel 最後一張是「不行日期」', async () => {
    const wb = await buildWorkbook(project, runScheduler(project));
    const names = wb.worksheets.map((sheet) => sheet.name);
    expect(names[names.length - 1]).toBe('不行日期');
  });
});
