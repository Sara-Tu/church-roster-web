/** 步驟 4：不行日期。規格 §7.2 步驟 4、§7.6.3 */

import { useMemo, useState } from 'react';
import {
  buildAiPrompt,
  parseUnavailable,
  staleDates,
  weekLoad,
} from '../domain/unavailable';
import type { ImportMode, ParsedUnavailable } from '../domain/unavailable';
import { useAppStore } from '../store/project';
import {
  Button,
  Card,
  ConfirmDialog,
  Empty,
  HEAD_CELL,
  IconButton,
  INPUT_CLASS,
  StickyTable,
} from './parts';

export function StepUnavailable() {
  const project = useAppStore((state) => state.project);
  const weeks = project.term.weeks;

  if (weeks.length === 0) {
    return (
      <Card title="不行日期" hint="這一步可以跳過，之後隨時回來填。">
        <Empty>還沒有聚會日。先回步驟 1 按「產生聚會日」，這裡才有日期可以勾。</Empty>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AiCard />
      <MatrixCard />
      <StaleCard />
      <LoadCard />
    </div>
  );
}

// ── 用 AI 整理 ────────────────────────────────────────────────────────────

function AiCard() {
  const project = useAppStore((state) => state.project);
  const importUnavailable = useAppStore((state) => state.importUnavailable);

  const prompt = useMemo(() => buildAiPrompt(project), [project]);
  const [pasted, setPasted] = useState('');
  const [parsed, setParsed] = useState<ParsedUnavailable | null>(null);
  const [copied, setCopied] = useState('');
  const [result, setResult] = useState('');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('已複製，貼進你自己的 AI，後面接上 LINE 的對話或截圖。');
    } catch {
      setCopied('瀏覽器不讓我用剪貼簿，請展開下面的 prompt 自己複製。');
    }
  };

  const apply = (mode: ImportMode) => {
    if (parsed === null) return;
    const changed = importUnavailable(parsed.entries, mode);
    setResult(
      mode === 'replace'
        ? `已取代 ${changed} 個人的不行日期。`
        : `已加上 ${changed} 個人的不行日期。`,
    );
    setParsed(null);
    setPasted('');
  };

  return (
    <Card
      title="用 AI 整理不行日期"
      hint="複製下面的 prompt 給你自己的 AI，連同 LINE 的對話或截圖一起丟進去，再把它回覆的 JSON 貼回來。"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button tone="primary" onClick={copy}>
          複製 prompt
        </Button>
        {copied !== '' && <span className="text-sm text-ink-muted">{copied}</span>}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        名單與截圖會送到你選的那個 AI 服務，請先確認同工能接受。
      </p>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-brand">看看 prompt 的內容</summary>
        <textarea
          readOnly
          className={`${INPUT_CLASS} mt-2 h-40 w-full font-mono text-xs`}
          value={prompt}
        />
      </details>

      <hr className="my-5 border-neutral-200" />

      <label className="text-sm font-medium" htmlFor="ai-reply">
        把 AI 回覆的 JSON 貼在這裡
      </label>
      <textarea
        id="ai-reply"
        className={`${INPUT_CLASS} mt-1 h-28 w-full font-mono text-xs`}
        value={pasted}
        placeholder={'{"unavailable":[{"name":"王小明","dates":["2027-01-10"]}]}'}
        onChange={(event) => {
          setPasted(event.target.value);
          setParsed(null);
          setResult('');
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          disabled={pasted.trim() === ''}
          onClick={() => setParsed(parseUnavailable(pasted, project))}
        >
          檢查
        </Button>
        {result !== '' && <span className="text-sm text-ink-muted">{result}</span>}
      </div>

      {parsed !== null && <Preview parsed={parsed} onApply={apply} />}
    </Card>
  );
}

function Preview({
  parsed,
  onApply,
}: {
  parsed: ParsedUnavailable;
  onApply: (mode: ImportMode) => void;
}) {
  if (parsed.error !== null) {
    return <p className="mt-4 text-sm text-alert">{parsed.error}</p>;
  }

  const total = parsed.entries.reduce((sum, entry) => sum + entry.dates.length, 0);

  return (
    <div className="mt-4 rounded-lg border border-neutral-200">
      <div className="border-b border-neutral-200 px-4 py-2 text-sm">
        對到 {parsed.entries.length} 個人、共 {total} 筆日期
      </div>

      <table className="w-full text-sm">
        <tbody>
          {parsed.entries.map((entry) => (
            <tr key={entry.memberId} className="border-b border-neutral-100 last:border-0">
              <td className="w-28 px-4 py-2 align-top">{entry.name}</td>
              <td className="tabular w-16 px-2 py-2 align-top text-ink-muted">
                {entry.dates.length} 筆
              </td>
              <td className="px-2 py-2">
                <span className="tabular">{entry.dates.join('、')}</span>
                {entry.unsure !== undefined && (
                  <span className="block text-notice">AI 不確定：{entry.unsure}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-1 px-4 py-3 text-sm">
        {parsed.unknownNames.length > 0 && (
          <span className="text-notice">
            名單裡找不到這些名字，已略過：{parsed.unknownNames.join('、')}
          </span>
        )}
        {parsed.ambiguousNames.length > 0 && (
          <span className="text-notice">
            名單裡有兩個以上同名的人，不確定是誰，已略過：{parsed.ambiguousNames.join('、')}
          </span>
        )}
        {parsed.badDates.length > 0 && (
          <span className="text-notice">
            這些日期不是本梯次的聚會日，已略過：{parsed.badDates.join('、')}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 px-4 py-3">
        <Button
          tone="primary"
          disabled={parsed.entries.length === 0}
          onClick={() => onApply('replace')}
        >
          取代這些人的日期
        </Button>
        <Button disabled={parsed.entries.length === 0} onClick={() => onApply('add')}>
          加上去
        </Button>
        <span className="text-xs text-ink-muted">
          取代＝這幾個人以這次的結果為準；加上去＝保留原本已經填的日期。
        </span>
      </div>
    </div>
  );
}

// ── 人 × 週勾選矩陣 ───────────────────────────────────────────────────────

function MatrixCard() {
  const project = useAppStore((state) => state.project);
  const toggleUnavailable = useAppStore((state) => state.toggleUnavailable);
  const clearMemberUnavailable = useAppStore((state) => state.clearMemberUnavailable);

  const weeks = project.term.weeks;
  const tag = project.weekTags[0];
  const total = project.members.reduce((sum, member) => sum + member.unavailable.length, 0);

  return (
    <Card
      title="誰哪一週不行"
      hint={`勾起來就是那一週不能服事。目前共 ${total} 筆，表格可以左右滑動。`}
    >
      {project.members.length === 0 ? (
        <Empty>還沒有人員。先回步驟 3 建立名單。</Empty>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-200">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-32 border-b border-r border-neutral-200 bg-brand px-3 py-2 text-left font-medium text-white">
                  姓名
                </th>
                {weeks.map((week) => {
                  const special = tag !== undefined && week.tags.includes(tag.id);
                  return (
                    <th
                      key={week.date}
                      title={`${week.date}${special ? `（${tag?.label}）` : ''}`}
                      className={`tabular sticky top-0 z-10 w-12 border-b border-neutral-200 px-1 py-2 text-center font-medium ${
                        special ? 'bg-communion text-ink' : 'bg-brand text-white'
                      }`}
                    >
                      {week.date.slice(5).replace('-', '/')}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {project.members.map((member, index) => {
                const rowBg = index % 2 === 1 ? 'bg-stripe' : 'bg-white';
                return (
                  <tr key={member.id}>
                    <th
                      className={`sticky left-0 z-10 min-w-32 border-b border-r border-neutral-200 px-3 py-1.5 text-left font-normal ${rowBg}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span>{member.name.trim() === '' ? '（未命名）' : member.name}</span>
                        <span className="flex items-center gap-1">
                          {member.unavailable.length > 0 && (
                            <>
                              <span className="tabular text-xs text-ink-muted">
                                {member.unavailable.length}
                              </span>
                              <IconButton
                                label={`清掉 ${member.name} 的不行日期`}
                                onClick={() => clearMemberUnavailable(member.id)}
                              >
                                ×
                              </IconButton>
                            </>
                          )}
                        </span>
                      </span>
                    </th>
                    {weeks.map((week) => (
                      <td
                        key={week.date}
                        className={`border-b border-neutral-100 px-1 py-1.5 text-center ${rowBg}`}
                      >
                        <input
                          type="checkbox"
                          checked={member.unavailable.includes(week.date)}
                          onChange={(event) =>
                            toggleUnavailable(member.id, week.date, event.target.checked)
                          }
                          aria-label={`${member.name || '未命名'} ${week.date} 不行`}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── 殘留的非聚會日 ────────────────────────────────────────────────────────

function StaleCard() {
  const project = useAppStore((state) => state.project);
  const clearStaleUnavailable = useAppStore((state) => state.clearStaleUnavailable);
  const [confirm, setConfirm] = useState(false);
  const [removed, setRemoved] = useState('');

  const stale = staleDates(project);
  if (stale.length === 0 && removed === '') return null;

  const total = stale.reduce((sum, group) => sum + group.dates.length, 0);

  return (
    <Card
      title="不是本梯次聚會日的日期"
      hint="改過聚會日之後留下來的。留著不會影響排班，但也不會有任何作用。"
    >
      {stale.length === 0 ? (
        <p className="text-sm text-ink-muted">{removed}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {stale.map((group) => (
              <li key={group.memberId}>
                <span className="font-medium">
                  {group.name.trim() === '' ? '（未命名）' : group.name}
                </span>
                <span className="tabular ml-2 text-ink-muted">{group.dates.join('、')}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Button tone="danger" onClick={() => setConfirm(true)}>
              清掉這 {total} 筆
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title={`清掉 ${total} 筆不是聚會日的日期`}
        body="只會清掉不在本梯次聚會日清單裡的那些日期，其他的不動。這個動作沒辦法復原。"
        confirmLabel="清掉"
        onConfirm={() => {
          setRemoved(`已清掉 ${clearStaleUnavailable()} 筆。`);
          setConfirm(false);
        }}
        onCancel={() => setConfirm(false)}
      />
    </Card>
  );
}

// ── 每週人力 ──────────────────────────────────────────────────────────────

function LoadCard() {
  const project = useAppStore((state) => state.project);
  const tag = project.weekTags[0];
  const loads = weekLoad(project);
  const shortWeeks = loads.filter((load) => load.shortages.length > 0).length;

  return (
    <Card
      title="每週人力"
      hint={
        shortWeeks === 0
          ? '每一週都還有足夠的人可以排。這裡只扣不行日期，不計算限制條件。'
          : `有 ${shortWeeks} 週排不滿，下面標橘色。這裡只扣不行日期，不計算限制條件。`
      }
    >
      <StickyTable className="w-full min-w-[520px]">
          <thead>
            <tr>
              <th className={`${HEAD_CELL} px-4 py-2 text-left`}>聚會日</th>
              <th className={`${HEAD_CELL} px-3 py-2 text-left`}>不行人數</th>
              <th className={`${HEAD_CELL} px-3 py-2 text-left`}>排不滿的位置</th>
            </tr>
          </thead>
          <tbody>
            {loads.map((load, index) => {
              const special = tag !== undefined && load.tags.includes(tag.id);
              const rowBg = load.shortages.length > 0 ? 'bg-notice/10' : special ? 'bg-communion' : index % 2 === 1 ? 'bg-stripe' : '';
              return (
                <tr key={load.date} className={rowBg}>
                  <td className="tabular px-4 py-2">
                    {load.date}
                    {special && <span className="ml-2 text-xs text-ink-muted">{tag?.label}</span>}
                  </td>
                  <td className="tabular px-3 py-2">{load.absent}</td>
                  <td className="px-3 py-2">
                    {load.shortages.length === 0 ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      <span className="text-notice">
                        {load.shortages
                          .map(
                            (shortage) =>
                              `${shortage.roleName}（${shortage.available} 人 / 需要 ${shortage.needed} 人）`,
                          )
                          .join('、')}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
      </StickyTable>
    </Card>
  );
}
