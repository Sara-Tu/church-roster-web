/**
 * 唯一能改狀態的地方。規格 §7.5.3。
 *
 * state 分兩塊：`project`（§4 的 schema v1，完整一份，匯出時原樣寫出去）與
 * `ui`（導覽與「產生聚會日」的輸入，只存在 localStorage，不進專案檔）。
 */

import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StateCreator } from 'zustand';
import { SCHEMA_VERSION, weekdayOf } from '../engine';
import type {
  Constraint,
  ConstraintType,
  Member,
  Project,
  Role,
  RoleId,
  WeekTagId,
} from '../engine';
import { APP_VERSION } from '../version';
import { defaultRoles, moveRole as reorderRoles } from '../domain/roles';
import { parseNameList, toggleRole } from '../domain/members';
import type { ParsedNames } from '../domain/members';
import { BASIC_TYPES, blankConstraint, isBasic } from '../domain/constraints';
import { mergeDates, toggleDate } from '../domain/unavailable';
import type { ImportMode, ParsedEntry } from '../domain/unavailable';
import {
  applyNthMeetingRule,
  generateMeetingDates,
  insertMeetingDate,
  ruleDeviationCount,
  toWeeks,
} from '../domain/term';
import { removeMembers, removeRole } from './cascade';
import { initCounters, takeId } from './ids';
import type { IdCounters } from './ids';
import { browserStorage, loadSaved, saveState } from './persist';
import type { PersistedUi, StorageLike } from './persist';
import { ALL_STEPS, LAST_GUIDE_INDEX, STEPS, stepIndex } from '../ui/steps';
import type { StepId } from '../ui/steps';

export const DEFAULT_TAG_ID = 'communion';
const SAVE_DELAY_MS = 300;

export type UiState = PersistedUi;

export interface StorageState {
  writable: boolean;
  backupKey: string | null;
}

export interface AppState {
  project: Project;
  ui: UiState;
  storage: StorageState;
  counters: IdCounters;

  // 步驟 1
  setChurchName: (name: string) => void;
  setTermName: (name: string) => void;
  setTermStart: (date: string) => void;
  setTermEnd: (date: string) => void;
  setMeetingWeekday: (weekday: number) => void;
  generateWeeks: () => number;
  setTagLabel: (label: string) => void;
  /** 回傳 true 代表已經即時重算；false 代表有手動改過的週次，要按「套用」 */
  setTagRule: (n: number | null) => boolean;
  applyTagRule: () => string[];
  toggleWeekTag: (date: string) => void;
  removeWeek: (date: string) => void;
  addWeek: (date: string) => boolean;

  // 步驟 2
  addRole: () => void;
  updateRole: (id: RoleId, patch: Partial<Pick<Role, 'name' | 'perWeek'>>) => void;
  setRoleTagOnly: (id: RoleId, only: boolean) => void;
  setRolePair: (id: RoleId, pairsWith: RoleId | null) => void;
  moveRole: (index: number, delta: number) => void;
  deleteRole: (id: RoleId) => void;

  // 步驟 3
  addMember: (name?: string) => void;
  renameMember: (id: string, name: string) => void;
  setMemberRole: (id: string, roleId: RoleId, on: boolean) => void;
  deleteMember: (id: string) => void;
  deleteMembers: (ids: readonly string[]) => void;
  clearMembers: () => void;
  addMembersFromText: (text: string) => ParsedNames;

  // 步驟 4
  toggleUnavailable: (memberId: string, date: string, on: boolean) => void;
  clearMemberUnavailable: (memberId: string) => void;
  /** 清掉不是本梯次聚會日的殘留日期，回傳清掉幾筆 */
  clearStaleUnavailable: () => number;
  /** 套用 AI 整理出來的結果，回傳有幾個人的日期被改動 */
  importUnavailable: (entries: readonly ParsedEntry[], mode: ImportMode) => number;

  // 步驟 5
  addConstraint: (type: ConstraintType) => string;
  updateConstraint: (constraint: Constraint) => void;
  setConstraintEnabled: (id: string, enabled: boolean) => void;
  setConstraintNote: (id: string, note: string) => void;
  deleteConstraint: (id: string) => void;
  replaceConstraints: (constraints: readonly Constraint[]) => void;

  /** 匯入：整份換掉，導覽直接進頁籤模式並停在步驟 1 */
  loadProject: (project: Project) => void;

  // 導覽
  goToStep: (step: StepId) => void;
  nextStep: () => void;
  prevStep: () => void;
  finishGuide: () => void;

  /** 測試與離開頁面前用：立刻寫入，不等 debounce */
  flushSave: () => void;
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 補上缺少的基本規則（規格 §7.7.4）。基本規則不出現在「新增規則」裡，
 * 使用者只能開關、不能刪，所以空白專案、匯入的檔案與進階 JSON 都要過這一關。
 */
export function ensureBasicConstraints(
  constraints: readonly Constraint[],
  counters: IdCounters,
): { constraints: Constraint[]; counters: IdCounters } {
  let next = counters;
  const missing: Constraint[] = [];

  for (const type of BASIC_TYPES) {
    if (constraints.some((item) => item.type === type)) continue;
    const taken = takeId(next, 'c');
    next = taken.counters;
    missing.push(blankConstraint(type, taken.id));
  }

  return { constraints: [...missing, ...constraints], counters: next };
}

function withBasics(project: Project): { project: Project; counters: IdCounters } {
  const ensured = ensureBasicConstraints(project.constraints, initCounters(project));
  return {
    project: { ...project, constraints: ensured.constraints },
    counters: ensured.counters,
  };
}

export function createBlankProject(): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: today(),
    church: { name: '', note: '' },
    term: { name: '', start: '', end: '', weeks: [] },
    weekTags: [
      { id: DEFAULT_TAG_ID, label: '聖餐週', rule: { kind: 'nthMeetingOfMonth', n: 1 } },
    ],
    roles: defaultRoles(DEFAULT_TAG_ID),
    members: [],
    // 基本規則一開始就在，不用使用者自己加
    constraints: [blankConstraint('one_role_per_week', 'c1')],
    revision: 0,
  };
}

function blankUi(): UiState {
  return {
    step: 'term',
    guideDone: false,
    maxReached: 0,
    meetingWeekday: 0,
    generatedFrom: null,
  };
}

function makeAppState(storage: StorageLike | null): StateCreator<AppState> {
  return (set, get) => {
    const loaded = loadSaved(storage);
    const project = loaded.saved?.project ?? createBlankProject();
    const ui = loaded.saved?.ui ?? blankUi();

    let timer: ReturnType<typeof setTimeout> | null = null;

    const writeNow = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const state = get();
      const ok = saveState(storage, {
        schemaVersion: SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        project: { ...state.project, appVersion: APP_VERSION },
        ui: state.ui,
      });
      if (ok !== state.storage.writable) {
        set({ storage: { ...state.storage, writable: ok } });
      }
    };

    /** 改狀態的唯一入口：set 之後排一次 debounce 寫入 */
    const commit = (patch: (state: AppState) => Partial<AppState>) => {
      set(patch);
      if (storage === null) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(writeNow, SAVE_DELAY_MS);
    };

    const patchProject = (update: (project: Project) => Project) => {
      commit((state) => ({ project: update(state.project) }));
    };

    const patchTerm = (update: (term: Project['term']) => Project['term']) => {
      patchProject((current) => ({ ...current, term: update(current.term) }));
    };

    const patchConstraint = (id: string, update: (constraint: Constraint) => Constraint) => {
      patchProject((current) => ({
        ...current,
        constraints: current.constraints.map((item) => (item.id === id ? update(item) : item)),
      }));
    };

    const tagId = (state: AppState): WeekTagId => state.project.weekTags[0]?.id ?? DEFAULT_TAG_ID;

    return {
      project,
      ui,
      storage: { writable: storage !== null, backupKey: loaded.backupKey },
      counters: initCounters(project),

      // ── 步驟 1 ──
      setChurchName: (name) =>
        patchProject((current) => ({ ...current, church: { ...current.church, name } })),

      setTermName: (name) => patchTerm((term) => ({ ...term, name })),
      setTermStart: (date) => patchTerm((term) => ({ ...term, start: date })),
      setTermEnd: (date) => patchTerm((term) => ({ ...term, end: date })),

      setMeetingWeekday: (weekday) =>
        commit((state) => ({ ui: { ...state.ui, meetingWeekday: weekday } })),

      generateWeeks: () => {
        const state = get();
        const { start, end } = state.project.term;
        const weekday = state.ui.meetingWeekday;
        const fresh = toWeeks(generateMeetingDates(start, end, weekday));
        const rule = state.project.weekTags[0]?.rule;
        // 重建出來的週次沒有手動改過的東西，直接把規則套上去
        const weeks =
          rule?.kind === 'nthMeetingOfMonth'
            ? applyNthMeetingRule(fresh, tagId(state), rule.n).weeks
            : fresh;

        commit((current) => ({
          project: { ...current.project, term: { ...current.project.term, weeks } },
          ui: { ...current.ui, generatedFrom: { start, end, weekday } },
        }));
        return weeks.length;
      },

      setTagLabel: (label) =>
        patchProject((current) => ({
          ...current,
          weekTags: current.weekTags.map((tag, i) => (i === 0 ? { ...tag, label } : tag)),
        })),

      setTagRule: (n) => {
        const state = get();
        const id = tagId(state);
        const weeks = state.project.term.weeks;
        const previous = state.project.weekTags[0]?.rule;

        // 目前的標記完全等於舊規則算出來的（或根本還沒標），就代表沒有人手動改過，
        // 換規則可以直接重算；手動改過的話留給「套用到所有週次」按鈕去確認覆蓋。
        const untouched =
          previous?.kind === 'nthMeetingOfMonth'
            ? ruleDeviationCount(weeks, id, previous.n) === 0
            : weeks.every((week) => !week.tags.includes(id));
        const applying = n !== null && weeks.length > 0 && untouched;

        commit((current) => ({
          project: {
            ...current.project,
            weekTags: current.project.weekTags.map((tag, i) =>
              i === 0
                ? {
                    ...tag,
                    rule: n === null ? { kind: 'manual' } : { kind: 'nthMeetingOfMonth', n },
                  }
                : tag,
            ),
            term: applying
              ? {
                  ...current.project.term,
                  weeks: applyNthMeetingRule(weeks, id, n as number).weeks,
                }
              : current.project.term,
          },
        }));
        return applying;
      },

      applyTagRule: () => {
        const state = get();
        const rule = state.project.weekTags[0]?.rule;
        if (rule?.kind !== 'nthMeetingOfMonth') return [];
        const applied = applyNthMeetingRule(state.project.term.weeks, tagId(state), rule.n);
        patchTerm((term) => ({ ...term, weeks: applied.weeks }));
        return applied.gaps;
      },

      toggleWeekTag: (date) => {
        const id = tagId(get());
        patchTerm((term) => ({
          ...term,
          weeks: term.weeks.map((week) =>
            week.date === date
              ? {
                  ...week,
                  tags: week.tags.includes(id)
                    ? week.tags.filter((tag) => tag !== id)
                    : [...week.tags, id],
                }
              : week,
          ),
        }));
      },

      removeWeek: (date) =>
        patchTerm((term) => ({ ...term, weeks: term.weeks.filter((week) => week.date !== date) })),

      addWeek: (date) => {
        const next = insertMeetingDate(get().project.term.weeks, date);
        if (next === null) return false;
        patchTerm((term) => ({ ...term, weeks: next }));
        return true;
      },

      // ── 步驟 2 ──
      addRole: () =>
        commit((state) => {
          const { id, counters } = takeId(state.counters, 'r');
          const role: Role = { id, name: '', perWeek: 1, appliesTo: { kind: 'all' } };
          return { counters, project: { ...state.project, roles: [...state.project.roles, role] } };
        }),

      updateRole: (id, patch) =>
        patchProject((current) => ({
          ...current,
          roles: current.roles.map((role) => (role.id === id ? { ...role, ...patch } : role)),
        })),

      setRoleTagOnly: (id, only) => {
        const tag = tagId(get());
        patchProject((current) => ({
          ...current,
          roles: current.roles.map((role) =>
            role.id === id
              ? { ...role, appliesTo: only ? { kind: 'weekTag', tagId: tag } : { kind: 'all' } }
              : role,
          ),
        }));
      },

      setRolePair: (id, pairsWith) =>
        patchProject((current) => ({
          ...current,
          roles: current.roles.map((role) => {
            if (role.id !== id) return role;
            const next = { ...role };
            if (pairsWith === null) delete next.pairsWith;
            else next.pairsWith = pairsWith;
            return next;
          }),
        })),

      moveRole: (index, delta) =>
        patchProject((current) => ({ ...current, roles: reorderRoles(current.roles, index, delta) })),

      deleteRole: (id) => patchProject((current) => removeRole(current, id)),

      // ── 步驟 3 ──
      addMember: (name = '') =>
        commit((state) => {
          const { id, counters } = takeId(state.counters, 'm');
          const member: Member = { id, name, roles: [], unavailable: [] };
          return {
            counters,
            project: { ...state.project, members: [...state.project.members, member] },
          };
        }),

      renameMember: (id, name) =>
        patchProject((current) => ({
          ...current,
          members: current.members.map((member) =>
            member.id === id ? { ...member, name } : member,
          ),
        })),

      setMemberRole: (id, roleId, on) =>
        patchProject((current) => ({
          ...current,
          members: current.members.map((member) =>
            member.id === id ? toggleRole(member, roleId, on) : member,
          ),
        })),

      deleteMember: (id) => patchProject((current) => removeMembers(current, [id])),

      deleteMembers: (ids) => patchProject((current) => removeMembers(current, ids)),

      clearMembers: () =>
        patchProject((current) =>
          removeMembers(
            current,
            current.members.map((member) => member.id),
          ),
        ),

      addMembersFromText: (text) => {
        const state = get();
        const parsed = parseNameList(
          text,
          state.project.members.map((member) => member.name),
        );
        if (parsed.names.length === 0) return parsed;

        let counters = state.counters;
        const added: Member[] = parsed.names.map((name) => {
          const taken = takeId(counters, 'm');
          counters = taken.counters;
          return { id: taken.id, name, roles: [], unavailable: [] };
        });

        commit((current) => ({
          counters,
          project: { ...current.project, members: [...current.project.members, ...added] },
        }));
        return parsed;
      },

      // ── 步驟 4 ──
      toggleUnavailable: (memberId, date, on) =>
        patchProject((current) => ({
          ...current,
          members: current.members.map((member) =>
            member.id === memberId
              ? { ...member, unavailable: toggleDate(member.unavailable, date, on) }
              : member,
          ),
        })),

      clearMemberUnavailable: (memberId) =>
        patchProject((current) => ({
          ...current,
          members: current.members.map((member) =>
            member.id === memberId && member.unavailable.length > 0
              ? { ...member, unavailable: [] }
              : member,
          ),
        })),

      clearStaleUnavailable: () => {
        let removed = 0;
        patchProject((current) => {
          const dates = new Set(current.term.weeks.map((week) => week.date));
          const members = current.members.map((member) => {
            const kept = member.unavailable.filter((date) => dates.has(date));
            if (kept.length === member.unavailable.length) return member;
            removed += member.unavailable.length - kept.length;
            return { ...member, unavailable: kept };
          });
          return { ...current, members };
        });
        return removed;
      },

      importUnavailable: (entries, mode) => {
        const incoming = new Map(entries.map((entry) => [entry.memberId, entry.dates]));
        let changed = 0;
        patchProject((current) => ({
          ...current,
          members: current.members.map((member) => {
            const dates = incoming.get(member.id);
            if (dates === undefined) return member;
            const next = mergeDates(member.unavailable, dates, mode);
            if (same(next, member.unavailable)) return member;
            changed += 1;
            return { ...member, unavailable: next };
          }),
        }));
        return changed;
      },

      // ── 步驟 5 ──
      addConstraint: (type) => {
        const taken = takeId(get().counters, 'c');
        commit((state) => ({
          counters: taken.counters,
          project: {
            ...state.project,
            constraints: [...state.project.constraints, blankConstraint(type, taken.id)],
          },
        }));
        return taken.id;
      },

      updateConstraint: (constraint) => patchConstraint(constraint.id, () => constraint),

      setConstraintEnabled: (id, enabled) =>
        patchConstraint(id, (item) => ({ ...item, enabled })),

      setConstraintNote: (id, note) =>
        patchConstraint(id, (item) => {
          const next = { ...item };
          if (note.trim() === '') delete next.note;
          else next.note = note;
          return next;
        }),

      deleteConstraint: (id) =>
        patchProject((current) => ({
          ...current,
          // 基本規則只能停用，不能刪
          constraints: current.constraints.filter(
            (item) => item.id !== id || isBasic(item.type),
          ),
        })),

      replaceConstraints: (constraints) =>
        commit((state) => {
          const project = { ...state.project, constraints: [...constraints] };
          // 進階 JSON 可以自己指定 id，計數器只往前走，避免之後發出已經用過的號碼
          const scanned = initCounters(project);
          const counters = { ...state.counters, c: Math.max(state.counters.c, scanned.c) };
          const ensured = ensureBasicConstraints(project.constraints, counters);
          return {
            project: { ...project, constraints: ensured.constraints },
            counters: ensured.counters,
          };
        }),

      // ── 匯入 ──
      loadProject: (incoming) => {
        const weeks = incoming.term.weeks;
        const weekday = weeks.length > 0 ? weekdayOf(weeks[0].date) : 0;
        const generated = generateMeetingDates(incoming.term.start, incoming.term.end, weekday);
        // 聚會日剛好等於規則算出來的，才記 generatedFrom，否則會誤報「日期改過了」
        const untouched =
          generated.length === weeks.length &&
          generated.every((date, i) => date === weeks[i].date);

        const ensured = withBasics(incoming);

        commit(() => ({
          project: ensured.project,
          counters: ensured.counters,
          ui: {
            step: 'term',
            guideDone: true,
            maxReached: LAST_GUIDE_INDEX,
            meetingWeekday: weekday,
            generatedFrom: untouched
              ? { start: incoming.term.start, end: incoming.term.end, weekday }
              : null,
          },
        }));
      },

      // ── 導覽 ──
      goToStep: (step) =>
        commit((state) => {
          const index = stepIndex(step);
          if (index < 0) return {};
          if (!state.ui.guideDone && index > state.ui.maxReached) return {};
          return { ui: { ...state.ui, step } };
        }),

      nextStep: () =>
        commit((state) => {
          const index = stepIndex(state.ui.step);
          if (state.ui.guideDone) {
            const next = ALL_STEPS[index + 1];
            return next === undefined ? {} : { ui: { ...state.ui, step: next.id } };
          }
          // 引導模式：走完最後一步就結束引導，直接落在「結果」頁籤
          if (index >= LAST_GUIDE_INDEX) {
            return {
              ui: { ...state.ui, guideDone: true, maxReached: LAST_GUIDE_INDEX, step: 'result' },
            };
          }
          return {
            ui: {
              ...state.ui,
              step: STEPS[index + 1].id,
              maxReached: Math.max(state.ui.maxReached, index + 1),
            },
          };
        }),

      prevStep: () =>
        commit((state) => {
          const index = stepIndex(state.ui.step);
          if (index <= 0) return {};
          return { ui: { ...state.ui, step: ALL_STEPS[index - 1].id } };
        }),

      finishGuide: () =>
        commit((state) => ({
          ui: { ...state.ui, guideDone: true, maxReached: LAST_GUIDE_INDEX, step: 'result' },
        })),

      flushSave: writeNow,
    };
  };
}

export function createAppStore(storage: StorageLike | null) {
  return createStore<AppState>()(makeAppState(storage));
}

export const useAppStore = create<AppState>()(makeAppState(browserStorage()));

// 刪除前的影響預估，給確認視窗用
export { memberRemovalImpact, membersRemovalImpact, roleRemovalImpact } from './cascade';
export type { CascadeImpact } from './cascade';
