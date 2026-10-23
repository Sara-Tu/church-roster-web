/** 結果頁的佔位。步驟 1–5 都已經接上了，只剩 Phase 4 的結果頁。規格 §7.5.1 */

import { Card } from './parts';
import type { StepId } from './steps';

const CONTENT: Partial<Record<StepId, { title: string; phase: string; body: string }>> = {
  result: {
    title: '結果',
    phase: 'Phase 4',
    body: '排班引擎已經寫好也通過 parity 測試，產生班表的按鈕、依週次／依人員的檢視與 Excel 下載在 Phase 4 接上。',
  },
};

export function StepTodo({ step }: { step: StepId }) {
  const content = CONTENT[step];
  if (content === undefined) return null;

  return (
    <Card title={content.title} hint={`${content.phase} 接上`}>
      <p className="text-sm text-ink-muted">{content.body}</p>
    </Card>
  );
}
