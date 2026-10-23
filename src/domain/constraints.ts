/**
 * 步驟 5：15 種限制條件的中文說明、空白樣板、欄位檢查與 JSON 解析。規格 §5、§7.6.4。
 *
 * engine 的 validateProject 只查 id 參照對不對，欄位有沒有填完是 UI 的責任，
 * 所以這一層自己做形狀檢查，新增的規則一律留空並標紅，不自動填第一個人。
 */

import { isIsoDate } from '../engine';
import type {
  Constraint,
  ConstraintType,
  MemberId,
  Project,
  RoleId,
  RoleSlot,
} from '../engine';

export type ConstraintGroup = 'limits' | 'pairing' | 'rotation';

export const GROUP_LABELS: Record<ConstraintGroup, string> = {
  limits: '次數上限',
  pairing: '搭配與禁止',
  rotation: '輪替與日期',
};

export interface ConstraintMeta {
  type: ConstraintType;
  label: string;
  group: ConstraintGroup;
  hint: string;
  /**
   * 這一種規則是硬性還是偏好，由種類決定，使用者不能改。
   * 引擎不讀 `Constraint.hard`（每一種規則怎麼用是寫死在引擎裡的），
   * 所以這個欄位只是說明用，給卡片上的標記與匯出的 JSON 用。
   */
  defaultHard: boolean;
  /** 基本規則：一律存在、不能刪除，也不出現在「新增規則」裡 */
  basic?: true;
}

export const CONSTRAINT_META: readonly ConstraintMeta[] = [
  // ── 次數上限 ──
  {
    type: 'max_per_month',
    label: '每月最多幾次',
    group: 'limits',
    hint: '某個人每個月最多服事幾次，可以只算某一個位置。',
    defaultHard: true,
  },
  {
    type: 'max_per_term_role',
    label: '某個位置整梯次最多幾次',
    group: 'limits',
    hint: '某個人在指定位置上，整個梯次最多服事幾次。',
    defaultHard: true,
  },
  {
    type: 'max_total_per_term',
    label: '整梯次服事總次數上限',
    group: 'limits',
    hint: '不指定人就是套用到每一個人；指定人就只限那一個人。',
    defaultHard: true,
  },
  {
    type: 'role_frequency',
    label: '某個位置的間隔與次數',
    group: 'limits',
    hint: '這個位置上，同一個人至少要隔幾週才會再被排到，整梯次最多幾次。',
    defaultHard: true,
  },
  {
    type: 'max_consecutive_weeks_per_member',
    label: '連續兩週服事的次數上限',
    group: 'limits',
    hint: '每人整個梯次「連續兩週都有服事」最多可以發生幾次。不是限制最多連續幾週。',
    defaultHard: true,
  },

  // ── 搭配與禁止 ──
  {
    type: 'one_role_per_week',
    label: '每人每週只排一個位置',
    group: 'pairing',
    hint: '基本規則，整份班表通用。要開例外的人，用「可以同時擔任兩個位置」另外加。',
    defaultHard: true,
    basic: true,
  },
  {
    type: 'dual_role_exception',
    label: '可以同時擔任兩個位置',
    group: 'pairing',
    hint: '基本規則的例外：這個人可以在同一週同時擔任指定的幾個位置。',
    defaultHard: true,
  },
  {
    type: 'forbidden_role_combination',
    label: '不能同一週服事',
    group: 'pairing',
    hint: '這幾個人不能出現在同一週。預設不管位置，需要時才指定「只有在某些位置時才不能」。',
    defaultHard: true,
  },
  {
    type: 'required_pair',
    label: '固定搭檔（最優先湊成對）',
    group: 'pairing',
    hint: '每一週最先試這一對。湊不成就照一般順序排，不會卡住班表。',
    defaultHard: true,
  },
  {
    type: 'forbidden_together',
    label: '不能同一個位置',
    group: 'pairing',
    hint: '這個位置一次要排兩人以上時，名單裡的人任選兩個都不能同一週。只要填一個位置加一份名單。',
    defaultHard: true,
  },
  {
    type: 'substitute_priority',
    label: '缺人時的替補順序',
    group: 'pairing',
    hint: '原本的搭檔排不出來時，優先找誰、誰留到最後才找。',
    defaultHard: false,
  },
  {
    type: 'preferred_role_combination',
    label: '偏好的搭配（第二順位）',
    group: 'pairing',
    hint: 'A 先被排到之後，才優先找 B 來配。排不出來不算違規。',
    defaultHard: false,
  },

  // ── 輪替與日期 ──
  {
    type: 'rotation_groups',
    label: '輪替群組',
    group: 'rotation',
    hint: '這個位置的固定搭檔分組，依週次或當月第幾次聚會輪替。',
    defaultHard: false,
  },
  {
    type: 'max_consecutive_same_group',
    label: '同一組不能連續太多週',
    group: 'rotation',
    hint: '同一組人在這個位置上最多連續幾週。填 1 就是不能連續兩週。',
    defaultHard: true,
  },
  {
    type: 'availability_window',
    label: '可服事的日期範圍',
    group: 'rotation',
    hint: '某個人只能排在某一天之後、之前，或兩者之間。',
    defaultHard: true,
  },
];

const META_BY_TYPE = new Map(CONSTRAINT_META.map((meta) => [meta.type, meta]));

export function metaOf(type: ConstraintType): ConstraintMeta {
  const meta = META_BY_TYPE.get(type);
  if (meta === undefined) throw new Error(`未知的限制條件型別：${type}`);
  return meta;
}

export function isBasic(type: ConstraintType): boolean {
  return metaOf(type).basic === true;
}

/** 基本規則一律存在，不用新增也不能刪，所以不列進「新增規則」 */
export function groupedMeta(): { group: ConstraintGroup; items: ConstraintMeta[] }[] {
  return (['limits', 'pairing', 'rotation'] as const).map((group) => ({
    group,
    items: CONSTRAINT_META.filter((meta) => meta.group === group && meta.basic !== true),
  }));
}

/** 每一份專案都要有的基本規則。缺哪一條就補哪一條（store 的 ensureBasic 用） */
export const BASIC_TYPES: readonly ConstraintType[] = CONSTRAINT_META.filter(
  (meta) => meta.basic === true,
).map((meta) => meta.type);

// ── 空白樣板 ──────────────────────────────────────────────────────────────

/** 新增用的空白規則：該選人、該選位置的欄位一律留空，由 validateConstraint 標紅 */
export function blankConstraint(type: ConstraintType, id: string): Constraint {
  const base = { id, hard: metaOf(type).defaultHard, enabled: true };

  switch (type) {
    case 'one_role_per_week':
      return { ...base, type };
    case 'dual_role_exception':
      return { ...base, type, memberId: '', roleIds: [] };
    case 'forbidden_role_combination':
      return {
        ...base,
        type,
        entries: [
          { memberId: '', roleIds: [] },
          { memberId: '', roleIds: [] },
        ],
      };
    case 'required_pair':
      return {
        ...base,
        type,
        a: { memberId: '', roleId: '' },
        b: { memberId: '', roleId: '' },
        directional: true,
      };
    case 'max_per_month':
      return { ...base, type, memberId: '', max: 1, roleId: null };
    case 'max_per_term_role':
      return { ...base, type, memberId: '', roleId: '', max: 1 };
    case 'max_total_per_term':
      return { ...base, type, memberId: null, max: 10 };
    case 'availability_window':
      return { ...base, type, memberId: '' };
    case 'role_frequency':
      return { ...base, type, roleId: '', minGapWeeks: 4, maxPerTerm: 3 };
    case 'rotation_groups':
      return { ...base, type, roleId: '', groups: [], cycleBy: 'week' };
    case 'max_consecutive_same_group':
      return { ...base, type, roleId: '', max: 1 };
    case 'max_consecutive_weeks_per_member':
      return { ...base, type, max: 1 };
    case 'forbidden_together':
      return { ...base, type, roleId: '', memberIds: [], mode: 'any_two' };
    case 'substitute_priority':
      return { ...base, type, roleId: '', prefer: [], lastResort: [] };
    case 'preferred_role_combination':
      return {
        ...base,
        type,
        when: { memberId: '', roleId: '' },
        prefer: { memberId: '', roleId: '' },
      };
  }
}

// ── 人話摘要 ──────────────────────────────────────────────────────────────

const NO_MEMBER = '（還沒選人）';
const NO_ROLE = '（還沒選位置）';

function memberName(project: Project, id: MemberId): string {
  if (id === '') return NO_MEMBER;
  const member = project.members.find((candidate) => candidate.id === id);
  if (member === undefined) return `（找不到的人 ${id}）`;
  return member.name.trim() === '' ? '（未命名）' : member.name;
}

function roleName(project: Project, id: RoleId): string {
  if (id === '') return NO_ROLE;
  const role = project.roles.find((candidate) => candidate.id === id);
  if (role === undefined) return `（找不到的位置 ${id}）`;
  return role.name.trim() === '' ? '（未命名）' : role.name;
}

function memberNames(project: Project, ids: readonly MemberId[]): string {
  return ids.length === 0 ? '（還沒選人）' : ids.map((id) => memberName(project, id)).join('、');
}

function roleNames(project: Project, ids: readonly RoleId[], separator = '＋'): string {
  return ids.length === 0 ? NO_ROLE : ids.map((id) => roleName(project, id)).join(separator);
}

function slotText(project: Project, slot: RoleSlot): string {
  return `${memberName(project, slot.memberId)} ${roleName(project, slot.roleId)}`;
}

/** 規則卡片上那一行人話。一律用姓名與位置名稱，不露出 id */
export function describeConstraint(project: Project, constraint: Constraint): string {
  switch (constraint.type) {
    case 'one_role_per_week':
      return '每人每週只排一個位置';

    case 'dual_role_exception':
      return `${memberName(project, constraint.memberId)} 可以同時擔任 ${roleNames(
        project,
        constraint.roleIds,
      )}`;

    case 'forbidden_role_combination':
      return `${constraint.entries
        .map((entry) => {
          const who = memberName(project, entry.memberId);
          // 空陣列＝不限位置，就不用在名字後面掛括號
          return entry.roleIds.length === 0
            ? who
            : `${who}（${roleNames(project, entry.roleIds, '／')}）`;
        })
        .join(' 與 ')} 不能同一週服事`;

    case 'required_pair':
      return `${slotText(project, constraint.a)} 時，${slotText(project, constraint.b)} 必須同一週${
        constraint.directional ? '（單向）' : '（雙向）'
      }`;

    case 'max_per_month':
      return `${memberName(project, constraint.memberId)} 每月最多 ${constraint.max} 次${
        constraint.roleId === null
          ? '（所有位置合計）'
          : `（只算 ${roleName(project, constraint.roleId)}）`
      }`;

    case 'max_per_term_role':
      return `${memberName(project, constraint.memberId)} 的 ${roleName(
        project,
        constraint.roleId,
      )} 整梯次最多 ${constraint.max} 次`;

    case 'max_total_per_term':
      return constraint.memberId === null
        ? `每人整梯次最多 ${constraint.max} 次`
        : `${memberName(project, constraint.memberId)} 整梯次最多 ${constraint.max} 次`;

    case 'availability_window': {
      const who = memberName(project, constraint.memberId);
      if (constraint.from !== undefined && constraint.until !== undefined) {
        return `${who} 只能排在 ${constraint.from} 到 ${constraint.until} 之間`;
      }
      if (constraint.from !== undefined) return `${who} 只能排在 ${constraint.from}（含）之後`;
      if (constraint.until !== undefined) return `${who} 只能排在 ${constraint.until}（含）之前`;
      return `${who} 的日期範圍還沒填`;
    }

    case 'role_frequency':
      return `${roleName(project, constraint.roleId)} 至少間隔 ${
        constraint.minGapWeeks
      } 週，整梯次最多 ${constraint.maxPerTerm} 次`;

    case 'rotation_groups':
      return `${roleName(project, constraint.roleId)} 依${
        constraint.cycleBy === 'week' ? '週次' : '當月第幾次聚會'
      }輪替：${
        constraint.groups.length === 0
          ? '（還沒分組）'
          : constraint.groups.map((group) => memberNames(project, group)).join(' → ')
      }`;

    case 'max_consecutive_same_group':
      return `${roleName(project, constraint.roleId)} 同一組不能連續超過 ${constraint.max} 週`;

    case 'max_consecutive_weeks_per_member':
      return `每人整梯次最多出現 ${constraint.max} 次連續兩週服事`;

    case 'forbidden_together':
      return `${roleName(project, constraint.roleId)} 的 ${memberNames(
        project,
        constraint.memberIds,
      )} 之中，任兩人不能同一週`;

    case 'substitute_priority': {
      const parts: string[] = [];
      if (constraint.prefer.length > 0) {
        parts.push(`優先找 ${memberNames(project, constraint.prefer)}`);
      }
      if (constraint.lastResort.length > 0) {
        parts.push(`${memberNames(project, constraint.lastResort)} 留到最後`);
      }
      return `${roleName(project, constraint.roleId)} 缺人時${
        parts.length === 0 ? '（兩個名單都還是空的）' : parts.join('，')
      }`;
    }

    case 'preferred_role_combination':
      return `${slotText(project, constraint.when)} 時，偏好 ${slotText(
        project,
        constraint.prefer,
      )}`;
  }
}

// ── 欄位檢查 ──────────────────────────────────────────────────────────────

const MEMBER_MISSING = '還沒選人';
const ROLE_MISSING = '還沒選位置';

/** 回傳空陣列代表這條規則填完了；否則每個字串都是一句可以直接顯示的紅字 */
export function validateConstraint(project: Project, constraint: Constraint): string[] {
  const issues: string[] = [];
  const memberIds = new Set(project.members.map((member) => member.id));
  const roleIds = new Set(project.roles.map((role) => role.id));

  const member = (id: MemberId, label = MEMBER_MISSING) => {
    if (id === '') issues.push(label);
    else if (!memberIds.has(id)) issues.push(`指向已經被刪掉的人（${id}）`);
  };
  const role = (id: RoleId, label = ROLE_MISSING) => {
    if (id === '') issues.push(label);
    else if (!roleIds.has(id)) issues.push(`指向已經被刪掉的位置（${id}）`);
  };
  const positive = (value: number, label: string) => {
    if (!Number.isInteger(value) || value < 1) issues.push(`${label}要填 1 以上的整數`);
  };

  switch (constraint.type) {
    case 'one_role_per_week':
      break;

    case 'dual_role_exception':
      member(constraint.memberId);
      if (constraint.roleIds.length < 2) issues.push('至少要選兩個位置');
      constraint.roleIds.forEach((id) => role(id));
      break;

    case 'forbidden_role_combination':
      // 位置是選填的：留空就是不限位置，不算沒填完
      if (constraint.entries.length < 2) issues.push('至少要有兩個人');
      constraint.entries.forEach((entry) => {
        member(entry.memberId);
        entry.roleIds.forEach((id) => role(id));
      });
      break;

    case 'required_pair':
      member(constraint.a.memberId, '還沒選第一個人');
      role(constraint.a.roleId, '第一個人還沒選位置');
      member(constraint.b.memberId, '還沒選第二個人');
      role(constraint.b.roleId, '第二個人還沒選位置');
      if (
        constraint.a.memberId !== '' &&
        constraint.a.memberId === constraint.b.memberId
      ) {
        issues.push('兩邊是同一個人');
      }
      break;

    case 'max_per_month':
      member(constraint.memberId);
      positive(constraint.max, '每月次數上限');
      if (constraint.roleId !== null) role(constraint.roleId);
      break;

    case 'max_per_term_role':
      member(constraint.memberId);
      role(constraint.roleId);
      positive(constraint.max, '次數上限');
      break;

    case 'max_total_per_term':
      if (constraint.memberId !== null) member(constraint.memberId);
      positive(constraint.max, '次數上限');
      break;

    case 'availability_window':
      member(constraint.memberId);
      if (constraint.from === undefined && constraint.until === undefined) {
        issues.push('至少要填一個日期');
      }
      for (const date of [constraint.from, constraint.until]) {
        if (date !== undefined && !isIsoDate(date)) issues.push(`日期不合法：${date}`);
      }
      if (
        constraint.from !== undefined &&
        constraint.until !== undefined &&
        constraint.from > constraint.until
      ) {
        issues.push('起始日比結束日還晚');
      }
      break;

    case 'role_frequency':
      role(constraint.roleId);
      if (!Number.isInteger(constraint.minGapWeeks) || constraint.minGapWeeks < 0) {
        issues.push('間隔週數要填 0 以上的整數');
      }
      positive(constraint.maxPerTerm, '整梯次次數上限');
      break;

    case 'rotation_groups':
      role(constraint.roleId);
      if (constraint.groups.length === 0) issues.push('至少要有一組');
      constraint.groups.forEach((group) => {
        if (group.length === 0) issues.push('有一組是空的');
        group.forEach((id) => member(id));
      });
      break;

    case 'max_consecutive_same_group':
      role(constraint.roleId);
      positive(constraint.max, '連續週數上限');
      break;

    case 'max_consecutive_weeks_per_member':
      positive(constraint.max, '次數上限');
      break;

    case 'forbidden_together':
      role(constraint.roleId);
      if (constraint.memberIds.length < 2) issues.push('至少要選兩個人');
      constraint.memberIds.forEach((id) => member(id));
      break;

    case 'substitute_priority':
      role(constraint.roleId);
      if (constraint.prefer.length === 0 && constraint.lastResort.length === 0) {
        issues.push('兩個名單都是空的');
      }
      [...constraint.prefer, ...constraint.lastResort].forEach((id) => member(id));
      if (constraint.prefer.some((id) => constraint.lastResort.includes(id))) {
        issues.push('有人同時在「優先」和「最後」名單裡');
      }
      break;

    case 'preferred_role_combination':
      member(constraint.when.memberId, '還沒選第一個人');
      role(constraint.when.roleId, '第一個人還沒選位置');
      member(constraint.prefer.memberId, '還沒選第二個人');
      role(constraint.prefer.roleId, '第二個人還沒選位置');
      break;
  }

  // 同一條規則裡同樣的毛病只講一次
  return [...new Set(issues)];
}

export function invalidConstraintCount(project: Project): number {
  return project.constraints.filter(
    (constraint) => validateConstraint(project, constraint).length > 0,
  ).length;
}

// ── 進階 JSON ─────────────────────────────────────────────────────────────

export interface ConstraintJsonError {
  /** 第幾條（從 1 起算）；整段讀不懂時是 null */
  position: number | null;
  message: string;
}

export type ParsedConstraints =
  | { ok: true; constraints: Constraint[] }
  | { ok: false; errors: ConstraintJsonError[] };

export function constraintsToJson(constraints: readonly Constraint[]): string {
  return JSON.stringify(constraints, null, 2);
}

/**
 * 吃整個 constraints 陣列。型別、欄位形狀、id 參照、欄位完整度全部查一遍，
 * 任何一條有問題就整段不套用（規格 §7.6.4）。
 */
export function parseConstraintsJson(text: string, project: Project): ParsedConstraints {
  const trimmed = stripCodeFence(text);
  if (trimmed === '') return { ok: true, constraints: [] };

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    return {
      ok: false,
      errors: [{ position: null, message: `不是合法的 JSON：${(error as Error).message}` }],
    };
  }

  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.constraints)
      ? value.constraints
      : null;
  if (list === null) {
    return {
      ok: false,
      errors: [{ position: null, message: '最外層要是一個陣列 [ … ]，或 {"constraints":[ … ]}' }],
    };
  }

  const errors: ConstraintJsonError[] = [];
  const constraints: Constraint[] = [];
  const usedIds = new Set<string>();
  let serial = 0;
  const nextId = (): string => {
    do {
      serial += 1;
    } while (usedIds.has(`c${serial}`));
    return `c${serial}`;
  };

  list.forEach((raw, index) => {
    const position = index + 1;
    if (!isRecord(raw)) {
      errors.push({ position, message: '這一條不是物件' });
      return;
    }
    try {
      const body = readConstraint(raw);
      const givenId = typeof raw.id === 'string' ? raw.id.trim() : '';
      const id = givenId !== '' && !usedIds.has(givenId) ? givenId : nextId();
      usedIds.add(id);
      const constraint = {
        ...body,
        id,
        // hard 由種類決定，檔案裡寫什麼都不算數（引擎本來就不讀它）
        hard: metaOf(body.type).defaultHard,
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
        ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
      } as Constraint;

      for (const issue of validateConstraint(project, constraint)) {
        errors.push({ position, message: issue });
      }
      constraints.push(constraint);
    } catch (error) {
      errors.push({ position, message: (error as Error).message });
    }
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, constraints };
}

/** 去掉共用欄位之後的本體。要逐個聯集成員展開，否則只會留下共同欄位 */
type Body<T> = T extends unknown ? Omit<T, 'id' | 'hard' | 'enabled' | 'note'> : never;
type ConstraintBody = Body<Constraint>;

function readConstraint(raw: Record<string, unknown>): ConstraintBody {
  const type = raw.type;
  if (typeof type !== 'string' || !META_BY_TYPE.has(type as ConstraintType)) {
    return fail(`type 不認得：${JSON.stringify(type)}`);
  }

  switch (type as ConstraintType) {
    case 'one_role_per_week':
      return { type: 'one_role_per_week' };
    case 'dual_role_exception':
      return {
        type: 'dual_role_exception',
        memberId: str(raw, 'memberId'),
        roleIds: strArray(raw, 'roleIds'),
      };
    case 'forbidden_role_combination':
      return {
        type: 'forbidden_role_combination',
        entries: array(raw, 'entries').map((entry, i) => {
          if (!isRecord(entry)) return fail(`entries 第 ${i + 1} 筆不是物件`);
          return {
            memberId: str(entry, 'memberId'),
            // 省略或空陣列都是「不限位置」
            roleIds: entry.roleIds === undefined ? [] : strArray(entry, 'roleIds'),
          };
        }),
      };
    case 'required_pair':
      return {
        type: 'required_pair',
        a: slot(raw, 'a'),
        b: slot(raw, 'b'),
        directional: bool(raw, 'directional'),
      };
    case 'max_per_month':
      return {
        type: 'max_per_month',
        memberId: str(raw, 'memberId'),
        max: int(raw, 'max'),
        roleId: raw.roleId === null || raw.roleId === undefined ? null : str(raw, 'roleId'),
      };
    case 'max_per_term_role':
      return {
        type: 'max_per_term_role',
        memberId: str(raw, 'memberId'),
        roleId: str(raw, 'roleId'),
        max: int(raw, 'max'),
      };
    case 'max_total_per_term':
      return {
        type: 'max_total_per_term',
        max: int(raw, 'max'),
        memberId:
          raw.memberId === null || raw.memberId === undefined ? null : str(raw, 'memberId'),
      };
    case 'availability_window':
      return {
        type: 'availability_window',
        memberId: str(raw, 'memberId'),
        ...(raw.from === undefined || raw.from === null ? {} : { from: str(raw, 'from') }),
        ...(raw.until === undefined || raw.until === null ? {} : { until: str(raw, 'until') }),
      };
    case 'role_frequency':
      return {
        type: 'role_frequency',
        roleId: str(raw, 'roleId'),
        minGapWeeks: int(raw, 'minGapWeeks'),
        maxPerTerm: int(raw, 'maxPerTerm'),
      };
    case 'rotation_groups':
      return {
        type: 'rotation_groups',
        roleId: str(raw, 'roleId'),
        groups: array(raw, 'groups').map((group, i) => {
          if (!Array.isArray(group)) return fail(`groups 第 ${i + 1} 組不是陣列`);
          return group.map((id) => {
            if (typeof id !== 'string') return fail(`groups 第 ${i + 1} 組裡有不是字串的 id`);
            return id;
          });
        }),
        cycleBy: enumOf(raw, 'cycleBy', ['week', 'month'] as const),
      };
    case 'max_consecutive_same_group':
      return {
        type: 'max_consecutive_same_group',
        roleId: str(raw, 'roleId'),
        max: int(raw, 'max'),
      };
    case 'max_consecutive_weeks_per_member':
      return { type: 'max_consecutive_weeks_per_member', max: int(raw, 'max') };
    case 'forbidden_together':
      return {
        type: 'forbidden_together',
        roleId: str(raw, 'roleId'),
        memberIds: strArray(raw, 'memberIds'),
        mode: enumOf(raw, 'mode', ['any_two'] as const),
      };
    case 'substitute_priority':
      return {
        type: 'substitute_priority',
        roleId: str(raw, 'roleId'),
        prefer: strArray(raw, 'prefer'),
        lastResort: strArray(raw, 'lastResort'),
      };
    case 'preferred_role_combination':
      return {
        type: 'preferred_role_combination',
        when: slot(raw, 'when'),
        prefer: slot(raw, 'prefer'),
      };
  }
}

function fail(message: string): never {
  throw new Error(message);
}

function str(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string') return fail(`${key} 要是字串`);
  return value;
}

function int(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) return fail(`${key} 要是整數`);
  return value;
}

function bool(raw: Record<string, unknown>, key: string): boolean {
  const value = raw[key];
  if (typeof value !== 'boolean') return fail(`${key} 要是 true 或 false`);
  return value;
}

function array(raw: Record<string, unknown>, key: string): unknown[] {
  const value = raw[key];
  if (!Array.isArray(value)) return fail(`${key} 要是陣列`);
  return value;
}

function strArray(raw: Record<string, unknown>, key: string): string[] {
  return array(raw, key).map((item) => {
    if (typeof item !== 'string') return fail(`${key} 裡有不是字串的項目`);
    return item;
  });
}

function slot(raw: Record<string, unknown>, key: string): RoleSlot {
  const value = raw[key];
  if (!isRecord(value)) return fail(`${key} 要是 {"memberId":"…","roleId":"…"}`);
  return { memberId: str(value, 'memberId'), roleId: str(value, 'roleId') };
}

function enumOf<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = raw[key];
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return fail(`${key} 只能是 ${allowed.join(' 或 ')}`);
  }
  return value as T;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
