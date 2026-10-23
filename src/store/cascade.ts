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
  }
}

export function roleRemovalImpact(project: Project, roleId: RoleId): CascadeImpact {
  return {
    removed: project.constraints.filter((constraint) => mentionsRole(constraint, roleId)).length,
    modified: 0,
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
    constraints: project.constraints.filter(
      (constraint) => !mentionsRole(constraint, roleId),
    ),
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

export function memberRemovalImpact(project: Project, memberId: MemberId): CascadeImpact {
  let removed = 0;
  let modified = 0;
  for (const constraint of project.constraints) {
    const rewrite = withoutMember(constraint, memberId);
    if (rewrite.kind === 'remove') removed += 1;
    else if (rewrite.kind === 'modify') modified += 1;
  }
  return { removed, modified };
}

export function removeMember(project: Project, memberId: MemberId): Project {
  const constraints: Constraint[] = [];
  for (const constraint of project.constraints) {
    const rewrite = withoutMember(constraint, memberId);
    if (rewrite.kind === 'remove') continue;
    constraints.push(rewrite.kind === 'modify' ? rewrite.next : constraint);
  }

  return {
    ...project,
    members: project.members.filter((member) => member.id !== memberId),
    constraints,
  };
}
