/**
 * 把 constraints 陣列預先整理成查詢用的索引。規格 §6.4.2。
 *
 * 幾處刻意沿用現有 Python 引擎的「取第一條」語意（對應 `next(...)`）：
 * role_frequency、rotation_groups、max_consecutive_same_group、substitute_priority、
 * max_consecutive_weeks_per_member。同一個角色重複設定時，後面的會被忽略。
 */

import type { Constraint, IsoDate, MemberId, RoleId, RoleSlot } from './schema';

export interface RoleFrequencyRule {
  minGapWeeks: number;
  maxPerTerm: number;
}

export interface RotationRule {
  groups: MemberId[][];
  cycleBy: 'week' | 'month';
  /** 與 groups 同長度：這一組偏好的「當月第 N 次聚會」，null = 不釘（規格 §7.9.2） */
  pinnedSlots: (number | null)[];
}

export interface SubstituteRule {
  prefer: Set<MemberId>;
  lastResort: Set<MemberId>;
}

export interface ForbiddenComboEntry {
  memberId: MemberId;
  roleIds: Set<RoleId>;
}

export interface AvailabilityWindow {
  from?: IsoDate;
  until?: IsoDate;
}

export interface RuleIndex {
  /** one_role_per_week 存在且啟用時，同一人同一週只能有一個角色 */
  blockRepeatWithinWeek: boolean;
  /** 可同時擔任多個角色的例外：memberId → 允許的角色集合 */
  dualRoles: Map<MemberId, Set<RoleId>>;
  forbiddenCombos: ForbiddenComboEntry[][];
  requiredPairs: { a: RoleSlot; b: RoleSlot; directional: boolean }[];
  /** memberId 為 null ＝ 套用到每一個人 */
  maxPerMonth: { memberId: MemberId | null; roleId: RoleId | null; max: number }[];
  maxPerTermRole: { memberId: MemberId; roleId: RoleId; max: number }[];
  maxTotalPerTerm: { memberId: MemberId | null; max: number }[];
  windows: Map<MemberId, AvailabilityWindow[]>;
  roleFrequency: Map<RoleId, RoleFrequencyRule>;
  rotation: Map<RoleId, RotationRule>;
  maxConsecutiveSameGroup: Map<RoleId, number>;
  /** 整梯次允許發生幾次「同一人連續兩週服事」。沒有這條規則＝不限制 */
  maxConsecutiveWeeks: number;
  forbiddenTogether: Map<RoleId, Set<MemberId>[]>;
  substitutes: Map<RoleId, SubstituteRule>;
  preferredCombos: { when: RoleSlot; prefer: RoleSlot }[];
}

export function indexConstraints(constraints: readonly Constraint[]): RuleIndex {
  const index: RuleIndex = {
    blockRepeatWithinWeek: false,
    dualRoles: new Map(),
    forbiddenCombos: [],
    requiredPairs: [],
    maxPerMonth: [],
    maxPerTermRole: [],
    maxTotalPerTerm: [],
    windows: new Map(),
    roleFrequency: new Map(),
    rotation: new Map(),
    maxConsecutiveSameGroup: new Map(),
    maxConsecutiveWeeks: Number.POSITIVE_INFINITY,
    forbiddenTogether: new Map(),
    substitutes: new Map(),
    preferredCombos: [],
  };

  let consecutiveWeeksSeen = false;

  for (const c of constraints) {
    if (!c.enabled) continue;

    switch (c.type) {
      case 'one_role_per_week':
        index.blockRepeatWithinWeek = true;
        break;

      case 'dual_role_exception': {
        const allowed = index.dualRoles.get(c.memberId) ?? new Set<RoleId>();
        for (const roleId of c.roleIds) allowed.add(roleId);
        index.dualRoles.set(c.memberId, allowed);
        break;
      }

      case 'forbidden_role_combination':
        index.forbiddenCombos.push(
          c.entries.map((entry) => ({
            memberId: entry.memberId,
            roleIds: new Set(entry.roleIds),
          })),
        );
        break;

      case 'required_pair':
        index.requiredPairs.push({ a: c.a, b: c.b, directional: c.directional });
        break;

      case 'max_per_month':
        index.maxPerMonth.push({ memberId: c.memberId, roleId: c.roleId, max: c.max });
        break;

      case 'max_per_term_role':
        index.maxPerTermRole.push({ memberId: c.memberId, roleId: c.roleId, max: c.max });
        break;

      case 'max_total_per_term':
        index.maxTotalPerTerm.push({ memberId: c.memberId, max: c.max });
        break;

      case 'availability_window': {
        const list = index.windows.get(c.memberId) ?? [];
        list.push({ from: c.from, until: c.until });
        index.windows.set(c.memberId, list);
        break;
      }

      case 'role_frequency':
        if (!index.roleFrequency.has(c.roleId)) {
          index.roleFrequency.set(c.roleId, {
            minGapWeeks: c.minGapWeeks,
            maxPerTerm: c.maxPerTerm,
          });
        }
        break;

      case 'rotation_groups':
        if (!index.rotation.has(c.roleId)) {
          index.rotation.set(c.roleId, {
            groups: c.groups.map((group) => [...group]),
            cycleBy: c.cycleBy,
            // 長度一律對齊 groups，少寫或多寫都不會讓引擎讀錯組
            pinnedSlots: c.groups.map((_, i) => c.pinnedSlots?.[i] ?? null),
          });
        }
        break;

      case 'max_consecutive_same_group':
        if (!index.maxConsecutiveSameGroup.has(c.roleId)) {
          index.maxConsecutiveSameGroup.set(c.roleId, c.max);
        }
        break;

      case 'max_consecutive_weeks_per_member':
        if (!consecutiveWeeksSeen) {
          index.maxConsecutiveWeeks = c.max;
          consecutiveWeeksSeen = true;
        }
        break;

      case 'forbidden_together': {
        const list = index.forbiddenTogether.get(c.roleId) ?? [];
        list.push(new Set(c.memberIds));
        index.forbiddenTogether.set(c.roleId, list);
        break;
      }

      case 'substitute_priority':
        if (!index.substitutes.has(c.roleId)) {
          index.substitutes.set(c.roleId, {
            prefer: new Set(c.prefer),
            lastResort: new Set(c.lastResort),
          });
        }
        break;

      case 'preferred_role_combination':
        index.preferredCombos.push({ when: c.when, prefer: c.prefer });
        break;
    }
  }

  return index;
}
