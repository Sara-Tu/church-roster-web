/** 瀏覽器端下載。Phase 4 的 Excel / CSV 也走這裡。規格 §7.6.5 */

export function downloadText(
  filename: string,
  text: string,
  mime = 'application/json;charset=utf-8',
): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 立刻釋放會讓部分瀏覽器來不及開始下載，排到下一輪事件迴圈
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function readTextFile(file: File): Promise<string> {
  return file.text();
}
