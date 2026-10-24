/**
 * 引擎執行脈絡：預先建好的索引、人員池與驗證。
 *
 * 驗證對應規格 §6.2 缺陷 #3：舊版姓名對不上就靜默忽略，新版一律在進引擎前
 * 就把所有 id 參照查一遍，有問題直接丟 ProjectValidationError。
 */

import { isIsoDate, monthOf } from './dates';
import { indexConstraints, type RuleIndex } from './rules';
import { SchedulerState } from './state';
import {
  SCHEMA_VERSION,
  type Constraint,
  type IsoDate,
  type Member,
  type MemberId,
  type Project,
  type Role,
  type RoleId,
  type SoftViolation,
  type Week,
} from './schema';

export class ProjectValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`專案檔有 ${issues.length} 個問題：\n- ${issues.join('\n- ')}`);
    this.name = 'ProjectValidationError';
    this.issues = issues;
  }
}

export interface EngineContext {
  readonly project: Project;
  readonly rules: RuleIndex;
  readonly state: SchedulerState;
  readonly roleById: Map<RoleId, Role>;
  readonly memberById: Map<MemberId, Member>;
  /** members 陣列順序，所有排序的最後一道 tie-break（規格 §6.4.7） */
  readonly memberOrder: Map<MemberId, number>;
  readonly unavailable: Map<MemberId, Set<IsoDate>>;
  /** roleId → 有這個角色的成員，依 members 陣列順序 */
  readonly pools: Map<RoleId, MemberId[]>;
  /** 聚會日期 → 在 term.weeks 裡的索引（cycleBy: "week" 用） */
  readonly weekIndex: Map<IsoDate, number>;
  /** 聚會日期 → 當月第幾次聚會，從 0 起算（cycleBy: "month" 用） */
  readonly monthSlot: Map<IsoDate, number>;
  /** 聚會日期 → 當月總共幾次聚會（釘選「當月最後一次」要用） */
  readonly monthCount: Map<IsoDate, number>;
  readonly softViolations: SoftViolation[];
}

export function createContext(project: Project): EngineContext {
  const roleById = new Map(project.roles.map((role) => [role.id, role]));
  const memberById = new Map(project.members.map((member) => [member.id, member]));
  const memberOrder = new Map(project.members.map((member, i) => [member.id, i]));
  const unavailable = new Map(
    project.members.map((member) => [member.id, new Set(member.unavailable)]),
  );

  const pools = new Map<RoleId, MemberId[]>(project.roles.map((role) => [role.id, []]));
  for (const member of project.members) {
    for (const roleId of member.roles) {
      pools.get(roleId)?.push(member.id);
    }
  }

  const weekIndex = new Map<IsoDate, number>();
  const monthSlot = new Map<IsoDate, number>();
  const monthCount = new Map<IsoDate, number>();
  const seenInMonth = new Map<number, number>();
  project.term.weeks.forEach((week, i) => {
    weekIndex.set(week.date, i);
    // 沿用現有引擎：只看月份數字、不看年份（規格 §6.4.5）
    const month = monthOf(week.date);
    const slot = seenInMonth.get(month) ?? 0;
    monthSlot.set(week.date, slot);
    seenInMonth.set(month, slot + 1);
  });
  for (const week of project.term.weeks) {
    monthCount.set(week.date, seenInMonth.get(monthOf(week.date)) ?? 1);
  }

  return {
    project,
    rules: indexConstraints(project.constraints),
    state: new SchedulerState(),
    roleById,
    memberById,
    memberOrder,
    unavailable,
    pools,
    weekIndex,
    monthSlot,
    monthCount,
    softViolations: [],
  };
}

export function appliesToWeek(role: Role, week: Week): boolean {
  return role.appliesTo.kind === 'all' || week.tags.includes(role.appliesTo.tagId);
}

export function validateProject(project: Project): void {
  const issues: string[] = [];

  if (project.schemaVersion !== SCHEMA_VERSION) {
    issues.push(
      `schemaVersion 是 ${project.schemaVersion}，這個版本的引擎只支援 ${SCHEMA_VERSION}`,
    );
  }

  const roleIds = collectIds(project.roles, 'roles', '角色', issues);
  const memberIds = collectIds(project.members, 'members', '人員', issues);
  const tagIds = collectIds(project.weekTags, 'weekTags', '週標籤', issues);
  collectIds(project.constraints, 'constraints', '限制條件', issues);

  for (const date of [project.term.start, project.term.end]) {
    if (!isIsoDate(date)) issues.push(`梯次日期不是合法的 YYYY-MM-DD：${String(date)}`);
  }

  // 聚會日期：格式正確且嚴格遞增（陣列順序就是輪替規則的週次索引，規格 §4）
  let previous: IsoDate | null = null;
  project.term.weeks.forEach((week, i) => {
    if (!isIsoDate(week.date)) {
      issues.push(`第 ${i + 1} 個聚會日期不是合法的 YYYY-MM-DD：${String(week.date)}`);
      return;
    }
    if (previous !== null && week.date <= previous) {
      issues.push(`聚會日期沒有依序遞增：${previous} 之後出現 ${week.date}`);
    }
    previous = week.date;
    for (const tagId of week.tags) {
      if (!tagIds.has(tagId)) issues.push(`${week.date} 用到不存在的週標籤：${tagId}`);
    }
  });

  for (const role of project.roles) {
    if (!Number.isInteger(role.perWeek) || role.perWeek < 1) {
      issues.push(`角色「${role.name}」的 perWeek 必須是 1 以上的整數，目前是 ${role.perWeek}`);
    }
    if (role.appliesTo.kind === 'weekTag' && !tagIds.has(role.appliesTo.tagId)) {
      issues.push(`角色「${role.name}」指向不存在的週標籤：${role.appliesTo.tagId}`);
    }
    if (role.pairsWith !== undefined) {
      if (role.pairsWith === role.id) {
        issues.push(`角色「${role.name}」的 pairsWith 指向自己`);
      } else if (!roleIds.has(role.pairsWith)) {
        issues.push(`角色「${role.name}」的 pairsWith 指向不存在的角色：${role.pairsWith}`);
      }
    }
  }

  // 成對關係必須是單純的一對一：不能接力、不能兩個主角色搶同一個配角
  const partnerOwners = new Map<RoleId, string>();
  for (const role of project.roles) {
    if (role.pairsWith === undefined) continue;
    const owner = partnerOwners.get(role.pairsWith);
    if (owner !== undefined) {
      issues.push(`角色「${owner}」和「${role.name}」的 pairsWith 指向同一個角色`);
    } else {
      partnerOwners.set(role.pairsWith, role.name);
    }
    const partner = project.roles.find((candidate) => candidate.id === role.pairsWith);
    if (partner?.pairsWith !== undefined) {
      issues.push(`成對關係不能接力：「${role.name}」→「${partner.name}」→ 還有下一個`);
    }
  }

  for (const member of project.members) {
    for (const roleId of member.roles) {
      if (!roleIds.has(roleId)) {
        issues.push(`人員「${member.name}」有不存在的角色：${roleId}`);
      }
    }
    for (const date of member.unavailable) {
      if (!isIsoDate(date)) {
        issues.push(`人員「${member.name}」的不行日期不是合法的 YYYY-MM-DD：${String(date)}`);
      }
    }
  }

  for (const constraint of project.constraints) {
    for (const memberId of referencedMembers(constraint)) {
      if (!memberIds.has(memberId)) {
        issues.push(`限制條件 ${constraint.id}（${constraint.type}）指向不存在的人員：${memberId}`);
      }
    }
    for (const roleId of referencedRoles(constraint)) {
      if (!roleIds.has(roleId)) {
        issues.push(`限制條件 ${constraint.id}（${constraint.type}）指向不存在的角色：${roleId}`);
      }
    }
    for (const date of referencedDates(constraint)) {
      if (!isIsoDate(date)) {
        issues.push(
          `限制條件 ${constraint.id}（${constraint.type}）的日期不合法：${String(date)}`,
        );
      }
    }
  }

  if (issues.length > 0) throw new ProjectValidationError(issues);
}

function collectIds(
  items: readonly { id: string }[],
  field: string,
  label: string,
  issues: string[],
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) issues.push(`${field} 裡有重複的${label} id：${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

function referencedMembers(constraint: Constraint): MemberId[] {
  switch (constraint.type) {
    case 'dual_role_exception':
    case 'max_per_term_role':
    case 'availability_window':
    case 'min_per_term':
      return [constraint.memberId];
    // null ＝ 套用到每一個人，沒有要檢查的參照
    case 'max_per_month':
    case 'max_total_per_term':
      return constraint.memberId === null ? [] : [constraint.memberId];
    case 'forbidden_role_combination':
      return constraint.entries.map((entry) => entry.memberId);
    case 'required_pair':
      return [constraint.a.memberId, constraint.b.memberId];
    case 'rotation_groups':
      return constraint.groups.flat();
    case 'forbidden_together':
      return constraint.memberIds;
    case 'substitute_priority':
      return [...constraint.prefer, ...constraint.lastResort];
    case 'preferred_role_combination':
      return [constraint.when.memberId, constraint.prefer.memberId];
    default:
      return [];
  }
}

function referencedRoles(constraint: Constraint): RoleId[] {
  switch (constraint.type) {
    case 'dual_role_exception':
      return constraint.roleIds;
    case 'forbidden_role_combination':
      return constraint.entries.flatMap((entry) => entry.roleIds);
    case 'required_pair':
      return [constraint.a.roleId, constraint.b.roleId];
    case 'max_per_month':
    case 'min_per_term':
      return constraint.roleId === null ? [] : [constraint.roleId];
    case 'max_per_term_role':
    case 'role_frequency':
    case 'rotation_groups':
    case 'max_consecutive_same_group':
    case 'forbidden_together':
    case 'substitute_priority':
      return [constraint.roleId];
    case 'preferred_role_combination':
      return [constraint.when.roleId, constraint.prefer.roleId];
    default:
      return [];
  }
}

function referencedDates(constraint: Constraint): IsoDate[] {
  if (constraint.type !== 'availability_window') return [];
  const dates: IsoDate[] = [];
  if (constraint.from !== undefined) dates.push(constraint.from);
  if (constraint.until !== undefined) dates.push(constraint.until);
  return dates;
}
