/** id 流水號。規格 §7.5.3、§7.5.9 */

import { describe, expect, it } from 'vitest';
import { initCounters, takeId } from '../src/store/ids';
import { makeProject, member, role, rule, weeks } from './helpers';

function project(parts: Parameters<typeof makeProject>[0]) {
  return makeProject(parts);
}

describe('initCounters', () => {
  it('空專案從 0 起算，第一個 id 是 1 號', () => {
    const counters = initCounters(project({ roles: [], members: [], weeks: weeks(1) }));
    expect(counters).toEqual({ r: 0, m: 0, c: 0 });
    expect(takeId(counters, 'm').id).toBe('m1');
  });

  it('取現有 id 的最大數字尾碼，不是筆數', () => {
    const counters = initCounters(
      project({
        roles: [role('r3'), role('r1')],
        members: [member('m12', ['r1']), member('m2', ['r1'])],
        weeks: weeks(1),
        constraints: [rule({ type: 'one_role_per_week' })],
      }),
    );
    expect(counters.r).toBe(3);
    expect(counters.m).toBe(12);
    expect(counters.c).toBeGreaterThanOrEqual(1);
  });

  it('認不得格式的 id 不影響計數', () => {
    const counters = initCounters(
      project({ roles: [role('role-x')], members: [member('m1', [])], weeks: weeks(1) }),
    );
    expect(counters.r).toBe(0);
  });
});

describe('takeId', () => {
  it('遞增並回傳新的計數器，不改原本的', () => {
    const counters = { r: 5, m: 0, c: 0 };
    const first = takeId(counters, 'r');
    expect(first.id).toBe('r6');
    expect(counters.r).toBe(5);

    const second = takeId(first.counters, 'r');
    expect(second.id).toBe('r7');
  });

  it('刪除過的號碼不重用', () => {
    // r1 r2 r3 存在 → 計數器 3；刪掉 r3 之後再新增，拿到的是 r4
    let counters = initCounters(
      project({ roles: [role('r1'), role('r2'), role('r3')], members: [], weeks: weeks(1) }),
    );
    const afterDelete = initCounters(
      project({ roles: [role('r1'), role('r2')], members: [], weeks: weeks(1) }),
    );
    // 同一個 session 內計數器不會因為刪除而往回走
    expect(takeId(counters, 'r').id).toBe('r4');
    // 重新載入專案才會重算（此時 r3 已不存在，號碼才會被讓出來）
    expect(takeId(afterDelete, 'r').id).toBe('r3');
    counters = takeId(counters, 'r').counters;
    expect(takeId(counters, 'r').id).toBe('r5');
  });
});
