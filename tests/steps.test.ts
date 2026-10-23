/** 引導模式的「跳過」判斷。規格 §7.7.7 */

import { describe, expect, it } from 'vitest';
import { isStepEmpty, LAST_GUIDE_INDEX, stepIndex, STEPS } from '../src/ui/steps';
import { createBlankProject } from '../src/store/project';
import type { Project } from '../src/engine';
import { member, role, weeks } from './helpers';

function withPeople(): Project {
  const blank = createBlankProject();
  return {
    ...blank,
    roles: [role('r1')],
    members: [member('m1', ['r1']), member('m2', ['r1'])],
    term: { ...blank.term, weeks: weeks(4) },
  };
}

describe('isStepEmpty', () => {
  it('不行日期：有人填了就不算空', () => {
    const project = withPeople();
    expect(isStepEmpty(project, 'unavailable')).toBe(true);

    const filled = {
      ...project,
      members: [{ ...project.members[0], unavailable: ['2026-01-04'] }, project.members[1]],
    };
    expect(isStepEmpty(filled, 'unavailable')).toBe(false);
  });

  it('限制條件：只有基本規則不算填過東西', () => {
    const project = withPeople();
    // 空白專案本來就帶著基本規則
    expect(project.constraints.map((item) => item.type)).toEqual(['one_role_per_week']);
    expect(isStepEmpty(project, 'constraints')).toBe(true);

    const added = {
      ...project,
      constraints: [
        ...project.constraints,
        { id: 'c2', type: 'max_total_per_term', hard: true, enabled: true, memberId: null, max: 5 },
      ] as Project['constraints'],
    };
    expect(isStepEmpty(added, 'constraints')).toBe(false);
  });

  it('前三步與結果頁一律不可跳過', () => {
    const project = withPeople();
    for (const step of ['term', 'roles', 'members', 'result'] as const) {
      expect(isStepEmpty(project, step)).toBe(false);
    }
  });

  it('限制條件是引導的最後一步，所以跳過的字樣是「完成」那一組', () => {
    expect(stepIndex(STEPS[LAST_GUIDE_INDEX].id)).toBe(LAST_GUIDE_INDEX);
    expect(STEPS[LAST_GUIDE_INDEX].id).toBe('constraints');
  });
});
