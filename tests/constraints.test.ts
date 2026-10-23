/** 步驟 5 的純函式：meta、空白樣板、人話摘要、欄位檢查、進階 JSON。規格 §7.6.4、§7.6.7 */

import { describe, expect, it } from 'vitest';
import {
  blankConstraint,
  CONSTRAINT_META,
  constraintsToJson,
  describeConstraint,
  groupedMeta,
  invalidConstraintCount,
  metaOf,
  parseConstraintsJson,
  validateConstraint,
} from '../src/domain/constraints';
import type { Constraint, ConstraintType, Project } from '../src/engine';
import projectJson from './fixtures/sample-project.json';
import { makeProject, member, role, rule, weeks } from './helpers';

const fixture = projectJson as unknown as Project;

function base(): Project {
  return makeProject({
    roles: [role('r1'), role('r2')],
    members: [
      { ...member('m1', ['r1']), name: '小明' },
      { ...member('m2', ['r2']), name: '小華' },
    ],
    weeks: weeks(4),
  });
}

const ALL_TYPES: ConstraintType[] = CONSTRAINT_META.map((meta) => meta.type);

describe('CONSTRAINT_META', () => {
  it('15 種型別，沒有重複，分成三組', () => {
    expect(ALL_TYPES).toHaveLength(15);
    expect(new Set(ALL_TYPES).size).toBe(15);
    const grouped = groupedMeta();
    expect(grouped.flatMap((entry) => entry.items)).toHaveLength(15);
    expect(grouped.map((entry) => entry.group)).toEqual(['limits', 'pairing', 'rotation']);
  });

  it('輪替、替補、偏好搭配預設是偏好規則，其他是硬性', () => {
    const soft = ALL_TYPES.filter((type) => !metaOf(type).defaultHard);
    expect(soft).toEqual([
      'substitute_priority',
      'preferred_role_combination',
      'rotation_groups',
    ]);
  });

  it('fixture 的 21 條規則都認得，而且 hard 與樣板的預設一致', () => {
    for (const constraint of fixture.constraints) {
      expect(metaOf(constraint.type).defaultHard).toBe(constraint.hard);
    }
  });
});

describe('blankConstraint', () => {
  it('每種型別都做得出來，id 與 enabled 照給的來', () => {
    for (const type of ALL_TYPES) {
      const blank = blankConstraint(type, 'c9');
      expect(blank.type).toBe(type);
      expect(blank.id).toBe('c9');
      expect(blank.enabled).toBe(true);
    }
  });

  it('要選人選位置的型別一開始都標紅，不自動填第一個人', () => {
    const complete: ConstraintType[] = [
      'one_role_per_week',
      'max_total_per_term',
      'max_consecutive_weeks_per_member',
    ];
    for (const type of ALL_TYPES) {
      const issues = validateConstraint(base(), blankConstraint(type, 'c1'));
      if (complete.includes(type)) expect(issues).toEqual([]);
      else expect(issues.length).toBeGreaterThan(0);
    }
  });
});

describe('describeConstraint', () => {
  const project = base();
  const describe_ = (body: Parameters<typeof rule>[0]) =>
    describeConstraint(project, rule(body));

  it('用姓名與位置名稱，不露出 id', () => {
    expect(describe_({ type: 'dual_role_exception', memberId: 'm1', roleIds: ['r1', 'r2'] })).toBe(
      '小明 可以同時擔任 r1＋r2',
    );
    expect(describe_({ type: 'max_per_month', memberId: 'm1', max: 1, roleId: null })).toBe(
      '小明 每月最多 1 次（所有位置合計）',
    );
    expect(describe_({ type: 'max_total_per_term', memberId: null, max: 10 })).toBe(
      '每人整梯次最多 10 次',
    );
    expect(
      describe_({ type: 'rotation_groups', roleId: 'r1', groups: [['m1'], ['m2']], cycleBy: 'month' }),
    ).toBe('r1 依當月第幾次聚會輪替：小明 → 小華');
  });

  it('連續週數那兩條照引擎的真實語意寫', () => {
    expect(describe_({ type: 'max_consecutive_weeks_per_member', max: 1 })).toBe(
      '每人整梯次最多出現 1 次連續兩週服事',
    );
    expect(describe_({ type: 'max_consecutive_same_group', roleId: 'r1', max: 1 })).toBe(
      'r1 同一組不能連續超過 1 週',
    );
  });

  it('日期範圍三種寫法', () => {
    expect(describe_({ type: 'availability_window', memberId: 'm1', until: '2026-03-01' })).toContain(
      '之前',
    );
    expect(describe_({ type: 'availability_window', memberId: 'm1', from: '2026-03-01' })).toContain(
      '之後',
    );
    expect(
      describe_({ type: 'availability_window', memberId: 'm1', from: '2026-01-01', until: '2026-03-01' }),
    ).toContain('之間');
  });

  it('還沒填的欄位寫成「還沒選」，被刪掉的 id 寫成「找不到」', () => {
    expect(describe_({ type: 'max_per_term_role', memberId: '', roleId: '', max: 3 })).toContain(
      '還沒選人',
    );
    expect(describe_({ type: 'max_per_term_role', memberId: 'm9', roleId: 'r1', max: 3 })).toContain(
      '找不到的人 m9',
    );
  });

  it('15 種型別都寫得出一句話', () => {
    for (const constraint of fixture.constraints) {
      expect(describeConstraint(fixture, constraint)).not.toBe('');
    }
    expect(new Set(fixture.constraints.map((c) => c.type)).size).toBe(15);
  });
});

describe('validateConstraint', () => {
  const project = base();

  it('抓出指向已經被刪掉的人或位置', () => {
    expect(
      validateConstraint(project, rule({ type: 'max_per_term_role', memberId: 'm9', roleId: 'r1', max: 1 })),
    ).toEqual(['指向已經被刪掉的人（m9）']);
  });

  it('次數上限要是 1 以上的整數', () => {
    expect(
      validateConstraint(project, rule({ type: 'max_total_per_term', memberId: null, max: 0 })),
    ).toEqual(['次數上限要填 1 以上的整數']);
  });

  it('間隔週數可以是 0，次數上限不行', () => {
    expect(
      validateConstraint(
        project,
        rule({ type: 'role_frequency', roleId: 'r1', minGapWeeks: 0, maxPerTerm: 3 }),
      ),
    ).toEqual([]);
  });

  it('輪替群組至少一組、每組至少一人', () => {
    expect(
      validateConstraint(project, rule({ type: 'rotation_groups', roleId: 'r1', groups: [], cycleBy: 'week' })),
    ).toEqual(['至少要有一組']);
    expect(
      validateConstraint(
        project,
        rule({ type: 'rotation_groups', roleId: 'r1', groups: [['m1'], []], cycleBy: 'week' }),
      ),
    ).toEqual(['有一組是空的']);
  });

  it('禁止互相搭配至少兩人；可以同時擔任至少兩個位置', () => {
    expect(
      validateConstraint(
        project,
        rule({ type: 'forbidden_together', roleId: 'r1', memberIds: ['m1'], mode: 'any_two' }),
      ),
    ).toEqual(['至少要選兩個人']);
    expect(
      validateConstraint(project, rule({ type: 'dual_role_exception', memberId: 'm1', roleIds: ['r1'] })),
    ).toEqual(['至少要選兩個位置']);
  });

  it('替補名單兩邊都空、或同一個人同時在兩邊', () => {
    expect(
      validateConstraint(
        project,
        rule({ type: 'substitute_priority', roleId: 'r1', prefer: [], lastResort: [] }),
      ),
    ).toEqual(['兩個名單都是空的']);
    expect(
      validateConstraint(
        project,
        rule({ type: 'substitute_priority', roleId: 'r1', prefer: ['m1'], lastResort: ['m1'] }),
      ),
    ).toEqual(['有人同時在「優先」和「最後」名單裡']);
  });

  it('日期範圍至少要填一個，而且不能顛倒', () => {
    expect(validateConstraint(project, rule({ type: 'availability_window', memberId: 'm1' }))).toEqual(
      ['至少要填一個日期'],
    );
    expect(
      validateConstraint(
        project,
        rule({ type: 'availability_window', memberId: 'm1', from: '2026-03-01', until: '2026-01-01' }),
      ),
    ).toEqual(['起始日比結束日還晚']);
  });

  it('固定搭檔兩邊不能是同一個人', () => {
    expect(
      validateConstraint(
        project,
        rule({
          type: 'required_pair',
          a: { memberId: 'm1', roleId: 'r1' },
          b: { memberId: 'm1', roleId: 'r2' },
          directional: true,
        }),
      ),
    ).toEqual(['兩邊是同一個人']);
  });

  it('fixture 的 21 條規則全部填完了', () => {
    expect(invalidConstraintCount(fixture)).toBe(0);
  });
});

describe('parseConstraintsJson', () => {
  it('吃得下 fixture 原本的 21 條', () => {
    const parsed = parseConstraintsJson(constraintsToJson(fixture.constraints), fixture);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.constraints).toEqual(fixture.constraints);
  });

  it('空白代表沒有規則', () => {
    const parsed = parseConstraintsJson('   ', base());
    expect(parsed).toEqual({ ok: true, constraints: [] });
  });

  it('也吃 {"constraints":[…]} 與程式碼區塊', () => {
    const parsed = parseConstraintsJson('```json\n{"constraints":[{"type":"one_role_per_week"}]}\n```', base());
    expect(parsed.ok).toBe(true);
  });

  it('沒給 hard / enabled 就用樣板的預設', () => {
    const parsed = parseConstraintsJson(
      '[{"type":"one_role_per_week"},{"type":"rotation_groups","roleId":"r1","groups":[["m1"]],"cycleBy":"week"}]',
      base(),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.constraints.map((c) => [c.id, c.hard, c.enabled])).toEqual([
        ['c1', true, true],
        ['c2', false, true],
      ]);
    }
  });

  it('id 重複或沒給時重新編號，不會撞號', () => {
    const parsed = parseConstraintsJson(
      '[{"id":"c5","type":"one_role_per_week"},{"id":"c5","type":"one_role_per_week"},{"type":"one_role_per_week"}]',
      base(),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.constraints.map((c) => c.id)).toEqual(['c5', 'c1', 'c2']);
  });

  it('最外層不是陣列、整段不是 JSON', () => {
    const notJson = parseConstraintsJson('[{', base());
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.errors[0].position).toBeNull();

    const notArray = parseConstraintsJson('{"type":"one_role_per_week"}', base());
    expect(notArray.ok).toBe(false);
    if (!notArray.ok) expect(notArray.errors[0].message).toContain('陣列');
  });

  it('逐條報錯，帶第幾條', () => {
    const parsed = parseConstraintsJson(
      '[{"type":"one_role_per_week"},{"type":"沒這種"},{"type":"max_total_per_term","max":"3","memberId":null}]',
      base(),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toEqual([
        { position: 2, message: 'type 不認得："沒這種"' },
        { position: 3, message: 'max 要是整數' },
      ]);
    }
  });

  it('欄位形狀不對就擋下來，不會猜', () => {
    const cases: [string, string][] = [
      ['[{"type":"dual_role_exception","memberId":"m1","roleIds":"r1"}]', 'roleIds 要是陣列'],
      ['[{"type":"forbidden_role_combination","entries":[1]}]', 'entries 第 1 筆不是物件'],
      ['[{"type":"rotation_groups","roleId":"r1","groups":["m1"],"cycleBy":"week"}]', 'groups 第 1 組不是陣列'],
      [
        '[{"type":"rotation_groups","roleId":"r1","groups":[["m1"]],"cycleBy":"year"}]',
        'cycleBy 只能是 week 或 month',
      ],
      ['[{"type":"required_pair","a":"m1","b":"m2","directional":true}]', 'a 要是'],
      [
        '[{"type":"required_pair","a":{"memberId":"m1","roleId":"r1"},"b":{"memberId":"m2","roleId":"r2"}}]',
        'directional 要是 true 或 false',
      ],
    ];
    for (const [json, message] of cases) {
      const parsed = parseConstraintsJson(json, base());
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.errors[0].message).toContain(message);
    }
  });

  it('形狀對但指向不存在的人，一樣算錯', () => {
    const parsed = parseConstraintsJson(
      '[{"type":"max_per_month","memberId":"m9","max":1,"roleId":null}]',
      base(),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toEqual({ position: 1, message: '指向已經被刪掉的人（m9）' });
  });

  it('note 留著，未知欄位丟掉', () => {
    const parsed = parseConstraintsJson(
      '[{"type":"one_role_per_week","note":"說明","亂加的":1}]',
      base(),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.constraints[0]).toEqual({
        id: 'c1',
        type: 'one_role_per_week',
        hard: true,
        enabled: true,
        note: '說明',
      } satisfies Constraint);
    }
  });
});
