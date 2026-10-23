/** 步驟 2：服事位置。規格 §7.2 步驟 2、§7.5.5 */

import { useState } from 'react';
import type { Role, RoleId } from '../engine';
import { candidateCount, pairOptions } from '../domain/roles';
import { roleRemovalImpact, useAppStore } from '../store/project';
import { Button, Card, ConfirmDialog, Empty, HEAD_CELL, INPUT_CLASS, IconButton, StickyTable } from './parts';

export function StepRoles() {
  const project = useAppStore((state) => state.project);
  const deleteRole = useAppStore((state) => state.deleteRole);
  const addRole = useAppStore((state) => state.addRole);
  const [pending, setPending] = useState<Role | null>(null);

  const tag = project.weekTags[0];
  const impact = pending === null ? null : roleRemovalImpact(project, pending.id);

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="服事位置"
        hint="由上而下的順序就是排班的指派順序，也是下載班表的欄位順序。"
      >
        {project.roles.length === 0 ? (
          <Empty>還沒有服事位置。按下方的「新增位置」開始。</Empty>
        ) : (
          <StickyTable className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <th className={`${HEAD_CELL} px-4 py-2 text-left`}>名稱</th>
                  <th className={`${HEAD_CELL} px-4 py-2 text-left`}>每週人數</th>
                  <th className={`${HEAD_CELL} px-4 py-2 text-left`}>只在{tag?.label ?? '特殊週'}</th>
                  <th className={`${HEAD_CELL} px-4 py-2 text-left`}>一起排</th>
                  <th className={`${HEAD_CELL} px-4 py-2 text-left`}>可擔任人數</th>
                  <th className={`${HEAD_CELL} px-4 py-2 text-left`} />
                </tr>
              </thead>
              <tbody>
                {project.roles.map((role, index) => (
                  <RoleRow key={role.id} role={role} index={index} onDelete={setPending} />
                ))}
              </tbody>
          </StickyTable>
        )}

        <div className="mt-4">
          <Button tone="primary" onClick={addRole}>
            新增位置
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={`刪除「${pending === null || pending.name === '' ? '未命名位置' : pending.name}」`}
        body={
          <>
            會從每個人的勾選裡移除這個位置
            {impact !== null && impact.removed > 0 && `，並一併移除 ${impact.removed} 條限制條件`}
            。這個動作沒辦法復原。
          </>
        }
        confirmLabel="刪除"
        onConfirm={() => {
          if (pending !== null) deleteRole(pending.id);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function RoleRow({
  role,
  index,
  onDelete,
}: {
  role: Role;
  index: number;
  onDelete: (role: Role) => void;
}) {
  const project = useAppStore((state) => state.project);
  const updateRole = useAppStore((state) => state.updateRole);
  const setRoleTagOnly = useAppStore((state) => state.setRoleTagOnly);
  const setRolePair = useAppStore((state) => state.setRolePair);
  const moveRole = useAppStore((state) => state.moveRole);

  const tag = project.weekTags[0];
  const count = candidateCount(project.members, role.id);
  const options = pairOptions(project.roles, role.id);

  return (
    <tr className={index % 2 === 1 ? 'bg-stripe' : ''}>
      <td className="px-4 py-2">
        <input
          className={`${INPUT_CLASS} w-36`}
          value={role.name}
          placeholder="位置名稱"
          onChange={(event) => updateRole(role.id, { name: event.target.value })}
          aria-label="位置名稱"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min={1}
          className={`${INPUT_CLASS} w-20 tabular`}
          value={role.perWeek}
          onChange={(event) =>
            updateRole(role.id, { perWeek: Math.max(1, Number(event.target.value) || 1) })
          }
          aria-label="每週人數"
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="checkbox"
          checked={role.appliesTo.kind === 'weekTag'}
          disabled={tag === undefined}
          onChange={(event) => setRoleTagOnly(role.id, event.target.checked)}
          aria-label={`只在${tag?.label ?? '特殊週'}`}
        />
      </td>
      <td className="px-4 py-2">
        <select
          className={`${INPUT_CLASS} w-32`}
          value={role.pairsWith ?? ''}
          onChange={(event) =>
            setRolePair(role.id, event.target.value === '' ? null : (event.target.value as RoleId))
          }
          aria-label="一起排的位置"
        >
          <option value="">（不成對）</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name === '' ? '（未命名）' : option.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2">
        <span className={`tabular ${count < role.perWeek ? 'text-alert' : 'text-ink-muted'}`}>
          {count} 人{count === 0 && '（沒有人可擔任）'}
          {count > 0 && count < role.perWeek && `（不足 ${role.perWeek} 人）`}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right">
        <IconButton label="上移" disabled={index === 0} onClick={() => moveRole(index, -1)}>
          ↑
        </IconButton>
        <IconButton
          label="下移"
          disabled={index === project.roles.length - 1}
          onClick={() => moveRole(index, 1)}
        >
          ↓
        </IconButton>
        <IconButton label="刪除這個位置" onClick={() => onDelete(role)}>
          刪除
        </IconButton>
      </td>
    </tr>
  );
}
