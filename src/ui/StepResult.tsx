/** 結果頁。規格 §7.2 結果、§7.8 */

import { useMemo, useState } from 'react';
import { collectIssues } from '../domain/issues';
import { buildView, formatMd, roleName, rosterInputHash, rosterFilename } from '../domain/roster';
import type { RosterNote, RosterSnapshot, RosterView } from '../domain/roster';
import { rosterCsv } from '../io/csv';
import { downloadBlob, downloadText } from '../io/download';
import { useAppStore } from '../store/project';
import type { Project } from '../engine';
import { Button, Card, Empty, HEAD_CELL, StickyTable } from './parts';

type ViewMode = 'week' | 'person';

export function StepResult() {
  const project = useAppStore((state) => state.project);
  const roster = useAppStore((state) => state.roster);
  const generatedFrom = useAppStore((state) => state.ui.generatedFrom);
  const storage = useAppStore((state) => state.storage);
  const generateRoster = useAppStore((state) => state.generateRoster);

  const [mode, setMode] = useState<ViewMode>('week');
  const [error, setError] = useState('');

  const blockers = collectIssues(project, { generatedFrom }, storage).filter(
    (issue) => issue.level === 'alert',
  );
  const stale = roster !== null && roster.inputHash !== rosterInputHash(project);
  const view = useMemo(
    () => (roster === null ? null : buildView(project, roster.result)),
    [project, roster],
  );

  const run = () => {
    const outcome = generateRoster();
    setError(outcome.ok ? '' : outcome.message);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="產生班表"
        hint="引擎會照著步驟 1–5 的設定排，排不出來的地方會列在下面的警告裡。"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" onClick={run} disabled={blockers.length > 0}>
            {roster === null ? '產生班表' : '重新產生班表'}
          </Button>
          {roster !== null && (
            <span className="text-sm text-ink-muted tabular">
              第 r{roster.revision} 版 · {stamp(roster)}
            </span>
          )}
        </div>

        {blockers.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-alert">
            {blockers.map((issue) => (
              <li key={issue.code}>先修掉：{issue.message}</li>
            ))}
          </ul>
        )}
        {error !== '' && <p className="mt-3 text-sm text-alert">排不出來：{error}</p>}
        {stale && (
          <p className="mt-3 text-sm text-notice">
            產生這份班表之後，資料又改過了。要套用新的設定請按「重新產生班表」。
          </p>
        )}
      </Card>

      {roster === null || view === null ? (
        <Card title="班表">
          <Empty>還沒產生過班表。按上面的「產生班表」。</Empty>
        </Card>
      ) : (
        <>
          <Card
            title="班表"
            hint={
              mode === 'week'
                ? '一列一週，底色是聖餐週。手機上可以左右滑動後截圖給同工。'
                : '一列一人，日期是這個梯次裡被排到的每一天。'
            }
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <Button tone={mode === 'week' ? 'primary' : 'ghost'} onClick={() => setMode('week')}>
                  依週次
                </Button>
                <Button
                  tone={mode === 'person' ? 'primary' : 'ghost'}
                  onClick={() => setMode('person')}
                >
                  依人員
                </Button>
              </div>
              <Downloads project={project} roster={roster} />
            </div>

            {mode === 'week' ? <WeekTable view={view} /> : <PersonTable view={view} />}
          </Card>

          <NotesCard view={view} />
          <FairnessCard view={view} />
        </>
      )}
    </div>
  );
}

function stamp(roster: RosterSnapshot): string {
  const at = new Date(roster.generatedAt);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `產生於 ${pad(at.getMonth() + 1)}/${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

// ── 下載 ────────────────────────────────────────────────────────────────────

function Downloads({ project, roster }: { project: Project; roster: RosterSnapshot }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const excel = async () => {
    setBusy(true);
    setError('');
    try {
      // exceljs 只在這裡才載入（規格 §9）
      const { rosterXlsx } = await import('../io/excel');
      const blob = await rosterXlsx(project, roster.result);
      downloadBlob(rosterFilename(project, roster.revision, 'xlsx'), blob);
    } catch {
      setError('Excel 產生失敗，可以先下載 CSV。');
    } finally {
      setBusy(false);
    }
  };

  const csv = () => {
    downloadText(
      rosterFilename(project, roster.revision, 'csv'),
      rosterCsv(project, roster.result),
      'text/csv;charset=utf-8',
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={excel} disabled={busy}>
        {busy ? '產生中…' : '下載 Excel'}
      </Button>
      <Button onClick={csv}>下載 CSV</Button>
      {error !== '' && <span className="text-sm text-alert">{error}</span>}
    </div>
  );
}

// ── 依週次 ──────────────────────────────────────────────────────────────────

function WeekTable({ view }: { view: RosterView }) {
  return (
    <StickyTable className="w-full">
      <thead>
        <tr>
          <th className={`${HEAD_CELL} px-4 py-2 text-left`}>日期</th>
          {view.roles.map((role) => (
            <th key={role.id} className={`${HEAD_CELL} px-4 py-2 text-left`}>
              {roleName(role)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {view.weeks.map((week, index) => (
          <tr
            key={week.date}
            className={
              week.tagged ? 'bg-communion' : index % 2 === 1 ? 'bg-stripe' : 'bg-white'
            }
          >
            <td className="px-4 py-2 whitespace-nowrap tabular">
              {week.label}
              <span className="ml-1 text-ink-muted">（{week.weekday}）</span>
            </td>
            {week.cells.map((cell) => (
              <td key={cell.roleId} className="px-4 py-2">
                {cell.applicable ? (
                  <span className="flex flex-wrap items-center gap-1">
                    <span>{cell.names.join('、')}</span>
                    {cell.missing > 0 && (
                      <span className="text-alert">缺 {cell.missing} 人</span>
                    )}
                  </span>
                ) : (
                  <span className="text-ink-muted">—</span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </StickyTable>
  );
}

// ── 依人員 ──────────────────────────────────────────────────────────────────

function PersonTable({ view }: { view: RosterView }) {
  return (
    <>
      <StickyTable className="w-full">
        <thead>
          <tr>
            <th className={`${HEAD_CELL} px-4 py-2 text-left whitespace-nowrap`}>姓名</th>
            <th className={`${HEAD_CELL} px-4 py-2 text-right whitespace-nowrap`}>總次數</th>
            {view.roles.map((role) => (
              <th key={role.id} className={`${HEAD_CELL} px-4 py-2 text-left`}>
                {roleName(role)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.people.map((person, index) => (
            <tr
              key={person.memberId}
              className={`${index % 2 === 1 ? 'bg-stripe' : 'bg-white'} ${
                person.total === 0 ? 'text-ink-muted' : ''
              }`}
            >
              <td className="px-4 py-2 whitespace-nowrap">{person.name}</td>
              <td className="px-4 py-2 text-right tabular">{person.total}</td>
              {view.roles.map((role) => {
                const dates = person.byRole.find((item) => item.roleId === role.id)?.dates ?? [];
                return (
                  <td key={role.id} className="px-4 py-2 tabular">
                    {dates.map(formatMd).join('、')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </StickyTable>
      {view.idle > 0 && (
        <p className="mt-3 text-sm text-notice">
          有 {view.idle} 人整個梯次都沒被排到（灰色那幾列）。下載的 Excel 不會列這幾位。
        </p>
      )}
    </>
  );
}

// ── 警告與偏好 ──────────────────────────────────────────────────────────────

function NotesCard({ view }: { view: RosterView }) {
  const [open, setOpen] = useState<string | null>(null);

  if (view.warnings.length === 0 && view.soft.length === 0) {
    return (
      <Card title="警告">
        <p className="text-sm text-ink-muted">沒有排不出來的位置，偏好也都排到了。</p>
      </Card>
    );
  }

  return (
    <Card title="警告" hint="紅色是硬性規則排不出來、橘色是偏好沒排到（班表仍然有效）。">
      <div className="flex flex-col gap-4">
        {view.warnings.length > 0 && (
          <ul className="flex flex-col gap-2 text-sm text-alert">
            {view.warnings.map((note, i) => {
              const key = `${note.date}-${i}`;
              return (
                <li key={key}>
                  <span className="tabular">{note.label}</span>
                  {note.roleName !== '' && ` ${note.roleName}`}：{note.message}
                  {note.blocked.length > 0 && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => setOpen(open === key ? null : key)}
                      >
                        {open === key ? '收起' : '為什麼？'}
                      </button>
                      {open === key && <BlockedTable note={note} />}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {view.soft.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm text-notice">
            {view.soft.map((note, i) => (
              <li key={`${note.date}-${i}`}>
                <span className="tabular">{note.label}</span>
                {note.roleName !== '' && ` ${note.roleName}`}：{note.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** 這一週每一位有資格的人分別卡在哪裡。排得上的人排在最前面（規格 §7.9.4） */
function BlockedTable({ note }: { note: RosterNote }) {
  const rows = [...note.blocked].sort(
    (a, b) => Number(b.servable) - Number(a.servable),
  );
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full border-collapse text-sm text-ink">
        <thead>
          <tr>
            {/* 這張小表格不釘表頭：它在警告列底下展開，sticky 會蓋住自己的前幾列 */}
            <th className="bg-brand px-3 py-1.5 text-left font-medium text-white">有資格的人</th>
            <th className="bg-brand px-3 py-1.5 text-left font-medium text-white">為什麼不能排</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.name}-${i}`} className={i % 2 === 0 ? 'bg-neutral-50' : ''}>
              <td className="whitespace-nowrap px-3 py-1.5">{row.name}</td>
              <td className={`px-3 py-1.5 ${row.servable ? 'text-notice' : 'text-ink-muted'}`}>
                {row.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 公平性 ──────────────────────────────────────────────────────────────────

function FairnessCard({ view }: { view: RosterView }) {
  return (
    <Card
      title="公平性"
      hint="每個位置的次數差距，以及每個人每個月被排了幾次。這是呈現實際分佈，不是規則。"
    >
      <div className="flex flex-col gap-6">
        <StickyTable className="w-full">
          <thead>
            <tr>
              <th className={`${HEAD_CELL} px-4 py-2 text-left`}>位置</th>
              <th className={`${HEAD_CELL} px-4 py-2 text-right`}>可擔任</th>
              <th className={`${HEAD_CELL} px-4 py-2 text-right`}>總次數</th>
              <th className={`${HEAD_CELL} px-4 py-2 text-right`}>最少</th>
              <th className={`${HEAD_CELL} px-4 py-2 text-right`}>最多</th>
              <th className={`${HEAD_CELL} px-4 py-2 text-right`}>差距</th>
            </tr>
          </thead>
          <tbody>
            {view.spread.map((role, index) => (
              <tr key={role.roleId} className={index % 2 === 1 ? 'bg-stripe' : 'bg-white'}>
                <td className="px-4 py-2">{role.name}</td>
                <td className="px-4 py-2 text-right tabular">{role.people}</td>
                <td className="px-4 py-2 text-right tabular">{role.total}</td>
                <td className="px-4 py-2 text-right tabular">{role.min}</td>
                <td className="px-4 py-2 text-right tabular">{role.max}</td>
                <td
                  className={`px-4 py-2 text-right tabular ${
                    role.max - role.min >= 3 ? 'text-notice' : ''
                  }`}
                >
                  {role.max - role.min}
                </td>
              </tr>
            ))}
          </tbody>
        </StickyTable>

        <StickyTable className="w-full">
          <thead>
            <tr>
              <th className={`${HEAD_CELL} px-4 py-2 text-left`}>姓名</th>
              {view.months.map((month) => (
                <th key={month} className={`${HEAD_CELL} px-4 py-2 text-right`}>
                  {month.slice(5)} 月
                </th>
              ))}
              <th className={`${HEAD_CELL} px-4 py-2 text-right`}>合計</th>
            </tr>
          </thead>
          <tbody>
            {view.monthly.map((row, index) => (
              <tr
                key={row.memberId}
                className={`${index % 2 === 1 ? 'bg-stripe' : 'bg-white'} ${
                  row.total === 0 ? 'text-ink-muted' : ''
                }`}
              >
                <td className="px-4 py-2 whitespace-nowrap">{row.name}</td>
                {row.counts.map((count, i) => (
                  <td key={view.months[i]} className="px-4 py-2 text-right tabular">
                    {count}
                  </td>
                ))}
                <td className="px-4 py-2 text-right font-medium tabular">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </StickyTable>
      </div>
    </Card>
  );
}
