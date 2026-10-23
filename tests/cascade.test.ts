/** 刪除角色 / 人員的連動。規格 §7.5.5、§7.5.6、§7.5.9 */

import { describe, expect, it } from 'vitest';
import {
  memberRemovalImpact,
  membersRemovalImpact,
  removeMember,
  removeMembers,
  removeRole,
  roleRemovalImpact,
} from '../src/store/cascade';
import type { Constraint, Project } from '../src/engine';
import { makeProject, member, role, rule, weeks } from './helpers';

function withConstraints(constraints: Constraint[]): Project {
  return makeProject({
    roles: [role('r1', { pairsWith: 'r2' }), role('r2'), role('r3')],
    members: [member('m1', ['r1', 'r3']), member('m2', ['r2']), member('m3', ['r3'])],
    weeks: weeks(2),
    constraints,
  });
}

describe('removeRole', () => {
  it('從每個人的角色清單裡移除', () => {
    const next = removeRole(withConstraints([]), 'r3');
    expect(next.roles.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(next.members.map((m) => m.roles)).toEqual([['r1'], ['r2'], []]);
  });

  it('清掉指向它的 pairsWith', () => {
    const next = removeRole(withConstraints([]), 'r2');
    expect(next.roles.find((r) => r.id === 'r1')?.pairsWith).toBeUndefined();
  });

  it('參照它的限制條件整條移除，其他留著', () => {
    const project = withConstraints([
      rule({ type: 'one_role_per_week' }),
      rule({ type: 'dual_role_exception', memberId: 'm1', roleIds: ['r1', 'r3'] }),
      rule({ type: 'role_frequency', roleId: 'r3', minGapWeeks: 2, maxPerTerm: 5 }),
      rule({ type: 'max_per_month', memberId: 'm1', max: 2, roleId: null }),
      rule({ type: 'max_consecutive_weeks_per_member', max: 2 }),
    ]);
    expect(roleRemovalImpact(project, 'r3')).toEqual({ removed: 2, modified: 0 });

    const next = removeRole(project, 'r3');
    expect(next.constraints.map((c) => c.type)).toEqual([
      'one_role_per_week',
      'max_per_month',
      'max_consecutive_weeks_per_member',
    ]);
  });

  it('12 種綁角色的規則都認得出來', () => {
    const project = withConstraints([
      rule({ type: 'dual_role_exception', memberId: 'm1', roleIds: ['r3'] }),
      rule({
        type: 'forbidden_role_combination',
        entries: [
          { memberId: 'm1', roleIds: ['r3'] },
          { memberId: 'm3', roleIds: ['r3'] },
        ],
      }),
      rule({
        type: 'required_pair',
        a: { memberId: 'm1', roleId: 'r3' },
        b: { memberId: 'm3', roleId: 'r3' },
        directional: false,
      }),
      rule({ type: 'max_per_month', memberId: 'm1', max: 1, roleId: 'r3' }),
      rule({ type: 'max_per_term_role', memberId: 'm1', roleId: 'r3', max: 3 }),
      rule({ type: 'role_frequency', roleId: 'r3', minGapWeeks: 1, maxPerTerm: 9 }),
      rule({ type: 'rotation_groups', roleId: 'r3', groups: [['m1', 'm3']], cycleBy: 'week' }),
      rule({ type: 'max_consecutive_same_group', roleId: 'r3', max: 2 }),
      rule({ type: 'forbidden_together', roleId: 'r3', memberIds: ['m1', 'm3'], mode: 'any_two' }),
      rule({ type: 'substitute_priority', roleId: 'r3', prefer: ['m1'], lastResort: ['m3'] }),
      rule({
        type: 'preferred_role_combination',
        when: { memberId: 'm1', roleId: 'r3' },
        prefer: { memberId: 'm3', roleId: 'r3' },
      }),
      rule({ type: 'availability_window', memberId: 'm1', from: '2026-01-01' }),
    ]);
    expect(roleRemovalImpact(project, 'r3').removed).toBe(11);
    expect(removeRole(project, 'r3').constraints.map((c) => c.type)).toEqual([
      'availability_window',
    ]);
  });
});

describe('removeMember', () => {
  it('從人員清單移除', () => {
    const next = removeMember(withConstraints([]), 'm2');
    expect(next.members.map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('以這個人為主體的規則整條移除', () => {
    const project = withConstraints([
      rule({ type: 'dual_role_exception', memberId: 'm1', roleIds: ['r1', 'r3'] }),
      rule({ type: 'max_per_month', memberId: 'm1', max: 2, roleId: null }),
      rule({ type: 'max_per_term_role', memberId: 'm1', roleId: 'r1', max: 3 }),
      rule({ type: 'availability_window', memberId: 'm1', until: '2026-03-01' }),
      rule({ type: 'max_total_per_term', memberId: 'm1', max: 8 }),
      rule({
        type: 'required_pair',
        a: { memberId: 'm1', roleId: 'r1' },
        b: { memberId: 'm2', roleId: 'r2' },
        directional: true,
      }),
      rule({
        type: 'preferred_role_combination',
        when: { memberId: 'm1', roleId: 'r1' },
        prefer: { memberId: 'm2', roleId: 'r2' },
      }),
    ]);
    expect(memberRemovalImpact(project, 'm1')).toEqual({ removed: 7, modified: 0 });
    expect(removeMember(project, 'm1').constraints).toEqual([]);
  });

  it('全體適用的 max_total_per_term 留著', () => {
    const project = withConstraints([rule({ type: 'max_total_per_term', memberId: null, max: 8 })]);
    expect(memberRemovalImpact(project, 'm1')).toEqual({ removed: 0, modified: 0 });
    expect(removeMember(project, 'm1').constraints).toHaveLength(1);
  });

  it('名單型欄位只把那個人移掉', () => {
    const project = withConstraints([
      rule({
        type: 'rotation_groups',
        roleId: 'r3',
        groups: [
          ['m1', 'm3'],
          ['m2', 'm3'],
        ],
        cycleBy: 'week',
      }),
      rule({ type: 'forbidden_together', roleId: 'r3', memberIds: ['m1', 'm2', 'm3'], mode: 'any_two' }),
      rule({ type: 'substitute_priority', roleId: 'r3', prefer: ['m1', 'm2'], lastResort: ['m3'] }),
    ]);
    expect(memberRemovalImpact(project, 'm1')).toEqual({ removed: 0, modified: 3 });

    const next = removeMember(project, 'm1');
    expect(next.constraints[0]).toMatchObject({ groups: [['m3'], ['m2', 'm3']] });
    expect(next.constraints[1]).toMatchObject({ memberIds: ['m2', 'm3'] });
    expect(next.constraints[2]).toMatchObject({ prefer: ['m2'], lastResort: ['m3'] });
  });

  it('群組被清空就移掉那一組', () => {
    const project = withConstraints([
      rule({ type: 'rotation_groups', roleId: 'r3', groups: [['m1'], ['m2', 'm3']], cycleBy: 'month' }),
    ]);
    expect(removeMember(project, 'm1').constraints[0]).toMatchObject({ groups: [['m2', 'm3']] });
  });

  it('所有群組都空了就整條移除', () => {
    const project = withConstraints([
      rule({ type: 'rotation_groups', roleId: 'r3', groups: [['m1']], cycleBy: 'week' }),
    ]);
    expect(memberRemovalImpact(project, 'm1')).toEqual({ removed: 1, modified: 0 });
    expect(removeMember(project, 'm1').constraints).toEqual([]);
  });

  it('配對型名單剩不到兩人就整條移除', () => {
    const project = withConstraints([
      rule({ type: 'forbidden_together', roleId: 'r3', memberIds: ['m1', 'm3'], mode: 'any_two' }),
      rule({
        type: 'forbidden_role_combination',
        entries: [
          { memberId: 'm1', roleIds: ['r1'] },
          { memberId: 'm3', roleIds: ['r3'] },
        ],
      }),
    ]);
    expect(memberRemovalImpact(project, 'm1')).toEqual({ removed: 2, modified: 0 });
    expect(removeMember(project, 'm1').constraints).toEqual([]);
  });

  it('substitute_priority 兩個名單都空了才整條移除', () => {
    const project = withConstraints([
      rule({ type: 'substitute_priority', roleId: 'r3', prefer: ['m1'], lastResort: [] }),
    ]);
    expect(memberRemovalImpact(project, 'm1')).toEqual({ removed: 1, modified: 0 });
  });

  it('沒提到這個人的規則原封不動', () => {
    const project = withConstraints([
      rule({ type: 'one_role_per_week' }),
      rule({ type: 'max_consecutive_weeks_per_member', max: 2 }),
      rule({ type: 'role_frequency', roleId: 'r3', minGapWeeks: 1, maxPerTerm: 9 }),
      rule({ type: 'max_consecutive_same_group', roleId: 'r3', max: 2 }),
    ]);
    expect(memberRemovalImpact(project, 'm1')).toEqual({ removed: 0, modified: 0 });
    expect(removeMember(project, 'm1').constraints).toHaveLength(4);
  });
});

describe('removeMembers（批次）', () => {
  it('同一條規則被兩個人影響時只算一次', () => {
    const project = withConstraints([
      rule({
        type: 'forbidden_together',
        roleId: 'r3',
        memberIds: ['m1', 'm2', 'm3'],
        mode: 'any_two',
      }),
    ]);
    // 逐筆相加會得到 2 次修改，批次應該是 1 次
    expect(membersRemovalImpact(project, ['m1', 'm2'])).toEqual({ removed: 1, modified: 0 });
    expect(membersRemovalImpact(project, ['m1'])).toEqual({ removed: 0, modified: 1 });
  });

  it('一次移除多個人，名單型欄位只留下剩下的人', () => {
    const project = withConstraints([
      rule({
        type: 'rotation_groups',
        roleId: 'r3',
        groups: [
          ['m1', 'm2'],
          ['m2', 'm3'],
        ],
        cycleBy: 'week',
      }),
    ]);
    const next = removeMembers(project, ['m1', 'm2']);
    expect(next.members.map((m) => m.id)).toEqual(['m3']);
    expect(next.constraints[0]).toMatchObject({ groups: [['m3']] });
  });

  it('全部清空時連帶清掉所有參照人員的規則', () => {
    const project = withConstraints([
      rule({ type: 'one_role_per_week' }),
      rule({ type: 'max_per_month', memberId: 'm1', max: 2, roleId: null }),
      rule({ type: 'rotation_groups', roleId: 'r3', groups: [['m1', 'm3']], cycleBy: 'week' }),
    ]);
    const next = removeMembers(project, ['m1', 'm2', 'm3']);
    expect(next.members).toEqual([]);
    expect(next.constraints.map((c) => c.type)).toEqual(['one_role_per_week']);
  });

  it('空清單什麼都不動', () => {
    const project = withConstraints([rule({ type: 'one_role_per_week' })]);
    expect(removeMembers(project, [])).toEqual(project);
    expect(membersRemovalImpact(project, [])).toEqual({ removed: 0, modified: 0 });
  });
});
