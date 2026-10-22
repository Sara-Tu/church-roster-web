/** 規則單元測試用的最小專案建構器。每個測試只放剛好夠用的角色、人員與週次。 */

import { SCHEMA_VERSION } from '../src/engine';
import type { Constraint, Member, Project, Role, Week, WeekTag } from '../src/engine';

const MS_PER_DAY = 86_400_000;

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

export function role(
  id: string,
  options: { perWeek?: number; pairsWith?: string; tagId?: string } = {},
): Role {
  return {
    id,
    name: id,
    perWeek: options.perWeek ?? 1,
    appliesTo:
      options.tagId === undefined
        ? { kind: 'all' }
        : { kind: 'weekTag', tagId: options.tagId },
    ...(options.pairsWith === undefined ? {} : { pairsWith: options.pairsWith }),
  };
}

export function member(id: string, roles: string[], unavailable: string[] = []): Member {
  return { id, name: id, roles, unavailable };
}

/** 從 2026-01-04 起每七天一次聚會；1 月剛好有四次，方便測每月上限 */
export function weeks(count: number, start = '2026-01-04', tags: string[] = []): Week[] {
  return Array.from({ length: count }, (_, i) => ({
    date: addDays(start, i * 7),
    tags: [...tags],
  }));
}

export function weekDate(index: number, start = '2026-01-04'): string {
  return addDays(start, index * 7);
}

type ConstraintBody<T> = T extends unknown ? Omit<T, 'id' | 'hard' | 'enabled'> : never;

let counter = 0;

export function rule(
  body: ConstraintBody<Constraint>,
  options: { hard?: boolean; enabled?: boolean } = {},
): Constraint {
  counter += 1;
  return {
    id: `c${counter}`,
    hard: options.hard ?? true,
    enabled: options.enabled ?? true,
    ...body,
  } as Constraint;
}

export function makeProject(parts: {
  roles: Role[];
  members: Member[];
  weeks: Week[];
  constraints?: Constraint[];
  weekTags?: WeekTag[];
}): Project {
  const termWeeks = parts.weeks;
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: 'test',
    exportedAt: '2026-01-01',
    church: { name: '測試教會', note: '' },
    term: {
      name: '測試梯次',
      start: termWeeks[0]?.date ?? '2026-01-04',
      end: termWeeks[termWeeks.length - 1]?.date ?? '2026-01-04',
      weeks: termWeeks,
    },
    weekTags: parts.weekTags ?? [],
    roles: parts.roles,
    members: parts.members,
    constraints: parts.constraints ?? [],
    revision: 0,
  };
}

/** 把排班結果壓成「每週每個角色是誰」的簡表，方便斷言 */
export function assignmentsOf(
  weeksResult: readonly { assignments: Record<string, string[]> }[],
  roleId: string,
): string[][] {
  return weeksResult.map((week) => week.assignments[roleId] ?? []);
}
