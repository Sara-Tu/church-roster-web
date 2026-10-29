/**
 * 步驟 4：不行日期的純函式。規格 §7.6.3。
 *
 * 這裡不信任 AI 的輸出：姓名要對得上名單、日期要對得上本梯次的聚會日，
 * 對不上的一律列出來給使用者看，不自己猜也不默默丟掉（規格 §8）。
 */

import { isIsoDate } from '../engine';
import type { IsoDate, MemberId, Project, RoleId, Week, WeekTagId } from '../engine';
import { groupByMonth } from './term';

// ── 給使用者複製去自己的 AI 的 prompt ──────────────────────────────────────

export function buildAiPrompt(project: Project): string {
  const names = project.members
    .map((member) => member.name.trim())
    .filter((name) => name !== '');
  const dateLines = [...groupByMonth(project.term.weeks).values()].map((weeks) =>
    weeks.map((week) => week.date).join('、'),
  );

  return [
    '你是教會服事排班的助手。我會給你一份同工名單與本梯次的聚會日期，',
    '接著給你一段 LINE 的對話文字或截圖。請整理出每個人不能服事的日期。',
    '',
    '【同工名單】只能用這份清單裡的姓名，清單裡沒有的人不要自己加。',
    names.join('、'),
    '',
    '【本梯次聚會日】只能用這些日期，不是聚會日的日期不要輸出。',
    ...dateLines,
    '',
    '【輸出格式】只輸出一段 JSON，前後不要加任何說明文字：',
    '{"unavailable":[',
    '  {"name":"姓名","dates":["YYYY-MM-DD","YYYY-MM-DD"]},',
    '  {"name":"姓名","dates":[],"unsure":"只說月底可能不行，沒有講哪一天"}',
    ']}',
    '',
    '【規則】',
    '1. 日期一律寫成 YYYY-MM-DD。',
    '2. 看不出是哪一天、或不確定是誰說的，就把那個人的 dates 留空，',
    '   並在 unsure 寫下原因，不要猜。',
    '3. 完全沒提到的人不要放進 unavailable。',
    '4. 只輸出 JSON。',
    '',
    '以下是要整理的內容：',
  ].join('\n');
}

// ── 解析 AI 回傳的片段 ────────────────────────────────────────────────────

export interface ParsedEntry {
  memberId: MemberId;
  name: string;
  /** 對得上聚會日的日期，已去重並依日期遞增 */
  dates: IsoDate[];
  /** AI 自己標的不確定說明 */
  unsure?: string;
}

export interface ParsedUnavailable {
  entries: ParsedEntry[];
  /** 名單裡找不到的姓名 */
  unknownNames: string[];
  /** 名單裡有兩個以上同名的人，不確定是誰，一律不套用 */
  ambiguousNames: string[];
  /** 不是本梯次聚會日、或格式不對的日期 */
  badDates: string[];
  /** 整段讀不懂時的訊息；非 null 時其他欄位都是空的 */
  error: string | null;
}

const EMPTY: Omit<ParsedUnavailable, 'error'> = {
  entries: [],
  unknownNames: [],
  ambiguousNames: [],
  badDates: [],
};

export function parseUnavailable(text: string, project: Project): ParsedUnavailable {
  const items = readItems(text);
  if (typeof items === 'string') return { ...EMPTY, error: items };

  const byName = new Map<string, MemberId[]>();
  for (const member of project.members) {
    const key = normalizeName(member.name);
    if (key === '') continue;
    const bucket = byName.get(key);
    if (bucket === undefined) byName.set(key, [member.id]);
    else bucket.push(member.id);
  }
  const meetingDates = new Set(project.term.weeks.map((week) => week.date));

  const entries: ParsedEntry[] = [];
  const unknownNames: string[] = [];
  const ambiguousNames: string[] = [];
  const badDates: string[] = [];
  const taken = new Set<MemberId>();

  for (const item of items) {
    const rawName = typeof item.name === 'string' ? item.name.trim() : '';
    if (rawName === '') continue;

    const matched = byName.get(normalizeName(rawName));
    if (matched === undefined) {
      if (!unknownNames.includes(rawName)) unknownNames.push(rawName);
      continue;
    }
    if (matched.length > 1) {
      if (!ambiguousNames.includes(rawName)) ambiguousNames.push(rawName);
      continue;
    }
    const memberId = matched[0];
    if (taken.has(memberId)) continue;
    taken.add(memberId);

    const dates = new Set<IsoDate>();
    for (const value of Array.isArray(item.dates) ? item.dates : []) {
      const date = typeof value === 'string' ? value.trim() : String(value);
      if (isIsoDate(date) && meetingDates.has(date)) dates.add(date);
      else if (!badDates.includes(date)) badDates.push(date);
    }

    const unsure = typeof item.unsure === 'string' ? item.unsure.trim() : '';
    entries.push({
      memberId,
      name: rawName,
      dates: [...dates].sort(),
      ...(unsure === '' ? {} : { unsure }),
    });
  }

  return { entries, unknownNames, ambiguousNames, badDates, error: null };
}

interface RawItem {
  name?: unknown;
  dates?: unknown;
  unsure?: unknown;
}

/** 回傳字串代表讀不懂，字串本身就是要顯示給使用者的訊息 */
function readItems(text: string): RawItem[] | string {
  const trimmed = stripCodeFence(text);
  if (trimmed === '') return '還沒貼上任何內容。';

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return '這段內容不是合法的 JSON。請把 AI 回覆裡的那一段 JSON 完整貼上（從 { 到 }）。';
  }

  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.unavailable)
      ? value.unavailable
      : null;
  if (list === null) {
    return '找得到 JSON，但裡面沒有 unavailable 清單。格式應該是 {"unavailable":[{"name":"…","dates":[…]}]}。';
  }

  const items = list.filter(isRecord);
  if (items.length === 0) return 'unavailable 清單是空的，沒有任何人的不行日期。';
  return items;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

/** 比對姓名用：去空白、英文大小寫一視同仁 */
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, '').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── 套用到專案 ────────────────────────────────────────────────────────────

export type ImportMode = 'replace' | 'add';

/** 把一個人的日期算出來：replace 直接換掉，add 併進現有的 */
export function mergeDates(
  current: readonly IsoDate[],
  incoming: readonly IsoDate[],
  mode: ImportMode,
): IsoDate[] {
  const merged = mode === 'replace' ? new Set(incoming) : new Set([...current, ...incoming]);
  return [...merged].sort();
}

export function toggleDate(dates: readonly IsoDate[], date: IsoDate, on: boolean): IsoDate[] {
  const next = new Set(dates);
  if (on) next.add(date);
  else next.delete(date);
  return [...next].sort();
}

// ── 每週人力 ──────────────────────────────────────────────────────────────

export interface RoleShortage {
  roleId: RoleId;
  roleName: string;
  available: number;
  needed: number;
}

export interface WeekLoad {
  date: IsoDate;
  tags: WeekTagId[];
  /** 這一週有幾人說不行 */
  absent: number;
  shortages: RoleShortage[];
}

/**
 * 每一週扣掉不行的人之後還剩幾位候選人。
 * 只扣不行日期，不模擬 15 種限制條件 —— 否則給出的數字會比引擎樂觀或悲觀，
 * 反而誤導（規格 §7.6.3）。
 */
export function weekLoad(project: Project): WeekLoad[] {
  return project.term.weeks.map((week) => {
    const absent = project.members.filter((member) =>
      member.unavailable.includes(week.date),
    ).length;

    const shortages: RoleShortage[] = [];
    for (const role of project.roles) {
      if (!appliesTo(role.appliesTo, week)) continue;
      const available = project.members.filter(
        (member) =>
          member.roles.includes(role.id) && !member.unavailable.includes(week.date),
      ).length;
      if (available < role.perWeek) {
        shortages.push({
          roleId: role.id,
          roleName: role.name.trim() === '' ? '（未命名）' : role.name,
          available,
          needed: role.perWeek,
        });
      }
    }

    return { date: week.date, tags: week.tags, absent, shortages };
  });
}

function appliesTo(applicability: Project['roles'][number]['appliesTo'], week: Week): boolean {
  return applicability.kind === 'all' || week.tags.includes(applicability.tagId);
}

/** 不是本梯次聚會日的殘留日期，依人分組 */
export function staleDates(project: Project): { memberId: MemberId; name: string; dates: IsoDate[] }[] {
  if (project.term.weeks.length === 0) return [];
  const meetingDates = new Set(project.term.weeks.map((week) => week.date));
  const groups: { memberId: MemberId; name: string; dates: IsoDate[] }[] = [];

  for (const member of project.members) {
    const dates = member.unavailable.filter((date) => !meetingDates.has(date));
    if (dates.length > 0) {
      groups.push({ memberId: member.id, name: member.name, dates });
    }
  }
  return groups;
}

// ── 不行日期的 Excel（規格 §7.12.7）─────────────────────────────────────────

export interface UnavailableRow {
  name: string;
  /** MM/DD，依日期排序，用「、」隔開；沒有就是空字串 */
  dates: string;
}

/**
 * 一人一列，依人員清單的順序全部列出 —— 沒有不行日期的人第二欄留空，看得出
 * 誰整個梯次都可以。只列本梯次的聚會日，梯次改過之後留下來的舊日期不算。
 */
export function unavailableRows(project: Project): UnavailableRow[] {
  const meetings = new Set(project.term.weeks.map((week) => week.date));
  return project.members.map((member) => ({
    name: member.name.trim() === '' ? '（未命名）' : member.name,
    dates: member.unavailable
      .filter((date) => meetings.has(date))
      .sort()
      .map((date) => `${date.slice(5, 7)}/${date.slice(8, 10)}`)
      .join('、'),
  }));
}

export function unavailableFilename(project: Project): string {
  const name = project.term.name.trim().replace(/[\\/:*?"<>|\s]+/g, '-');
  return `不行日期${name === '' ? '' : `_${name}`}.xlsx`;
}
