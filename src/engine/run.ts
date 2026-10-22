/**
 * 主迴圈。規格 §6.4.4：
 *
 *   每一週（依 term.weeks 陣列順序）
 *     每一個角色（依 roles 陣列順序）
 *       被前一個角色成對排掉 → 跳過
 *       appliesTo 不符當週標籤 → 跳過
 *       否則依 §6.4.3 選策略指派
 *
 * 指派順序完全由 roles 陣列決定，不再寫死在程式碼裡。
 */

import { appliesToWeek, createContext, validateProject, type EngineContext } from './context';
import { assignCoupled, assignFill, assignRotation, type AssignContext } from './strategies';
import type {
  MemberTally,
  Project,
  RoleId,
  RosterResult,
  RosterWeek,
} from './schema';

export function runScheduler(project: Project): RosterResult {
  validateProject(project);
  const ctx = createContext(project);
  const weeks: RosterWeek[] = [];

  for (const week of project.term.weeks) {
    const draft: RosterWeek = {
      date: week.date,
      tags: [...week.tags],
      assignments: {},
      warnings: [],
    };
    const aw: AssignContext = {
      week: draft,
      previousWeeks: weeks,
      assignedThisWeek: new Set(),
    };
    const handled = new Set<RoleId>();

    for (const role of project.roles) {
      if (handled.has(role.id)) continue;
      if (!appliesToWeek(role, week)) continue;

      const partner =
        role.pairsWith !== undefined ? ctx.roleById.get(role.pairsWith) : undefined;

      draft.assignments[role.id] = [];

      if (partner !== undefined && appliesToWeek(partner, week)) {
        draft.assignments[partner.id] = [];
        handled.add(partner.id);
        assignCoupled(ctx, role, partner, aw);
      } else if (ctx.rules.rotation.has(role.id)) {
        assignRotation(ctx, role, aw);
      } else {
        assignFill(ctx, role, aw);
      }
    }

    weeks.push(draft);
  }

  return {
    weeks,
    softViolations: ctx.softViolations,
    fairness: { perMember: tally(ctx, weeks) },
  };
}

function tally(ctx: EngineContext, weeks: readonly RosterWeek[]): MemberTally[] {
  const counts = new Map<string, number>();
  for (const week of weeks) {
    for (const [roleId, members] of Object.entries(week.assignments)) {
      for (const memberId of members) {
        const key = `${memberId}|${roleId}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  return ctx.project.members.map((member) => {
    const byRole: Record<RoleId, number> = {};
    let total = 0;
    for (const role of ctx.project.roles) {
      const count = counts.get(`${member.id}|${role.id}`) ?? 0;
      // 有資格的角色一律列出（含 0 次），讓公平性報表看得出誰沒被排到
      if (count > 0 || member.roles.includes(role.id)) byRole[role.id] = count;
      total += count;
    }
    return { memberId: member.id, total, byRole };
  });
}
