/** 步驟 1 的純函式：產生聚會日、特殊週規則。規格 §7.5.4、§7.5.9 */

import { describe, expect, it } from 'vitest';
import {
  applyNthMeetingRule,
  countTagged,
  expectedTagged,
  generateMeetingDates,
  insertMeetingDate,
  LAST_MEETING,
  ruleDeviationCount,
  toWeeks,
} from '../src/domain/term';

const TERM = generateMeetingDates('2027-01-03', '2027-06-27', 0);

describe('generateMeetingDates', () => {
  it('驗收用的梯次剛好 26 週', () => {
    expect(TERM).toHaveLength(26);
    expect(TERM[0]).toBe('2027-01-03');
    expect(TERM[25]).toBe('2027-06-27');
  });

  it('起始日剛好是聚會日就從那天算起', () => {
    expect(generateMeetingDates('2027-01-03', '2027-01-17', 0)).toEqual([
      '2027-01-03',
      '2027-01-10',
      '2027-01-17',
    ]);
  });

  it('起始日不是聚會日就往後找第一個', () => {
    // 2027-01-01 是星期五
    expect(generateMeetingDates('2027-01-01', '2027-01-17', 0)[0]).toBe('2027-01-03');
  });

  it('結束日落在聚會日當天要含進去', () => {
    const dates = generateMeetingDates('2027-01-03', '2027-01-10', 0);
    expect(dates[dates.length - 1]).toBe('2027-01-10');
  });

  it('結束日差一天就不含', () => {
    expect(generateMeetingDates('2027-01-03', '2027-01-09', 0)).toEqual(['2027-01-03']);
  });

  it('改成星期三', () => {
    expect(generateMeetingDates('2027-01-01', '2027-01-20', 3)).toEqual([
      '2027-01-06',
      '2027-01-13',
      '2027-01-20',
    ]);
  });

  it('結束日早於起始日回傳空陣列', () => {
    expect(generateMeetingDates('2027-06-27', '2027-01-03', 0)).toEqual([]);
  });

  it('日期不合法回傳空陣列', () => {
    expect(generateMeetingDates('', '2027-06-27', 0)).toEqual([]);
    expect(generateMeetingDates('2027-02-30', '2027-06-27', 0)).toEqual([]);
    expect(generateMeetingDates('2027/01/03', '2027-06-27', 0)).toEqual([]);
  });
});

describe('applyNthMeetingRule', () => {
  const weeks = toWeeks(TERM);

  it('每月第一次聚會：6 週', () => {
    const { weeks: tagged, gaps } = applyNthMeetingRule(weeks, 'communion', 1);
    expect(gaps).toEqual([]);
    expect(tagged.filter((week) => week.tags.includes('communion')).map((w) => w.date)).toEqual([
      '2027-01-03',
      '2027-02-07',
      '2027-03-07',
      '2027-04-04',
      '2027-05-02',
      '2027-06-06',
    ]);
  });

  it('每月最後一次聚會', () => {
    const { weeks: tagged } = applyNthMeetingRule(weeks, 'communion', LAST_MEETING);
    expect(tagged.filter((week) => week.tags.includes('communion')).map((w) => w.date)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-28',
      '2027-04-25',
      '2027-05-30',
      '2027-06-27',
    ]);
  });

  it('某月聚會次數不足 N 時列進 gaps 且該月沒有特殊週', () => {
    const { weeks: tagged, gaps } = applyNthMeetingRule(weeks, 'communion', 5);
    // 2027 年上半年只有 1 月與 5 月有五次聚會
    expect(gaps).toEqual(['2027-02', '2027-03', '2027-04', '2027-06']);
    expect(tagged.filter((week) => week.tags.includes('communion')).map((w) => w.date)).toEqual([
      '2027-01-31',
      '2027-05-30',
    ]);
  });

  it('是全部覆蓋而不是疊加', () => {
    const manual = weeks.map((week) =>
      week.date === '2027-01-10' ? { ...week, tags: ['communion'] } : week,
    );
    const { weeks: tagged } = applyNthMeetingRule(manual, 'communion', 1);
    expect(countTagged(tagged, 'communion')).toBe(6);
    expect(tagged.find((week) => week.date === '2027-01-10')?.tags).toEqual([]);
  });

  it('不動其他標籤', () => {
    const withOther = weeks.map((week) =>
      week.date === '2027-01-10' ? { ...week, tags: ['special'] } : week,
    );
    const { weeks: tagged } = applyNthMeetingRule(withOther, 'communion', 1);
    expect(tagged.find((week) => week.date === '2027-01-10')?.tags).toEqual(['special']);
  });

  it('沒有任何聚會日時不會爆', () => {
    expect(applyNthMeetingRule([], 'communion', 1)).toEqual({ weeks: [], gaps: [] });
  });
});

describe('expectedTagged 與 ruleDeviationCount', () => {
  it('手動改過幾週就回報幾週', () => {
    const { weeks: tagged } = applyNthMeetingRule(toWeeks(TERM), 'communion', 1);
    expect(ruleDeviationCount(tagged, 'communion', 1)).toBe(0);

    const edited = tagged.map((week) => {
      if (week.date === '2027-01-03') return { ...week, tags: [] };
      if (week.date === '2027-01-17') return { ...week, tags: ['communion'] };
      return week;
    });
    expect(ruleDeviationCount(edited, 'communion', 1)).toBe(2);
  });

  it('換一個 N 之後的偏離數是兩組的對稱差', () => {
    const { weeks: tagged } = applyNthMeetingRule(toWeeks(TERM), 'communion', 1);
    expect(ruleDeviationCount(tagged, 'communion', 2)).toBe(12);
  });

  it('expectedTagged 依 YYYY-MM 分組，跨年不會混在一起', () => {
    const weeks = toWeeks(['2026-12-06', '2026-12-13', '2027-01-03']);
    const { dates } = expectedTagged(weeks, 1);
    expect([...dates]).toEqual(['2026-12-06', '2027-01-03']);
  });
});

describe('insertMeetingDate', () => {
  const weeks = toWeeks(['2027-01-03', '2027-01-17']);

  it('插在正確的位置維持遞增', () => {
    expect(insertMeetingDate(weeks, '2027-01-10')?.map((w) => w.date)).toEqual([
      '2027-01-03',
      '2027-01-10',
      '2027-01-17',
    ]);
  });

  it('重複日期擋下來', () => {
    expect(insertMeetingDate(weeks, '2027-01-17')).toBeNull();
  });

  it('不合法日期擋下來', () => {
    expect(insertMeetingDate(weeks, '2027-01-32')).toBeNull();
    expect(insertMeetingDate(weeks, '')).toBeNull();
  });
});
