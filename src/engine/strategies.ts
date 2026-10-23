/**
 * 三種指派策略。規格 §6.4.3：角色用哪一種由資料決定，不再寫死角色名。
 *
 *   assignCoupled   成對指派（領會＋司琴）
 *   assignRotation  固定組合輪替（音控、招待）
 *   assignFill      單純填滿（聖餐）
 *
 * 三者都遵守「全有或全無」：湊不滿 perWeek 就整個角色留空並記 warning（§6.4.8）。
 */

import type { EngineContext } from './context';
import {
  canServe,
  consecutiveSameGroup,
  violatesForbiddenTogether,
  violatesRoleCombinationWithin,
} from './eligibility';
import { leaderKey, stableSortBy, substituteKey, termCountKey } from './ordering';
import type { MemberId, Role, RoleId, RosterWeek } from './schema';

export interface AssignContext {
  /** 正在填的這一週 */
  readonly week: RosterWeek;
  /** 已經排完的週（往回數連續組合用），不含當週 */
  readonly previousWeeks: readonly RosterWeek[];
  /** 當週已經排到服事的人 */
  readonly assignedThisWeek: Set<MemberId>;
}

// ── 共用工具 ────────────────────────────────────────────────────────────────

function excludedSet(
  ctx: EngineContext,
  aw: AssignContext,
  extra: readonly MemberId[] = [],
): Set<MemberId> {
  const excluded = new Set<MemberId>(extra);
  if (ctx.rules.blockRepeatWithinWeek) {
    for (const memberId of aw.assignedThisWeek) excluded.add(memberId);
  }
  return excluded;
}

function commit(
  ctx: EngineContext,
  aw: AssignContext,
  roleId: RoleId,
  members: readonly MemberId[],
): void {
  aw.week.assignments[roleId] = [...members];
  for (const memberId of members) {
    aw.assignedThisWeek.add(memberId);
    ctx.state.record(memberId, roleId, aw.week.date);
  }
}

function warn(aw: AssignContext, roleId: RoleId, code: string, message: string): void {
  aw.week.warnings.push({ roleId, code, message });
}

function soft(
  ctx: EngineContext,
  aw: AssignContext,
  roleId: RoleId,
  code: string,
  message: string,
): void {
  ctx.softViolations.push({ date: aw.week.date, roleId, code, message });
}

function nameOf(ctx: EngineContext, memberId: MemberId): string {
  return ctx.memberById.get(memberId)?.name ?? memberId;
}

function allowsDualRole(
  ctx: EngineContext,
  memberId: MemberId,
  first: RoleId,
  second: RoleId,
): boolean {
  const allowed = ctx.rules.dualRoles.get(memberId);
  return allowed !== undefined && allowed.has(first) && allowed.has(second);
}

function reportLastResort(
  ctx: EngineContext,
  aw: AssignContext,
  role: Role,
  members: readonly MemberId[],
): void {
  const rule = ctx.rules.substitutes.get(role.id);
  if (rule === undefined) return;
  for (const memberId of members) {
    if (rule.lastResort.has(memberId)) {
      soft(
        ctx,
        aw,
        role.id,
        'last_resort_used',
        `${role.name}動用了最後手段人員：${nameOf(ctx, memberId)}`,
      );
    }
  }
}

/**
 * 依候選人順序找出第一組（字典順序最小）通過檢查的組合。
 * perWeek 為 2 時與現有引擎的雙重迴圈完全等價（`scheduler.py:295-299`）。
 */
function pickCombination(
  candidates: readonly MemberId[],
  need: number,
  accepts: (picked: readonly MemberId[], next: MemberId) => boolean,
): MemberId[] | null {
  const picked: MemberId[] = [];

  const search = (start: number): boolean => {
    if (picked.length === need) return true;
    for (let i = start; i < candidates.length; i++) {
      const next = candidates[i];
      if (!accepts(picked, next)) continue;
      picked.push(next);
      if (search(i + 1)) return true;
      picked.pop();
    }
    return false;
  };

  return search(0) ? [...picked] : null;
}

// ── 成對指派 ────────────────────────────────────────────────────────────────

/**
 * 對應 `scheduler.py:_assign_領會_司琴`。兩個角色一次排完：先試 required_pair，
 * 再依主角色的候選順序逐一嘗試，每個主角色人選依序找配角（同一人的例外 →
 * 偏好搭配 → 服事次數最少的人）。
 *
 * `required_pair.directional` 在成對指派下沒有行為差異（兩個角色一次決定），
 * 欄位保留給日後非成對角色之間的 required_pair 使用。
 */
export function assignCoupled(
  ctx: EngineContext,
  leader: Role,
  partner: Role,
  aw: AssignContext,
): void {
  const date = aw.week.date;

  const tryPair = (leaderId: MemberId, partnerId: MemberId): boolean => {
    const samePerson = leaderId === partnerId;
    if (samePerson && ctx.rules.blockRepeatWithinWeek) {
      if (!allowsDualRole(ctx, leaderId, leader.id, partner.id)) return false;
    }
    if (!canServe(ctx, leaderId, leader.id, date, excludedSet(ctx, aw), aw.week.assignments)) {
      return false;
    }
    const partnerExcluded = excludedSet(ctx, aw, samePerson ? [] : [leaderId]);
    if (!canServe(ctx, partnerId, partner.id, date, partnerExcluded, aw.week.assignments)) {
      return false;
    }

    // record 的呼叫順序會影響「連續兩週」的累計，必須先主角色再配角
    aw.week.assignments[leader.id] = [leaderId];
    aw.week.assignments[partner.id] = [partnerId];
    aw.assignedThisWeek.add(leaderId);
    aw.assignedThisWeek.add(partnerId);
    ctx.state.record(leaderId, leader.id, date);
    ctx.state.record(partnerId, partner.id, date);
    return true;
  };

  for (const pair of ctx.rules.requiredPairs) {
    const slots = matchCoupledPair(pair, leader.id, partner.id);
    if (slots === null) continue;
    if (tryPair(slots.leaderMember, slots.partnerMember)) return;
  }

  const leaderCandidates = stableSortBy(
    ctx.pools.get(leader.id) ?? [],
    leaderKey(ctx, leader.id, date),
  );

  for (const leaderId of leaderCandidates) {
    if (!canServe(ctx, leaderId, leader.id, date, excludedSet(ctx, aw), aw.week.assignments)) {
      continue;
    }

    let partnerId: MemberId | null = null;

    if (
      allowsDualRole(ctx, leaderId, leader.id, partner.id) &&
      canServe(ctx, leaderId, partner.id, date, excludedSet(ctx, aw), aw.week.assignments)
    ) {
      partnerId = leaderId;
    }

    if (partnerId === null) {
      const preferred = ctx.rules.preferredCombos.find(
        (combo) => combo.when.memberId === leaderId && combo.when.roleId === leader.id,
      );
      if (
        preferred !== undefined &&
        preferred.prefer.roleId === partner.id &&
        canServe(
          ctx,
          preferred.prefer.memberId,
          partner.id,
          date,
          excludedSet(ctx, aw, [leaderId]),
          aw.week.assignments,
        )
      ) {
        partnerId = preferred.prefer.memberId;
      }
    }

    if (partnerId === null) {
      const candidates = (ctx.pools.get(partner.id) ?? []).filter((memberId) =>
        canServe(
          ctx,
          memberId,
          partner.id,
          date,
          excludedSet(ctx, aw, [leaderId]),
          aw.week.assignments,
        ),
      );
      partnerId = stableSortBy(candidates, termCountKey(ctx, partner.id))[0] ?? null;
    }

    if (partnerId !== null && tryPair(leaderId, partnerId)) return;
  }

  warn(aw, leader.id, 'unfilled', `無法排定${leader.name}/${partner.name}`);
}

function matchCoupledPair(
  pair: { a: { memberId: MemberId; roleId: RoleId }; b: { memberId: MemberId; roleId: RoleId } },
  leaderRoleId: RoleId,
  partnerRoleId: RoleId,
): { leaderMember: MemberId; partnerMember: MemberId } | null {
  if (pair.a.roleId === leaderRoleId && pair.b.roleId === partnerRoleId) {
    return { leaderMember: pair.a.memberId, partnerMember: pair.b.memberId };
  }
  if (pair.b.roleId === leaderRoleId && pair.a.roleId === partnerRoleId) {
    return { leaderMember: pair.b.memberId, partnerMember: pair.a.memberId };
  }
  return null;
}

// ── 固定組合輪替 ────────────────────────────────────────────────────────────

/**
 * 對應 `scheduler.py:_assign_音控` 與 `_assign_招待`。依週次（或當月第幾次聚會）
 * 輪替固定組合；組合裡有人不行時留下能來的人、其餘位置找替補；所有組合都不行
 * 才從整個人員池 fallback。
 */
export function assignRotation(ctx: EngineContext, role: Role, aw: AssignContext): void {
  const date = aw.week.date;
  const rotation = ctx.rules.rotation.get(role.id);
  const maxConsecutive =
    ctx.rules.maxConsecutiveSameGroup.get(role.id) ?? Number.POSITIVE_INFINITY;

  const eligible = (memberId: MemberId, extra: readonly MemberId[]): boolean =>
    canServe(ctx, memberId, role.id, date, excludedSet(ctx, aw, extra), aw.week.assignments);

  const groupConsecutive = (members: readonly MemberId[]): number =>
    consecutiveSameGroup(aw.previousWeeks, role.id, members);

  const findSubstitute = (picked: readonly MemberId[]): MemberId | null => {
    const candidates = (ctx.pools.get(role.id) ?? []).filter(
      (memberId) =>
        !picked.includes(memberId) &&
        eligible(memberId, picked) &&
        !violatesForbiddenTogether(ctx, role.id, [...picked, memberId]) &&
        !violatesRoleCombinationWithin(ctx, role.id, [...picked, memberId]) &&
        groupConsecutive([...picked, memberId]) < maxConsecutive,
    );
    return stableSortBy(candidates, substituteKey(ctx, role.id, date))[0] ?? null;
  };

  // 缺陷 #1：群組數為 0 時直接走 fallback，不再 `% 0` 崩潰
  if (rotation !== undefined && rotation.groups.length > 0) {
    const offset =
      rotation.cycleBy === 'week'
        ? (ctx.weekIndex.get(date) ?? 0)
        : (ctx.monthSlot.get(date) ?? 0);

    const total = rotation.groups.length;
    const rotated: MemberId[][] = [];
    for (let i = 0; i < total; i++) rotated.push(rotation.groups[(offset + i) % total]);

    // 缺陷 #6：現有引擎只在找替補時檢查 forbidden_together，完整的組合本身不檢查
    const usable = stableSortBy(
      rotated.filter(
        (group) =>
          groupConsecutive(group) < maxConsecutive &&
          !violatesForbiddenTogether(ctx, role.id, group) &&
          !violatesRoleCombinationWithin(ctx, role.id, group),
      ),
      (group) => [groupConsecutive(group)],
    );

    for (const group of usable) {
      const survivors: MemberId[] = [];
      for (const memberId of group) {
        if (eligible(memberId, survivors)) survivors.push(memberId);
      }
      if (survivors.length === 0) continue;

      if (survivors.length >= role.perWeek) {
        const picked = survivors.slice(0, role.perWeek);
        commit(ctx, aw, role.id, picked);
        reportLastResort(ctx, aw, role, picked);
        return;
      }

      const picked = [...survivors];
      while (picked.length < role.perWeek) {
        const substitute = findSubstitute(picked);
        if (substitute === null) break;
        picked.push(substitute);
      }
      if (picked.length < role.perWeek) continue;

      commit(ctx, aw, role.id, picked);
      soft(
        ctx,
        aw,
        role.id,
        'rotation_substituted',
        `${role.name}的固定組合被拆開，由 ${picked
          .slice(survivors.length)
          .map((memberId) => nameOf(ctx, memberId))
          .join('、')} 替補`,
      );
      reportLastResort(ctx, aw, role, picked);
      return;
    }
  }

  const candidates = stableSortBy(
    (ctx.pools.get(role.id) ?? []).filter((memberId) => eligible(memberId, [])),
    substituteKey(ctx, role.id, date),
  );

  if (candidates.length < role.perWeek) {
    warn(aw, role.id, 'unfilled', `無法排定${role.name}（人數不足）`);
    return;
  }

  const combination = pickCombination(
    candidates,
    role.perWeek,
    (picked, next) =>
      !violatesForbiddenTogether(ctx, role.id, [...picked, next]) &&
      !violatesRoleCombinationWithin(ctx, role.id, [...picked, next]),
  );

  const picked = combination ?? candidates.slice(0, role.perWeek);
  if (combination === null) {
    warn(aw, role.id, 'forbidden_pair_unavoidable', `${role.name}備用禁止配對無法迴避`);
  }
  commit(ctx, aw, role.id, picked);
  soft(ctx, aw, role.id, 'rotation_fallback', `${role.name}沒有用到固定組合，改從人員池挑人`);
  reportLastResort(ctx, aw, role, picked);
}

// ── 單純填滿 ────────────────────────────────────────────────────────────────

/** 對應 `scheduler.py:_assign_聖餐`：沒有固定組合，服事次數最少的人優先 */
export function assignFill(ctx: EngineContext, role: Role, aw: AssignContext): void {
  const date = aw.week.date;
  const candidates = stableSortBy(
    (ctx.pools.get(role.id) ?? []).filter((memberId) =>
      canServe(ctx, memberId, role.id, date, excludedSet(ctx, aw), aw.week.assignments),
    ),
    termCountKey(ctx, role.id),
  );

  if (candidates.length < role.perWeek) {
    warn(aw, role.id, 'unfilled', `無法排定${role.name}（人數不足）`);
    return;
  }

  // 這裡的人選也是一次挑完的，所以組合本身要查過才算數（規格 §7.7.3）
  const combination = pickCombination(
    candidates,
    role.perWeek,
    (chosen, next) =>
      !violatesForbiddenTogether(ctx, role.id, [...chosen, next]) &&
      !violatesRoleCombinationWithin(ctx, role.id, [...chosen, next]),
  );

  const picked = combination ?? candidates.slice(0, role.perWeek);
  if (combination === null) {
    warn(aw, role.id, 'forbidden_pair_unavoidable', `${role.name}的禁止配對無法迴避`);
  }
  commit(ctx, aw, role.id, picked);
  reportLastResort(ctx, aw, role, picked);
}
