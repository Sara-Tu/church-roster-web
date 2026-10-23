import { useEffect } from 'react';
import { useAppStore } from './store/project';
import { IssueBar } from './ui/IssueBar';
import { Nav } from './ui/Nav';
import { Button } from './ui/parts';
import { StepMembers } from './ui/StepMembers';
import { StepRoles } from './ui/StepRoles';
import { StepTerm } from './ui/StepTerm';
import { StepTodo } from './ui/StepTodo';
import { LAST_GUIDE_INDEX, stepIndex } from './ui/steps';
import { APP_VERSION } from './version';

export default function App() {
  const step = useAppStore((state) => state.ui.step);
  const guideDone = useAppStore((state) => state.ui.guideDone);
  const nextStep = useAppStore((state) => state.nextStep);
  const prevStep = useAppStore((state) => state.prevStep);
  const flushSave = useAppStore((state) => state.flushSave);

  // 關掉分頁前把還在 debounce 裡的那一次寫入補上
  useEffect(() => {
    window.addEventListener('pagehide', flushSave);
    return () => window.removeEventListener('pagehide', flushSave);
  }, [flushSave]);

  const index = stepIndex(step);
  const skippable = step === 'unavailable' || step === 'constraints';

  return (
    <div className="flex min-h-screen flex-col bg-stripe">
      <header className="bg-brand text-white">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
          <h1 className="text-lg font-bold">教會服事排班</h1>
          <div className="flex items-center gap-2 text-sm">
            <span className="tabular text-white/60">v{APP_VERSION}</span>
            <button
              type="button"
              disabled
              title="Phase 3 接上"
              className="rounded-lg border border-white/40 px-3 py-1.5 opacity-50"
            >
              匯入
            </button>
            <button
              type="button"
              disabled
              title="Phase 3 接上"
              className="rounded-lg border border-white/40 px-3 py-1.5 opacity-50"
            >
              匯出
            </button>
          </div>
        </div>
      </header>

      <Nav />
      <IssueBar />

      <main className="mx-auto w-full max-w-[1200px] grow px-6 py-8">
        {step === 'term' && <StepTerm />}
        {step === 'roles' && <StepRoles />}
        {step === 'members' && <StepMembers />}
        {(step === 'unavailable' || step === 'constraints' || step === 'result') && (
          <StepTodo step={step} />
        )}

        {!guideDone && (
          <div className="mt-8 flex items-center justify-between">
            <Button onClick={prevStep} disabled={index === 0}>
              ← 上一步
            </Button>
            <Button tone="primary" onClick={nextStep}>
              {skippable ? '跳過，下一步 →' : index === LAST_GUIDE_INDEX ? '完成 →' : '下一步 →'}
            </Button>
          </div>
        )}
      </main>

      <footer className="mx-auto w-full max-w-[1200px] px-6 py-6 text-xs text-ink-muted">
        資料只存在這台裝置的瀏覽器裡，不會上傳到任何伺服器。
      </footer>
    </div>
  );
}
