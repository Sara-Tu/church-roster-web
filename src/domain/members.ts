/** 人員（步驟 3）的純函式。規格 §7.5.6。 */

import type { Member } from '../engine';

/** 換行、逗號（半形與全形）、頓號、分號（半形與全形）、tab。不含空白：英文姓名有空白 */
const SEPARATORS = /[\n\r,，、;；\t]+/;

/** 從 LINE 複製過來常見的開頭：編號與項目符號 */
const LEADING_BULLET = /^(\d+\s*[.)]|[-*・•])\s*/;

export interface ParsedNames {
  /** 可以新增的姓名，已去重、依出現順序 */
  names: string[];
  /** 與現有名單或貼上內容本身重複而略過的筆數 */
  skipped: number;
}

export function parseNameList(input: string, existing: readonly string[] = []): ParsedNames {
  const seen = new Set(existing.map((name) => name.trim()));
  const names: string[] = [];
  let skipped = 0;

  for (const piece of input.split(SEPARATORS)) {
    const name = piece.trim().replace(LEADING_BULLET, '').trim();
    if (name === '') continue;
    if (seen.has(name)) {
      skipped += 1;
      continue;
    }
    seen.add(name);
    names.push(name);
  }

  return { names, skipped };
}

export function duplicateNames(items: readonly { name: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = item.name.trim();
    if (name === '') continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

export function toggleRole(member: Member, roleId: string, on: boolean): Member {
  if (on === member.roles.includes(roleId)) return member;
  return {
    ...member,
    roles: on ? [...member.roles, roleId] : member.roles.filter((id) => id !== roleId),
  };
}
