/** 服事位置（步驟 2）的純函式。規格 §7.5.5。 */

import type { Member, Role, RoleId, WeekTagId } from '../engine';

/**
 * 空白起步時帶的 5 個角色（規格 §12 決定 12）。
 * id 固定 r1–r5，因為只有全新的空白專案會用到這組資料。
 */
export function defaultRoles(tagId: WeekTagId): Role[] {
  return [
    { id: 'r1', name: '領會', perWeek: 1, appliesTo: { kind: 'all' }, pairsWith: 'r2' },
    { id: 'r2', name: '司琴', perWeek: 1, appliesTo: { kind: 'all' } },
    { id: 'r3', name: '音控', perWeek: 2, appliesTo: { kind: 'all' } },
    { id: 'r4', name: '招待', perWeek: 2, appliesTo: { kind: 'all' } },
    { id: 'r5', name: '聖餐', perWeek: 2, appliesTo: { kind: 'weekTag', tagId } },
  ];
}

export function candidateCount(members: readonly Member[], roleId: RoleId): number {
  return members.filter((member) => member.roles.includes(roleId)).length;
}

/**
 * 「一起排」下拉可以選的對象：
 * 不能選自己、不能選已經指向別人的角色（成對關係不能接力）、
 * 也不能選已經被別人指走的角色（兩個主角色搶同一個配角）。
 */
export function pairOptions(roles: readonly Role[], roleId: RoleId): Role[] {
  const current = roles.find((role) => role.id === roleId);
  const takenBy = new Map<RoleId, RoleId>();
  for (const role of roles) {
    if (role.pairsWith !== undefined) takenBy.set(role.pairsWith, role.id);
  }

  return roles.filter((role) => {
    if (role.id === roleId) return false;
    if (role.id === current?.pairsWith) return true;
    if (role.pairsWith !== undefined) return false;
    const owner = takenBy.get(role.id);
    return owner === undefined || owner === roleId;
  });
}

/** 被別的角色指為「一起排」的對象，本身不會單獨排一次（規格 §6.4.3） */
export function isPairedPartner(roles: readonly Role[], roleId: RoleId): boolean {
  return roles.some((role) => role.id !== roleId && role.pairsWith === roleId);
}

export function moveRole(roles: readonly Role[], index: number, delta: number): Role[] {
  const target = index + delta;
  if (index < 0 || index >= roles.length || target < 0 || target >= roles.length) {
    return [...roles];
  }
  const next = [...roles];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
