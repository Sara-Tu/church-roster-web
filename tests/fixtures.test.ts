import { describe, expect, it } from 'vitest';
import projectJson from './fixtures/sample-project.json';
import goldenJson from './fixtures/golden-roster.json';
import { SCHEMA_VERSION, type GoldenRoster, type Project } from '../src/engine/schema';

const project = projectJson as unknown as Project;
const golden = goldenJson as unknown as GoldenRoster;

const CONSTRAINT_TYPES = new Set([
  'one_role_per_week',
  'dual_role_exception',
  'forbidden_role_combination',
  'required_pair',
  'max_per_month',
  'max_per_term_role',
  'max_total_per_term',
  'availability_window',
  'role_frequency',
  'rotation_groups',
  'max_consecutive_same_group',
  'max_consecutive_weeks_per_member',
  'forbidden_together',
  'substitute_priority',
  'preferred_role_combination',
]);

const memberIds = new Set(project.members.map((m) => m.id));
const roleById = new Map(project.roles.map((r) => [r.id, r]));
const memberById = new Map(project.members.map((m) => [m.id, m]));

/** 遞迴收集物件裡所有 memberId / roleId 參照 */
function collectRefs(value: unknown, refs: { members: string[]; roles: string[] }): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'memberId' && typeof item === 'string') refs.members.push(item);
      else if (key === 'roleId' && typeof item === 'string') refs.roles.push(item);
      else if (key === 'memberIds' || key === 'prefer' || key === 'lastResort' || key === 'groups') {
        for (const id of (Array.isArray(item) ? item.flat(2) : []) as unknown[]) {
          if (typeof id === 'string') refs.members.push(id);
        }
      } else if (key === 'roleIds' && Array.isArray(item)) {
        for (const id of item) if (typeof id === 'string') refs.roles.push(id);
      } else {
        collectRefs(item, refs);
      }
    }
  }
}

describe('匿名 fixture', () => {
  it('schema 版本與基本數量', () => {
    expect(project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(project.term.weeks).toHaveLength(26);
    expect(project.members).toHaveLength(28);
    expect(project.roles).toHaveLength(5);
    expect(project.constraints.length).toBeGreaterThan(0);
  });

  it('聚會日期遞增且聖餐週符合「每月第一次聚會」規則', () => {
    const dates = project.term.weeks.map((w) => w.date);
    expect([...dates].sort()).toEqual(dates);

    const firstOfMonth = new Set<string>();
    const seenMonths = new Set<string>();
    for (const date of dates) {
      const month = date.slice(0, 7);
      if (!seenMonths.has(month)) {
        seenMonths.add(month);
        firstOfMonth.add(date);
      }
    }
    const tagged = project.term.weeks.filter((w) => w.tags.includes('communion')).map((w) => w.date);
    expect(new Set(tagged)).toEqual(firstOfMonth);
    expect(tagged).toHaveLength(6);
  });

  it('沒有真實姓名，只有代號', () => {
    for (const member of project.members) {
      expect(member.name).toMatch(/^M\d{2}$/);
    }
  });

  it('每個人的角色與不行日期都合法', () => {
    for (const member of project.members) {
      expect(member.roles.length).toBeGreaterThan(0);
      for (const roleId of member.roles) expect(roleById.has(roleId)).toBe(true);
      for (const date of member.unavailable) {
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('每個角色都有足夠人選填滿每週人數', () => {
    for (const role of project.roles) {
      const pool = project.members.filter((m) => m.roles.includes(role.id));
      expect(pool.length).toBeGreaterThanOrEqual(role.perWeek);
    }
  });

  it('限制條件的型別已知、參照都存在', () => {
    for (const constraint of project.constraints) {
      expect(CONSTRAINT_TYPES.has(constraint.type)).toBe(true);
      const refs = { members: [] as string[], roles: [] as string[] };
      collectRefs(constraint, refs);
      for (const id of refs.members) expect(memberIds.has(id)).toBe(true);
      for (const id of refs.roles) expect(roleById.has(id)).toBe(true);
    }
  });
});

describe('golden 班表（現有 Python 引擎的輸出）', () => {
  it('週次與 fixture 對齊', () => {
    expect(golden.schemaVersion).toBe(SCHEMA_VERSION);
    expect(golden.weeks.map((w) => w.date)).toEqual(project.term.weeks.map((w) => w.date));
    expect(golden.weeks.map((w) => w.tags)).toEqual(project.term.weeks.map((w) => w.tags));
  });

  it('每週每個角色都排滿，且只在適用的週次出現', () => {
    for (const week of golden.weeks) {
      for (const role of project.roles) {
        const applies =
          role.appliesTo.kind === 'all' || week.tags.includes(role.appliesTo.tagId);
        const assigned = week.assignments[role.id];
        if (!applies) {
          expect(assigned).toBeUndefined();
          continue;
        }
        expect(assigned, `${week.date} ${role.name}`).toHaveLength(role.perWeek);
      }
    }
  });

  it('被排到的人都有該角色，且當天沒有說不行', () => {
    for (const week of golden.weeks) {
      for (const [roleId, assigned] of Object.entries(week.assignments)) {
        for (const memberId of assigned) {
          const member = memberById.get(memberId);
          expect(member, `${week.date} ${roleId} ${memberId}`).toBeDefined();
          expect(member!.roles).toContain(roleId);
          expect(member!.unavailable).not.toContain(week.date);
        }
      }
    }
  });

  it('同一人同一週只排一個角色（雙角色例外除外）', () => {
    const dualRoleMembers = new Set(
      project.constraints
        .filter((c) => c.type === 'dual_role_exception')
        .map((c) => (c as { memberId: string }).memberId),
    );

    for (const week of golden.weeks) {
      const counts = new Map<string, number>();
      for (const assigned of Object.values(week.assignments)) {
        for (const memberId of assigned) {
          counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
        }
      }
      for (const [memberId, count] of counts) {
        if (count > 1) expect(dualRoleMembers.has(memberId), `${week.date} ${memberId}`).toBe(true);
      }
    }
  });

  it('沒有警告（現有資料應該全部排得出來）', () => {
    expect(golden.weeks.flatMap((w) => w.warnings)).toHaveLength(0);
  });
});
