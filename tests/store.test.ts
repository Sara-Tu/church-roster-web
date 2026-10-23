/** store 的狀態連動與導覽。規格 §7.5.3、§7.5.7、§7.5.9 */

import { describe, expect, it } from 'vitest';
import { createAppStore, DEFAULT_TAG_ID } from '../src/store/project';
import { STORAGE_KEY } from '../src/store/persist';
import type { StorageLike } from '../src/store/persist';

function fakeStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** 驗收情境：2027 上半年、每週日、28 人 */
function buildTerm(store: ReturnType<typeof createAppStore>) {
  store.getState().setTermName('2027 上半年');
  store.getState().setTermStart('2027-01-03');
  store.getState().setTermEnd('2027-06-27');
  return store.getState().generateWeeks();
}

const NAMES = Array.from({ length: 28 }, (_, i) => `同工${i + 1}`).join('\n');

describe('空白起步', () => {
  it('帶 5 個預設角色、一個特殊週、沒有人員', () => {
    const state = createAppStore(null).getState();
    expect(state.project.roles.map((role) => role.name)).toEqual([
      '領會',
      '司琴',
      '音控',
      '招待',
      '聖餐',
    ]);
    expect(state.project.weekTags[0]).toMatchObject({
      id: DEFAULT_TAG_ID,
      label: '聖餐週',
      rule: { kind: 'nthMeetingOfMonth', n: 1 },
    });
    expect(state.project.members).toEqual([]);
    expect(state.project.term.weeks).toEqual([]);
    expect(state.ui).toMatchObject({ step: 'term', guideDone: false, maxReached: 0 });
  });
});

describe('步驟 1：梯次', () => {
  it('產生 26 週，並自動套上每月第一次聚會的規則', () => {
    const store = createAppStore(null);
    expect(buildTerm(store)).toBe(26);

    const weeks = store.getState().project.term.weeks;
    expect(weeks).toHaveLength(26);
    expect(weeks.map((week) => week.date)).toEqual([...weeks].sort((a, b) => (a < b ? -1 : 1)).map((w) => w.date));
    expect(weeks.filter((week) => week.tags.includes(DEFAULT_TAG_ID))).toHaveLength(6);
    expect(store.getState().ui.generatedFrom).toEqual({
      start: '2027-01-03',
      end: '2027-06-27',
      weekday: 0,
    });
  });

  it('換聚會星期會換一組日期', () => {
    const store = createAppStore(null);
    store.getState().setMeetingWeekday(6);
    buildTerm(store);
    expect(store.getState().project.term.weeks[0].date).toBe('2027-01-09');
  });

  it('逐週覆寫與重新套用規則', () => {
    const store = createAppStore(null);
    buildTerm(store);

    store.getState().toggleWeekTag('2027-01-03');
    store.getState().toggleWeekTag('2027-01-17');
    const tagged = () =>
      store.getState().project.term.weeks.filter((w) => w.tags.includes(DEFAULT_TAG_ID)).length;
    expect(tagged()).toBe(6);

    expect(store.getState().applyTagRule()).toEqual([]);
    expect(tagged()).toBe(6);
    expect(
      store.getState().project.term.weeks.find((w) => w.date === '2027-01-17')?.tags,
    ).toEqual([]);
  });

  it('規則設成每月第五次聚會時回報湊不齊的月份', () => {
    const store = createAppStore(null);
    buildTerm(store);
    store.getState().setTagRule(5);
    expect(store.getState().applyTagRule()).toEqual(['2027-02', '2027-03', '2027-04', '2027-06']);
  });

  it('規則設成不設定之後套用是沒有作用的', () => {
    const store = createAppStore(null);
    buildTerm(store);
    store.getState().setTagRule(null);
    expect(store.getState().project.weekTags[0].rule).toEqual({ kind: 'manual' });
    expect(store.getState().applyTagRule()).toEqual([]);
  });

  it('補登與刪除單次聚會，維持日期遞增', () => {
    const store = createAppStore(null);
    buildTerm(store);

    expect(store.getState().addWeek('2027-01-06')).toBe(true);
    expect(store.getState().project.term.weeks[1].date).toBe('2027-01-06');
    expect(store.getState().addWeek('2027-01-06')).toBe(false);
    expect(store.getState().addWeek('壞日期')).toBe(false);

    store.getState().removeWeek('2027-01-06');
    expect(store.getState().project.term.weeks).toHaveLength(26);
  });

  it('改特殊週的名稱', () => {
    const store = createAppStore(null);
    store.getState().setTagLabel('擘餅');
    expect(store.getState().project.weekTags[0].label).toBe('擘餅');
    expect(store.getState().project.weekTags[0].id).toBe(DEFAULT_TAG_ID);
  });
});

describe('步驟 2：服事位置', () => {
  it('新增的角色拿到沒用過的 id', () => {
    const store = createAppStore(null);
    store.getState().addRole();
    expect(store.getState().project.roles[5].id).toBe('r6');
  });

  it('只在特殊週的切換', () => {
    const store = createAppStore(null);
    store.getState().setRoleTagOnly('r3', true);
    expect(store.getState().project.roles[2].appliesTo).toEqual({
      kind: 'weekTag',
      tagId: DEFAULT_TAG_ID,
    });
    store.getState().setRoleTagOnly('r3', false);
    expect(store.getState().project.roles[2].appliesTo).toEqual({ kind: 'all' });
  });

  it('設定與清掉一起排', () => {
    const store = createAppStore(null);
    store.getState().setRolePair('r1', null);
    expect(store.getState().project.roles[0].pairsWith).toBeUndefined();
    store.getState().setRolePair('r3', 'r4');
    expect(store.getState().project.roles[2].pairsWith).toBe('r4');
  });

  it('上下移動', () => {
    const store = createAppStore(null);
    store.getState().moveRole(0, 1);
    expect(store.getState().project.roles.map((r) => r.name)).toEqual([
      '司琴',
      '領會',
      '音控',
      '招待',
      '聖餐',
    ]);
  });

  it('刪角色會連動清掉人員的勾選與指向它的 pairsWith', () => {
    const store = createAppStore(null);
    store.getState().addMember('甲');
    store.getState().setMemberRole('m1', 'r2', true);
    store.getState().deleteRole('r2');

    expect(store.getState().project.roles.map((r) => r.id)).toEqual(['r1', 'r3', 'r4', 'r5']);
    expect(store.getState().project.members[0].roles).toEqual([]);
    expect(store.getState().project.roles[0].pairsWith).toBeUndefined();
  });
});

describe('步驟 3：人員', () => {
  it('貼上 28 個姓名', () => {
    const store = createAppStore(null);
    const parsed = store.getState().addMembersFromText(NAMES);
    expect(parsed.names).toHaveLength(28);
    expect(parsed.skipped).toBe(0);

    const members = store.getState().project.members;
    expect(members).toHaveLength(28);
    expect(members[0]).toMatchObject({ id: 'm1', name: '同工1', roles: [], unavailable: [] });
    expect(members[27].id).toBe('m28');
    expect(new Set(members.map((m) => m.id)).size).toBe(28);
  });

  it('再貼一次全部略過', () => {
    const store = createAppStore(null);
    store.getState().addMembersFromText(NAMES);
    const again = store.getState().addMembersFromText(NAMES);
    expect(again.names).toEqual([]);
    expect(again.skipped).toBe(28);
    expect(store.getState().project.members).toHaveLength(28);
  });

  it('改名不動 id', () => {
    const store = createAppStore(null);
    store.getState().addMember('甲');
    store.getState().renameMember('m1', '乙');
    expect(store.getState().project.members[0]).toMatchObject({ id: 'm1', name: '乙' });
  });

  it('刪人員後新增不會重用號碼', () => {
    const store = createAppStore(null);
    store.getState().addMember('甲');
    store.getState().addMember('乙');
    store.getState().deleteMember('m1');
    store.getState().addMember('丙');
    expect(store.getState().project.members.map((m) => m.id)).toEqual(['m2', 'm3']);
  });
});

describe('導覽', () => {
  it('引導模式只能往回點已經到過的步驟', () => {
    const store = createAppStore(null);
    store.getState().goToStep('members');
    expect(store.getState().ui.step).toBe('term');

    store.getState().nextStep();
    expect(store.getState().ui).toMatchObject({ step: 'roles', maxReached: 1 });

    store.getState().goToStep('term');
    expect(store.getState().ui.step).toBe('term');
    store.getState().goToStep('roles');
    expect(store.getState().ui.step).toBe('roles');
  });

  it('走完第五步就結束引導並落在結果頁', () => {
    const store = createAppStore(null);
    for (let i = 0; i < 5; i++) store.getState().nextStep();
    expect(store.getState().ui).toMatchObject({ step: 'result', guideDone: true, maxReached: 4 });
  });

  it('頁籤模式可以自由跳，包含結果頁', () => {
    const store = createAppStore(null);
    store.getState().finishGuide();
    store.getState().goToStep('unavailable');
    expect(store.getState().ui.step).toBe('unavailable');
    store.getState().goToStep('result');
    expect(store.getState().ui.step).toBe('result');
  });

  it('在最後一個頁籤按下一步不會跑掉', () => {
    const store = createAppStore(null);
    store.getState().finishGuide();
    store.getState().nextStep();
    expect(store.getState().ui.step).toBe('result');
    store.getState().prevStep();
    expect(store.getState().ui.step).toBe('constraints');
  });
});

describe('持久化', () => {
  it('存檔之後另開一個 store 讀得回來', () => {
    const storage = fakeStorage();
    const first = createAppStore(storage);
    buildTerm(first);
    first.getState().addMembersFromText(NAMES);
    first.getState().nextStep();
    first.getState().flushSave();

    expect(storage.map.has(STORAGE_KEY)).toBe(true);

    const second = createAppStore(storage);
    expect(second.getState().project.term.weeks).toHaveLength(26);
    expect(second.getState().project.members).toHaveLength(28);
    expect(second.getState().ui.step).toBe('roles');
    // 計數器由現有 id 推導，接著新增不會撞號
    second.getState().addMember('新同工');
    expect(second.getState().project.members[28].id).toBe('m29');
  });

  it('沒有 storage 時照常運作，只是標記存不了', () => {
    const store = createAppStore(null);
    expect(store.getState().storage).toEqual({ writable: false, backupKey: null });
    buildTerm(store);
    expect(store.getState().project.term.weeks).toHaveLength(26);
  });

  it('讀到壞掉的存檔時以空白專案起步並留著備份 key', () => {
    const storage = fakeStorage();
    storage.map.set(STORAGE_KEY, '{壞掉的');
    const store = createAppStore(storage);
    expect(store.getState().project.members).toEqual([]);
    expect(store.getState().storage.backupKey).toMatch(/unreadable-/);
  });
});
