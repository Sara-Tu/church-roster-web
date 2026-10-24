/**
 * 結果頁與 Excel / CSV 共用的檢視資料。規格 §7.8。
 *
 * 純函式：`Project` + `RosterResult` → 畫面與檔案都照這一份資料畫，
 * 不讓網頁與 Excel 各算一次（兩邊會慢慢長得不一樣）。
 */

import { weekdayOf } from '../engine';
import type {
  BlockReason,
  GroupBlockReason,
  IsoDate,
  MemberId,
  Project,
  Role,
  RoleId,
  RosterResult,
  Week,
} from '../engine';
import { WEEKDAY_LABELS } from './term';

/** MM/DD。跟舊 Python 版的 `_date_str` 一樣，Excel 的格子才對得上 */
export function formatMd(date: IsoDate): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`;
}

/** （日）。只在網頁上顯示，Excel 沿用舊版沒有星期 */
export function weekdayShort(date: IsoDate): string {
  return WEEKDAY_LABELS[weekdayOf(date)].slice(2);
}

/** 產生出來的班表。存進 localStorage，但不進匯出的專案檔（規格 §7.8.3） */
export interface RosterSnapshot {
  result: RosterResult;
  /** 產生時間，ISO 格式含時分 */
  generatedAt: string;
  /** 這份班表是第幾版（檔名的 r{n}） */
  revision: number;
  /** 產生當下的輸入指紋，用來判斷之後資料有沒有改過 */
  inputHash: string;
}

export interface WeekCell {
  roleId: RoleId;
  /** 這一週這個位置排到的人，依指派順序 */
  names: string[];
  /** 這個位置這一週要不要排（只在特殊週的位置，一般週是 false） */
  applicable: boolean;
  /** 還缺幾人 */
  missing: number;
}

export interface WeekRow {
  date: IsoDate;
  label: string;
  weekday: string;
  /** 有特殊週標記（第一版只有聖餐週一種） */
  tagged: boolean;
  cells: WeekCell[];
}

export interface PersonRole {
  roleId: RoleId;
  dates: IsoDate[];
}

export interface PersonRow {
  memberId: MemberId;
  name: string;
  total: number;
  byRole: PersonRole[];
  /** 依日期排序的「日期 + 位置」，給 Excel 的時序工作表 */
  timeline: { date: IsoDate; roleId: RoleId }[];
}

export interface RoleSpread {
  roleId: RoleId;
  name: string;
  /** 有排到這個位置的人數 */
  people: number;
  total: number;
  min: number;
  max: number;
}

export interface MonthlyRow {
  memberId: MemberId;
  name: string;
  /** 對應 `months` 的每月次數 */
  counts: number[];
  total: number;
}

export interface RosterNote {
  date: IsoDate;
  label: string;
  roleName: string;
  message: string;
  /** 這個位置每一位有資格的人分別卡在哪裡（規格 §7.9.4、§7.10.1） */
  blocked: BlockedRow[];
  /** 輪替群組的每一組為什麼不能用在這一週（規格 §7.10.1） */
  groups: BlockedGroupRow[];
}

export interface BlockedGroupRow {
  label: string;
  names: string;
  reason: string;
  /** true = 這一組就是本週用的那一組 */
  used: boolean;
}

export interface BlockedRow {
  name: string;
  reason: string;
  /** true = 這個人其實排得上，是整個位置湊不滿才留空 */
  servable: boolean;
}

export interface RosterView {
  roles: Role[];
  weeks: WeekRow[];
  /** 有排到班的人依「第一次服事日期 → 姓名」，沒排到的排在最後 */
  people: PersonRow[];
  /** 完全沒排到班的人數（`people` 最後面的那幾位） */
  idle: number;
  months: string[];
  monthly: MonthlyRow[];
  spread: RoleSpread[];
  warnings: RosterNote[];
  soft: RosterNote[];
}

function appliesTo(role: Role, week: Week | undefined): boolean {
  if (week === undefined) return false;
  return role.appliesTo.kind === 'all' || week.tags.includes(role.appliesTo.tagId);
}

export function roleName(role: Role): string {
  return role.name.trim() === '' ? '（未命名）' : role.name;
}

export function buildView(project: Project, result: RosterResult): RosterView {
  const roles = [...project.roles];
  const weekByDate = new Map(project.term.weeks.map((week) => [week.date, week]));
  const nameOf = new Map(project.members.map((member) => [member.id, member.name]));
  const roleById = new Map(roles.map((role) => [role.id, role]));

  const weeks: WeekRow[] = result.weeks.map((week) => ({
    date: week.date,
    label: formatMd(week.date),
    weekday: weekdayShort(week.date),
    tagged: week.tags.length > 0,
    cells: roles.map((role) => {
      const assigned = week.assignments[role.id] ?? [];
      const names = assigned.map((id) => nameOf.get(id) ?? id);
      const applicable = appliesTo(role, weekByDate.get(week.date));
      return {
        roleId: role.id,
        names,
        applicable,
        missing: applicable ? Math.max(0, role.perWeek - assigned.length) : 0,
      };
    }),
  }));

  return {
    roles,
    ...people(project, result),
    weeks,
    ...monthly(project, result),
    spread: spread(project, result),
    warnings: warnings(result, roleById, nameOf),
    soft: soft(result, roleById, nameOf),
  };
}

/**
 * 依人員。排序與舊 Python 版的 `_persons_sorted` 一致（第一次服事日期，再比姓名），
 * 這樣網頁的順序與下載的 Excel 才是同一個順序。沒排到班的人舊版根本不會出現，
 * 這裡列在最後面（網頁要看得出誰沒被排到）。
 */
function people(project: Project, result: RosterResult): { people: PersonRow[]; idle: number } {
  const names = new Map(project.roles.map((role) => [role.id, roleName(role)]));
  const rows = new Map<MemberId, PersonRow>();
  for (const member of project.members) {
    rows.set(member.id, {
      memberId: member.id,
      name: member.name,
      total: 0,
      byRole: [],
      timeline: [],
    });
  }

  const dates = new Map<MemberId, Map<RoleId, IsoDate[]>>();
  for (const week of result.weeks) {
    for (const role of project.roles) {
      for (const memberId of week.assignments[role.id] ?? []) {
        let byRole = dates.get(memberId);
        if (byRole === undefined) {
          byRole = new Map();
          dates.set(memberId, byRole);
        }
        const list = byRole.get(role.id);
        if (list === undefined) byRole.set(role.id, [week.date]);
        else list.push(week.date);
      }
    }
  }

  for (const [memberId, byRole] of dates) {
    const row = rows.get(memberId);
    if (row === undefined) continue;
    for (const role of project.roles) {
      const list = byRole.get(role.id);
      if (list === undefined) continue;
      const sorted = [...list].sort();
      row.byRole.push({ roleId: role.id, dates: sorted });
      row.total += sorted.length;
      for (const date of sorted) row.timeline.push({ date, roleId: role.id });
    }
    // 同一天身兼兩個位置時，舊版是比位置名稱（Python 的 sorted 比的是 tuple），
    // 所以這裡也要比名稱，Excel 的時序工作表才跟 r9 一樣
    row.timeline.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const left = names.get(a.roleId) ?? a.roleId;
      const right = names.get(b.roleId) ?? b.roleId;
      return left === right ? 0 : left < right ? -1 : 1;
    });
  }

  const served: PersonRow[] = [];
  const idle: PersonRow[] = [];
  for (const member of project.members) {
    const row = rows.get(member.id);
    if (row === undefined) continue;
    if (row.total === 0) idle.push(row);
    else served.push(row);
  }

  served.sort((a, b) => {
    const first = a.timeline[0].date;
    const other = b.timeline[0].date;
    if (first !== other) return first < other ? -1 : 1;
    return a.name === b.name ? 0 : a.name < b.name ? -1 : 1;
  });

  return { people: [...served, ...idle], idle: idle.length };
}

/** 每人每月次數（規格 §12 決定 18：月平衡只呈現實際分佈，不當成規則） */
function monthly(
  project: Project,
  result: RosterResult,
): { months: string[]; monthly: MonthlyRow[] } {
  const months: string[] = [];
  for (const week of result.weeks) {
    const key = week.date.slice(0, 7);
    if (!months.includes(key)) months.push(key);
  }

  const index = new Map(months.map((month, i) => [month, i]));
  const counts = new Map<MemberId, number[]>();
  for (const member of project.members) {
    counts.set(member.id, months.map(() => 0));
  }

  for (const week of result.weeks) {
    const column = index.get(week.date.slice(0, 7));
    if (column === undefined) continue;
    for (const assigned of Object.values(week.assignments)) {
      for (const memberId of assigned) {
        const row = counts.get(memberId);
        if (row !== undefined) row[column] += 1;
      }
    }
  }

  const rows: MonthlyRow[] = project.members.map((member) => {
    const row = counts.get(member.id) ?? months.map(() => 0);
    return {
      memberId: member.id,
      name: member.name,
      counts: row,
      total: row.reduce((sum, value) => sum + value, 0),
    };
  });

  return { months, monthly: rows };
}

/** 每個位置的次數分佈：只看有資格擔任這個位置的人，看得出誰被排太多 */
function spread(project: Project, result: RosterResult): RoleSpread[] {
  const tally = new Map(result.fairness.perMember.map((item) => [item.memberId, item]));

  return project.roles.map((role) => {
    const counts: number[] = [];
    for (const member of project.members) {
      if (!member.roles.includes(role.id)) continue;
      counts.push(tally.get(member.id)?.byRole[role.id] ?? 0);
    }
    return {
      roleId: role.id,
      name: roleName(role),
      people: counts.length,
      total: counts.reduce((sum, value) => sum + value, 0),
      min: counts.length === 0 ? 0 : Math.min(...counts),
      max: counts.length === 0 ? 0 : Math.max(...counts),
    };
  });
}

function labelOf(roleId: RoleId | null, roleById: Map<RoleId, Role>): string {
  if (roleId === null) return '';
  const role = roleById.get(roleId);
  return role === undefined ? '' : roleName(role);
}

function warnings(
  result: RosterResult,
  roleById: Map<RoleId, Role>,
  nameOf: Map<MemberId, string>,
): RosterNote[] {
  const notes: RosterNote[] = [];
  for (const week of result.weeks) {
    for (const warning of week.warnings) {
      notes.push({
        date: week.date,
        label: formatMd(week.date),
        roleName: labelOf(warning.roleId, roleById),
        message: warning.message,
        blocked: (warning.blocked ?? []).map((entry) => ({
          name: nameOf.get(entry.memberId) ?? entry.memberId,
          // 「盡量填滿」之後紅色警告裡不會有排得上的人（排得上就被排進去了），
          // 這句留著防引擎哪天分岔（規格 §7.11）
          reason: reasonText(entry.reason, roleById, '排得上'),
          servable: entry.reason === null,
        })),
        groups: [],
      });
    }
  }
  return notes;
}

function soft(
  result: RosterResult,
  roleById: Map<RoleId, Role>,
  nameOf: Map<MemberId, string>,
): RosterNote[] {
  const who = (memberId: MemberId): string => nameOf.get(memberId) ?? memberId;
  return result.softViolations.map((violation) => ({
    date: violation.date,
    label: formatMd(violation.date),
    roleName: labelOf(violation.roleId, roleById),
    message: violation.message,
    blocked: (violation.blocked ?? []).map((entry) => ({
      name: who(entry.memberId),
      // 偏好警告裡「排得上」就只是排得上，不是紅色那種「湊不滿才整個留空」
      reason: reasonText(entry.reason, roleById, '排得上'),
      servable: entry.reason === null,
    })),
    groups: (violation.groups ?? []).map((group) => ({
      label: `第 ${group.index + 1} 組`,
      names: group.members.map(who).join('、'),
      reason: group.used
        ? '這一週用的就是這一組'
        : group.reason === null
          ? '可以用，只是輪替順序還沒輪到'
          : groupReasonText(group.reason),
      used: group.used,
    })),
  }));
}

/** 輪替群組出局的理由（規格 §7.10.1） */
function groupReasonText(reason: GroupBlockReason): string {
  switch (reason.kind) {
    case 'too_consecutive':
      return `同一組已經連續 ${reason.max} 週，不能再連下去`;
    case 'forbidden_together':
      return '這一組裡有人不能同一個位置';
    case 'forbidden_combination':
      return '這一組裡有人不能同一週服事';
    case 'short_handed':
      return `這一組只有 ${reason.available} 人能來，這個位置要 ${reason.need} 人`;
    case 'pinned_elsewhere':
      return `這一組固定在${pinText(reason.pin)}`;
  }
}

function pinText(pin: number): string {
  return pin === -1 ? '當月最後一次聚會' : `當月第 ${pin} 次聚會`;
}

/**
 * 把引擎的 BlockReason 翻成結果頁上直接看得懂的一句話（規格 §7.9.4）。
 * `nullText` 是「他其實排得上」的說法，紅色與橘色的語境不同，由呼叫端給。
 */
function reasonText(
  reason: BlockReason | null,
  roleById: Map<RoleId, Role>,
  nullText: string,
): string {
  if (reason === null) return nullText;
  switch (reason.kind) {
    case 'not_in_role':
      return '沒有這個位置的資格';
    case 'assigned_elsewhere':
      return reason.roleId === null
        ? '本週已經排在別的位置'
        : `本週已經排在${labelOf(reason.roleId, roleById)}`;
    case 'unavailable':
      return '這天不行';
    case 'outside_window':
      return '不在可服事的日期範圍';
    case 'max_per_month':
      return reason.roleId === null
        ? `每月最多 ${reason.max} 次已經用完`
        : `${labelOf(reason.roleId, roleById)}每月最多 ${reason.max} 次已經用完`;
    case 'max_total_per_term':
      return `整梯次最多 ${reason.max} 次已經用完`;
    case 'max_consecutive_weeks':
      return `連續兩週服事已經達到上限 ${reason.max} 次`;
    case 'max_per_term_role':
    case 'role_frequency_total':
      return `這個位置整梯次最多 ${reason.max} 次已經用完`;
    case 'role_frequency_gap':
      return `距上次排這個位置還沒滿 ${reason.minGapWeeks} 週`;
    case 'forbidden_combination':
      return '和本週已經排到的人有「不能同一週」的規則';
    case 'no_partner':
      return `排得上，但找不到可以配的${labelOf(reason.roleId, roleById)}`;
    case 'combination_blocked':
      return '排得上，但跟這一週已經排定的人湊不成合法的組合';
  }
}

/**
 * 排班用得到的輸入的指紋。產生班表時記下來，之後只要人員、位置、週次或
 * 限制條件改過，結果頁就標示「這份班表不是最新的」。FNV-1a，夠分辨改動就好。
 */
export function rosterInputHash(project: Project): string {
  const payload = JSON.stringify([
    project.term.weeks,
    project.roles,
    project.members,
    project.constraints,
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** 服事表_{梯次}_r{n}.xlsx（規格 §9）。梯次沒命名就只留版號 */
export function rosterFilename(project: Project, revision: number, ext: string): string {
  const name = project.term.name.trim().replace(/[\\/:*?"<>|\s]+/g, '-');
  return `服事表${name === '' ? '' : `_${name}`}_r${revision}.${ext}`;
}
