/**
 * 唯一能改狀態的地方。規格 §7.5.3。
 *
 * state 分兩塊：`project`（§4 的 schema v1，完整一份，匯出時原樣寫出去）與
 * `ui`（導覽與「產生聚會日」的輸入，只存在 localStorage，不進專案檔）。
 */

import { create } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StateCreator } from 'zustand';
import { SCHEMA_VERSION } from '../engine';
import type { Member, Project, Role, RoleId, WeekTagId } from '../engine';
import { APP_VERSION } from '../version';
import { defaultRoles, moveRole as reorderRoles } from '../domain/roles';
import { parseNameList, toggleRole } from '../domain/members';
import type { ParsedNames } from '../domain/members';
import {
  applyNthMeetingRule,
  generateMeetingDates,
  insertMeetingDate,
  toWeeks,
} from '../domain/term';
import { removeMember, removeRole } from './cascade';
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
  setTagRule: (n: number | null) => void;
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
  addMembersFromText: (text: string) => ParsedNames;

  // 導覽
  goToStep: (step: StepId) => void;
  nextStep: () => void;
  prevStep: () => void;
  finishGuide: () => void;

  /** 測試與離開頁面前用：立刻寫入，不等 debounce */
  flushSave: () => void;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
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
    constraints: [],
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

      setTagRule: (n) =>
        patchProject((current) => ({
          ...current,
          weekTags: current.weekTags.map((tag, i) =>
            i === 0
              ? { ...tag, rule: n === null ? { kind: 'manual' } : { kind: 'nthMeetingOfMonth', n } }
              : tag,
          ),
        })),

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

      deleteMember: (id) => patchProject((current) => removeMember(current, id)),

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
export { memberRemovalImpact, roleRemovalImpact } from './cascade';
export type { CascadeImpact } from './cascade';
