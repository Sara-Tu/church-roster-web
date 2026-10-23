/**
 * localStorage 讀寫。規格 §7.5.3。
 *
 * 讀不回來時（JSON 壞掉、schemaVersion 不符）**不覆蓋**原本的資料：
 * 改名成 unreadable-{timestamp} 留著，以空白專案起步並在問題清單說明。
 * 匯入面板提供「下載備份」把那一份原始字串存下來（規格 §7.6.5）。
 */

import { SCHEMA_VERSION } from '../engine';
import type { Project } from '../engine';
import type { RosterSnapshot } from '../domain/roster';
import type { StepId } from '../ui/steps';

export const STORAGE_KEY = 'church-roster/project/v1';

export interface PersistedUi {
  step: StepId;
  guideDone: boolean;
  maxReached: number;
  meetingWeekday: number;
  generatedFrom: { start: string; end: string; weekday: number } | null;
}

export interface SavedState {
  schemaVersion: number;
  savedAt: string;
  project: Project;
  ui: PersistedUi;
  /** 產生過的班表。舊存檔沒有這個欄位，讀回來是 null */
  roster: RosterSnapshot | null;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LoadResult {
  saved: SavedState | null;
  /** 原存檔讀不回來時，備份所用的 key */
  backupKey: string | null;
}

export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // 瀏覽器設定擋掉 site data 時，光是取用 localStorage 就會丟例外
    return null;
  }
}

export function loadSaved(storage: StorageLike | null): LoadResult {
  if (storage === null) return { saved: null, backupKey: null };

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { saved: null, backupKey: null };
  }
  if (raw === null) return { saved: null, backupKey: null };

  const parsed = parse(raw);
  if (parsed !== null) return { saved: parsed, backupKey: null };

  // 讀不回來：先備份再讓出 key。備份寫不進去就原封不動留著，不冒險刪掉
  const backupKey = `church-roster/project/unreadable-${new Date().toISOString()}`;
  try {
    storage.setItem(backupKey, raw);
    storage.removeItem(STORAGE_KEY);
  } catch {
    return { saved: null, backupKey: null };
  }
  return { saved: null, backupKey };
}

/** 讀回改名保留的那一份原始字串，給匯入面板的「下載備份」用 */
export function readBackup(storage: StorageLike | null, key: string): string | null {
  if (storage === null) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** 回傳 false 代表寫不進去（隱私模式、空間不足） */
export function saveState(storage: StorageLike | null, state: SavedState): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function parse(raw: string): SavedState | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isProject(value.project) || !isUi(value.ui)) return null;
  if (!isRoster(value.roster)) return { ...(value as unknown as SavedState), roster: null };
  return { ...(value as unknown as SavedState), roster: (value.roster as SavedState['roster']) ?? null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== SCHEMA_VERSION) return false;
  if (!isRecord(value.term) || !Array.isArray(value.term.weeks)) return false;
  return (
    Array.isArray(value.roles) &&
    Array.isArray(value.members) &&
    Array.isArray(value.constraints) &&
    Array.isArray(value.weekTags)
  );
}

/** 班表只做最低檢查：壞掉就當成沒有，不要因為它讓整份存檔讀不回來 */
function isRoster(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return isRecord(value) && isRecord(value.result) && Array.isArray(value.result.weeks);
}

function isUi(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.step === 'string' &&
    typeof value.guideDone === 'boolean' &&
    typeof value.maxReached === 'number' &&
    typeof value.meetingWeekday === 'number'
  );
}
