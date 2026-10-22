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
