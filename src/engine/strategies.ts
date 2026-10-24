/**
 * 三種指派策略。規格 §6.4.3：角色用哪一種由資料決定，不再寫死角色名。
 *
 *   assignCoupled   成對指派（領會＋司琴）
 *   assignRotation  固定組合輪替（音控、招待）
 *   assignFill      單純填滿（聖餐）
 *
 * 三者都「盡量填滿」：湊不滿 perWeek 時排得上幾個就排幾個，缺的位置留空並記
 * partially_filled；一個人都排不上才整個留空並記 unfilled（§6.4.8、§7.11）。
 */

import type { EngineContext } from './context';
import {
  blockReason,
  canServe,
  consecutiveSameGroup,
  violatesForbiddenTogether,
  violatesRoleCombinationWithin,
} from './eligibility';
import { leaderKey, stableSortBy, substituteKey, termCountKey } from './ordering';
import type { SortKey } from './ordering';
import type { RotationRule } from './rules';
import type {
  BlockedCandidate,
  BlockedGroup,
  BlockReason,
  GroupBlockReason,
  MemberId,
  Role,
  RoleId,
  RosterWeek,
} from './schema';

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

function warn(
  aw: AssignContext,
  roleId: RoleId,
  code: string,
  message: string,
  blocked?: BlockedCandidate[],
): void {
  aw.week.warnings.push({ roleId, code, message, ...(blocked === undefined ? {} : { blocked }) });
}

/**
 * 排不出來時，把這個位置每一位有資格的人分別卡在哪裡記下來，給結果頁的
 * 「為什麼？」用（規格 §7.9.4）。reason 為 null 代表這個人其實排得上，
 * 是整個位置湊不滿 perWeek 才留空。
 */
function blockedList(
  ctx: EngineContext,
  aw: AssignContext,
  role: Role,
  extra: readonly MemberId[] = [],
): BlockedCandidate[] {
  const excluded = excludedSet(ctx, aw, extra);
  return (ctx.pools.get(role.id) ?? []).map((memberId) => ({
    memberId,
    reason: blockReason(ctx, memberId, role.id, aw.week.date, excluded, aw.week.assignments),
  }));
}

/**
 * 只排到一部分（規格 §7.11）：排得上幾個就排幾個，缺的位置留空。
 *
 * `blocked` 一定要在 `commit()` 之前拍，而且要把排上去的人濾掉 —— 這張表回答的是
 * 「剩下的空位為什麼沒人」，把剛排上去的人列進去只會混亂。
 *
 * 這條路徑不記橘色備註（沒有用到固定組合、動用最後手段人員）：紅色那一列的
 * 「為什麼？」已經把整個人員池逐人列出來了，橘色在這裡只是重複。
 */
function commitPartial(
  ctx: EngineContext,
  aw: AssignContext,
  role: Role,
  picked: readonly MemberId[],
): void {
  // 沒被排上卻「排得上」的人，一定是跟排定的人湊不成合法組合 —— 不然
  // largestCombination 會連他一起排進去（多一個人的組合就成立了）
  const blocked = blockedList(ctx, aw, role)
    .filter((entry) => !picked.includes(entry.memberId))
    .map((entry) =>
      entry.reason === null
        ? { ...entry, reason: { kind: 'combination_blocked' } as BlockReason }
        : entry,
    );
  commit(ctx, aw, role.id, picked);
  warn(
    aw,
    role.id,
    'partially_filled',
    `${role.name}只排到 ${picked.length} 人（需要 ${role.perWeek} 人）`,
    blocked,
  );
}

/** 釘選值轉成 0 起算的「當月第幾次聚會」；-1 ＝ 當月最後一次 */
function resolveSlot(pin: number, lastSlot: number): number {
  return pin === -1 ? lastSlot : pin - 1;
}

function soft(
  ctx: EngineContext,
  aw: AssignContext,
  roleId: RoleId,
  code: string,
  message: string,
  extra?: { blocked?: BlockedCandidate[] | null; groups?: BlockedGroup[] },
): void {
  ctx.softViolations.push({
    date: aw.week.date,
    roleId,
    code,
    message,
    ...(extra?.blocked === undefined || extra.blocked === null
      ? {}
      : { blocked: extra.blocked }),
    ...(extra?.groups === undefined ? {} : { groups: extra.groups }),
  });
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

/**
 * 動用最後手段人員時，整個人員池分別卡在哪裡（規格 §7.10.1）。
 * 一定要在 commit 之前呼叫，否則剛排上去的人會變成「本週已經排在別的位置」。
 * 沒動用到最後手段就回 null，不白算。
 */
function lastResortSnapshot(
  ctx: EngineContext,
  aw: AssignContext,
  role: Role,
  picked: readonly MemberId[],
): BlockedCandidate[] | null {
  const rule = ctx.rules.substitutes.get(role.id);
  if (rule === undefined || !picked.some((memberId) => rule.lastResort.has(memberId))) {
    return null;
  }
  return blockedList(ctx, aw, role);
}

function reportLastResort(
  ctx: EngineContext,
  aw: AssignContext,
  role: Role,
  members: readonly MemberId[],
  blocked: BlockedCandidate[] | null,
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
        { blocked },
      );
    }
  }
}

/**
 * 輪替群組的每一組為什麼不能用在這一週（規格 §7.10.1）。
 * 在挑組之前算，理由同上 —— 挑完再算，狀態已經被這一週的指派改掉了。
 *
 * 判斷順序與下面 `usable` 的 filter 一致，最後兩項（人不夠、釘在別週）是
 * filter 擋不住、但實際上決定了這一組有沒有被用到的原因。
 */
function groupSnapshot(
  ctx: EngineContext,
  aw: AssignContext,
  role: Role,
  rotation: RotationRule,
  context: { slot: number; lastSlot: number; maxConsecutive: number },
): BlockedGroup[] {
  return rotation.groups.map((members, index) => ({
    index,
    members: [...members],
    used: false,
    reason: groupReason(ctx, aw, role, rotation, context, members, index),
  }));
}

function groupReason(
  ctx: EngineContext,
  aw: AssignContext,
  role: Role,
  rotation: RotationRule,
  context: { slot: number; lastSlot: number; maxConsecutive: number },
  members: readonly MemberId[],
  index: number,
): GroupBlockReason | null {
  if (consecutiveSameGroup(aw.previousWeeks, role.id, members) >= context.maxConsecutive) {
    return { kind: 'too_consecutive', max: context.maxConsecutive };
  }
  if (violatesForbiddenTogether(ctx, role.id, members)) return { kind: 'forbidden_together' };
  if (violatesRoleCombinationWithin(ctx, role.id, members)) {
    return { kind: 'forbidden_combination' };
  }

  const survivors: MemberId[] = [];
  for (const memberId of members) {
    if (canServe(ctx, memberId, role.id, aw.week.date, excludedSet(ctx, aw, survivors), aw.week.assignments)) {
      survivors.push(memberId);
    }
  }
  if (survivors.length < role.perWeek) {
    return { kind: 'short_handed', available: survivors.length, need: role.perWeek };
  }

  const pin = rotation.pinnedSlots[index];
  if (pin !== null && pin !== undefined && resolveSlot(pin, context.lastSlot) !== context.slot) {
    return { kind: 'pinned_elsewhere', pin };
  }
  return null;
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

/**
 * 挑得出來的最大合法組合：先試 `need` 人，不行就一路往下試到 1 人（規格 §7.11）。
 * 一個人自己不會違反「不能同一個位置」或「不能同一週」，所以候選人不是空的就
 * 一定有答案。
 */
function largestCombination(
  candidates: readonly MemberId[],
  need: number,
  accepts: (picked: readonly MemberId[], next: MemberId) => boolean,
): MemberId[] | null {
  for (let size = Math.min(need, candidates.length); size >= 1; size--) {
    const picked = pickCombination(candidates, size, accepts);
    if (picked !== null) return picked;
  }
  return null;
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

  // ── 配不出一對：各排各的（規格 §7.11）────────────────────────────────────
  // commit 的順序與 tryPair 一致（先主角色再配角），所以「連續兩週」的累計不變。
  // 配角的資格在主角色排定之後才查，「本週已經排在主角色」這類原因會自然反映出來。
  const fillOne = (role: Role, sortKey: (memberId: MemberId) => SortKey): boolean => {
    const candidates = stableSortBy(
      (ctx.pools.get(role.id) ?? []).filter((memberId) =>
        canServe(ctx, memberId, role.id, date, excludedSet(ctx, aw), aw.week.assignments),
      ),
      sortKey,
    );
    const picked = candidates[0];
    if (picked === undefined) return false;
    commit(ctx, aw, role.id, [picked]);
    return true;
  };

  const leaderFilled = fillOne(leader, leaderKey(ctx, leader.id, date));
  const partnerFilled = fillOne(partner, termCountKey(ctx, partner.id));

  if (leaderFilled && partnerFilled) return;

  if (!leaderFilled && !partnerFilled) {
    // 兩個都空：維持原本的訊息。這裡沒有人的 reason 會是 null（排得上就被 fillOne
    // 排掉了），no_partner 的對應留著防 blockReason 與 canServe 哪天分岔
    const blocked = blockedList(ctx, aw, leader).map((entry) =>
      entry.reason === null
        ? { ...entry, reason: { kind: 'no_partner', roleId: partner.id } as BlockReason }
        : entry,
    );
    warn(aw, leader.id, 'unfilled', `無法排定${leader.name}/${partner.name}`, blocked);
    return;
  }

  const empty = leaderFilled ? partner : leader;
  const filled = leaderFilled ? leader : partner;
  warn(
    aw,
    empty.id,
    'partially_filled',
    `無法排定${empty.name}（${filled.name}已排定）`,
    blockedList(ctx, aw, empty),
  );
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

  const slot = ctx.monthSlot.get(date) ?? 0;
  const lastSlot = (ctx.monthCount.get(date) ?? 1) - 1;
  const pins = rotation?.pinnedSlots ?? [];
  /** 本週該用哪一組（釘選），沒有就是 -1 */
  const pinnedIndex = pins.findIndex(
    (pin) => pin !== null && resolveSlot(pin, lastSlot) === slot,
  );
  // 挑組之前先拍快照：出局理由必須在狀態被這一週的指派改掉之前算（規格 §7.10.1）
  const snapshot =
    rotation === undefined || rotation.groups.length === 0
      ? []
      : groupSnapshot(ctx, aw, role, rotation, { slot, lastSlot, maxConsecutive });

  /** 標出本週實際用到的是哪一組，其餘維持出局理由 */
  const groupsWith = (usedIndex: number | null): BlockedGroup[] =>
    snapshot.map((group) =>
      group.index === usedIndex ? { ...group, used: true, reason: null } : group,
    );

  /** 釘選是偏好：本週該用的那一組沒用到就記一筆，不擋班表 */
  const notePin = (usedIndex: number | null): void => {
    if (pinnedIndex < 0 || usedIndex === pinnedIndex) return;
    const pin = pins[pinnedIndex];
    soft(
      ctx,
      aw,
      role.id,
      'pinned_group_missed',
      `${role.name}第 ${pinnedIndex + 1} 組沒能排在${
        pin === -1 ? '當月最後一次聚會' : `當月第 ${pin} 次聚會`
      }`,
      { groups: groupsWith(usedIndex) },
    );
  };

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
    const rotated: { members: MemberId[]; index: number }[] = [];
    for (let i = 0; i < total; i++) {
      const index = (offset + i) % total;
      rotated.push({ members: rotation.groups[index], index });
    }

    // 釘在本週的組排最前、沒釘的照輪替順序、釘在別週的壓到最後。
    // 一組都沒釘時每一組的名次都是 1，排序結果與加這個欄位之前完全相同。
    const pinRank = (index: number): number => {
      const pin = pins[index];
      if (pin === null || pin === undefined) return 1;
      return resolveSlot(pin, lastSlot) === slot ? 0 : 2;
    };

    // 缺陷 #6：現有引擎只在找替補時檢查 forbidden_together，完整的組合本身不檢查
    const usable = stableSortBy(
      rotated.filter(
        ({ members }) =>
          groupConsecutive(members) < maxConsecutive &&
          !violatesForbiddenTogether(ctx, role.id, members) &&
          !violatesRoleCombinationWithin(ctx, role.id, members),
      ),
      ({ members, index }) => [pinRank(index), groupConsecutive(members)],
    );

    for (const { members: group, index: groupIndex } of usable) {
      const survivors: MemberId[] = [];
      for (const memberId of group) {
        if (eligible(memberId, survivors)) survivors.push(memberId);
      }
      if (survivors.length === 0) continue;

      if (survivors.length >= role.perWeek) {
        const picked = survivors.slice(0, role.perWeek);
        const lastResort = lastResortSnapshot(ctx, aw, role, picked);
        commit(ctx, aw, role.id, picked);
        notePin(groupIndex);
        reportLastResort(ctx, aw, role, picked, lastResort);
        return;
      }

      const picked = [...survivors];
      while (picked.length < role.perWeek) {
        const substitute = findSubstitute(picked);
        if (substitute === null) break;
        picked.push(substitute);
      }
      if (picked.length < role.perWeek) continue;

      // 原本這一組的人分別卡在哪裡（commit 之前算，理由同上）
      const groupBlocked = group.map((memberId) => ({
        memberId,
        reason: blockReason(
          ctx,
          memberId,
          role.id,
          date,
          excludedSet(ctx, aw),
          aw.week.assignments,
        ),
      }));
      const lastResort = lastResortSnapshot(ctx, aw, role, picked);
      commit(ctx, aw, role.id, picked);
      notePin(groupIndex);
      soft(
        ctx,
        aw,
        role.id,
        'rotation_substituted',
        `${role.name}的固定組合被拆開，由 ${picked
          .slice(survivors.length)
          .map((memberId) => nameOf(ctx, memberId))
          .join('、')} 替補`,
        { blocked: groupBlocked },
      );
      reportLastResort(ctx, aw, role, picked, lastResort);
      return;
    }
  }

  const candidates = stableSortBy(
    (ctx.pools.get(role.id) ?? []).filter((memberId) => eligible(memberId, [])),
    substituteKey(ctx, role.id, date),
  );

  if (candidates.length < role.perWeek) {
    // 所有固定組合都湊不滿，人員池也不夠：排得上幾個就排幾個（規格 §7.11）
    const partial = largestCombination(
      candidates,
      candidates.length,
      (picked, next) =>
        !violatesForbiddenTogether(ctx, role.id, [...picked, next]) &&
        !violatesRoleCombinationWithin(ctx, role.id, [...picked, next]),
    );
    if (partial === null) {
      warn(aw, role.id, 'unfilled', `無法排定${role.name}（人數不足）`, blockedList(ctx, aw, role));
    } else {
      commitPartial(ctx, aw, role, partial);
    }
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
  const lastResort = lastResortSnapshot(ctx, aw, role, picked);
  commit(ctx, aw, role.id, picked);
  notePin(null);
  soft(ctx, aw, role.id, 'rotation_fallback', `${role.name}沒有用到固定組合，改從人員池挑人`, {
    groups: groupsWith(null),
  });
  reportLastResort(ctx, aw, role, picked, lastResort);
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
    // 人數不夠就排得上幾個就排幾個，不整個留空（規格 §7.11）
    const partial = largestCombination(
      candidates,
      candidates.length,
      (chosen, next) =>
        !violatesForbiddenTogether(ctx, role.id, [...chosen, next]) &&
        !violatesRoleCombinationWithin(ctx, role.id, [...chosen, next]),
    );
    if (partial === null) {
      warn(aw, role.id, 'unfilled', `無法排定${role.name}（人數不足）`, blockedList(ctx, aw, role));
    } else {
      commitPartial(ctx, aw, role, partial);
    }
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
  const lastResort = lastResortSnapshot(ctx, aw, role, picked);
  commit(ctx, aw, role.id, picked);
  reportLastResort(ctx, aw, role, picked, lastResort);
}
