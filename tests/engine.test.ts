/**
 * 引擎行為測試：§6.2 的既有缺陷、§6.4.8 全有或全無、§6.4.9 的 warning 與
 * softViolations、以及 enabled / appliesTo 的處理。
 */

import { describe, expect, it } from 'vitest';
import { ProjectValidationError, runScheduler } from '../src/engine';
import type { Project } from '../src/engine';
import { makeProject, member, role, rule, weekDate, weeks } from './helpers';

describe('enabled: false 的規則完全不生效', () => {
  it('停用 one_role_per_week 之後同一人可以兼兩個角色', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1'), role('r2')],
        members: [member('m1', ['r1', 'r2'])],
        weeks: weeks(1),
        constraints: [rule({ type: 'one_role_per_week' }, { enabled: false })],
      }),
    );
    expect(result.weeks[0].assignments).toEqual({ r1: ['m1'], r2: ['m1'] });
  });
});

describe('缺陷 #1：輪替群組為空時不會崩潰', () => {
  it('groups 是空陣列時直接走人員池', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1', { perWeek: 2 })],
        members: [member('m1', ['r1']), member('m2', ['r1'])],
        weeks: weeks(1),
        constraints: [
          rule({ type: 'rotation_groups', roleId: 'r1', groups: [], cycleBy: 'week' }, { hard: false }),
        ],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m1', 'm2']);
    expect(result.softViolations.map((v) => v.code)).toEqual(['rotation_fallback']);
  });
});

describe('缺陷 #3：參照不存在就丟出明確錯誤', () => {
  const base = {
    roles: [role('r1')],
    members: [member('m1', ['r1'])],
    weeks: weeks(1),
  };

  it('限制條件指向不存在的人員', () => {
    const project = makeProject({
      ...base,
      constraints: [rule({ type: 'max_per_month', memberId: 'm9', max: 1, roleId: null })],
    });
    expect(() => runScheduler(project)).toThrow(ProjectValidationError);
    expect(() => runScheduler(project)).toThrow(/不存在的人員：m9/);
  });

  it('人員帶著不存在的角色', () => {
    const project = makeProject({ ...base, members: [member('m1', ['r9'])] });
    expect(() => runScheduler(project)).toThrow(/不存在的角色：r9/);
  });

  it('不行日期格式錯誤（缺陷 #2 在引擎層的防線）', () => {
    const project = makeProject({ ...base, members: [member('m1', ['r1'], ['2026/01/04'])] });
    expect(() => runScheduler(project)).toThrow(/不是合法的 YYYY-MM-DD/);
  });

  it('聚會日期沒有依序遞增', () => {
    const project = makeProject({
      ...base,
      weeks: [
        { date: '2026-01-11', tags: [] },
        { date: '2026-01-04', tags: [] },
      ],
    });
    expect(() => runScheduler(project)).toThrow(/沒有依序遞增/);
  });

  it('pairsWith 指向自己或不存在的角色', () => {
    expect(() =>
      runScheduler(makeProject({ ...base, roles: [role('r1', { pairsWith: 'r1' })] })),
    ).toThrow(/pairsWith 指向自己/);
    expect(() =>
      runScheduler(makeProject({ ...base, roles: [role('r1', { pairsWith: 'r9' })] })),
    ).toThrow(/pairsWith 指向不存在的角色/);
  });

  it('成對關係不能接力', () => {
    const project = makeProject({
      roles: [role('r1', { pairsWith: 'r2' }), role('r2', { pairsWith: 'r3' }), role('r3')],
      members: [member('m1', ['r1', 'r2', 'r3'])],
      weeks: weeks(1),
    });
    expect(() => runScheduler(project)).toThrow(/成對關係不能接力/);
  });

  it('角色 id 重複', () => {
    const project = makeProject({ ...base, roles: [role('r1'), role('r1')] });
    expect(() => runScheduler(project)).toThrow(/重複的角色 id/);
  });

  it('錯誤物件帶著完整的問題清單', () => {
    const project = makeProject({ ...base, members: [member('m1', ['r9'], ['bad-date'])] });
    try {
      runScheduler(project);
      expect.unreachable('應該要丟出 ProjectValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectValidationError);
      expect((error as ProjectValidationError).issues).toHaveLength(2);
    }
  });

  it('schemaVersion 不符時拒絕執行', () => {
    const project = { ...makeProject(base), schemaVersion: 2 } as Project;
    expect(() => runScheduler(project)).toThrow(/只支援 1/);
  });
});

describe('§6.4.8 全有或全無', () => {
  it('湊不滿 perWeek 時整個角色留空並記 warning', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1', { perWeek: 2 })],
        members: [member('m1', ['r1'])],
        weeks: weeks(1),
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual([]);
    expect(result.weeks[0].warnings).toEqual([
      {
        roleId: 'r1',
        code: 'unfilled',
        message: '無法排定r1（人數不足）',
        // 排不出來的原因（規格 §7.9.4）：m1 本身排得上，是湊不滿 2 人才留空
        blocked: [{ memberId: 'm1', reason: null }],
      },
    ]);
  });
});

describe('appliesTo：只在特定週次需要的角色', () => {
  it('沒有該標籤的週不會出現這個角色的欄位', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1'), role('r2', { tagId: 'special' })],
        members: [member('m1', ['r1']), member('m2', ['r2'])],
        weeks: [
          { date: weekDate(0), tags: ['special'] },
          { date: weekDate(1), tags: [] },
        ],
        weekTags: [{ id: 'special', label: '特殊週', rule: { kind: 'manual' } }],
      }),
    );
    expect(result.weeks[0].assignments).toEqual({ r1: ['m1'], r2: ['m2'] });
    expect(result.weeks[1].assignments).toEqual({ r1: ['m1'] });
  });
});

describe('§6.4.9 softViolations', () => {
  const rotation = rule(
    { type: 'rotation_groups', roleId: 'r1', groups: [['m1', 'm2']], cycleBy: 'week' as const },
    { hard: false },
  );

  it('固定組合被拆開時記 rotation_substituted', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1', { perWeek: 2 })],
        members: [
          member('m1', ['r1']),
          member('m2', ['r1'], [weekDate(0)]),
          member('m3', ['r1']),
        ],
        weeks: weeks(1),
        constraints: [rotation],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m1', 'm3']);
    expect(result.softViolations).toEqual([
      {
        date: weekDate(0),
        roleId: 'r1',
        code: 'rotation_substituted',
        message: 'r1的固定組合被拆開，由 m3 替補',
        // 原本那一組的人分別卡在哪裡（規格 §7.10.1）
        blocked: [
          { memberId: 'm1', reason: null },
          { memberId: 'm2', reason: { kind: 'unavailable' } },
        ],
      },
    ]);
  });

  it('動用最後手段人員時記 last_resort_used', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1', { perWeek: 2 })],
        members: [
          member('m1', ['r1']),
          member('m2', ['r1'], [weekDate(0)]),
          member('m3', ['r1']),
        ],
        weeks: weeks(1),
        constraints: [
          rotation,
          rule(
            { type: 'substitute_priority', roleId: 'r1', prefer: [], lastResort: ['m3'] },
            { hard: false },
          ),
        ],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m1', 'm3']);
    expect(result.softViolations.map((v) => v.code)).toEqual([
      'rotation_substituted',
      'last_resort_used',
    ]);
  });
});

describe('禁止配對無法迴避時仍然排出來但記 warning', () => {
  it('人員池湊不出合法組合', () => {
    const result = runScheduler(
      makeProject({
        roles: [role('r1', { perWeek: 2 })],
        members: [member('m1', ['r1']), member('m2', ['r1'])],
        weeks: weeks(1),
        constraints: [
          rule(
            {
              type: 'rotation_groups',
              roleId: 'r1',
              groups: [['m1', 'm2']],
              cycleBy: 'week',
            },
            { hard: false },
          ),
          rule({
            type: 'forbidden_together',
            roleId: 'r1',
            memberIds: ['m1', 'm2'],
            mode: 'any_two',
          }),
        ],
      }),
    );
    expect(result.weeks[0].assignments.r1).toEqual(['m1', 'm2']);
    expect(result.weeks[0].warnings.map((w) => w.code)).toEqual(['forbidden_pair_unavoidable']);
  });
});
