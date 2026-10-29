/**
 * 刪除角色 / 人員時對 members 與 constraints 的連動。規格 §7.5.5、§7.5.6。
 *
 * 兩套原則：
 *   - 角色是規則的主軸（幾乎每條規則都綁一個 roleId），少了角色規則就沒有意義
 *     → 整條移除。
 *   - 人是名單的成員 → 名單型欄位只把那個人移掉；以單一人為主體的規則才整條移除。
 *
 * Phase 2 還沒有限制條件的 UI，這些連動要到 Phase 3 匯入既有專案檔才真的用到，
 * 但現在就實作並測試，store 才不會留下只對一半的狀態。
 */

import type { Constraint, MemberId, Project, RoleId } from '../engine';

export interface CascadeImpact {
  /** 會整條移除的限制條件數 */
  removed: number;
  /** 會被改寫（只拿掉其中一個人）的限制條件數 */
  modified: number;
}

// ── 角色 ────────────────────────────────────────────────────────────────────

function mentionsRole(constraint: Constraint, roleId: RoleId): boolean {
  switch (constraint.type) {
    case 'one_role_per_week':
    case 'max_consecutive_weeks_per_member':
    case 'availability_window':
    case 'max_total_per_term':
      return false;
    case 'dual_role_exception':
      return constraint.roleIds.includes(roleId);
    case 'forbidden_role_combination':
      return constraint.entries.some((entry) => entry.roleIds.includes(roleId));
    case 'required_pair':
      return constraint.a.roleId === roleId || constraint.b.roleId === roleId;
    case 'max_per_month':
    case 'min_per_term':
      return constraint.roleId === roleId;
    case 'max_per_term_role':
    case 'role_frequency':
    case 'rotation_groups':
    case 'max_consecutive_same_group':
    case 'forbidden_together':
    case 'substitute_priority':
      return constraint.roleId === roleId;
    case 'preferred_role_combination':
      return constraint.when.roleId === roleId || constraint.prefer.roleId === roleId;
    case 'fixed_assignment':
      // 「限制哪些位置」只是附帶的名單，交給 withoutRole 改寫
      return constraint.roleId === roleId;
  }
}

/**
 * 刪掉位置之後還留著的規則要不要改寫。目前只有指定服事的「限制哪些位置」
 * （規格 §7.12.6）：拿掉那個位置；拿到變成空的就改回「照常排」——
 * 空陣列代表所有位置，直接留空會讓限制變得更大。
 */
function withoutRole(constraint: Constraint, roleId: RoleId): Constraint | null {
  if (constraint.type !== 'fixed_assignment' || !constraint.onlyRoleIds.includes(roleId)) {
    return null;
  }
  const onlyRoleIds = constraint.onlyRoleIds.filter((id) => id !== roleId);
  return onlyRoleIds.length === 0
    ? { ...constraint, onlyRoleIds, onlyPinnedDates: false }
    : { ...constraint, onlyRoleIds };
}

export function roleRemovalImpact(project: Project, roleId: RoleId): CascadeImpact {
  const kept = project.constraints.filter((constraint) => !mentionsRole(constraint, roleId));
  return {
    removed: project.constraints.length - kept.length,
    modified: kept.filter((constraint) => withoutRole(constraint, roleId) !== null).length,
  };
}

export function removeRole(project: Project, roleId: RoleId): Project {
  return {
    ...project,
    roles: project.roles
      .filter((role) => role.id !== roleId)
      .map((role) =>
        role.pairsWith === roleId ? { ...role, pairsWith: undefined } : role,
      ),
    members: project.members.map((member) =>
      member.roles.includes(roleId)
        ? { ...member, roles: member.roles.filter((id) => id !== roleId) }
        : member,
    ),
    constraints: project.constraints
      .filter((constraint) => !mentionsRole(constraint, roleId))
      .map((constraint) => withoutRole(constraint, roleId) ?? constraint),
  };
}

// ── 人員 ────────────────────────────────────────────────────────────────────

type Rewrite = { kind: 'keep' } | { kind: 'remove' } | { kind: 'modify'; next: Constraint };

/**
 * 一條規則在某個人被刪掉之後要怎麼辦。
 * 名單型欄位只移除那個人；名單短到規則失去意義（配對剩不到 2 人、群組全空）就整條移除。
 */
function withoutMember(constraint: Constraint, memberId: MemberId): Rewrite {
  switch (constraint.type) {
    case 'one_role_per_week':
    case 'max_consecutive_weeks_per_member':
    case 'role_frequency':
    case 'max_consecutive_same_group':
      return { kind: 'keep' };

    case 'dual_role_exception':
    case 'max_per_month':
    case 'max_per_term_role':
    case 'availability_window':
    case 'min_per_term':
    case 'fixed_assignment':
      return constraint.memberId === memberId ? { kind: 'remove' } : { kind: 'keep' };

    case 'max_total_per_term':
      return constraint.memberId === memberId ? { kind: 'remove' } : { kind: 'keep' };

    case 'required_pair':
      return constraint.a.memberId === memberId || constraint.b.memberId === memberId
        ? { kind: 'remove' }
        : { kind: 'keep' };

    case 'preferred_role_combination':
      return constraint.when.memberId === memberId || constraint.prefer.memberId === memberId
        ? { kind: 'remove' }
        : { kind: 'keep' };

    case 'forbidden_role_combination': {
      const entries = constraint.entries.filter((entry) => entry.memberId !== memberId);
      if (entries.length === constraint.entries.length) return { kind: 'keep' };
      // 這條規則講的是「不同人之間」的組合，剩不到兩個人就沒有意義
      if (entries.length < 2) return { kind: 'remove' };
      return { kind: 'modify', next: { ...constraint, entries } };
    }

    case 'rotation_groups': {
      const groups = constraint.groups
        .map((group) => group.filter((id) => id !== memberId))
        .filter((group) => group.length > 0);
      if (
        groups.length === constraint.groups.length &&
        groups.every((group, i) => group.length === constraint.groups[i].length)
      ) {
        return { kind: 'keep' };
      }
      if (groups.length === 0) return { kind: 'remove' };
      return { kind: 'modify', next: { ...constraint, groups } };
    }

    case 'forbidden_together': {
      const memberIds = constraint.memberIds.filter((id) => id !== memberId);
      if (memberIds.length === constraint.memberIds.length) return { kind: 'keep' };
      if (memberIds.length < 2) return { kind: 'remove' };
      return { kind: 'modify', next: { ...constraint, memberIds } };
    }

    case 'substitute_priority': {
      const prefer = constraint.prefer.filter((id) => id !== memberId);
      const lastResort = constraint.lastResort.filter((id) => id !== memberId);
      if (
        prefer.length === constraint.prefer.length &&
        lastResort.length === constraint.lastResort.length
      ) {
        return { kind: 'keep' };
      }
      if (prefer.length === 0 && lastResort.length === 0) return { kind: 'remove' };
      return { kind: 'modify', next: { ...constraint, prefer, lastResort } };
    }
  }
}

/**
 * 一次刪掉多個人。逐條規則把每個人依序拿掉，所以同一條規則被兩個人影響時
 * 只會算一次（批次刪除的確認視窗要的是這個數字，不是逐筆相加）。
 */
function withoutMembers(constraint: Constraint, memberIds: ReadonlySet<MemberId>): Rewrite {
  let current = constraint;
  let changed = false;
  for (const memberId of memberIds) {
    const rewrite = withoutMember(current, memberId);
    if (rewrite.kind === 'remove') return { kind: 'remove' };
    if (rewrite.kind === 'modify') {
      current = rewrite.next;
      changed = true;
    }
  }
  return changed ? { kind: 'modify', next: current } : { kind: 'keep' };
}

export function membersRemovalImpact(
  project: Project,
  memberIds: readonly MemberId[],
): CascadeImpact {
  const ids = new Set(memberIds);
  let removed = 0;
  let modified = 0;
  for (const constraint of project.constraints) {
    const rewrite = withoutMembers(constraint, ids);
    if (rewrite.kind === 'remove') removed += 1;
    else if (rewrite.kind === 'modify') modified += 1;
  }
  return { removed, modified };
}

export function removeMembers(project: Project, memberIds: readonly MemberId[]): Project {
  const ids = new Set(memberIds);
  const constraints: Constraint[] = [];
  for (const constraint of project.constraints) {
    const rewrite = withoutMembers(constraint, ids);
    if (rewrite.kind === 'remove') continue;
    constraints.push(rewrite.kind === 'modify' ? rewrite.next : constraint);
  }

  return {
    ...project,
    members: project.members.filter((member) => !ids.has(member.id)),
    constraints,
  };
}

export function memberRemovalImpact(project: Project, memberId: MemberId): CascadeImpact {
  return membersRemovalImpact(project, [memberId]);
}

export function removeMember(project: Project, memberId: MemberId): Project {
  return removeMembers(project, [memberId]);
}
