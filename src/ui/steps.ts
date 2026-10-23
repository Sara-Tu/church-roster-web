import { isBasic } from '../domain/constraints';
import type { Project } from '../engine';

export const STEPS = [
  { id: 'term', label: '梯次' },
  { id: 'roles', label: '服事位置' },
  { id: 'members', label: '人員' },
  { id: 'unavailable', label: '不行日期' },
  { id: 'constraints', label: '限制條件' },
] as const;

/** 走完引導後才出現的頁籤 */
export const RESULT_STEP = { id: 'result', label: '結果' } as const;

export type StepId = (typeof STEPS)[number]['id'] | typeof RESULT_STEP.id;

/** 頁籤模式下的完整順序 */
export const ALL_STEPS: readonly { id: StepId; label: string }[] = [...STEPS, RESULT_STEP];

/** 引導模式的最後一步（走完它就結束引導） */
export const LAST_GUIDE_INDEX = STEPS.length - 1;

export function stepIndex(id: StepId): number {
  return ALL_STEPS.findIndex((step) => step.id === id);
}

export function stepLabel(id: StepId): string {
  return ALL_STEPS.find((step) => step.id === id)?.label ?? id;
}

/**
 * 這一步是不是還完全沒填。按鈕要不要寫「跳過」看這個 —— 已經填了東西還寫「跳過」，
 * 會讓人以為剛才填的不算數（規格 §7.7.7）。只有可跳過的兩步要判斷。
 */
export function isStepEmpty(project: Project, step: StepId): boolean {
  switch (step) {
    case 'unavailable':
      return project.members.every((member) => member.unavailable.length === 0);
    case 'constraints':
      // 基本規則是系統自己加的，不算使用者填過東西
      return !project.constraints.some((constraint) => !isBasic(constraint.type));
    default:
      return false;
  }
}
