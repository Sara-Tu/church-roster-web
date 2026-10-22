/**
 * 15 種限制條件的最小單元測試（規格 §6.4.11）。
 * 每一種都有「規則生效」與「規則不生效」兩個案例，用同一份資料對照。
 */

import { describe, expect, it } from 'vitest';
import { runScheduler } from '../src/engine';
import type { Constraint } from '../src/engine';
import { assignmentsOf, makeProject, member, role, rule, weekDate, weeks } from './helpers';

const onePerWeek = (): Constraint => rule({ type: 'one_role_per_week' });

describe('1. one_role_per_week', () => {
  const parts = {
    roles: [role('r1'), role('r2')],
    members: [member('m1', ['r1', 'r2'])],
    weeks: weeks(1),
  };

  it('生效：同一人不會在同一週拿到兩個角色', () => {
    const result = runScheduler(makeProject({ ...parts, constraints: [onePerWeek()] }));
    expect(result.weeks[0].assignments).toEqual({ r1: ['m1'], r2: [] });
    expect(result.weeks[0].warnings.map((w) => w.code)).toEqual(['unfilled']);
  });

  it('不生效：沒有這條規則時同一人可以兼兩個角色', () => {
    const result = runScheduler(makeProject(parts));
    expect(result.weeks[0].assignments).toEqual({ r1: ['m1'], r2: ['m1'] });
  });
});

describe('2. dual_role_exception', () => {
  const parts = {
    roles: [role('r1', { pairsWith: 'r2' }), role('r2')],
    members: [member('m1', ['r1', 'r2'])],
    weeks: weeks(1),
  };

  it('生效：例外人員可以同時擔任成對的兩個角色', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          onePerWeek(),
          rule({ type: 'dual_role_exception', memberId: 'm1', roleIds: ['r1', 'r2'] }),
        ],
      }),
    );
    expect(result.weeks[0].assignments).toEqual({ r1: ['m1'], r2: ['m1'] });
  });

  it('不生效：沒有例外時只有一個人排不出成對角色', () => {
    const result = runScheduler(makeProject({ ...parts, constraints: [onePerWeek()] }));
    expect(result.weeks[0].assignments).toEqual({ r1: [], r2: [] });
    expect(result.weeks[0].warnings.map((w) => w.code)).toEqual(['unfilled']);
  });
});

describe('3. forbidden_role_combination', () => {
  const parts = {
    roles: [role('r1'), role('r2')],
    members: [member('m1', ['r1']), member('m2', ['r2']), member('m3', ['r2'])],
    weeks: weeks(1),
  };

  it('生效：m1 擔任 r1 時 m2 不能擔任 r2', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          rule({
            type: 'forbidden_role_combination',
            entries: [
              { memberId: 'm1', roleIds: ['r1'] },
              { memberId: 'm2', roleIds: ['r2'] },
            ],
          }),
        ],
      }),
    );
    expect(result.weeks[0].assignments).toEqual({ r1: ['m1'], r2: ['m3'] });
  });

  it('不生效：沒有這條規則時 m2 照常被排', () => {
    const result = runScheduler(makeProject(parts));
    expect(result.weeks[0].assignments).toEqual({ r1: ['m1'], r2: ['m2'] });
  });
});

describe('4. required_pair', () => {
  const parts = {
    roles: [role('r1', { pairsWith: 'r2' }), role('r2')],
    members: [
      member('m1', ['r1']),
      member('m2', ['r2']),
      member('m3', ['r1']),
      member('m4', ['r2']),
    ],
    weeks: weeks(1),
  };

  it('生效：指定的配對優先成立', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          rule({
            type: 'required_pair',
            a: { memberId: 'm3', roleId: 'r1' },
            b: { memberId: 'm4', roleId: 'r2' },
            directional: true,
          }),
        ],
      }),
    );
    expect(result.weeks[0].assignments).toEqual({ r1: ['m3'], r2: ['m4'] });
  });

  it('不生效：沒有這條規則時依服事次數挑人', () => {
    const result = runScheduler(makeProject(parts));
    expect(result.weeks[0].assignments).toEqual({ r1: ['m1'], r2: ['m2'] });
  });
});

describe('5. max_per_month', () => {
  const parts = {
    roles: [role('r1')],
    members: [member('m1', ['r1']), member('m2', ['r1'])],
    weeks: weeks(4),
  };

  it('生效：m1 整個月只排一次', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [rule({ type: 'max_per_month', memberId: 'm1', max: 1, roleId: null })],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], ['m2'], ['m2']]);
  });

  it('不生效：沒有上限時兩人輪流', () => {
    const result = runScheduler(makeProject(parts));
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], ['m1'], ['m2']]);
  });
});

describe('6. max_per_term_role', () => {
  const parts = {
    roles: [role('r1')],
    members: [member('m1', ['r1']), member('m2', ['r1'])],
    weeks: weeks(4),
  };

  it('生效：m1 整梯次這個角色只排一次', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [rule({ type: 'max_per_term_role', memberId: 'm1', roleId: 'r1', max: 1 })],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], ['m2'], ['m2']]);
  });

  it('不生效：上限放寬後回到輪流', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [rule({ type: 'max_per_term_role', memberId: 'm1', roleId: 'r1', max: 9 })],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], ['m1'], ['m2']]);
  });
});

describe('7. max_total_per_term', () => {
  const parts = {
    roles: [role('r1')],
    members: [member('m1', ['r1']), member('m2', ['r1']), member('m3', ['r1'])],
    weeks: weeks(4),
  };

  it('生效：每人整梯次只排一次，第四週就排不出來', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [rule({ type: 'max_total_per_term', max: 1, memberId: null })],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], ['m3'], []]);
    expect(result.weeks[3].warnings.map((w) => w.code)).toEqual(['unfilled']);
  });

  it('不生效：沒有總量上限時第四週由 m1 再次服事', () => {
    const result = runScheduler(makeProject(parts));
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], ['m3'], ['m1']]);
  });
});

describe('8. availability_window', () => {
  const parts = {
    roles: [role('r1')],
    members: [member('m1', ['r1']), member('m2', ['r1'])],
    weeks: weeks(4),
  };

  it('生效：m1 只能排在期限之前', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          rule({ type: 'availability_window', memberId: 'm1', until: weekDate(1) }),
        ],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], ['m2'], ['m2']]);
  });

  it('不生效：沒有期限時兩人輪流', () => {
    const result = runScheduler(makeProject(parts));
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m2'], ['m1'], ['m2']]);
  });
});

describe('9. role_frequency', () => {
  const single = {
    roles: [role('r1')],
    members: [member('m1', ['r1'])],
    weeks: weeks(3),
  };

  it('生效（最小間隔）：中間一週空著', () => {
    const result = runScheduler(
      makeProject({
        ...single,
        constraints: [rule({ type: 'role_frequency', roleId: 'r1', minGapWeeks: 2, maxPerTerm: 9 })],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], [], ['m1']]);
  });

  it('生效（梯次上限）：排滿上限後就不再排', () => {
    const result = runScheduler(
      makeProject({
        ...single,
        constraints: [rule({ type: 'role_frequency', roleId: 'r1', minGapWeeks: 0, maxPerTerm: 1 })],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], [], []]);
  });

  it('不生效：沒有這條規則時每週都排', () => {
    const result = runScheduler(makeProject(single));
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m1'], ['m1']]);
  });
});

describe('10. rotation_groups', () => {
  const parts = {
    roles: [role('r1', { perWeek: 2 })],
    members: [
      member('m1', ['r1']),
      member('m2', ['r1']),
      member('m3', ['r1']),
      member('m4', ['r1']),
    ],
    weeks: weeks(2),
  };

  it('生效：依設定的組別順序輪替，而不是依服事次數', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          rule(
            {
              type: 'rotation_groups',
              roleId: 'r1',
              groups: [
                ['m3', 'm4'],
                ['m1', 'm2'],
              ],
              cycleBy: 'week',
            },
            { hard: false },
          ),
        ],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([
      ['m3', 'm4'],
      ['m1', 'm2'],
    ]);
  });

  it('不生效：沒有組別時依服事次數挑人', () => {
    const result = runScheduler(makeProject(parts));
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([
      ['m1', 'm2'],
      ['m3', 'm4'],
    ]);
  });

  it('cycleBy 週 與 月 的輪替基準不同', () => {
    // 五組、五次聚會：1/4、1/11、1/18、1/25、2/1。
    // 第五次聚會是「整體第 5 週」但也是「二月的第 1 次聚會」，兩種基準指向不同組。
    const tenMembers = Array.from({ length: 10 }, (_, i) => member(`m${i + 1}`, ['r1']));
    const groups = [
      ['m1', 'm2'],
      ['m3', 'm4'],
      ['m5', 'm6'],
      ['m7', 'm8'],
      ['m9', 'm10'],
    ];
    const build = (cycleBy: 'week' | 'month') =>
      makeProject({
        roles: [role('r1', { perWeek: 2 })],
        members: tenMembers,
        weeks: weeks(5),
        constraints: [
          rule({ type: 'rotation_groups', roleId: 'r1', groups, cycleBy }, { hard: false }),
        ],
      });

    expect(assignmentsOf(runScheduler(build('week')).weeks, 'r1')[4]).toEqual(['m9', 'm10']);
    expect(assignmentsOf(runScheduler(build('month')).weeks, 'r1')[4]).toEqual(['m1', 'm2']);
  });
});

describe('11. max_consecutive_same_group', () => {
  const parts = {
    roles: [role('r1', { perWeek: 2 })],
    members: [
      member('m1', ['r1']),
      member('m2', ['r1']),
      member('m3', ['r1']),
      member('m4', ['r1']),
    ],
    weeks: weeks(2),
    rotation: rule(
      { type: 'rotation_groups', roleId: 'r1', groups: [['m1', 'm2']], cycleBy: 'week' as const },
      { hard: false },
    ),
  };

  it('生效：同一組不能連續兩週，第二週換人', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          parts.rotation,
          rule({ type: 'max_consecutive_same_group', roleId: 'r1', max: 1 }),
        ],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([
      ['m1', 'm2'],
      ['m3', 'm4'],
    ]);
  });

  it('不生效：沒有上限時同一組連續兩週', () => {
    const result = runScheduler(makeProject({ ...parts, constraints: [parts.rotation] }));
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([
      ['m1', 'm2'],
      ['m1', 'm2'],
    ]);
  });
});

describe('12. max_consecutive_weeks_per_member', () => {
  const parts = {
    roles: [role('r1')],
    members: [member('m1', ['r1'])],
    weeks: weeks(3),
  };

  it('生效：整梯次只允許發生一次連續兩週，第三週就排不出來', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [rule({ type: 'max_consecutive_weeks_per_member', max: 1 })],
      }),
    );
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m1'], []]);
  });

  it('不生效：沒有這條規則時連續三週都排', () => {
    const result = runScheduler(makeProject(parts));
    expect(assignmentsOf(result.weeks, 'r1')).toEqual([['m1'], ['m1'], ['m1']]);
  });
});

describe('13. forbidden_together', () => {
  const rotation = rule(
    { type: 'rotation_groups', roleId: 'r1', groups: [['m1', 'm2']], cycleBy: 'week' as const },
    { hard: false },
  );
  const parts = {
    roles: [role('r1', { perWeek: 2 })],
    members: [
      member('m1', ['r1']),
      member('m2', ['r1']),
      member('m3', ['r1']),
      member('m4', ['r1']),
    ],
    weeks: weeks(1),
  };

  it('生效：名單中的兩人不會同時擔任同一角色（連固定組合本身也檢查）', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          rotation,
          rule({
            type: 'forbidden_together',
            roleId: 'r1',
            memberIds: ['m1', 'm2'],
            mode: 'any_two',
          }),
        ],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m1', 'm3']);
  });

  it('不生效：沒有這條規則時固定組合照常成立', () => {
    const result = runScheduler(makeProject({ ...parts, constraints: [rotation] }));
    expect(result.weeks[0].assignments.r1).toEqual(['m1', 'm2']);
  });
});

describe('14. substitute_priority', () => {
  const rotation = rule(
    { type: 'rotation_groups', roleId: 'r1', groups: [['m1', 'm2']], cycleBy: 'week' as const },
    { hard: false },
  );
  const parts = {
    roles: [role('r1', { perWeek: 2 })],
    members: [
      member('m1', ['r1']),
      // m2 當週不行，必須找替補
      member('m2', ['r1'], [weekDate(0)]),
      member('m3', ['r1']),
      member('m4', ['r1']),
    ],
    weeks: weeks(1),
  };

  it('生效（優先人選）：替補先找 prefer 名單的人', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          rotation,
          rule(
            { type: 'substitute_priority', roleId: 'r1', prefer: ['m4'], lastResort: [] },
            { hard: false },
          ),
        ],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m1', 'm4']);
  });

  it('生效（最後手段）：lastResort 名單的人排到最後', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          rotation,
          rule(
            { type: 'substitute_priority', roleId: 'r1', prefer: [], lastResort: ['m3'] },
            { hard: false },
          ),
        ],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m1', 'm4']);
  });

  it('不生效：沒有這條規則時替補依服事次數與名單順序', () => {
    const result = runScheduler(makeProject({ ...parts, constraints: [rotation] }));
    expect(result.weeks[0].assignments.r1).toEqual(['m1', 'm3']);
  });
});

describe('15. preferred_role_combination', () => {
  const parts = {
    roles: [role('r1', { pairsWith: 'r2' }), role('r2')],
    members: [member('m1', ['r1']), member('m2', ['r2']), member('m3', ['r2'])],
    weeks: weeks(1),
  };

  it('生效：m1 擔任 r1 時優先找 m3 搭配', () => {
    const result = runScheduler(
      makeProject({
        ...parts,
        constraints: [
          rule(
            {
              type: 'preferred_role_combination',
              when: { memberId: 'm1', roleId: 'r1' },
              prefer: { memberId: 'm3', roleId: 'r2' },
            },
            { hard: false },
          ),
        ],
      }),
    );
    expect(result.weeks[0].assignments).toEqual({ r1: ['m1'], r2: ['m3'] });
  });

  it('不生效：沒有偏好時依服事次數挑人', () => {
    const result = runScheduler(makeProject(parts));
    expect(result.weeks[0].assignments).toEqual({ r1: ['m1'], r2: ['m2'] });
  });
});
