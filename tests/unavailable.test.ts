/** 步驟 4 的純函式：AI prompt、解析 AI 回傳、每週人力。規格 §7.6.3、§7.6.7 */

import { describe, expect, it } from 'vitest';
import {
  buildAiPrompt,
  mergeDates,
  parseUnavailable,
  staleDates,
  toggleDate,
  weekLoad,
} from '../src/domain/unavailable';
import { makeProject, member, role, weekDate, weeks } from './helpers';

function project(options: { members?: ReturnType<typeof member>[] } = {}) {
  return makeProject({
    roles: [role('r1'), role('r2', { perWeek: 2 }), role('r3', { tagId: 'communion' })],
    members:
      options.members ??
      [member('m1', ['r1', 'r2']), member('m2', ['r2']), member('m3', ['r2', 'r3'])],
    weeks: weeks(4, '2026-01-04', []),
  });
}

/** weeks(4) 的日期：2026-01-04、01-11、01-18、01-25 */
const D0 = weekDate(0);
const D1 = weekDate(1);
const D2 = weekDate(2);

describe('buildAiPrompt', () => {
  const prompt = buildAiPrompt(project());

  it('含所有人名與所有聚會日', () => {
    expect(prompt).toContain('m1、m2、m3');
    for (const date of [D0, D1, D2, weekDate(3)]) expect(prompt).toContain(date);
  });

  it('要求只用名單內的姓名與清單內的日期', () => {
    expect(prompt).toContain('清單裡沒有的人不要自己加');
    expect(prompt).toContain('不是聚會日的日期不要輸出');
  });

  it('要求不確定就寫 unsure 不要猜，而且只輸出 JSON', () => {
    expect(prompt).toContain('unsure');
    expect(prompt).toContain('不要猜');
    expect(prompt).toContain('只輸出 JSON');
  });

  it('沒填姓名的人不會變成空白項目', () => {
    const prompt2 = buildAiPrompt(project({ members: [member('m1', []), { ...member('m2', []), name: '' }] }));
    expect(prompt2).toContain('m1');
    expect(prompt2).not.toContain('m1、');
  });
});

describe('parseUnavailable', () => {
  it('吃 {"unavailable":[…]}', () => {
    const parsed = parseUnavailable(`{"unavailable":[{"name":"m1","dates":["${D0}"]}]}`, project());
    expect(parsed.error).toBeNull();
    expect(parsed.entries).toEqual([{ memberId: 'm1', name: 'm1', dates: [D0] }]);
  });

  it('也吃最外層就是陣列，以及包在程式碼區塊裡的', () => {
    const inArray = parseUnavailable(`[{"name":"m2","dates":["${D1}"]}]`, project());
    expect(inArray.entries).toHaveLength(1);

    const fenced = parseUnavailable(
      '```json\n{"unavailable":[{"name":"m2","dates":[]}]}\n```',
      project(),
    );
    expect(fenced.error).toBeNull();
    expect(fenced.entries).toHaveLength(1);
  });

  it('不是 JSON、或裡面沒有清單時給看得懂的訊息', () => {
    expect(parseUnavailable('好的，我幫你整理好了', project()).error).toContain('不是合法的 JSON');
    expect(parseUnavailable('{"people":[]}', project()).error).toContain('unavailable');
    expect(parseUnavailable('   ', project()).error).toContain('還沒貼上');
    expect(parseUnavailable('{"unavailable":[]}', project()).error).toContain('是空的');
  });

  it('名單裡沒有的姓名列出來，不套用', () => {
    const parsed = parseUnavailable(`{"unavailable":[{"name":"路人","dates":["${D0}"]}]}`, project());
    expect(parsed.unknownNames).toEqual(['路人']);
    expect(parsed.entries).toEqual([]);
  });

  it('同名兩個人時不猜是誰', () => {
    const twins = project({
      members: [
        { ...member('m1', ['r1']), name: '小明' },
        { ...member('m2', ['r1']), name: '小明' },
      ],
    });
    const parsed = parseUnavailable(`{"unavailable":[{"name":"小明","dates":["${D0}"]}]}`, twins);
    expect(parsed.ambiguousNames).toEqual(['小明']);
    expect(parsed.entries).toEqual([]);
  });

  it('不是聚會日、格式不對的日期列進 badDates', () => {
    const parsed = parseUnavailable(
      `{"unavailable":[{"name":"m1","dates":["2026-01-05","下週日","${D0}"]}]}`,
      project(),
    );
    expect(parsed.badDates).toEqual(['2026-01-05', '下週日']);
    expect(parsed.entries[0].dates).toEqual([D0]);
  });

  it('日期去重並排序', () => {
    const parsed = parseUnavailable(
      `{"unavailable":[{"name":"m1","dates":["${D2}","${D0}","${D0}"]}]}`,
      project(),
    );
    expect(parsed.entries[0].dates).toEqual([D0, D2]);
  });

  it('帶出 AI 自己標的 unsure，dates 空的也留著', () => {
    const parsed = parseUnavailable(
      '{"unavailable":[{"name":"m1","dates":[],"unsure":"只說月底可能不行"}]}',
      project(),
    );
    expect(parsed.entries[0]).toEqual({
      memberId: 'm1',
      name: 'm1',
      dates: [],
      unsure: '只說月底可能不行',
    });
  });

  it('同一個人出現兩次只採第一筆', () => {
    const parsed = parseUnavailable(
      `{"unavailable":[{"name":"m1","dates":["${D0}"]},{"name":"m1","dates":["${D1}"]}]}`,
      project(),
    );
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].dates).toEqual([D0]);
  });

  it('姓名的空白與英文大小寫一視同仁', () => {
    const english = project({ members: [{ ...member('m1', ['r1']), name: 'Amy Chen' }] });
    const parsed = parseUnavailable(`{"unavailable":[{"name":"amychen","dates":["${D0}"]}]}`, english);
    expect(parsed.entries[0].memberId).toBe('m1');
  });

  it('dates 不是陣列就當成沒填，不丟例外', () => {
    const parsed = parseUnavailable('{"unavailable":[{"name":"m1","dates":"下週"}]}', project());
    expect(parsed.entries[0].dates).toEqual([]);
  });
});

describe('mergeDates / toggleDate', () => {
  it('replace 直接換掉，add 併進去並排序去重', () => {
    expect(mergeDates([D0, D1], [D2], 'replace')).toEqual([D2]);
    expect(mergeDates([D1], [D2, D0, D1], 'add')).toEqual([D0, D1, D2]);
  });

  it('toggleDate 加上與移除都維持排序', () => {
    expect(toggleDate([D2], D0, true)).toEqual([D0, D2]);
    expect(toggleDate([D0, D2], D2, false)).toEqual([D0]);
    expect(toggleDate([D0], D0, true)).toEqual([D0]);
  });
});

describe('weekLoad', () => {
  it('算出每週幾人不行', () => {
    const loads = weekLoad(
      project({
        members: [member('m1', ['r1'], [D0]), member('m2', ['r1'], [D0, D1])],
      }),
    );
    expect(loads.map((load) => load.absent)).toEqual([2, 1, 0, 0]);
  });

  it('扣掉不行的人之後人數不足就列成 shortage', () => {
    const loads = weekLoad(
      project({ members: [member('m1', ['r1', 'r2'], [D0]), member('m2', ['r2'])] }),
    );
    expect(loads[0].shortages).toEqual([
      { roleId: 'r1', roleName: 'r1', available: 0, needed: 1 },
      { roleId: 'r2', roleName: 'r2', available: 1, needed: 2 },
    ]);
    expect(loads[1].shortages).toEqual([]);
  });

  it('只在特殊週出現的位置，只在那一週計算', () => {
    const base = makeProject({
      roles: [role('r3', { tagId: 'communion' })],
      members: [member('m1', [])],
      weeks: [
        { date: D0, tags: ['communion'] },
        { date: D1, tags: [] },
      ],
    });
    const loads = weekLoad(base);
    expect(loads[0].shortages).toHaveLength(1);
    expect(loads[1].shortages).toHaveLength(0);
  });
});

describe('staleDates', () => {
  it('列出不是本梯次聚會日的日期，依人分組', () => {
    const stale = staleDates(
      project({ members: [member('m1', ['r1'], [D0, '2025-12-25']), member('m2', ['r1'], [D1])] }),
    );
    expect(stale).toEqual([{ memberId: 'm1', name: 'm1', dates: ['2025-12-25'] }]);
  });

  it('還沒有聚會日時不報任何殘留（否則整份都會被當成殘留）', () => {
    const empty = makeProject({
      roles: [role('r1')],
      members: [member('m1', ['r1'], ['2025-12-25'])],
      weeks: [],
    });
    expect(staleDates(empty)).toEqual([]);
  });
});
