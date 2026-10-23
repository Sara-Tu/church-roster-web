/** localStorage 讀寫與壞檔處理。規格 §7.5.3、§7.5.9 */

import { describe, expect, it } from 'vitest';
import { loadSaved, saveState, STORAGE_KEY } from '../src/store/persist';
import type { SavedState, StorageLike } from '../src/store/persist';
import { SCHEMA_VERSION } from '../src/engine';
import { makeProject, role, weeks } from './helpers';

interface Fake extends StorageLike {
  map: Map<string, string>;
}

function fakeStorage(initial: Record<string, string> = {}, broken?: 'read' | 'write'): Fake {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => {
      if (broken === 'read') throw new Error('讀不到');
      return map.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (broken === 'write') throw new Error('空間不足');
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function savedState(): SavedState {
  return {
    schemaVersion: SCHEMA_VERSION,
    savedAt: '2026-10-23T00:00:00.000Z',
    project: makeProject({ roles: [role('r1')], members: [], weeks: weeks(2) }),
    ui: {
      step: 'roles',
      guideDone: true,
      maxReached: 4,
      meetingWeekday: 0,
      generatedFrom: null,
    },
  };
}

describe('loadSaved', () => {
  it('沒有存檔', () => {
    expect(loadSaved(fakeStorage())).toEqual({ saved: null, backupKey: null });
  });

  it('storage 不存在時不爆', () => {
    expect(loadSaved(null)).toEqual({ saved: null, backupKey: null });
  });

  it('round trip', () => {
    const storage = fakeStorage();
    const state = savedState();
    expect(saveState(storage, state)).toBe(true);
    expect(loadSaved(storage).saved).toEqual(state);
  });

  it('JSON 壞掉：改名備份、讓出原本的 key、不丟資料', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: '{壞掉的' });
    const result = loadSaved(storage);
    expect(result.saved).toBeNull();
    expect(result.backupKey).toMatch(/^church-roster\/project\/unreadable-/);
    expect(storage.map.get(STORAGE_KEY)).toBeUndefined();
    expect(storage.map.get(result.backupKey as string)).toBe('{壞掉的');
  });

  it('schemaVersion 不符就當成讀不回來', () => {
    const state = { ...savedState(), schemaVersion: 2 };
    const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify(state) });
    const result = loadSaved(storage);
    expect(result.saved).toBeNull();
    expect(result.backupKey).not.toBeNull();
  });

  it('專案結構不對也擋下來', () => {
    const storage = fakeStorage({
      [STORAGE_KEY]: JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        savedAt: '',
        project: { schemaVersion: SCHEMA_VERSION, term: {}, roles: [] },
        ui: savedState().ui,
      }),
    });
    expect(loadSaved(storage).saved).toBeNull();
  });

  it('ui 區塊不對也擋下來', () => {
    const storage = fakeStorage({
      [STORAGE_KEY]: JSON.stringify({ ...savedState(), ui: { step: 'roles' } }),
    });
    expect(loadSaved(storage).saved).toBeNull();
  });

  it('讀取本身丟例外時安靜降級', () => {
    expect(loadSaved(fakeStorage({}, 'read'))).toEqual({ saved: null, backupKey: null });
  });

  it('備份寫不進去時原存檔原封不動留著', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: '{壞掉的' }, 'write');
    expect(loadSaved(storage)).toEqual({ saved: null, backupKey: null });
    expect(storage.map.get(STORAGE_KEY)).toBe('{壞掉的');
  });
});

describe('saveState', () => {
  it('寫不進去時回傳 false 而不是丟例外', () => {
    expect(saveState(fakeStorage({}, 'write'), savedState())).toBe(false);
  });

  it('沒有 storage 時回傳 false', () => {
    expect(saveState(null, savedState())).toBe(false);
  });
});
