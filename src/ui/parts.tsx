/** 各步驟共用的小元件。配色與尺寸見規格 §7.4。 */

import type { ReactNode } from 'react';

export const INPUT_CLASS =
  'rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-brand-light focus:ring-2 focus:ring-brand-light/30 disabled:bg-stripe disabled:text-ink-muted';

export function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-6">
      <header className="mb-4">
        <h2 className="text-base font-bold">{title}</h2>
        {hint !== undefined && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint !== undefined && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

type ButtonTone = 'primary' | 'ghost' | 'danger';

const TONE_CLASS: Record<ButtonTone, string> = {
  primary: 'bg-brand text-white hover:bg-brand-light disabled:bg-neutral-300',
  ghost: 'border border-neutral-300 text-ink hover:bg-stripe disabled:text-ink-muted',
  danger: 'border border-alert/40 text-alert hover:bg-alert/10',
};

export function Button({
  tone = 'ghost',
  onClick,
  disabled,
  title,
  children,
}: {
  tone?: ButtonTone;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed ${TONE_CLASS[tone]}`}
    >
      {children}
    </button>
  );
}

/** 表格裡的小圖示按鈕（上移、下移、刪除） */
export function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-stripe hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = '確定',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-base font-bold">{title}</h3>
        <div className="mt-2 text-sm text-ink-muted">{body}</div>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button tone="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}
