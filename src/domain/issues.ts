/**
 * 常駐問題清單。規格 §7.5.8。純函式：專案 + 導覽狀態 + 儲存狀態 → 問題陣列。
 *
 * alert（紅）＝ 會擋住 Phase 4 的「產生班表」；notice（橘）＝ 提示。
 */

import { isIsoDate } from '../engine';
import type { Project, Week } from '../engine';
import type { StepId } from '../ui/steps';
import { candidateCount } from './roles';
import { duplicateNames } from './members';
import { expectedTagged } from './term';

export type IssueLevel = 'alert' | 'notice';

export interface Issue {
  code: string;
  level: IssueLevel;
  message: string;
  step: StepId;
}

export interface StorageStatus {
  writable: boolean;
  /** 原存檔讀不回來時，備份用的 key */
  backupKey: string | null;
}

export interface NavState {
  generatedFrom: { start: string; end: string; weekday: number } | null;
}

export function collectIssues(
  project: Project,
  nav: NavState,
  storage: StorageStatus,
): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, level: IssueLevel, message: string, step: StepId) => {
    issues.push({ code, level, message, step });
  };

  // ── 步驟 1 ──
  const { start, end } = project.term;
  if (!isIsoDate(start) || !isIsoDate(end)) {
    add('term_dates_missing', 'alert', '梯次的起訖日期還沒填', 'term');
  } else if (end < start) {
    add('term_dates_missing', 'alert', '梯次的結束日早於起始日', 'term');
  } else if (
    nav.generatedFrom !== null &&
    (nav.generatedFrom.start !== start || nav.generatedFrom.end !== end)
  ) {
    add('term_dates_stale', 'notice', '起訖日期改過了，還沒重新產生聚會日', 'term');
  }

  const weeks = project.term.weeks;
  if (weeks.length === 0) {
    add('no_weeks', 'alert', '還沒有任何聚會日', 'term');
  }

  for (const tag of project.weekTags) {
    if (tag.rule.kind !== 'nthMeetingOfMonth' || weeks.length === 0) continue;
    const { gaps } = expectedTagged(weeks, tag.rule.n);
    if (gaps.length > 0) {
      add(
        'week_tag_month_gap',
        'notice',
        `${gaps.join('、')} 的聚會次數不足，這幾個月沒有${tag.label}`,
        'term',
      );
    }
  }

  const stale = staleUnavailableCount(project, weeks);
  if (stale > 0) {
    add(
      'stale_unavailable',
      'notice',
      `有 ${stale} 筆不行日期不是本梯次的聚會日`,
      'unavailable',
    );
  }

  // ── 步驟 2 ──
  if (project.roles.some((role) => role.name.trim() === '')) {
    add('role_unnamed', 'alert', '有服事位置還沒命名', 'roles');
  }

  const duplicateRoles = duplicateNames(project.roles);
  if (duplicateRoles.length > 0) {
    add('role_duplicate_name', 'notice', `服事位置同名：${duplicateRoles.join('、')}`, 'roles');
  }

  const empty: string[] = [];
  const short: string[] = [];
  for (const role of project.roles) {
    const count = candidateCount(project.members, role.id);
    if (count === 0) empty.push(role.name.trim() === '' ? '（未命名）' : role.name);
    else if (count < role.perWeek) {
      short.push(`${role.name}（${count} 人 / 需要 ${role.perWeek} 人）`);
    }
  }
  if (empty.length > 0) {
    add('role_no_candidate', 'alert', `沒有人可擔任：${empty.join('、')}`, 'roles');
  }
  if (short.length > 0) {
    add('role_short_candidates', 'alert', `可擔任人數不足：${short.join('、')}`, 'roles');
  }

  // ── 步驟 3 ──
  if (project.members.length === 0) {
    add('no_members', 'alert', '還沒有任何人員', 'members');
  }
  if (project.members.some((member) => member.name.trim() === '')) {
    add('member_unnamed', 'alert', '有人員還沒填姓名', 'members');
  }
  const duplicateMembers = duplicateNames(project.members);
  if (duplicateMembers.length > 0) {
    add('member_duplicate_name', 'notice', `人員同名：${duplicateMembers.join('、')}`, 'members');
  }
  const roleless = project.members.filter((member) => member.roles.length === 0).length;
  if (roleless > 0) {
    add('member_no_role', 'notice', `有 ${roleless} 人還沒勾任何服事位置`, 'members');
  }

  // ── 儲存 ──
  if (!storage.writable) {
    add(
      'storage_unwritable',
      'notice',
      '瀏覽器存不下這份資料，離開頁面就會不見。請改用一般視窗，或清掉瀏覽器資料後重試',
      'term',
    );
  }
  if (storage.backupKey !== null) {
    add(
      'storage_unreadable',
      'notice',
      `瀏覽器裡原本的存檔讀不回來，已改名保留在 ${storage.backupKey}，目前是空白專案`,
      'term',
    );
  }

  return issues;
}

function staleUnavailableCount(project: Project, weeks: readonly Week[]): number {
  if (weeks.length === 0) return 0;
  const dates = new Set(weeks.map((week) => week.date));
  let count = 0;
  for (const member of project.members) {
    for (const date of member.unavailable) {
      if (!dates.has(date)) count += 1;
    }
  }
  return count;
}
