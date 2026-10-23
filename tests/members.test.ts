/** 步驟 3 的姓名解析。規格 §7.5.6、§7.5.9 */

import { describe, expect, it } from 'vitest';
import { duplicateNames, parseNameList, toggleRole } from '../src/domain/members';
import { member } from './helpers';

describe('parseNameList', () => {
  it('七種分隔符都切得開', () => {
    const input = '甲\n乙,丙，丁、戊;己；庚\t辛';
    expect(parseNameList(input).names).toEqual(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛']);
  });

  it('不以空白分隔，英文姓名保持完整', () => {
    expect(parseNameList('Mary Chen\nJohn Wu').names).toEqual(['Mary Chen', 'John Wu']);
  });

  it('去掉開頭的編號與項目符號', () => {
    const input = '1. 甲\n2) 乙\n3.丙\n- 丁\n・戊\n• 己';
    expect(parseNameList(input).names).toEqual(['甲', '乙', '丙', '丁', '戊', '己']);
  });

  it('去掉前後空白與空白項', () => {
    expect(parseNameList('  甲  \n\n\n  ,  , 乙').names).toEqual(['甲', '乙']);
  });

  it('與現有名單重複的略過並回報筆數', () => {
    const parsed = parseNameList('甲\n乙\n丙', ['乙']);
    expect(parsed.names).toEqual(['甲', '丙']);
    expect(parsed.skipped).toBe(1);
  });

  it('貼上內容自己重複也只留一個', () => {
    const parsed = parseNameList('甲\n甲\n甲');
    expect(parsed.names).toEqual(['甲']);
    expect(parsed.skipped).toBe(2);
  });

  it('空字串回傳空結果', () => {
    expect(parseNameList('   ')).toEqual({ names: [], skipped: 0 });
  });
});

describe('duplicateNames', () => {
  it('只列出真的重複的，忽略空白姓名', () => {
    const items = [{ name: '甲' }, { name: '甲' }, { name: '乙' }, { name: '  ' }, { name: '' }];
    expect(duplicateNames(items)).toEqual(['甲']);
  });
});

describe('toggleRole', () => {
  it('勾與不勾', () => {
    const m = member('m1', ['r1']);
    expect(toggleRole(m, 'r2', true).roles).toEqual(['r1', 'r2']);
    expect(toggleRole(m, 'r1', false).roles).toEqual([]);
  });

  it('狀態沒變就回原物件', () => {
    const m = member('m1', ['r1']);
    expect(toggleRole(m, 'r1', true)).toBe(m);
    expect(toggleRole(m, 'r2', false)).toBe(m);
  });
});
