/** 步驟 1：梯次。規格 §7.2 步驟 1、§7.5.4 */

import { useState } from 'react';
import { weekdayOf } from '../engine';
import {
  countTagged,
  LAST_MEETING,
  ruleDeviationCount,
  WEEKDAY_LABELS,
} from '../domain/term';
import { useAppStore } from '../store/project';
import { Button, Card, ConfirmDialog, Empty, Field, IconButton, INPUT_CLASS } from './parts';

const RULE_OPTIONS = [
  { value: '', label: '不設定（自己逐週勾）' },
  { value: '1', label: '每月第一次聚會' },
  { value: '2', label: '每月第二次聚會' },
  { value: '3', label: '每月第三次聚會' },
  { value: '4', label: '每月第四次聚會' },
  { value: '5', label: '每月第五次聚會' },
  { value: String(LAST_MEETING), label: '每月最後一次聚會' },
];

export function StepTerm() {
  const project = useAppStore((state) => state.project);
  const weekday = useAppStore((state) => state.ui.meetingWeekday);
  const store = useAppStore();

  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [gaps, setGaps] = useState<string[]>([]);
  const [newDate, setNewDate] = useState('');
  const [addError, setAddError] = useState('');

  const tag = project.weekTags[0];
  const weeks = project.term.weeks;
  const rule = tag?.rule;
  const ruleN = rule?.kind === 'nthMeetingOfMonth' ? rule.n : null;
  const tagged = tag === undefined ? 0 : countTagged(weeks, tag.id);
  const deviations =
    tag === undefined || ruleN === null ? 0 : ruleDeviationCount(weeks, tag.id, ruleN);

  const generate = () => {
    setConfirmGenerate(false);
    store.generateWeeks();
    setGaps([]);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card title="基本資料">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="教會名稱" hint="會印在下載的班表上，可以空白">
            <input
              className={INPUT_CLASS}
              value={project.church.name}
              onChange={(event) => store.setChurchName(event.target.value)}
              placeholder="例：恩典教會"
            />
          </Field>
          <Field label="梯次名稱" hint="會用在下載的檔名">
            <input
              className={INPUT_CLASS}
              value={project.term.name}
              onChange={(event) => store.setTermName(event.target.value)}
              placeholder="例：2027 上半年"
            />
          </Field>
        </div>
      </Card>

      <Card
        title="聚會日"
        hint="填起訖日期與固定的聚會星期，按下按鈕一次把整個梯次的聚會日排出來。"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="起始日">
            <input
              type="date"
              className={INPUT_CLASS}
              value={project.term.start}
              onChange={(event) => store.setTermStart(event.target.value)}
            />
          </Field>
          <Field label="結束日">
            <input
              type="date"
              className={INPUT_CLASS}
              value={project.term.end}
              onChange={(event) => store.setTermEnd(event.target.value)}
            />
          </Field>
          <Field label="聚會星期">
            <select
              className={INPUT_CLASS}
              value={weekday}
              onChange={(event) => store.setMeetingWeekday(Number(event.target.value))}
            >
              {WEEKDAY_LABELS.map((label, value) => (
                <option key={label} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            tone="primary"
            disabled={project.term.start === '' || project.term.end === ''}
            onClick={() => (weeks.length > 0 ? setConfirmGenerate(true) : generate())}
          >
            產生聚會日
          </Button>
          {weeks.length > 0 && (
            <span className="text-sm text-ink-muted">
              產生了 {weeks.length} 週
              {tag !== undefined && `，其中 ${tagged} 週是${tag.label}`}
            </span>
          )}
        </div>
      </Card>

      {tag !== undefined && (
        <Card
          title={tag.label}
          hint="以「當月第幾次聚會」計算，聚會日不是星期日的教會也算得對。"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="名稱">
              <input
                className={INPUT_CLASS}
                value={tag.label}
                onChange={(event) => store.setTagLabel(event.target.value)}
              />
            </Field>
            <Field label="規則">
              <select
                className={INPUT_CLASS}
                value={ruleN === null ? '' : String(ruleN)}
                onChange={(event) =>
                  store.setTagRule(event.target.value === '' ? null : Number(event.target.value))
                }
              >
                {RULE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              disabled={ruleN === null || weeks.length === 0}
              onClick={() => setGaps(store.applyTagRule())}
            >
              套用到所有週次
            </Button>
            {ruleN !== null && deviations > 0 && (
              <span className="text-sm text-notice">
                會覆蓋你手動改過的 {deviations} 週
              </span>
            )}
          </div>

          {gaps.length > 0 && (
            <p className="mt-3 text-sm text-notice">
              {gaps.join('、')} 的聚會次數不足，這幾個月沒有{tag.label}。
            </p>
          )}
        </Card>
      )}

      <Card
        title="逐週確認"
        hint="停聚會或加特別聚會時，在這裡增減；勾選欄可以單獨覆寫某一週。"
      >
        {weeks.length === 0 ? (
          <Empty>還沒有聚會日。填好上面的起訖日期後按「產生聚會日」。</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-brand text-left text-white">
                <tr>
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">日期</th>
                  <th className="px-4 py-2 font-medium">{tag?.label ?? '特殊週'}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, i) => {
                  const marked = tag !== undefined && week.tags.includes(tag.id);
                  return (
                    <tr
                      key={week.date}
                      className={marked ? 'bg-communion' : i % 2 === 1 ? 'bg-stripe' : ''}
                    >
                      <td className="px-4 py-2 tabular text-ink-muted">{i + 1}</td>
                      <td className="px-4 py-2 tabular">
                        {week.date}（{WEEKDAY_LABELS[weekdayOf(week.date)].slice(2)}）
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={marked}
                          disabled={tag === undefined}
                          onChange={() => store.toggleWeekTag(week.date)}
                          aria-label={`${week.date} 是否為${tag?.label ?? '特殊週'}`}
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <IconButton
                          label={`刪除 ${week.date} 這次聚會`}
                          onClick={() => store.removeWeek(week.date)}
                        >
                          刪除
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="補登一次聚會">
            <input
              type="date"
              className={INPUT_CLASS}
              value={newDate}
              onChange={(event) => {
                setNewDate(event.target.value);
                setAddError('');
              }}
            />
          </Field>
          <Button
            disabled={newDate === ''}
            onClick={() => {
              if (store.addWeek(newDate)) {
                setNewDate('');
                setAddError('');
              } else {
                setAddError('這一天已經在清單裡了');
              }
            }}
          >
            加入
          </Button>
          {addError !== '' && <span className="pb-2 text-sm text-alert">{addError}</span>}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmGenerate}
        title="重新產生聚會日"
        body={
          <>
            目前有 {weeks.length} 週。重新產生會整組重建
            {deviations > 0 && `，你手動改過的 ${deviations} 週會被覆蓋`}。
          </>
        }
        confirmLabel="重新產生"
        onConfirm={generate}
        onCancel={() => setConfirmGenerate(false)}
      />
    </div>
  );
}
