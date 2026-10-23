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

  it('換規則會即時重算，不必再按套用', () => {
    const store = createAppStore(null);
    buildTerm(store);
    const tagged = () =>
      store
        .getState()
        .project.term.weeks.filter((w) => w.tags.includes(DEFAULT_TAG_ID))
        .map((w) => w.date);
    expect(tagged()[0]).toBe('2027-01-03');

    expect(store.getState().setTagRule(2)).toBe(true);
    expect(tagged()[0]).toBe('2027-01-10');
    expect(tagged()).toHaveLength(6);
  });

  it('手動勾過之後換規則不會自動蓋掉，要自己按套用', () => {
    const store = createAppStore(null);
    buildTerm(store);
    store.getState().toggleWeekTag('2027-01-17');

    expect(store.getState().setTagRule(2)).toBe(false);
    const weeks = store.getState().project.term.weeks;
    expect(weeks.find((w) => w.date === '2027-01-17')?.tags).toEqual([DEFAULT_TAG_ID]);
    expect(weeks.find((w) => w.date === '2027-01-03')?.tags).toEqual([DEFAULT_TAG_ID]);

    store.getState().applyTagRule();
    const applied = store.getState().project.term.weeks;
    expect(applied.find((w) => w.date === '2027-01-10')?.tags).toEqual([DEFAULT_TAG_ID]);
    expect(applied.find((w) => w.date === '2027-01-17')?.tags).toEqual([]);
  });

  it('還沒產生聚會日時換規則只是記下來', () => {
    const store = createAppStore(null);
    expect(store.getState().setTagRule(3)).toBe(false);
    expect(store.getState().project.weekTags[0].rule).toEqual({
      kind: 'nthMeetingOfMonth',
      n: 3,
    });
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

describe('批次刪除人員', () => {
  it('一次刪掉勾選的幾個人', () => {
    const store = createAppStore(null);
    store.getState().addMembersFromText(NAMES);
    store.getState().deleteMembers(['m1', 'm3', 'm5']);

    const members = store.getState().project.members;
    expect(members).toHaveLength(25);
    expect(members.map((m) => m.id)).not.toContain('m3');
    expect(members[0].id).toBe('m2');
  });

  it('清空所有人員', () => {
    const store = createAppStore(null);
    store.getState().addMembersFromText(NAMES);
    store.getState().clearMembers();
    expect(store.getState().project.members).toEqual([]);
    // 角色與週次不受影響
    expect(store.getState().project.roles).toHaveLength(5);
  });

  it('清空之後新增的人不會撞到舊號碼', () => {
    const store = createAppStore(null);
    store.getState().addMembersFromText(NAMES);
    store.getState().clearMembers();
    store.getState().addMember('新同工');
    expect(store.getState().project.members[0].id).toBe('m29');
  });
});

describe('步驟 4：不行日期', () => {
  function withTerm() {
    const store = createAppStore(null);
    buildTerm(store);
    store.getState().addMembersFromText(NAMES);
    return store;
  }

  it('勾起來、取消、維持日期遞增', () => {
    const store = withTerm();
    store.getState().toggleUnavailable('m1', '2027-03-07', true);
    store.getState().toggleUnavailable('m1', '2027-01-10', true);
    expect(store.getState().project.members[0].unavailable).toEqual(['2027-01-10', '2027-03-07']);

    store.getState().toggleUnavailable('m1', '2027-01-10', false);
    expect(store.getState().project.members[0].unavailable).toEqual(['2027-03-07']);
  });

  it('清掉某一個人的全部日期', () => {
    const store = withTerm();
    store.getState().toggleUnavailable('m2', '2027-01-10', true);
    store.getState().clearMemberUnavailable('m2');
    expect(store.getState().project.members[1].unavailable).toEqual([]);
  });

  it('只清掉不是本梯次聚會日的那些', () => {
    const store = withTerm();
    store.getState().toggleUnavailable('m1', '2027-01-10', true);
    store
      .getState()
      .importUnavailable([{ memberId: 'm2', name: '同工2', dates: ['2026-12-25'] }], 'add');

    expect(store.getState().clearStaleUnavailable()).toBe(1);
    expect(store.getState().project.members[0].unavailable).toEqual(['2027-01-10']);
    expect(store.getState().project.members[1].unavailable).toEqual([]);
    // 已經清乾淨之後再按一次是 0
    expect(store.getState().clearStaleUnavailable()).toBe(0);
  });

  it('匯入：取代與加上去，回傳有幾個人被改動', () => {
    const store = withTerm();
    store.getState().toggleUnavailable('m1', '2027-01-10', true);

    const added = store
      .getState()
      .importUnavailable([{ memberId: 'm1', name: '同工1', dates: ['2027-02-07'] }], 'add');
    expect(added).toBe(1);
    expect(store.getState().project.members[0].unavailable).toEqual([
      '2027-01-10',
      '2027-02-07',
    ]);

    store
      .getState()
      .importUnavailable([{ memberId: 'm1', name: '同工1', dates: ['2027-02-07'] }], 'replace');
    expect(store.getState().project.members[0].unavailable).toEqual(['2027-02-07']);

    // 內容沒變就不算改動；名單裡沒有的人直接忽略
    expect(
      store
        .getState()
        .importUnavailable([{ memberId: 'm1', name: '同工1', dates: ['2027-02-07'] }], 'replace'),
    ).toBe(0);
    expect(
      store.getState().importUnavailable([{ memberId: 'm99', name: '路人', dates: [] }], 'replace'),
    ).toBe(0);
  });
});

describe('步驟 5：限制條件', () => {
  it('空白專案一開始就帶著基本規則', () => {
    expect(createAppStore(null).getState().project.constraints).toEqual([
      { id: 'c1', type: 'one_role_per_week', hard: true, enabled: true },
    ]);
  });

  it('新增一條空白規則，回傳新的 id', () => {
    const store = createAppStore(null);
    expect(store.getState().addConstraint('max_per_month')).toBe('c2');
    expect(store.getState().project.constraints[1]).toEqual({
      id: 'c2',
      type: 'max_per_month',
      hard: true,
      enabled: true,
      memberId: '',
      max: 1,
      roleId: null,
    });
  });

  it('編輯、停用、備註留空就移除', () => {
    const store = createAppStore(null);
    const id = store.getState().addConstraint('max_consecutive_weeks_per_member');
    store.getState().updateConstraint({
      id,
      type: 'max_consecutive_weeks_per_member',
      hard: true,
      enabled: true,
      max: 2,
    });
    expect(store.getState().project.constraints[1]).toMatchObject({ max: 2 });

    store.getState().setConstraintEnabled(id, false);
    store.getState().setConstraintNote(id, '先停用');
    expect(store.getState().project.constraints[1]).toMatchObject({
      enabled: false,
      note: '先停用',
    });

    store.getState().setConstraintNote(id, '   ');
    expect(store.getState().project.constraints[1]).not.toHaveProperty('note');
  });

  it('基本規則刪不掉，只能停用', () => {
    const store = createAppStore(null);
    store.getState().deleteConstraint('c1');
    expect(store.getState().project.constraints.map((item) => item.id)).toEqual(['c1']);

    store.getState().setConstraintEnabled('c1', false);
    expect(store.getState().project.constraints[0].enabled).toBe(false);
  });

  it('刪除之後新增不會重用號碼', () => {
    const store = createAppStore(null);
    const id = store.getState().addConstraint('max_per_month');
    store.getState().deleteConstraint(id);
    expect(store.getState().addConstraint('max_per_month')).toBe('c3');
  });

  it('進階 JSON 整批取代，計數器只往前走，基本規則會補回來', () => {
    const store = createAppStore(null);
    store
      .getState()
      .replaceConstraints([{ id: 'c7', type: 'one_role_per_week', hard: true, enabled: true }]);
    expect(store.getState().project.constraints).toHaveLength(1);
    expect(store.getState().addConstraint('max_per_month')).toBe('c8');

    // 整段刪光，基本規則還是會自己回來，但號碼只往前走
    store.getState().replaceConstraints([]);
    expect(store.getState().project.constraints.map((item) => item.type)).toEqual([
      'one_role_per_week',
    ]);
    expect(store.getState().addConstraint('max_per_month')).toBe('c10');
  });
});

describe('匯入整份專案', () => {
  it('換掉資料、重算計數器、直接進頁籤模式', () => {
    const store = createAppStore(null);
    buildTerm(store);
    store.getState().addMembersFromText(NAMES);

    const current = store.getState().project;
    store.getState().loadProject({
      ...current,
      term: { ...current.term, name: '另一個梯次' },
      members: [{ id: 'm40', name: '匯入的人', roles: [], unavailable: [] }],
      constraints: [{ id: 'c3', type: 'one_role_per_week', hard: true, enabled: true }],
    });

    expect(store.getState().project.term.name).toBe('另一個梯次');
    expect(store.getState().project.members).toHaveLength(1);
    expect(store.getState().ui).toMatchObject({ step: 'term', guideDone: true, maxReached: 4 });

    store.getState().addMember('再一個');
    expect(store.getState().project.members[1].id).toBe('m41');
    expect(store.getState().addConstraint('one_role_per_week')).toBe('c4');
  });

  it('舊檔案沒有基本規則時自動補上，號碼不跟既有的撞', () => {
    const store = createAppStore(null);
    const current = store.getState().project;
    store.getState().loadProject({
      ...current,
      constraints: [{ id: 'c5', type: 'max_consecutive_weeks_per_member', hard: true, enabled: true, max: 1 }],
    });

    expect(store.getState().project.constraints.map((item) => [item.id, item.type])).toEqual([
      ['c6', 'one_role_per_week'],
      ['c5', 'max_consecutive_weeks_per_member'],
    ]);
    expect(store.getState().addConstraint('max_per_month')).toBe('c7');
  });

  it('聚會日不是起訖日期算出來的檔案，不記 generatedFrom', () => {
    const store = createAppStore(null);
    buildTerm(store);
    const project = store.getState().project;
    store.getState().loadProject({
      ...project,
      term: { ...project.term, weeks: project.term.weeks.slice(0, 10) },
    });
    expect(store.getState().ui.generatedFrom).toBeNull();
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

describe('產生班表', () => {
  /** 排得出班表的最小設定：一個位置、兩個人、四週 */
  function ready(store: ReturnType<typeof createAppStore>) {
    store.getState().setTermName('測試梯次');
    store.getState().setTermStart('2027-01-03');
    store.getState().setTermEnd('2027-01-31');
    store.getState().generateWeeks();
    for (const role of [...store.getState().project.roles].slice(1)) {
      store.getState().deleteRole(role.id);
    }
    store.getState().addMembersFromText('小明\n小華');
    const roleId = store.getState().project.roles[0].id;
    for (const member of store.getState().project.members) {
      store.getState().setMemberRole(member.id, roleId, true);
    }
  }

  it('第一次產生就是 r1，再產生一次變 r2', () => {
    const store = createAppStore(null);
    ready(store);

    const first = store.getState().generateRoster();
    expect(first).toEqual({ ok: true, revision: 1 });
    expect(store.getState().project.revision).toBe(1);
    expect(store.getState().roster?.revision).toBe(1);
    expect(store.getState().roster?.result.weeks).toHaveLength(
      store.getState().project.term.weeks.length,
    );

    expect(store.getState().generateRoster()).toEqual({ ok: true, revision: 2 });
    expect(store.getState().roster?.revision).toBe(2);
  });

  it('引擎丟錯時不動 revision，也不留半份班表', () => {
    const store = createAppStore(null);
    ready(store);
    // 參照不存在的人員：引擎的入口驗證會丟錯
    store.getState().replaceConstraints([
      {
        id: 'c9',
        type: 'max_total_per_term',
        hard: true,
        enabled: true,
        memberId: 'm99',
        max: 3,
      },
    ]);

    const outcome = store.getState().generateRoster();
    expect(outcome.ok).toBe(false);
    expect(store.getState().project.revision).toBe(0);
    expect(store.getState().roster).toBeNull();
  });

  it('班表存得回來，匯入別的專案時會清掉', () => {
    const storage = fakeStorage();
    const first = createAppStore(storage);
    ready(first);
    first.getState().generateRoster();
    first.getState().flushSave();

    const second = createAppStore(storage);
    expect(second.getState().roster?.revision).toBe(1);

    second.getState().loadProject(second.getState().project);
    expect(second.getState().roster).toBeNull();
  });
});
