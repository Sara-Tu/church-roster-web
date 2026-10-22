/**
 * 專案檔 schema v1。對應 docs/網頁版規格.md §4 與 §5。
 * 任何欄位異動都要同步更新規格文件與 CHANGELOG。
 */

export const SCHEMA_VERSION = 1;

/** YYYY-MM-DD；一律用字串，避免 JavaScript Date 的時區問題 */
export type IsoDate = string;
export type MemberId = string;
export type RoleId = string;
export type WeekTagId = string;

export interface Project {
  schemaVersion: number;
  appVersion: string;
  exportedAt: IsoDate;
  church: { name: string; note: string };
  term: Term;
  weekTags: WeekTag[];
  roles: Role[];
  members: Member[];
  constraints: Constraint[];
  /** 已產生過幾版班表，用來命名下載檔（服事表_{梯次}_r{n}.xlsx） */
  revision: number;
}

export interface Term {
  name: string;
  start: IsoDate;
  end: IsoDate;
  /** 聚會日，依日期遞增；陣列順序即輪替規則的週次索引 */
  weeks: Week[];
}

export interface Week {
  date: IsoDate;
  tags: WeekTagId[];
}

export interface WeekTag {
  id: WeekTagId;
  label: string;
  rule: WeekTagRule;
}

/** n = 1..5 代表當月第 N 次聚會；n = -1 代表當月最後一次聚會 */
export type WeekTagRule =
  | { kind: 'nthMeetingOfMonth'; n: number }
  | { kind: 'manual' };

export interface Role {
  id: RoleId;
  name: string;
  /** 每次聚會需要幾人 */
  perWeek: number;
  appliesTo: RoleApplicability;
}

export type RoleApplicability =
  | { kind: 'all' }
  | { kind: 'weekTag'; tagId: WeekTagId };

export interface Member {
  id: MemberId;
  name: string;
  roles: RoleId[];
  unavailable: IsoDate[];
}

// ── 限制條件 ────────────────────────────────────────────────────────────────

interface ConstraintBase {
  id: string;
  /** true = 硬性規則，違反即無效；false = 偏好規則，打破時記進 softViolations */
  hard: boolean;
  /** 人類可讀說明，顯示在規則卡片上 */
  note?: string;
  /** false = 暫時停用但不刪除 */
  enabled: boolean;
}

export type Constraint =
  | (ConstraintBase & { type: 'one_role_per_week' })
  | (ConstraintBase & { type: 'dual_role_exception'; memberId: MemberId; roleIds: RoleId[] })
  | (ConstraintBase & {
      type: 'forbidden_role_combination';
      entries: { memberId: MemberId; roleIds: RoleId[] }[];
    })
  | (ConstraintBase & {
      type: 'required_pair';
      a: RoleSlot;
      b: RoleSlot;
      /** true = 只有 a 成立時才要求 b，反向不成立 */
      directional: boolean;
    })
  | (ConstraintBase & {
      type: 'max_per_month';
      memberId: MemberId;
      max: number;
      /** null = 所有角色合計 */
      roleId: RoleId | null;
    })
  | (ConstraintBase & { type: 'max_per_term_role'; memberId: MemberId; roleId: RoleId; max: number })
  | (ConstraintBase & {
      type: 'max_total_per_term';
      max: number;
      /** null = 套用到每一個人 */
      memberId: MemberId | null;
    })
  | (ConstraintBase & {
      type: 'availability_window';
      memberId: MemberId;
      from?: IsoDate;
      until?: IsoDate;
    })
  | (ConstraintBase & {
      type: 'role_frequency';
      roleId: RoleId;
      minGapWeeks: number;
      maxPerTerm: number;
    })
  | (ConstraintBase & {
      type: 'rotation_groups';
      roleId: RoleId;
      /** 依輪替順序排列 */
      groups: MemberId[][];
      cycleBy: 'week' | 'month';
    })
  | (ConstraintBase & { type: 'max_consecutive_same_group'; roleId: RoleId; max: number })
  | (ConstraintBase & { type: 'max_consecutive_weeks_per_member'; max: number })
  | (ConstraintBase & {
      type: 'forbidden_together';
      roleId: RoleId;
      memberIds: MemberId[];
      mode: 'any_two';
    })
  | (ConstraintBase & {
      type: 'substitute_priority';
      roleId: RoleId;
      prefer: MemberId[];
      lastResort: MemberId[];
    })
  | (ConstraintBase & { type: 'preferred_role_combination'; when: RoleSlot; prefer: RoleSlot });

export interface RoleSlot {
  memberId: MemberId;
  roleId: RoleId;
}

export type ConstraintType = Constraint['type'];

// ── 排班結果 ────────────────────────────────────────────────────────────────

export interface RosterWeek {
  date: IsoDate;
  tags: WeekTagId[];
  /** roleId → 指派到的成員，依指派順序 */
  assignments: Record<RoleId, MemberId[]>;
  warnings: RosterWarning[];
}

export interface RosterWarning {
  roleId: RoleId | null;
  code: string;
  message: string;
}

export interface SoftViolation {
  date: IsoDate;
  roleId: RoleId | null;
  code: string;
  message: string;
}

export interface MemberTally {
  memberId: MemberId;
  total: number;
  byRole: Record<RoleId, number>;
}

export interface RosterResult {
  weeks: RosterWeek[];
  softViolations: SoftViolation[];
  fairness: { perMember: MemberTally[] };
}

/**
 * parity 測試用的 golden 檔格式：只有 weeks，不含時間戳，
 * 這樣同一份 fixture 每次跑出來的檔案都可以逐位元組比對。
 */
export interface GoldenRoster {
  schemaVersion: number;
  weeks: RosterWeek[];
}
