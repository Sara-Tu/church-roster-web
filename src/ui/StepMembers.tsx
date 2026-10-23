/** 步驟 3：人員。規格 §7.2 步驟 3、§7.5.6 */

import { useState } from 'react';
import type { Member } from '../engine';
import { membersRemovalImpact, useAppStore } from '../store/project';
import { Button, Card, ConfirmDialog, Empty, IconButton, INPUT_CLASS } from './parts';

/** 要刪掉哪些人：單筆（從某一列按刪除）、勾選的那批、或全部 */
type Pending = { kind: 'one'; member: Member } | { kind: 'selected' } | { kind: 'all' };

export function StepMembers() {
  const project = useAppStore((state) => state.project);
  const addMember = useAppStore((state) => state.addMember);
  const addMembersFromText = useAppStore((state) => state.addMembersFromText);
  const deleteMembers = useAppStore((state) => state.deleteMembers);
  const clearMembers = useAppStore((state) => state.clearMembers);

  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);

  const members = project.members;
  const roleless = members.filter((member) => member.roles.length === 0).length;
  // 勾選的人可能已經被刪掉，所以每次都以現有名單為準
  const selectedIds = members.filter((member) => selected.has(member.id)).map((m) => m.id);
  const allSelected = members.length > 0 && selectedIds.length === members.length;

  const targets =
    pending === null
      ? []
      : pending.kind === 'one'
        ? [pending.member.id]
        : pending.kind === 'all'
          ? members.map((member) => member.id)
          : selectedIds;
  const impact = pending === null ? null : membersRemovalImpact(project, targets);

  const toggleSelected = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const paste = () => {
    const parsed = addMembersFromText(pasted);
    const parts = [`新增 ${parsed.names.length} 人`];
    if (parsed.skipped > 0) parts.push(`略過 ${parsed.skipped} 個重複的姓名`);
    setResult(parts.join('，'));
    if (parsed.names.length > 0) setPasted('');
  };

  const confirmDelete = () => {
    if (pending?.kind === 'all') clearMembers();
    else if (pending !== null) deleteMembers(targets);
    setSelected(new Set());
    setPending(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="貼上一串姓名"
        hint="換行、逗號、頓號、分號都可以分隔。貼完之後再到下面的表格勾服事位置。"
      >
        <textarea
          className={`${INPUT_CLASS} h-28 w-full font-sans`}
          value={pasted}
          placeholder={'王小明\n李小華\n陳美玲'}
          onChange={(event) => {
            setPasted(event.target.value);
            setResult('');
          }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button tone="primary" disabled={pasted.trim() === ''} onClick={paste}>
            批次建立
          </Button>
          {result !== '' && <span className="text-sm text-ink-muted">{result}</span>}
        </div>
      </Card>

      <Card
        title="人員與服事位置"
        hint={
          <>
            共 {members.length} 人
            {roleless > 0 && <span className="text-notice">，其中 {roleless} 人還沒勾任何位置</span>}
          </>
        }
      >
        {members.length === 0 ? (
          <Empty>還沒有人員。用上面的批次建立，或按下方的「新增一人」。</Empty>
        ) : (
          <>
            <div className="mb-3 flex min-h-9 flex-wrap items-center gap-3">
              {selectedIds.length > 0 ? (
                <>
                  <span className="text-sm text-ink-muted">已選 {selectedIds.length} 人</span>
                  <Button tone="danger" onClick={() => setPending({ kind: 'selected' })}>
                    刪除勾選的 {selectedIds.length} 人
                  </Button>
                  <Button onClick={() => setSelected(new Set())}>取消勾選</Button>
                </>
              ) : (
                <span className="text-sm text-ink-muted">
                  勾選最左欄可以一次刪除多個人。
                </span>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-brand text-left text-white">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(element) => {
                          if (element !== null) {
                            element.indeterminate = selectedIds.length > 0 && !allSelected;
                          }
                        }}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? new Set(members.map((member) => member.id))
                              : new Set(),
                          )
                        }
                        aria-label="全選"
                      />
                    </th>
                    <th className="px-4 py-2 font-medium">姓名</th>
                    {project.roles.map((role) => (
                      <th key={role.id} className="px-3 py-2 text-center font-medium">
                        {role.name === '' ? '（未命名）' : role.name}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center font-medium">已勾</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((member, index) => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      index={index}
                      selected={selected.has(member.id)}
                      onSelect={toggleSelected}
                      onDelete={(target) => setPending({ kind: 'one', member: target })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button onClick={() => addMember()}>新增一人</Button>
          {members.length > 0 && (
            <Button tone="danger" onClick={() => setPending({ kind: 'all' })}>
              清空所有人員
            </Button>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'one'
            ? `刪除「${pending.member.name === '' ? '未命名人員' : pending.member.name}」`
            : pending?.kind === 'all'
              ? `清空所有人員（${targets.length} 人）`
              : `刪除勾選的 ${targets.length} 人`
        }
        body={
          <>
            會從名單移除{pending?.kind === 'one' ? '這個人' : ` ${targets.length} 人`}
            {impact !== null && impact.removed > 0 && `，移除 ${impact.removed} 條限制條件`}
            {impact !== null && impact.modified > 0 && `，修改 ${impact.modified} 條限制條件`}
            。這個動作沒辦法復原。
          </>
        }
        confirmLabel="刪除"
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function MemberRow({
  member,
  index,
  selected,
  onSelect,
  onDelete,
}: {
  member: Member;
  index: number;
  selected: boolean;
  onSelect: (id: string, on: boolean) => void;
  onDelete: (member: Member) => void;
}) {
  const roles = useAppStore((state) => state.project.roles);
  const renameMember = useAppStore((state) => state.renameMember);
  const setMemberRole = useAppStore((state) => state.setMemberRole);

  const idle = member.roles.length === 0;

  return (
    <tr
      className={`${selected ? 'bg-brand-light/10' : index % 2 === 1 ? 'bg-stripe' : ''} ${
        idle ? 'text-ink-muted' : ''
      }`}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(member.id, event.target.checked)}
          aria-label={`勾選 ${member.name || '未命名人員'}`}
        />
      </td>
      <td className="px-4 py-2">
        <input
          className={`${INPUT_CLASS} w-32`}
          value={member.name}
          placeholder="姓名"
          onChange={(event) => renameMember(member.id, event.target.value)}
          aria-label="姓名"
        />
      </td>
      {roles.map((role) => (
        <td key={role.id} className="px-3 py-2 text-center">
          <input
            type="checkbox"
            checked={member.roles.includes(role.id)}
            onChange={(event) => setMemberRole(member.id, role.id, event.target.checked)}
            aria-label={`${member.name || '未命名'} 可擔任 ${role.name}`}
          />
        </td>
      ))}
      <td className="px-3 py-2 text-center tabular">{member.roles.length}</td>
      <td className="px-4 py-2 text-right">
        <IconButton label="刪除這個人" onClick={() => onDelete(member)}>
          刪除
        </IconButton>
      </td>
    </tr>
  );
}
