/** 常駐問題清單。點了跳到對應步驟。規格 §7.5.8 */

import { collectIssues } from '../domain/issues';
import { useAppStore } from '../store/project';
import { stepIndex } from './steps';

export function IssueBar() {
  const project = useAppStore((state) => state.project);
  const generatedFrom = useAppStore((state) => state.ui.generatedFrom);
  const storage = useAppStore((state) => state.storage);
  const goToStep = useAppStore((state) => state.goToStep);
  const guideDone = useAppStore((state) => state.ui.guideDone);
  const maxReached = useAppStore((state) => state.ui.maxReached);

  const issues = collectIssues(project, { generatedFrom }, storage);
  if (issues.length === 0) return null;

  return (
    <div className="border-b border-neutral-200 bg-white">
      <ul className="mx-auto flex max-w-[1200px] flex-col gap-1 px-6 py-3 text-sm">
        {issues.map((issue) => (
          <li key={`${issue.code}-${issue.message}`}>
            <button
              type="button"
              onClick={() => goToStep(issue.step)}
              disabled={!guideDone && stepIndex(issue.step) > maxReached}
              className="flex items-start gap-2 text-left hover:underline disabled:cursor-default disabled:no-underline"
            >
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  issue.level === 'alert' ? 'bg-alert' : 'bg-notice'
                }`}
              />
              <span className={issue.level === 'alert' ? 'text-alert' : 'text-notice'}>
                {issue.message}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
