/**
 * id 流水號。載入專案時由現有 id 的數字尾碼推導起點，不存進專案檔
 * （不為了一個計數器動 schemaVersion，規格 §7.5.3）。
 */

import type { Project } from '../engine';

export type IdPrefix = 'r' | 'm' | 'c';

export type IdCounters = Record<IdPrefix, number>;

function highest(ids: Iterable<string>, prefix: IdPrefix): number {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const id of ids) {
    const matched = pattern.exec(id);
    if (matched === null) continue;
    max = Math.max(max, Number(matched[1]));
  }
  return max;
}

export function initCounters(project: Project): IdCounters {
  return {
    r: highest(
      project.roles.map((role) => role.id),
      'r',
    ),
    m: highest(
      project.members.map((member) => member.id),
      'm',
    ),
    c: highest(
      project.constraints.map((constraint) => constraint.id),
      'c',
    ),
  };
}

/** 回傳新的 id 與遞增過的計數器；刪除過的號碼不重用 */
export function takeId(
  counters: IdCounters,
  prefix: IdPrefix,
): { id: string; counters: IdCounters } {
  const next = counters[prefix] + 1;
  return { id: `${prefix}${next}`, counters: { ...counters, [prefix]: next } };
}
