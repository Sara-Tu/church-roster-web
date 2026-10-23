/**
 * 步驟 4、5 與結果頁的佔位。導覽結構在 Phase 2 一次定案，後續只換內容。
 * 規格 §7.5.1
 */

import { Card } from './parts';
import type { StepId } from './steps';

const CONTENT: Partial<Record<StepId, { title: string; phase: string; body: string }>> = {
  unavailable: {
    title: '不行日期',
    phase: 'Phase 3',
    body: '每人一列的日期標籤、貼上文字或 JSON、以及可以複製給自己的 AI 的 prompt，都在下一階段接上。這一步可以跳過。',
  },
  constraints: {
    title: '限制條件',
    phase: 'Phase 3',
    body: '15 種規則的表單、專用編輯器與進階 JSON 區，在下一階段接上。這一步可以跳過。',
  },
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
