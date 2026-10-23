/** 步驟 3：人員。規格 §7.2 步驟 3、§7.5.6 */

import { useState } from 'react';
import type { Member } from '../engine';
import { memberRemovalImpact, useAppStore } from '../store/project';
import { Button, Card, ConfirmDialog, Empty, IconButton, INPUT_CLASS } from './parts';

export function StepMembers() {
  const project = useAppStore((state) => state.project);
  const addMember = useAppStore((state) => state.addMember);
  const addMembersFromText = useAppStore((state) => state.addMembersFromText);
  const deleteMember = useAppStore((state) => state.deleteMember);

  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState('');
  const [pending, setPending] = useState<Member | null>(null);

  const impact = pending === null ? null : memberRemovalImpact(project, pending.id);
  const roleless = project.members.filter((member) => member.roles.length === 0).length;

  const paste = () => {
    const parsed = addMembersFromText(pasted);
    const parts = [`新增 ${parsed.names.length} 人`];
    if (parsed.skipped > 0) parts.push(`略過 ${parsed.skipped} 個重複的姓名`);
    setResult(parts.join('，'));
    if (parsed.names.length > 0) setPasted('');
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
            共 {project.members.length} 人
            {roleless > 0 && <span className="text-notice">，其中 {roleless} 人還沒勾任何位置</span>}
          </>
        }
      >
        {project.members.length === 0 ? (
          <Empty>還沒有人員。用上面的批次建立，或按下方的「新增一人」。</Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-brand text-left text-white">
                <tr>
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
                {project.members.map((member, index) => (
                  <MemberRow key={member.id} member={member} index={index} onDelete={setPending} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4">
          <Button onClick={() => addMember()}>新增一人</Button>
        </div>
      </Card>

      <ConfirmDialog
        open={pending !== null}
        title={`刪除「${pending === null || pending.name === '' ? '未命名人員' : pending.name}」`}
        body={
          <>
            會從名單移除這個人
            {impact !== null && impact.removed > 0 && `，移除 ${impact.removed} 條限制條件`}
            {impact !== null && impact.modified > 0 && `，修改 ${impact.modified} 條限制條件`}
            。這個動作沒辦法復原。
          </>
        }
        confirmLabel="刪除"
        onConfirm={() => {
          if (pending !== null) deleteMember(pending.id);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function MemberRow({
  member,
  index,
  onDelete,
}: {
  member: Member;
  index: number;
  onDelete: (member: Member) => void;
}) {
  const roles = useAppStore((state) => state.project.roles);
  const renameMember = useAppStore((state) => state.renameMember);
  const setMemberRole = useAppStore((state) => state.setMemberRole);

  const idle = member.roles.length === 0;

  return (
    <tr className={`${index % 2 === 1 ? 'bg-stripe' : ''} ${idle ? 'text-ink-muted' : ''}`}>
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
