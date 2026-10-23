/**
 * Phase 3 的驗收測試（規格 §11、§7.6.1）：
 * 完全從空白開始，只用 UI 會呼叫的 store 動作把 2026H2 那一份設定重建出來，
 * 跑引擎之後必須與 golden 檔逐格相同。
 *
 * 這擔保的是「介面的資料路徑」排得出同一張班表，而不只是引擎本身（那是 parity 測試）。
 */

import { describe, expect, it } from 'vitest';
import { runScheduler } from '../src/engine';
import type { Constraint, GoldenRoster, Project } from '../src/engine';
import { isBasic, parseConstraintsJson } from '../src/domain/constraints';
import { parseUnavailable } from '../src/domain/unavailable';
import { createAppStore } from '../src/store/project';
import projectJson from './fixtures/sample-project.json';
import goldenJson from './fixtures/golden-roster.json';

const fixture = projectJson as unknown as Project;
const golden = goldenJson as unknown as GoldenRoster;

type Store = ReturnType<typeof createAppStore>;

/** 步驟 1–3：梯次、服事位置、人員與勾選的位置 */
function buildBase(): Store {
  const store = createAppStore(null);
  const act = () => store.getState();

  // 步驟 1：起訖日期與聚會星期，特殊週沿用預設的「每月第一次聚會」
  act().setChurchName('');
  act().setTermName(fixture.term.name);
  act().setTermStart(fixture.term.start);
  act().setTermEnd(fixture.term.end);
  act().setMeetingWeekday(0);
  act().generateWeeks();

  // 步驟 2：空白起步帶的 5 個角色剛好就是這間教會的設定，不用改

  // 步驟 3：貼上一整串姓名，再逐一勾服事位置
  act().addMembersFromText(fixture.members.map((member) => member.name).join('\n'));
  for (const member of fixture.members) {
    for (const roleId of member.roles) act().setMemberRole(member.id, roleId, true);
  }

  return store;
}

/** 步驟 4：把不行日期包成 AI 會回傳的那種 JSON，走匯入的路徑進去 */
function importUnavailable(store: Store): void {
  const reply = JSON.stringify({
    unavailable: fixture.members
      .filter((member) => member.unavailable.length > 0)
      .map((member) => ({ name: member.name, dates: member.unavailable })),
  });
  const parsed = parseUnavailable(reply, store.getState().project);
  expect(parsed.error).toBeNull();
  expect(parsed.unknownNames).toEqual([]);
  expect(parsed.badDates).toEqual([]);
  store.getState().importUnavailable(parsed.entries, 'replace');
}

function sameRoster(project: Project): void {
  const result = runScheduler(project);
  expect(result.weeks).toEqual(golden.weeks);
}

describe('從空白重建 2026H2', () => {
  it('步驟 1–3 做出 26 週、6 個聖餐週、28 人與原本一致的角色勾選', () => {
    const project = buildBase().getState().project;

    expect(project.term.weeks).toEqual(fixture.term.weeks);
    expect(project.roles).toEqual(fixture.roles);
    expect(project.members.map((member) => [member.id, member.name, member.roles])).toEqual(
      fixture.members.map((member) => [member.id, member.name, member.roles]),
    );
  });

  it('步驟 4 用 AI 匯入的路徑填回 65 筆不行日期', () => {
    const store = buildBase();
    importUnavailable(store);
    expect(store.getState().project.members).toEqual(fixture.members);
  });

  it('步驟 5 逐條新增規則之後，排出來的班表與 golden 逐格相同', () => {
    const store = buildBase();
    importUnavailable(store);

    // 「新增規則」再把欄位填好，等同在卡片上編輯
    for (const constraint of fixture.constraints) {
      // 基本規則空白專案就有了，不用新增，照著 fixture 把備註補上就好
      const basic = store
        .getState()
        .project.constraints.find((item) => item.type === constraint.type && isBasic(item.type));
      const id = basic?.id ?? store.getState().addConstraint(constraint.type);
      store.getState().updateConstraint({ ...constraint, id } as Constraint);
    }

    const project = store.getState().project;
    expect(project.constraints.map((constraint) => constraint.id)).toEqual(
      fixture.constraints.map((_, index) => `c${index + 1}`),
    );
    expect(project.constraints).toEqual(fixture.constraints);
    sameRoster(project);
  });

  it('改走進階 JSON 貼上整個 constraints 陣列，結果一樣', () => {
    const store = buildBase();
    importUnavailable(store);

    const parsed = parseConstraintsJson(JSON.stringify(fixture.constraints), store.getState().project);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    store.getState().replaceConstraints(parsed.constraints);

    sameRoster(store.getState().project);
  });

  it('匯出再匯入之後排出來的班表也一樣', () => {
    const store = buildBase();
    importUnavailable(store);
    const parsed = parseConstraintsJson(JSON.stringify(fixture.constraints), store.getState().project);
    if (!parsed.ok) throw new Error('fixture 的規則應該讀得進來');
    store.getState().replaceConstraints(parsed.constraints);

    const built = store.getState().project;
    store.getState().loadProject(built);
    sameRoster(store.getState().project);
    // 匯入一份完整的專案之後直接進頁籤模式，停在步驟 1
    expect(store.getState().ui.guideDone).toBe(true);
    expect(store.getState().ui.step).toBe('term');
    expect(store.getState().ui.generatedFrom).toEqual({
      start: fixture.term.start,
      end: fixture.term.end,
      weekday: 0,
    });
  });
});
