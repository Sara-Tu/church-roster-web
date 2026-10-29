/** 17 種限制條件的欄位編輯器。規格 §5、§7.6.4 */

import { useState } from 'react';
import type { Constraint, RoleSlot } from '../engine';
import { pinnedSlotLabel } from '../domain/constraints';
import { useAppStore } from '../store/project';
import { Button, IconButton, INPUT_CLASS } from './parts';
import {
  Chip,
  EditorRow,
  MemberChips,
  MemberPicker,
  NumberInput,
  RoleChips,
  RolePicker,
} from './pickers';

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
            <select
              className={INPUT_CLASS}
              value={constraint.memberId === null ? 'all' : 'one'}
              onChange={(event) =>
                onChange({
                  ...constraint,
                  memberId: event.target.value === 'all' ? null : '',
                })
              }
              aria-label="套用範圍"
            >
              <option value="one">指定某一個人</option>
              <option value="all">每一個人</option>
            </select>
            {constraint.memberId !== null && (
              <MemberPicker
                value={constraint.memberId === '' ? null : constraint.memberId}
                onChange={(value) => onChange({ ...constraint, memberId: value ?? '' })}
              />
            )}
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

    case 'min_per_term':
      return (
        <>
          <EditorRow title="誰">
            <MemberPicker
              value={constraint.memberId === '' ? null : constraint.memberId}
              onChange={(value) => onChange({ ...constraint, memberId: value ?? '' })}
            />
          </EditorRow>
          <EditorRow title="整梯次至少">
            <NumberInput
              min={1}
              value={constraint.min}
              onChange={(min) => onChange({ ...constraint, min })}
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
      return <RotationEditor constraint={constraint} onChange={onChange} />;

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

    case 'fixed_assignment':
      return <FixedAssignmentEditor constraint={constraint} onChange={onChange} />;
  }
}

/**
 * 指定服事（規格 §7.12.1）：人 → 位置 → 日期 → 指定日期以外照常排／不排。
 * 位置只列這個人有登記的；日期只列這個位置會排的聚會日。已經勾了、但現在
 * 不在清單裡的日期（梯次改過）用紅框留著，讓使用者自己拿掉。
 */
function FixedAssignmentEditor({
  constraint,
  onChange,
}: {
  constraint: Extract<Constraint, { type: 'fixed_assignment' }>;
  onChange: (next: Constraint) => void;
}) {
  const project = useAppStore((state) => state.project);
  const person = project.members.find((member) => member.id === constraint.memberId);
  const roles =
    person === undefined
      ? project.roles
      : project.roles.filter((role) => person.roles.includes(role.id));
  const role = project.roles.find((item) => item.id === constraint.roleId);
  const tagLabel = new Map(project.weekTags.map((tag) => [tag.id, tag.label]));
  const weeks = project.term.weeks.filter(
    (week) => role?.appliesTo.kind !== 'weekTag' || week.tags.includes(role.appliesTo.tagId),
  );
  const listed = new Set(weeks.map((week) => week.date));
  const stale = constraint.dates.filter((date) => !listed.has(date)).sort();
  const md = (date: string) => `${date.slice(5, 7)}/${date.slice(8, 10)}`;

  const toggle = (date: string) =>
    onChange({
      ...constraint,
      dates: constraint.dates.includes(date)
        ? constraint.dates.filter((item) => item !== date)
        : [...constraint.dates, date].sort(),
    });

  return (
    <>
      <EditorRow title="誰">
        <MemberPicker
          value={constraint.memberId === '' ? null : constraint.memberId}
          onChange={(value) => onChange({ ...constraint, memberId: value ?? '' })}
        />
      </EditorRow>
      <EditorRow title="擔任哪個位置" hint={person === undefined ? undefined : '只列出這個人有登記的位置'}>
        <select
          className={`${INPUT_CLASS} max-w-44`}
          value={constraint.roleId}
          onChange={(event) => onChange({ ...constraint, roleId: event.target.value })}
          aria-label="選服事位置"
        >
          <option value="">請選位置</option>
          {roles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name.trim() === '' ? '（未命名）' : item.name}
            </option>
          ))}
        </select>
      </EditorRow>
      <EditorRow title="哪幾天（可以複選）">
        {weeks.length === 0 ? (
          <span className="text-xs text-ink-muted">還沒有聚會日，先回步驟 1 產生。</span>
        ) : (
          weeks.map((week) => {
            const labels = week.tags.map((id) => tagLabel.get(id)).filter(Boolean);
            return (
              <Chip
                key={week.date}
                on={constraint.dates.includes(week.date)}
                onClick={() => toggle(week.date)}
              >
                <span className="tabular">{md(week.date)}</span>
                {labels.length > 0 && <span className="ml-1">{labels.join('、')}</span>}
              </Chip>
            );
          })
        )}
        {stale.map((date) => (
          <button
            key={date}
            type="button"
            onClick={() => toggle(date)}
            title="這一天現在不是這個位置會排的聚會日，點一下拿掉"
            className="rounded-full border border-alert px-2.5 py-1 text-xs text-alert"
          >
            <span className="tabular">{md(date)}</span> ✕
          </button>
        ))}
      </EditorRow>
      <EditorRow title="指定日期以外">
        <Chip
          on={!constraint.onlyPinnedDates}
          onClick={() => onChange({ ...constraint, onlyPinnedDates: false })}
        >
          照常排
        </Chip>
        <Chip
          on={constraint.onlyPinnedDates}
          onClick={() => onChange({ ...constraint, onlyPinnedDates: true })}
        >
          不排
        </Chip>
      </EditorRow>
      {constraint.onlyPinnedDates && (
        <EditorRow title="限制哪些位置" hint="留空＝所有位置">
          <RoleChips
            selected={constraint.onlyRoleIds}
            onChange={(onlyRoleIds) => onChange({ ...constraint, onlyRoleIds })}
          />
        </EditorRow>
      )}
    </>
  );
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

/**
 * 輪替群組。每一組除了成員，還可以釘一個「當月第 N 次聚會」當偏好（規格 §7.9.2）。
 * `pinnedSlots` 與 `groups` 同索引，所以搬動、刪除、新增都要兩邊一起動。
 */
function RotationEditor({
  constraint,
  onChange,
}: {
  constraint: Extract<Constraint, { type: 'rotation_groups' }>;
  onChange: (next: Constraint) => void;
}) {
  const weeks = useAppStore((state) => state.project.term.weeks);
  const slots = maxMeetingsPerMonth(weeks);
  const pins = constraint.groups.map((_, i) => constraint.pinnedSlots?.[i] ?? null);

  const write = (groups: readonly string[][], nextPins: readonly (number | null)[]) => {
    onChange({
      ...constraint,
      groups: [...groups],
      // 全部都沒釘就把欄位收掉，匯出的 JSON 不留空陣列
      ...(nextPins.some((pin) => pin !== null)
        ? { pinnedSlots: [...nextPins] }
        : { pinnedSlots: undefined }),
    });
  };

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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">第 {index + 1} 組</span>
            <span className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-ink-muted">
                固定在
                <select
                  className={`${INPUT_CLASS} max-w-40`}
                  value={pins[index] === null ? '' : String(pins[index])}
                  onChange={(event) =>
                    write(
                      constraint.groups,
                      pins.map((pin, i) =>
                        i === index
                          ? event.target.value === ''
                            ? null
                            : Number(event.target.value)
                          : pin,
                      ),
                    )
                  }
                >
                  <option value="">不指定</option>
                  {Array.from({ length: slots }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {pinnedSlotLabel(n)}
                    </option>
                  ))}
                  <option value="-1">{pinnedSlotLabel(-1)}</option>
                </select>
              </label>
              <IconButton
                label="上移"
                disabled={index === 0}
                onClick={() =>
                  write(move(constraint.groups, index, -1), move(pins, index, -1))
                }
              >
                ↑
              </IconButton>
              <IconButton
                label="下移"
                disabled={index === constraint.groups.length - 1}
                onClick={() => write(move(constraint.groups, index, 1), move(pins, index, 1))}
              >
                ↓
              </IconButton>
              <IconButton
                label="刪除這一組"
                onClick={() =>
                  write(
                    constraint.groups.filter((_, i) => i !== index),
                    pins.filter((_, i) => i !== index),
                  )
                }
              >
                刪除
              </IconButton>
            </span>
          </div>
          <MemberChips
            selected={group}
            onChange={(members) =>
              write(
                constraint.groups.map((item, i) => (i === index ? members : item)),
                pins,
              )
            }
          />
        </div>
      ))}
      <p className="text-xs text-ink-muted">
        「固定在」是偏好：排不出來時引擎還是會用別的組，並在結果頁的警告裡記一筆。
      </p>
      <div>
        <Button onClick={() => write([...constraint.groups, []], [...pins, null])}>
          新增一組
        </Button>
      </div>
    </>
  );
}

/** 這個梯次裡，同一個月最多有幾次聚會。決定「固定在第幾次」的選項數量 */
function maxMeetingsPerMonth(weeks: readonly { date: string }[]): number {
  const counts = new Map<string, number>();
  for (const week of weeks) {
    const month = week.date.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return Math.min(5, Math.max(4, ...counts.values(), 0));
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
