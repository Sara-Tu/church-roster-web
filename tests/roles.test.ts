/** 步驟 2 的純函式。規格 §7.5.5、§7.5.9 */

import { describe, expect, it } from 'vitest';
import {
  candidateCount,
  defaultRoles,
  isPairedPartner,
  moveRole,
  pairOptions,
} from '../src/domain/roles';
import { member, role } from './helpers';

describe('defaultRoles', () => {
  const roles = defaultRoles('communion');

  it('五個角色，順序即指派順序', () => {
    expect(roles.map((r) => r.name)).toEqual(['領會', '司琴', '音控', '招待', '聖餐']);
    expect(roles.map((r) => r.perWeek)).toEqual([1, 1, 2, 2, 2]);
  });

  it('領會與司琴成對，聖餐只在特殊週', () => {
    expect(roles[0].pairsWith).toBe('r2');
    expect(roles[1].pairsWith).toBeUndefined();
    expect(roles[4].appliesTo).toEqual({ kind: 'weekTag', tagId: 'communion' });
    expect(roles[2].appliesTo).toEqual({ kind: 'all' });
  });
});

describe('candidateCount', () => {
  it('數有勾這個角色的人', () => {
    const members = [member('m1', ['r1', 'r2']), member('m2', ['r2']), member('m3', [])];
    expect(candidateCount(members, 'r1')).toBe(1);
    expect(candidateCount(members, 'r2')).toBe(2);
    expect(candidateCount(members, 'r9')).toBe(0);
  });
});

describe('pairOptions', () => {
  it('不能選自己', () => {
    const roles = [role('r1'), role('r2')];
    expect(pairOptions(roles, 'r1').map((r) => r.id)).toEqual(['r2']);
  });

  // r2 指向 r3：r2 本身已是主角色，r3 已被指走
  const chained = [role('r1'), role('r2', { pairsWith: 'r3' }), role('r3'), role('r4')];

  it('不能選已經指向別人的角色（成對關係不能接力）', () => {
    expect(pairOptions(chained, 'r1').map((r) => r.id)).not.toContain('r2');
  });

  it('不能選已經被別人指走的角色', () => {
    expect(pairOptions(chained, 'r1').map((r) => r.id)).toEqual(['r4']);
  });

  it('自己目前選的那個一定留在選項裡', () => {
    const roles = [role('r1', { pairsWith: 'r2' }), role('r2'), role('r3')];
    expect(pairOptions(roles, 'r1').map((r) => r.id)).toEqual(['r2', 'r3']);
  });
});

describe('isPairedPartner', () => {
  it('被指到的角色不會單獨排一次', () => {
    const roles = [role('r1', { pairsWith: 'r2' }), role('r2')];
    expect(isPairedPartner(roles, 'r2')).toBe(true);
    expect(isPairedPartner(roles, 'r1')).toBe(false);
  });
});

describe('moveRole', () => {
  const roles = [role('r1'), role('r2'), role('r3')];

  it('上移與下移', () => {
    expect(moveRole(roles, 1, -1).map((r) => r.id)).toEqual(['r2', 'r1', 'r3']);
    expect(moveRole(roles, 1, 1).map((r) => r.id)).toEqual(['r1', 'r3', 'r2']);
  });

  it('超出範圍時原樣回傳', () => {
    expect(moveRole(roles, 0, -1).map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(moveRole(roles, 2, 1).map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });
});
