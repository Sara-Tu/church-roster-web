/** header 的匯出 / 匯入。規格 §8、§7.6.5 */

import { useRef, useState } from 'react';
import type { Project } from '../engine';
import { downloadText } from '../io/download';
import { projectFilename, readProject, serializeProject, summarize } from '../io/projectFile';
import { isBasic } from '../domain/constraints';
import { browserStorage, readBackup } from '../store/persist';
import { today, useAppStore } from '../store/project';
import { Button } from './parts';

const HEADER_BUTTON =
  'rounded-lg border border-white/40 px-3 py-1.5 transition-colors hover:bg-white/10';

export function ImportExport() {
  const project = useAppStore((state) => state.project);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={HEADER_BUTTON} onClick={() => setOpen(true)}>
        匯入
      </button>
      <button
        type="button"
        className={HEADER_BUTTON}
        onClick={() => {
          const date = today();
          downloadText(projectFilename(project, date), serializeProject(project, date));
        }}
      >
        匯出
      </button>
      {open && <ImportPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function ImportPanel({ onClose }: { onClose: () => void }) {
  const loadProject = useAppStore((state) => state.loadProject);
  const backupKey = useAppStore((state) => state.storage.backupKey);
  const fileInput = useRef<HTMLInputElement>(null);

  const [errors, setErrors] = useState<string[]>([]);
  const [incoming, setIncoming] = useState<Project | null>(null);
  const [filename, setFilename] = useState('');
  const [dragging, setDragging] = useState(false);

  const read = async (file: File) => {
    setFilename(file.name);
    const result = readProject(await file.text());
    if (result.ok) {
      setIncoming(result.project);
      setErrors([]);
    } else {
      setIncoming(null);
      setErrors(result.errors);
    }
  };

  const summary = incoming === null ? null : summarize(incoming);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-6">
      <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-base font-bold">匯入專案檔</h3>
        <p className="mt-1 text-sm text-ink-muted">
          選一個之前匯出的 JSON 檔。匯入會蓋掉目前在這台裝置上的資料，建議先按「匯出」留一份。
        </p>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file !== undefined) void read(file);
          }}
          className={`mt-4 rounded-lg border border-dashed px-4 py-8 text-center text-sm ${
            dragging ? 'border-brand bg-brand-light/10 text-ink' : 'border-neutral-300 text-ink-muted'
          }`}
        >
          把檔案拖到這裡，或
          <button
            type="button"
            className="mx-1 text-brand underline"
            onClick={() => fileInput.current?.click()}
          >
            選擇檔案
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void read(file);
            }}
          />
          {filename !== '' && <p className="mt-2 text-xs">{filename}</p>}
        </div>

        {errors.length > 0 && (
          <div className="mt-4">
            <p className="text-sm text-alert">這個檔案讀不進來：</p>
            <ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-auto text-xs text-alert">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {summary !== null && (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-stripe px-4 py-3 text-sm">
            <dt className="text-ink-muted">梯次</dt>
            <dd>{summary.term}</dd>
            <dt className="text-ink-muted">聚會日</dt>
            <dd className="tabular">
              {summary.weeks} 週（{summary.tagged} 週{summary.tagLabel}）
            </dd>
            <dt className="text-ink-muted">服事位置</dt>
            <dd className="tabular">{summary.roles} 個</dd>
            <dt className="text-ink-muted">人員</dt>
            <dd className="tabular">{summary.members} 人</dd>
            <dt className="text-ink-muted">不行日期</dt>
            <dd className="tabular">{summary.unavailable} 筆</dd>
            <dt className="text-ink-muted">限制條件</dt>
            <dd className="tabular">{summary.constraints} 條</dd>
          </dl>
        )}

        {incoming !== null && !incoming.constraints.some((item) => isBasic(item.type)) && (
          <p className="mt-2 text-xs text-ink-muted">
            這份檔案沒有「每人每週只排一個位置」這條基本規則，匯入後會自動補上。
          </p>
        )}

        {backupKey !== null && (
          <div className="mt-4 rounded-lg border border-notice/40 px-4 py-3 text-sm">
            <p className="text-notice">這台瀏覽器裡有一份讀不回來的舊存檔，已經改名保留著。</p>
            <div className="mt-2">
              <Button
                onClick={() => {
                  const raw = readBackup(browserStorage(), backupKey);
                  if (raw !== null) downloadText(`church-roster-backup_${today()}.json`, raw);
                }}
              >
                下載備份
              </Button>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            tone="primary"
            disabled={incoming === null}
            onClick={() => {
              if (incoming === null) return;
              loadProject(incoming);
              onClose();
            }}
          >
            覆蓋現在的資料
          </Button>
        </div>
      </div>
    </div>
  );
}
