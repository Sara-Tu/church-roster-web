/** 進度條（引導模式）與頁籤（走完之後）。同一個元件，靠 guideDone 切換。規格 §7.5.7 */

import { useAppStore } from '../store/project';
import { ALL_STEPS, STEPS, stepIndex } from './steps';
import type { StepId } from './steps';

export function Nav() {
  const step = useAppStore((state) => state.ui.step);
  const guideDone = useAppStore((state) => state.ui.guideDone);
  const maxReached = useAppStore((state) => state.ui.maxReached);
  const goToStep = useAppStore((state) => state.goToStep);

  const items = guideDone ? ALL_STEPS : STEPS;
  const currentIndex = stepIndex(step);

  return (
    // sticky：表格拉長之後不用滑回最上面才能換步驟
    <nav className="sticky top-0 z-30 border-b border-neutral-200 bg-stripe shadow-sm">
      <ol className="mx-auto flex max-w-[1200px] flex-wrap gap-x-2 gap-y-2 px-6 py-3 text-sm">
        {items.map((item, i) => {
          const reachable = guideDone || i <= maxReached;
          const current = item.id === step;
          return (
            <li key={item.id} className="flex items-center">
              <button
                type="button"
                disabled={!reachable}
                onClick={() => goToStep(item.id as StepId)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors ${
                  current ? 'bg-white font-medium text-ink ring-1 ring-brand' : ''
                } ${reachable ? 'hover:bg-white' : 'cursor-not-allowed opacity-40'}`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                    current
                      ? 'bg-brand text-white'
                      : i < currentIndex
                        ? 'bg-brand-light text-white'
                        : 'bg-white text-ink-muted ring-1 ring-neutral-300'
                  }`}
                >
                  {i + 1}
                </span>
                <span className={current ? 'text-ink' : 'text-ink-muted'}>{item.label}</span>
              </button>
              {i < items.length - 1 && <span className="px-1 text-neutral-300">—</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
