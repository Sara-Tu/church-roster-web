/** 選人、選位置的共用控件。規則編輯器與匯入預覽都用這些。規格 §7.6.4 */

import type { ReactNode } from 'react';
import { useAppStore } from '../store/project';
import { INPUT_CLASS } from './parts';

function label(name: string): string {
  return name.trim() === '' ? '（未命名）' : name;
}

export function MemberPicker({
  value,
  onChange,
  nullLabel,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  /** 給了就多一個「不指定」選項（例如整梯次上限套用到每一個人） */
  nullLabel?: string;
}) {
  const members = useAppStore((state) => state.project.members);
  return (
    <select
      className={`${INPUT_CLASS} max-w-44`}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      aria-label="選人"
    >
      <option value="">{nullLabel ?? '請選人'}</option>
      {members.map((member) => (
        <option key={member.id} value={member.id}>
          {label(member.name)}
        </option>
      ))}
    </select>
  );
}

export function RolePicker({
  value,
  onChange,
  nullLabel,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  nullLabel?: string;
}) {
  const roles = useAppStore((state) => state.project.roles);
  return (
    <select
      className={`${INPUT_CLASS} max-w-44`}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      aria-label="選服事位置"
    >
      <option value="">{nullLabel ?? '請選位置'}</option>
      {roles.map((role) => (
        <option key={role.id} value={role.id}>
          {label(role.name)}
        </option>
      ))}
    </select>
  );
}

export function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        on
          ? 'border-brand bg-brand text-white'
          : 'border-neutral-300 text-ink-muted hover:border-brand-light hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** 多選名單：點一下加入、再點一下移除。順序依點選順序（輪替群組要照順序排） */
export function MemberChips({
  selected,
  onChange,
}: {
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const members = useAppStore((state) => state.project.members);
  if (members.length === 0) {
    return <p className="text-xs text-ink-muted">還沒有人員，先回步驟 3 建立名單。</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {members.map((member) => {
        const on = selected.includes(member.id);
        return (
          <Chip
            key={member.id}
            on={on}
            onClick={() =>
              onChange(
                on ? selected.filter((id) => id !== member.id) : [...selected, member.id],
              )
            }
          >
            {label(member.name)}
          </Chip>
        );
      })}
    </div>
  );
}

export function RoleChips({
  selected,
  onChange,
}: {
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const roles = useAppStore((state) => state.project.roles);
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => {
        const on = selected.includes(role.id);
        return (
          <Chip
            key={role.id}
            on={on}
            onClick={() =>
              onChange(on ? selected.filter((id) => id !== role.id) : [...selected, role.id])
            }
          >
            {label(role.name)}
          </Chip>
        );
      })}
    </div>
  );
}

/** 規則編輯器裡的一列：左邊標題、右邊控件 */
export function EditorRow({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-40 shrink-0 text-sm font-medium">{title}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {hint !== undefined && <span className="text-xs text-ink-muted">{hint}</span>}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min = 0,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  suffix?: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        min={min}
        className={`${INPUT_CLASS} tabular w-20`}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChange(Math.trunc(Number(event.target.value)))}
      />
      {suffix !== undefined && <span className="text-sm text-ink-muted">{suffix}</span>}
    </span>
  );
}
