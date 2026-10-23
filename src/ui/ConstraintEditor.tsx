/** 15 種限制條件的欄位編輯器。規格 §5、§7.6.4 */

import { useState } from 'react';
import type { Constraint, RoleSlot } from '../engine';
import { Button, IconButton, INPUT_CLASS } from './parts';
import { EditorRow, MemberChips, MemberPicker, NumberInput, RoleChips, RolePicker } from './pickers';

export function ConstraintEditor({
  constraint,
  onChange,
}: {
  constraint: Constraint;
  onChange: (next: Constraint) => void;
}) {
  switch (constraint.type) {
    case 'one_role_per_week':
      return (
        <p className="text-sm text-ink-muted">
          這條規則沒有欄位要填。要讓某個人例外，用「可以同時擔任兩個位置」另外加一條。
        </p>
      );

    case 'dual_role_exception':
      return (
        <>
          <EditorRow title="誰">
            <MemberPicker
              value={constraint.memberId === '' ? null : constraint.memberId}
              onChange={(value) => onChange({ ...constraint, memberId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="可以同時擔任">
            <RoleChips
              selected={constraint.roleIds}
              onChange={(roleIds) => onChange({ ...constraint, roleIds })}
            />
          </EditorRow>
        </>
      );

    case 'forbidden_role_combination':
      return <ComboEntries constraint={constraint} onChange={onChange} />;

    case 'required_pair':
      return (
        <>
          <SlotRow
            title="當這個人"
            slot={constraint.a}
            onChange={(a) => onChange({ ...constraint, a })}
          />
          <SlotRow
            title="就必須搭配"
            slot={constraint.b}
            onChange={(b) => onChange({ ...constraint, b })}
          />
          <EditorRow title="方向">
            <select
              className={INPUT_CLASS}
              value={constraint.directional ? 'one' : 'both'}
              onChange={(event) =>
                onChange({ ...constraint, directional: event.target.value === 'one' })
              }
            >
              <option value="one">單向（只有上面那個人成立時才要求）</option>
              <option value="both">雙向（兩邊互相要求）</option>
            </select>
          </EditorRow>
        </>
      );

    case 'max_per_month':
      return (
        <>
          <EditorRow title="誰">
            <MemberPicker
              value={constraint.memberId === '' ? null : constraint.memberId}
              onChange={(value) => onChange({ ...constraint, memberId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="每月最多">
            <NumberInput
              min={1}
              value={constraint.max}
              onChange={(max) => onChange({ ...constraint, max })}
              suffix="次"
            />
          </EditorRow>
          <EditorRow title="只算哪個位置">
            <RolePicker
              value={constraint.roleId}
              onChange={(roleId) => onChange({ ...constraint, roleId })}
              nullLabel="所有位置合計"
            />
          </EditorRow>
        </>
      );

    case 'max_per_term_role':
      return (
        <>
          <EditorRow title="誰">
            <MemberPicker
              value={constraint.memberId === '' ? null : constraint.memberId}
              onChange={(value) => onChange({ ...constraint, memberId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="哪個位置">
            <RolePicker
              value={constraint.roleId === '' ? null : constraint.roleId}
              onChange={(value) => onChange({ ...constraint, roleId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="整梯次最多">
            <NumberInput
              min={1}
              value={constraint.max}
              onChange={(max) => onChange({ ...constraint, max })}
              suffix="次"
            />
          </EditorRow>
        </>
      );

    case 'max_total_per_term':
      return (
        <>
          <EditorRow title="誰">
            <MemberPicker
              value={constraint.memberId}
              onChange={(memberId) => onChange({ ...constraint, memberId })}
              nullLabel="每一個人都套用"
            />
          </EditorRow>
          <EditorRow title="整梯次最多">
            <NumberInput
              min={1}
              value={constraint.max}
              onChange={(max) => onChange({ ...constraint, max })}
              suffix="次"
            />
          </EditorRow>
        </>
      );

    case 'availability_window':
      return (
        <>
          <EditorRow title="誰">
            <MemberPicker
              value={constraint.memberId === '' ? null : constraint.memberId}
              onChange={(value) => onChange({ ...constraint, memberId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="最早可以排" hint="留空＝不限">
            <input
              type="date"
              className={INPUT_CLASS}
              value={constraint.from ?? ''}
              onChange={(event) => {
                const next = { ...constraint };
                if (event.target.value === '') delete next.from;
                else next.from = event.target.value;
                onChange(next);
              }}
            />
          </EditorRow>
          <EditorRow title="最晚可以排" hint="留空＝不限">
            <input
              type="date"
              className={INPUT_CLASS}
              value={constraint.until ?? ''}
              onChange={(event) => {
                const next = { ...constraint };
                if (event.target.value === '') delete next.until;
                else next.until = event.target.value;
                onChange(next);
              }}
            />
          </EditorRow>
        </>
      );

    case 'role_frequency':
      return (
        <>
          <EditorRow title="哪個位置">
            <RolePicker
              value={constraint.roleId === '' ? null : constraint.roleId}
              onChange={(value) => onChange({ ...constraint, roleId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="同一個人至少間隔">
            <NumberInput
              value={constraint.minGapWeeks}
              onChange={(minGapWeeks) => onChange({ ...constraint, minGapWeeks })}
              suffix="週"
            />
          </EditorRow>
          <EditorRow title="整梯次最多">
            <NumberInput
              min={1}
              value={constraint.maxPerTerm}
              onChange={(maxPerTerm) => onChange({ ...constraint, maxPerTerm })}
              suffix="次"
            />
          </EditorRow>
        </>
      );

    case 'rotation_groups':
      return (
        <>
          <EditorRow title="哪個位置">
            <RolePicker
              value={constraint.roleId === '' ? null : constraint.roleId}
              onChange={(value) => onChange({ ...constraint, roleId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="輪替方式">
            <select
              className={INPUT_CLASS}
              value={constraint.cycleBy}
              onChange={(event) =>
                onChange({
                  ...constraint,
                  cycleBy: event.target.value === 'month' ? 'month' : 'week',
                })
              }
            >
              <option value="week">依週次（第幾週）</option>
              <option value="month">依當月第幾次聚會</option>
            </select>
          </EditorRow>

          {constraint.groups.map((group, index) => (
            <div key={index} className="rounded-lg border border-neutral-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">第 {index + 1} 組</span>
                <span>
                  <IconButton
                    label="上移"
                    disabled={index === 0}
                    onClick={() => onChange({ ...constraint, groups: move(constraint.groups, index, -1) })}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    label="下移"
                    disabled={index === constraint.groups.length - 1}
                    onClick={() => onChange({ ...constraint, groups: move(constraint.groups, index, 1) })}
                  >
                    ↓
                  </IconButton>
                  <IconButton
                    label="刪除這一組"
                    onClick={() =>
                      onChange({
                        ...constraint,
                        groups: constraint.groups.filter((_, i) => i !== index),
                      })
                    }
                  >
                    刪除
                  </IconButton>
                </span>
              </div>
              <MemberChips
                selected={group}
                onChange={(members) =>
                  onChange({
                    ...constraint,
                    groups: constraint.groups.map((item, i) => (i === index ? members : item)),
                  })
                }
              />
            </div>
          ))}
          <div>
            <Button onClick={() => onChange({ ...constraint, groups: [...constraint.groups, []] })}>
              新增一組
            </Button>
          </div>
        </>
      );

    case 'max_consecutive_same_group':
      return (
        <>
          <EditorRow title="哪個位置">
            <RolePicker
              value={constraint.roleId === '' ? null : constraint.roleId}
              onChange={(value) => onChange({ ...constraint, roleId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="同一組最多連續" hint="填 1 就是不能連續兩週">
            <NumberInput
              min={1}
              value={constraint.max}
              onChange={(max) => onChange({ ...constraint, max })}
              suffix="週"
            />
          </EditorRow>
        </>
      );

    case 'max_consecutive_weeks_per_member':
      return (
        <EditorRow title="每人整梯次最多發生" hint="「連續兩週都有服事」這件事發生幾次">
          <NumberInput
            min={1}
            value={constraint.max}
            onChange={(max) => onChange({ ...constraint, max })}
            suffix="次"
          />
        </EditorRow>
      );

    case 'forbidden_together':
      return (
        <>
          <EditorRow title="哪個位置">
            <RolePicker
              value={constraint.roleId === '' ? null : constraint.roleId}
              onChange={(value) => onChange({ ...constraint, roleId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="這些人之中任兩人不能同一週">
            <MemberChips
              selected={constraint.memberIds}
              onChange={(memberIds) => onChange({ ...constraint, memberIds })}
            />
          </EditorRow>
        </>
      );

    case 'substitute_priority':
      return (
        <>
          <EditorRow title="哪個位置">
            <RolePicker
              value={constraint.roleId === '' ? null : constraint.roleId}
              onChange={(value) => onChange({ ...constraint, roleId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="優先找">
            <MemberChips
              selected={constraint.prefer}
              onChange={(prefer) => onChange({ ...constraint, prefer })}
            />
          </EditorRow>
          <EditorRow title="留到最後才找">
            <MemberChips
              selected={constraint.lastResort}
              onChange={(lastResort) => onChange({ ...constraint, lastResort })}
            />
          </EditorRow>
        </>
      );

    case 'preferred_role_combination':
      return (
        <>
          <SlotRow
            title="當這個人"
            slot={constraint.when}
            onChange={(when) => onChange({ ...constraint, when })}
          />
          <SlotRow
            title="就偏好"
            slot={constraint.prefer}
            onChange={(prefer) => onChange({ ...constraint, prefer })}
          />
        </>
      );
  }
}

function SlotRow({
  title,
  slot,
  onChange,
}: {
  title: string;
  slot: RoleSlot;
  onChange: (next: RoleSlot) => void;
}) {
  return (
    <EditorRow title={title}>
      <MemberPicker
        value={slot.memberId === '' ? null : slot.memberId}
        onChange={(value) => onChange({ ...slot, memberId: value ?? '' })}
      />
      <span className="text-sm text-ink-muted">擔任</span>
      <RolePicker
        value={slot.roleId === '' ? null : slot.roleId}
        onChange={(value) => onChange({ ...slot, roleId: value ?? '' })}
      />
    </EditorRow>
  );
}

function move<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * 「不能同一週服事」的人員清單。位置是選填的：留空＝不限位置（規格 §7.7.3）。
 * 選了「指定位置」但還沒挑的那幾列要記下來，否則 select 會自己跳回「不限位置」。
 */
function ComboEntries({
  constraint,
  onChange,
}: {
  constraint: Extract<Constraint, { type: 'forbidden_role_combination' }>;
  onChange: (next: Constraint) => void;
}) {
  const [picking, setPicking] = useState<ReadonlySet<number>>(new Set());

  const patchEntry = (index: number, patch: Partial<{ memberId: string; roleIds: string[] }>) =>
    onChange({
      ...constraint,
      entries: constraint.entries.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });

  const setPicked = (index: number, on: boolean) => {
    const next = new Set(picking);
    if (on) next.add(index);
    else next.delete(index);
    setPicking(next);
  };

  return (
    <>
      {constraint.entries.map((entry, index) => {
        const specific = entry.roleIds.length > 0 || picking.has(index);
        return (
          <EditorRow key={index} title={`第 ${index + 1} 個人`}>
            <MemberPicker
              value={entry.memberId === '' ? null : entry.memberId}
              onChange={(value) => patchEntry(index, { memberId: value ?? '' })}
            />
            <select
              className={INPUT_CLASS}
              value={specific ? 'some' : 'any'}
              onChange={(event) => {
                const next = event.target.value === 'some';
                setPicked(index, next);
                if (!next) patchEntry(index, { roleIds: [] });
              }}
              aria-label="位置範圍"
            >
              <option value="any">不限位置</option>
              <option value="some">只有這些位置</option>
            </select>
            {specific && (
              <RoleChips
                selected={entry.roleIds}
                onChange={(roleIds) => patchEntry(index, { roleIds })}
              />
            )}
            {constraint.entries.length > 2 && (
              <IconButton
                label="移除這個人"
                onClick={() =>
                  onChange({
                    ...constraint,
                    entries: constraint.entries.filter((_, i) => i !== index),
                  })
                }
              >
                刪除
              </IconButton>
            )}
          </EditorRow>
        );
      })}
      <div>
        <Button
          onClick={() =>
            onChange({
              ...constraint,
              entries: [...constraint.entries, { memberId: '', roleIds: [] }],
            })
          }
        >
          再加一個人
        </Button>
      </div>
    </>
  );
}
