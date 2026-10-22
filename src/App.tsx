import { STEPS } from './ui/steps';

/**
 * Phase 0 骨架：只有版面外殼與步驟指示條，功能從 Phase 1（排班引擎）起依序接上。
 */
export default function App() {
  return (
    <div className="min-h-screen bg-white">
      <header className="bg-brand text-white">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
          <h1 className="text-lg font-bold">教會服事排班</h1>
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              disabled
              className="rounded-lg border border-white/40 px-3 py-1.5 opacity-50"
            >
              匯入
            </button>
            <button
              type="button"
              disabled
              className="rounded-lg border border-white/40 px-3 py-1.5 opacity-50"
            >
              匯出
            </button>
          </div>
        </div>
      </header>

      <nav className="border-b border-neutral-200 bg-stripe">
        <ol className="mx-auto flex max-w-[1200px] flex-wrap gap-x-6 gap-y-2 px-6 py-3 text-sm">
          {STEPS.map((step, i) => (
            <li key={step.id} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                  i === 0 ? 'bg-brand text-white' : 'bg-white text-ink-muted ring-1 ring-neutral-300'
                }`}
              >
                {i + 1}
              </span>
              <span className={i === 0 ? 'font-medium text-ink' : 'text-ink-muted'}>
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      <main className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="rounded-lg border border-neutral-200 p-6">
          <h2 className="text-base font-bold">Phase 0 骨架</h2>
          <p className="mt-2 text-sm text-ink-muted">
            版面外殼、建置流程與 parity 測試已就緒。排班引擎與各步驟的輸入畫面依
            <code className="mx-1 rounded bg-stripe px-1 py-0.5">docs/網頁版規格.md</code>
            的分期依序接上。
          </p>
        </div>
      </main>
    </div>
  );
}
