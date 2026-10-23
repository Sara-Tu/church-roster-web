/** 匯出與匯入 JSON 專案檔。規格 §8、§7.6.5、§7.6.7 */

import { describe, expect, it } from 'vitest';
import {
  projectFilename,
  readProject,
  serializeProject,
  summarize,
} from '../src/io/projectFile';
import { APP_VERSION } from '../src/version';
import type { Project } from '../src/engine';
import projectJson from './fixtures/sample-project.json';

const fixture = projectJson as unknown as Project;

function reload(project: Project): Project {
  const result = readProject(serializeProject(project, '2026-10-23'));
  if (!result.ok) throw new Error(`預期讀得進來，卻得到：${result.errors.join('；')}`);
  return result.project;
}

function broken(patch: (value: Record<string, unknown>) => void): string[] {
  const value = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
  patch(value);
  const result = readProject(JSON.stringify(value));
  if (result.ok) throw new Error('預期讀不進來，卻成功了');
  return result.errors;
}

describe('匯出再匯入', () => {
  it('28 人、21 條規則、65 筆不行日期原封不動回來', () => {
    expect(reload(fixture)).toEqual({
      ...fixture,
      appVersion: APP_VERSION,
      exportedAt: '2026-10-23',
    });
  });

  it('匯出的內容是排版過的 JSON，結尾有換行', () => {
    const text = serializeProject(fixture, '2026-10-23');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "schemaVersion": 1');
  });

  it('檔名用梯次名稱，空白或有不能當檔名的字元時換掉', () => {
    expect(projectFilename(fixture, '2026-10-23')).toBe('church-roster_測試梯次-2026H2.json');
    expect(projectFilename({ ...fixture, term: { ...fixture.term, name: '' } }, '2026-10-23')).toBe(
      'church-roster_2026-10-23.json',
    );
    expect(
      projectFilename({ ...fixture, term: { ...fixture.term, name: '2027 上/下' } }, '2026-10-23'),
    ).toBe('church-roster_2027-上-下.json');
  });
});

describe('摘要', () => {
  it('給匯入面板看的數字', () => {
    expect(summarize(fixture)).toEqual({
      term: '測試梯次 2026H2',
      weeks: 26,
      tagged: 6,
      tagLabel: '聖餐週',
      roles: 5,
      members: 28,
      constraints: 21,
      unavailable: 65,
    });
  });
});

describe('擋得住壞檔案', () => {
  it('不是 JSON、最外層不是物件', () => {
    const notJson = readProject('{');
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.errors[0]).toContain('不是合法的 JSON');

    const notObject = readProject('[]');
    expect(notObject.ok).toBe(false);
    if (!notObject.ok) expect(notObject.errors[0]).toContain('不是一個物件');
  });

  it('schemaVersion 不符時說清楚是哪一版', () => {
    expect(broken((value) => (value.schemaVersion = 2))[0]).toContain('schemaVersion 是 2');
    expect(broken((value) => delete value.schemaVersion)[0]).toContain('（沒有）');
  });

  it('term、roles、members 的結構壞掉', () => {
    expect(broken((value) => (value.term = 'x'))).toContain('term 不是一個物件');
    expect(broken((value) => (value.roles = {}))).toContain('roles 不是陣列');
    expect(broken((value) => (value.members = [{ id: 'm1' }]))).toContain('members[0].name 要是字串');
    expect(
      broken((value) => ((value.term as Record<string, unknown>).weeks = [{ date: 1, tags: [] }])),
    ).toContain('term.weeks[0].date 要是字串');
  });

  it('限制條件壞掉時帶上第幾條', () => {
    const errors = broken((value) => {
      const constraints = value.constraints as Record<string, unknown>[];
      constraints[4].max = '1';
    });
    expect(errors).toContain('第 5 條限制條件：max 要是整數');
  });

  it('id 參照對不上（引擎的驗證）', () => {
    const errors = broken((value) => {
      const members = value.members as Record<string, unknown>[];
      members[0].roles = ['r9'];
    });
    expect(errors.some((error) => error.includes('r9'))).toBe(true);
  });

  it('聚會日沒有遞增', () => {
    const errors = broken((value) => {
      const term = value.term as Record<string, unknown>;
      term.weeks = [
        { date: '2026-07-12', tags: [] },
        { date: '2026-07-05', tags: [] },
      ];
    });
    expect(errors.some((error) => error.includes('遞增'))).toBe(true);
  });

  it('壞掉的檔案不會部分套用：回傳的是錯誤清單，不是半份專案', () => {
    const result = readProject('{"schemaVersion":1}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(1);
  });
});

describe('寬容的地方', () => {
  it('沒有 church、revision、appVersion 也讀得進來', () => {
    const value = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    delete value.church;
    delete value.revision;
    delete value.appVersion;
    const result = readProject(JSON.stringify(value));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.church).toEqual({ name: '', note: '' });
      expect(result.project.revision).toBe(0);
    }
  });

  it('不行日期沒排序的檔案，讀進來會排好', () => {
    const value = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    const members = value.members as Record<string, unknown>[];
    members[0].unavailable = ['2026-08-02', '2026-07-05'];
    const result = readProject(JSON.stringify(value));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project.members[0].unavailable).toEqual(['2026-07-05', '2026-08-02']);
  });
});
