/** 步驟 5：限制條件。規格 §7.2 步驟 5、§7.6.4、§7.7.4 */

import { useState } from 'react';
import type { Constraint, ConstraintType } from '../engine';
import {
  constraintsToJson,
  describeConstraint,
  GROUP_LABELS,
  groupedMeta,
  isBasic,
  metaOf,
  parseConstraintsJson,
  validateConstraint,
} from '../domain/constraints';
import type { ConstraintJsonError } from '../domain/constraints';
import { useAppStore } from '../store/project';
import { ConstraintEditor } from './ConstraintEditor';
import { Button, Card, ConfirmDialog, Empty, INPUT_CLASS } from './parts';

const HARD_TITLE = '這種規則一定是硬性的：違反就不排';
const SOFT_TITLE = '這種規則一定是偏好：排不出來只會在警告裡記一筆';

export function StepConstraints() {
  const project = useAppStore((state) => state.project);
  const addConstraint = useAppStore((state) => state.addConstraint);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<Constraint | null>(null);

  const basics = project.constraints.filter((constraint) => isBasic(constraint.type));
  const rest = project.constraints.filter((constraint) => !isBasic(constraint.type));
  const active = rest.filter((constraint) => constraint.enabled).length;

  const add = (type: ConstraintType) => {
    setExpanded(addConstraint(type));
  };

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="基本規則"
        hint="一律套用，不能刪除。除非你的教會真的需要同一個人在同一週身兼兩職，否則這裡不用動。"
      >
        <ul className="flex flex-col gap-2">
          {basics.map((constraint) => (
            <li
              key={constraint.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 px-4 py-3"
            >
              <span className={`text-sm ${constraint.enabled ? '' : 'text-ink-muted'}`}>
                {describeConstraint(project, constraint)}
              </span>
              <label className="flex items-center gap-1 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={constraint.enabled}
                  onChange={(event) =>
                    useAppStore.getState().setConstraintEnabled(constraint.id, event.target.checked)
                  }
                />
                生效
              </label>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="限制條件"
        hint={
          rest.length === 0
            ? '這一步可以跳過，之後隨時回來加。'
            : `共 ${rest.length} 條，其中 ${active} 條生效中。`
        }
      >
        {rest.length === 0 ? (
          <Empty>還沒有自己加的規則。從下面的「新增規則」挑一種加進來。</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {rest.map((constraint) => (
              <ConstraintCard
                key={constraint.id}
                constraint={constraint}
                open={expanded === constraint.id}
                onToggleOpen={() =>
                  setExpanded(expanded === constraint.id ? null : constraint.id)
                }
                onDelete={() => setPending(constraint)}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card title="新增規則" hint="挑一種加進來，欄位留空的地方會標紅字提醒。">
        <div className="flex flex-col gap-5">
          {groupedMeta().map(({ group, items }) => (
            <div key={group}>
              <h3 className="mb-2 text-sm font-medium text-ink-muted">{GROUP_LABELS[group]}</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((meta) => (
                  <button
                    key={meta.type}
                    type="button"
                    className="rounded-lg border border-neutral-200 px-3 py-2 text-left hover:border-brand-light hover:bg-brand-light/10"
                    onClick={() => add(meta.type)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{meta.label}</span>
                      <span className="text-xs text-ink-muted">＋</span>
                    </span>
                    {/* 說明直接寫在按鈕上：選規則的當下才是會搞混的時機 */}
                    <span className="mt-1 block text-xs text-ink-muted">{meta.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <JsonCard />

      <ConfirmDialog
        open={pending !== null}
        title="刪除這條規則"
        body={pending === null ? '' : describeConstraint(project, pending)}
        confirmLabel="刪除"
        onConfirm={() => {
          if (pending !== null) useAppStore.getState().deleteConstraint(pending.id);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function ConstraintCard({
  constraint,
  open,
  onToggleOpen,
  onDelete,
}: {
  constraint: Constraint;
  open: boolean;
  onToggleOpen: () => void;
  onDelete: () => void;
}) {
  const project = useAppStore((state) => state.project);
  const updateConstraint = useAppStore((state) => state.updateConstraint);
  const setConstraintEnabled = useAppStore((state) => state.setConstraintEnabled);
  const setConstraintNote = useAppStore((state) => state.setConstraintNote);

  const meta = metaOf(constraint.type);
  const issues = validateConstraint(project, constraint);

  return (
    <li
      className={`rounded-lg border p-4 ${
        issues.length > 0 ? 'border-alert/50' : 'border-neutral-200'
      } ${constraint.enabled ? '' : 'bg-stripe'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className={constraint.enabled ? '' : 'opacity-60'}>
          <p className="text-xs text-ink-muted">{meta.label}</p>
          <p className="text-sm font-medium">{describeConstraint(project, constraint)}</p>
          {constraint.note !== undefined && (
            <p className="mt-1 text-xs text-ink-muted">{constraint.note}</p>
          )}
          {issues.length > 0 && (
            <p className="mt-1 text-xs text-alert">{issues.join('；')}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 硬性／偏好由種類決定，不給改：引擎本來就不讀這個欄位 */}
          <span
            title={constraint.hard ? HARD_TITLE : SOFT_TITLE}
            className={`cursor-help rounded-full px-2 py-0.5 text-xs ${
              constraint.hard ? 'bg-brand text-white' : 'bg-stripe text-ink-muted'
            }`}
          >
            {constraint.hard ? '硬性' : '偏好'}
          </span>
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={constraint.enabled}
              onChange={(event) => setConstraintEnabled(constraint.id, event.target.checked)}
            />
            生效
          </label>
          <Button onClick={onToggleOpen}>{open ? '收起' : '編輯'}</Button>
          <Button tone="danger" onClick={onDelete}>
            刪除
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-3 border-t border-neutral-200 pt-4">
          <p className="text-xs text-ink-muted">
            {meta.hint}（{constraint.hard ? HARD_TITLE : SOFT_TITLE}）
          </p>
          <ConstraintEditor constraint={constraint} onChange={updateConstraint} />

          <label className="flex items-center gap-2 border-t border-neutral-200 pt-3 text-sm">
            <span className="font-medium">備註</span>
            <input
              className={`${INPUT_CLASS} grow`}
              value={constraint.note ?? ''}
              placeholder="寫給自己看的說明，可以空白"
              onChange={(event) => setConstraintNote(constraint.id, event.target.value)}
            />
          </label>
        </div>
      )}
    </li>
  );
}

function JsonCard() {
  const constraints = useAppStore((state) => state.project.constraints);
  const project = useAppStore((state) => state.project);
  const replaceConstraints = useAppStore((state) => state.replaceConstraints);

  const [draft, setDraft] = useState<string | null>(null);
  const [errors, setErrors] = useState<ConstraintJsonError[]>([]);
  const [result, setResult] = useState('');

  const text = draft ?? constraintsToJson(constraints);

  const apply = () => {
    const parsed = parseConstraintsJson(text, project);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setResult('');
      return;
    }
    replaceConstraints(parsed.constraints);
    setErrors([]);
    setDraft(null);
    setResult(`已套用 ${parsed.constraints.length} 條規則。`);
  };

  return (
    <Card
      title="進階：直接編 JSON"
      hint="罕見的規則、或是請 AI 幫你寫好的規則，可以整段貼在這裡。檢查全部通過才會套用。"
    >
      <details
        onToggle={(event) => {
          if (!(event.target as HTMLDetailsElement).open) {
            setDraft(null);
            setErrors([]);
          }
        }}
      >
        <summary className="cursor-pointer text-sm text-brand">
          展開（目前 {constraints.length} 條）
        </summary>

        <textarea
          className={`${INPUT_CLASS} mt-3 h-64 w-full font-mono text-xs`}
          value={text}
          onChange={(event) => {
            setDraft(event.target.value);
            setResult('');
          }}
          spellCheck={false}
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button tone="primary" onClick={apply}>
            檢查並套用
          </Button>
          <Button
            disabled={draft === null}
            onClick={() => {
              setDraft(null);
              setErrors([]);
              setResult('');
            }}
          >
            還原成目前的內容
          </Button>
          {result !== '' && <span className="text-sm text-ink-muted">{result}</span>}
        </div>

        {errors.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-alert">
            {errors.map((error, index) => (
              <li key={index}>
                {error.position === null ? '' : `第 ${error.position} 條：`}
                {error.message}
              </li>
            ))}
          </ul>
        )}
      </details>
    </Card>
  );
}
