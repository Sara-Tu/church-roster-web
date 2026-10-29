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
  /**
   * 成對指派：這兩個位置要一起排、互相挑人（領會 → 司琴）。
   * 只寫在主角色上；被指向的角色不會再單獨排一次。見規格 §6.4.3
   */
  pairsWith?: RoleId;
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
      /** roleIds 是空陣列代表「不限位置」：這個人排到哪個位置都算數 */
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
      /** null = 套用到每一個人 */
      memberId: MemberId | null;
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
      /**
       * 下限，而且是偏好不是硬性：引擎把還沒達標的人排到候選名單最前面，
       * 但不會為了湊數而違反任何上限。排完沒達標就記一筆 softViolation。見規格 §7.10.2
       */
      type: 'min_per_term';
      memberId: MemberId;
      min: number;
      /** null = 所有位置合計 */
      roleId: RoleId | null;
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
      /**
       * 與 `groups` 同索引的偏好：這一組盡量排在當月第 N 次聚會。
       * N 從 1 起算，-1 代表當月最後一次；null 或省略＝不釘。見規格 §7.9.2
       */
      pinnedSlots?: (number | null)[];
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
  | (ConstraintBase & { type: 'preferred_role_combination'; when: RoleSlot; prefer: RoleSlot })
  | (ConstraintBase & {
      /**
       * 指定服事：這個人在這幾天一定排這個位置，與其他規則衝突時以指定為優先。
       * 一般排班檢查上限時會預先扣掉之後還沒到的指定。見規格 §7.12
       */
      type: 'fixed_assignment';
      memberId: MemberId;
      roleId: RoleId;
      dates: IsoDate[];
      /** true = 指定日期以外，onlyRoleIds 裡的位置都不排他 */
      onlyPinnedDates: boolean;
      /** onlyPinnedDates 為 true 才有作用。空陣列＝所有位置 */
      onlyRoleIds: RoleId[];
    });

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
  /**
   * 排不出來時，這個位置每一位有資格的人分別卡在哪裡（規格 §7.9.4）。
   * 只有網頁的結果頁會用，Excel 的警告工作表維持舊格式。
   */
  blocked?: BlockedCandidate[];
}

export interface BlockedCandidate {
  memberId: MemberId;
  /**
   * null = 這個人其實排得上。0.3.6 改成「盡量填滿」之後紅色警告碰不到這個值
   * （排得上就會被排進去，湊不成組合的人標 combination_blocked），橘色的偏好
   * 警告則照舊會出現（規格 §7.11）。
   */
  reason: BlockReason | null;
}

/**
 * 擋住一個人的第一個原因。順序與 eligibility.ts 的檢查順序一致。
 *
 * `reserved`：之後還沒到的指定服事先扣掉了幾次（規格 §7.12.3）。只有「沒有預扣
 * 就不會擋」的時候才會出現，所以沒有指定服事時這些物件跟加這個欄位之前一樣。
 */
export type BlockReason =
  | { kind: 'not_in_role' }
  | { kind: 'assigned_elsewhere'; roleId: RoleId | null }
  | { kind: 'unavailable' }
  /** 指定服事選了「指定日期以外不排」（規格 §7.12.4） */
  | { kind: 'pinned_dates_only' }
  | { kind: 'outside_window' }
  | { kind: 'max_per_month'; max: number; roleId: RoleId | null; reserved?: number }
  | { kind: 'max_total_per_term'; max: number; reserved?: number }
  | { kind: 'max_consecutive_weeks'; max: number; reserved?: number }
  | { kind: 'max_per_term_role'; max: number; reserved?: number }
  | { kind: 'role_frequency_total'; max: number; reserved?: number }
  /** ahead = 擋住的是之後的指定服事，不是上一次排的 */
  | { kind: 'role_frequency_gap'; minGapWeeks: number; ahead?: true }
  | { kind: 'forbidden_combination' }
  /** 指定服事專用：跟同一個位置已經排定的人有「不能同一個位置」的規則 */
  | { kind: 'forbidden_together' }
  /** 成對位置專用：這個人本身排得上，但找不到配角 */
  | { kind: 'no_partner'; roleId: RoleId }
  /** 部分填滿專用：這個人本身排得上，但跟已經排定的人湊不成合法組合（規格 §7.11） */
  | { kind: 'combination_blocked' };

export interface SoftViolation {
  date: IsoDate;
  roleId: RoleId | null;
  code: string;
  message: string;
  /**
   * 偏好沒排到的原因（規格 §7.10.1）。兩種形狀，因為四種偏好警告問的不是同一件事：
   * 逐人（固定組合被拆開、動用最後手段人員）與逐組（沒用到固定組合、釘選的組沒輪到）。
   * 只有網頁的結果頁會用，Excel 的警告工作表維持舊格式。
   */
  blocked?: BlockedCandidate[];
  groups?: BlockedGroup[];
}

/** 輪替群組裡的某一組為什麼不能用在這一週 */
export interface BlockedGroup {
  /** 第幾組，從 0 起算（顯示時 +1） */
  index: number;
  members: MemberId[];
  /** true = 本週用的就是這一組 */
  used: boolean;
  /** null = 這一組本來可以用，只是輪替順序還沒輪到它 */
  reason: GroupBlockReason | null;
}

export type GroupBlockReason =
  | { kind: 'too_consecutive'; max: number }
  | { kind: 'forbidden_together' }
  | { kind: 'forbidden_combination' }
  /** 組裡能來的人不夠，替補也補不滿 */
  | { kind: 'short_handed'; available: number; need: number }
  /** 這一組釘在別的那次聚會 */
  | { kind: 'pinned_elsewhere'; pin: number };

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
