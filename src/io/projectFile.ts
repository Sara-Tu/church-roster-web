/**
 * JSON 專案檔的匯出與匯入。規格 §8、§7.6.5。
 *
 * 匯入一律當成外來資料：結構、schemaVersion、限制條件的形狀與所有 id 參照
 * 都查過才給用，壞掉的檔案不會部分套用。
 */

import { SCHEMA_VERSION, ProjectValidationError, validateProject } from '../engine';
import type { Constraint, Project, Role, Week, WeekTag } from '../engine';
import { APP_VERSION } from '../version';
import { parseConstraintsJson } from '../domain/constraints';

export interface ProjectSummary {
  term: string;
  weeks: number;
  tagged: number;
  tagLabel: string;
  roles: number;
  members: number;
  constraints: number;
  unavailable: number;
}

export function summarize(project: Project): ProjectSummary {
  const tag = project.weekTags[0];
  return {
    term: project.term.name.trim() === '' ? '（未命名梯次）' : project.term.name,
    weeks: project.term.weeks.length,
    tagged:
      tag === undefined
        ? 0
        : project.term.weeks.filter((week) => week.tags.includes(tag.id)).length,
    tagLabel: tag?.label ?? '特殊週',
    roles: project.roles.length,
    members: project.members.length,
    constraints: project.constraints.length,
    unavailable: project.members.reduce((sum, member) => sum + member.unavailable.length, 0),
  };
}

export function projectFilename(project: Project, today: string): string {
  const name = project.term.name.trim().replace(/[\\/:*?"<>|\s]+/g, '-');
  return `church-roster_${name === '' ? today : name}.json`;
}

/** 匯出的內容：原樣的 project，只更新版號與匯出日期 */
export function serializeProject(project: Project, today: string): string {
  const payload: Project = { ...project, appVersion: APP_VERSION, exportedAt: today };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export type ImportResult =
  | { ok: true; project: Project }
  | { ok: false; errors: string[] };

export function readProject(text: string): ImportResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`不是合法的 JSON：${(error as Error).message}`] };
  }
  if (!isRecord(value)) return { ok: false, errors: ['最外層不是一個物件'] };

  if (value.schemaVersion !== SCHEMA_VERSION) {
    const version = typeof value.schemaVersion === 'number' ? value.schemaVersion : '（沒有）';
    return {
      ok: false,
      errors: [
        `這個檔案的 schemaVersion 是 ${version}，目前的網頁只讀得懂 ${SCHEMA_VERSION}。請用產生這個檔案的那一版網頁開啟。`,
      ],
    };
  }

  const errors: string[] = [];
  const term = readTerm(value.term, errors);
  const weekTags = readList(value.weekTags, 'weekTags', readWeekTag, errors);
  const roles = readList(value.roles, 'roles', readRole, errors);
  const members = readList(value.members, 'members', readMember, errors);
  if (!Array.isArray(value.constraints)) errors.push('constraints 不是陣列');
  if (errors.length > 0) return { ok: false, errors };

  const project: Project = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: typeof value.appVersion === 'string' ? value.appVersion : '',
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    church: readChurch(value.church),
    term,
    weekTags,
    roles,
    members,
    constraints: [],
    revision: typeof value.revision === 'number' ? value.revision : 0,
  };

  // 限制條件沿用步驟 5 的那一套檢查：形狀、id 參照、欄位完整度一次查完
  const parsed = parseConstraintsJson(JSON.stringify(value.constraints), project);
  if (!parsed.ok) {
    return {
      ok: false,
      errors: parsed.errors.map((error) =>
        error.position === null
          ? `限制條件：${error.message}`
          : `第 ${error.position} 條限制條件：${error.message}`,
      ),
    };
  }
  project.constraints = parsed.constraints as Constraint[];

  try {
    validateProject(project);
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return { ok: false, errors: [...error.issues] };
    }
    throw error;
  }

  return { ok: true, project };
}

// ── 結構檢查 ──────────────────────────────────────────────────────────────

function readChurch(value: unknown): Project['church'] {
  if (!isRecord(value)) return { name: '', note: '' };
  return {
    name: typeof value.name === 'string' ? value.name : '',
    note: typeof value.note === 'string' ? value.note : '',
  };
}

function readTerm(value: unknown, errors: string[]): Project['term'] {
  if (!isRecord(value)) {
    errors.push('term 不是一個物件');
    return { name: '', start: '', end: '', weeks: [] };
  }
  const weeks = readList(value.weeks, 'term.weeks', readWeek, errors);
  return {
    name: typeof value.name === 'string' ? value.name : '',
    start: typeof value.start === 'string' ? value.start : '',
    end: typeof value.end === 'string' ? value.end : '',
    weeks,
  };
}

function readWeek(value: unknown, label: string): Week {
  const raw = expectRecord(value, label);
  return { date: expectString(raw.date, `${label}.date`), tags: expectStrings(raw.tags, `${label}.tags`) };
}

function readWeekTag(value: unknown, label: string): WeekTag {
  const raw = expectRecord(value, label);
  const rule = expectRecord(raw.rule, `${label}.rule`);
  if (rule.kind === 'manual') {
    return {
      id: expectString(raw.id, `${label}.id`),
      label: expectString(raw.label, `${label}.label`),
      rule: { kind: 'manual' },
    };
  }
  if (rule.kind !== 'nthMeetingOfMonth' || typeof rule.n !== 'number') {
    throw new Error(`${label}.rule 只能是 manual 或 nthMeetingOfMonth（含整數 n）`);
  }
  return {
    id: expectString(raw.id, `${label}.id`),
    label: expectString(raw.label, `${label}.label`),
    rule: { kind: 'nthMeetingOfMonth', n: rule.n },
  };
}

function readRole(value: unknown, label: string): Role {
  const raw = expectRecord(value, label);
  const appliesTo = expectRecord(raw.appliesTo, `${label}.appliesTo`);
  const role: Role = {
    id: expectString(raw.id, `${label}.id`),
    name: expectString(raw.name, `${label}.name`),
    perWeek: expectNumber(raw.perWeek, `${label}.perWeek`),
    appliesTo:
      appliesTo.kind === 'all'
        ? { kind: 'all' }
        : { kind: 'weekTag', tagId: expectString(appliesTo.tagId, `${label}.appliesTo.tagId`) },
  };
  if (typeof raw.pairsWith === 'string') role.pairsWith = raw.pairsWith;
  return role;
}

function readMember(value: unknown, label: string): Project['members'][number] {
  const raw = expectRecord(value, label);
  return {
    id: expectString(raw.id, `${label}.id`),
    name: expectString(raw.name, `${label}.name`),
    roles: expectStrings(raw.roles, `${label}.roles`),
    unavailable: [...expectStrings(raw.unavailable, `${label}.unavailable`)].sort(),
  };
}

function readList<T>(
  value: unknown,
  field: string,
  read: (item: unknown, label: string) => T,
  errors: string[],
): T[] {
  if (!Array.isArray(value)) {
    errors.push(`${field} 不是陣列`);
    return [];
  }
  const items: T[] = [];
  value.forEach((item, index) => {
    try {
      items.push(read(item, `${field}[${index}]`));
    } catch (error) {
      errors.push((error as Error).message);
    }
  });
  return items;
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} 不是一個物件`);
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} 要是字串`);
  return value;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} 要是數字`);
  return value;
}

function expectStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 要是陣列`);
  return value.map((item) => expectString(item, `${label} 裡的項目`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
