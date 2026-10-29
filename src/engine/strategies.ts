/**
 * 三種指派策略。規格 §6.4.3：角色用哪一種由資料決定，不再寫死角色名。
 *
 *   assignCoupled   成對指派（領會＋司琴）
 *   assignRotation  固定組合輪替（音控、招待）
 *   assignFill      單純填滿（聖餐）
 *
 * 三者都「盡量填滿」：湊不滿 perWeek 時排得上幾個就排幾個，缺的位置留空並記
 * partially_filled；一個人都排不上才整個留空並記 unfilled（§6.4.8、§7.11）。
 *
 * 指定服事（§7.12）在每週一開始就由 commitPins 寫進班表，三種策略都只補剩下的
 * 格子。沒有指定時 `pinnedIn` 一律是空陣列，每一條路徑都與原本相同。
 */

import { appliesToWeek, type EngineContext } from './context';
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
  Week,
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
  // 接在指定服事的人後面（規格 §7.12.2）；沒有指定時這一格本來就是空的
  aw.week.assignments[roleId] = [...(aw.week.assignments[roleId] ?? []), ...members];
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
  // 已經排在這個位置的人（指定服事）不是「空位為什麼沒人」的答案
  const already = pinnedIn(aw, role.id);
  return (ctx.pools.get(role.id) ?? [])
    .filter((memberId) => !already.includes(memberId))
    .map((memberId) => ({
      memberId,
      reason: blockReason(ctx, memberId, role.id, aw.week.date, excluded, aw.week.assignments),
    }));
}

/** 這個位置本週已經排定的人。commit 之前只會是指定服事的人（規格 §7.12.2） */
function pinnedIn(aw: AssignContext, roleId: RoleId): MemberId[] {
  return aw.week.assignments[roleId] ?? [];
}

/** 一個人都補不上。沒有指定服事時是原本的 unfilled；有指定的人就是只排到一部分 */
function reportEmpty(ctx: EngineContext, aw: AssignContext, role: Role): void {
  const pinned = pinnedIn(aw, role.id).length;
  if (pinned === 0) {
    warn(aw, role.id, 'unfilled', `無法排定${role.name}（人數不足）`, blockedList(ctx, aw, role));
    return;
  }
  warn(
    aw,
    role.id,
    'partially_filled',
    `${role.name}只排到 ${pinned} 人（需要 ${role.perWeek} 人）`,
    blockedList(ctx, aw, role),
  );
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
  const filled = pinnedIn(aw, role.id).length + picked.length;
  commit(ctx, aw, role.id, picked);
  warn(
    aw,
    role.id,
    'partially_filled',
    `${role.name}只排到 ${filled} 人（需要 ${role.perWeek} 人）`,
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
 * 一次挑多人時的組合檢查：「不能同一個位置」與「不能同一週」。已經指定在這個
 * 位置的人一起算進去（規格 §7.12.2）
 */
function acceptsWith(
  ctx: EngineContext,
  role: Role,
  pinned: readonly MemberId[],
): (chosen: readonly MemberId[], next: MemberId) => boolean {
  return (chosen, next) =>
    !violatesForbiddenTogether(ctx, role.id, [...pinned, ...chosen, next]) &&
    !violatesRoleCombinationWithin(ctx, role.id, [...pinned, ...chosen, next]);
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

// ── 指定服事 ────────────────────────────────────────────────────────────────

/**
 * 每週一開始先把這一週的指定服事寫進班表（規格 §7.12.2）。指定優先：不經過資格
 * 檢查一定排上，但照一般規則查一次（不預扣），查得到衝突就記一筆橘色提醒。
 * 位置在這一週不排的指定直接略過 —— 卡片的欄位檢查已經擋過，這裡只是防呆。
 */
export function commitPins(ctx: EngineContext, aw: AssignContext, week: Week): void {
  for (const pin of ctx.rules.pins.byDate.get(aw.week.date) ?? []) {
    const role = ctx.roleById.get(pin.roleId);
    if (role === undefined || !appliesToWeek(role, week)) continue;
    const current = pinnedIn(aw, role.id);
    if (current.includes(pin.memberId)) continue;

    const reason = pinConflict(ctx, aw, pin.memberId, role.id, current);
    commit(ctx, aw, role.id, [pin.memberId]);
    if (reason !== null) {
      soft(
        ctx,
        aw,
        role.id,
        'pinned_over_rule',
        `指定${nameOf(ctx, pin.memberId)}擔任${role.name}，但違反了其他規則`,
        { blocked: [{ memberId: pin.memberId, reason }] },
      );
    }
  }
}

function pinConflict(
  ctx: EngineContext,
  aw: AssignContext,
  memberId: MemberId,
  roleId: RoleId,
  current: readonly MemberId[],
): BlockReason | null {
  const excluded = excludedSet(ctx, aw);
  // 同一天被指定到兩個位置、又有「可以同時擔任兩個位置」的例外，就不算衝突
  for (const [otherRole, members] of Object.entries(aw.week.assignments)) {
    if (members.includes(memberId) && allowsDualRole(ctx, memberId, otherRole, roleId)) {
      excluded.delete(memberId);
    }
  }
  const reason = blockReason(
    ctx,
    memberId,
    roleId,
    aw.week.date,
    excluded,
    aw.week.assignments,
    'pin',
  );
  if (reason !== null) return reason;
  if (violatesForbiddenTogether(ctx, roleId, [...current, memberId])) {
    return { kind: 'forbidden_together' };
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

  // 其中一格已經指定（規格 §7.12.2）：只補另一格
  const pinnedLeader = pinnedIn(aw, leader.id)[0];
  const pinnedPartner = pinnedIn(aw, partner.id)[0];
  if (pinnedLeader !== undefined && pinnedPartner !== undefined) return;
  if (pinnedLeader !== undefined) {
    fillAround(ctx, aw, partner, leader, partnerChoices(ctx, aw, leader, partner, pinnedLeader));
    return;
  }
  if (pinnedPartner !== undefined) {
    fillAround(ctx, aw, leader, partner, leaderChoices(ctx, aw, leader, partner, pinnedPartner));
    return;
  }

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
      partnerId = stableSortBy(candidates, termCountKey(ctx, partner.id, date))[0] ?? null;
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
  const partnerFilled = fillOne(partner, termCountKey(ctx, partner.id, date));

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

interface Choice {
  memberId: MemberId;
  /** true = 跟已經指定的那一格是同一個人（一人兩職） */
  dual: boolean;
}

/**
 * 成對位置的其中一格已經指定了，另一格依序試 `choices`，第一個排得上的就排
 * （規格 §7.12.2）。都排不上就照 §7.11 留空、記 partially_filled。
 */
function fillAround(
  ctx: EngineContext,
  aw: AssignContext,
  empty: Role,
  filled: Role,
  choices: readonly Choice[],
): void {
  for (const { memberId, dual } of choices) {
    const excluded = excludedSet(ctx, aw);
    if (dual) excluded.delete(memberId);
    if (canServe(ctx, memberId, empty.id, aw.week.date, excluded, aw.week.assignments)) {
      commit(ctx, aw, empty.id, [memberId]);
      return;
    }
  }
  warn(
    aw,
    empty.id,
    'partially_filled',
    `無法排定${empty.name}（${filled.name}已排定）`,
    blockedList(ctx, aw, empty),
  );
}

/** 主角色已經指定：配角照原本的順序找 —— 固定搭檔 → 一人兩職 → 偏好搭配 → 次數最少 */
function partnerChoices(
  ctx: EngineContext,
  aw: AssignContext,
  leader: Role,
  partner: Role,
  leaderId: MemberId,
): Choice[] {
  const choices: Choice[] = [];
  for (const pair of ctx.rules.requiredPairs) {
    const slots = matchCoupledPair(pair, leader.id, partner.id);
    if (slots !== null && slots.leaderMember === leaderId) {
      choices.push({ memberId: slots.partnerMember, dual: slots.partnerMember === leaderId });
    }
  }
  if (allowsDualRole(ctx, leaderId, leader.id, partner.id)) {
    choices.push({ memberId: leaderId, dual: true });
  }
  for (const combo of ctx.rules.preferredCombos) {
    if (
      combo.when.memberId === leaderId &&
      combo.when.roleId === leader.id &&
      combo.prefer.roleId === partner.id
    ) {
      choices.push({ memberId: combo.prefer.memberId, dual: false });
    }
  }
  const pool = stableSortBy(
    ctx.pools.get(partner.id) ?? [],
    termCountKey(ctx, partner.id, aw.week.date),
  );
  for (const memberId of pool) choices.push({ memberId, dual: false });
  return choices;
}

/** 配角已經指定：主角色先找能跟他配的人，最後才照主角色原本的順序 */
function leaderChoices(
  ctx: EngineContext,
  aw: AssignContext,
  leader: Role,
  partner: Role,
  partnerId: MemberId,
): Choice[] {
  const choices: Choice[] = [];
  for (const pair of ctx.rules.requiredPairs) {
    const slots = matchCoupledPair(pair, leader.id, partner.id);
    if (slots !== null && slots.partnerMember === partnerId) {
      choices.push({ memberId: slots.leaderMember, dual: slots.leaderMember === partnerId });
    }
  }
  if (allowsDualRole(ctx, partnerId, leader.id, partner.id)) {
    choices.push({ memberId: partnerId, dual: true });
  }
  for (const combo of ctx.rules.preferredCombos) {
    if (
      combo.prefer.memberId === partnerId &&
      combo.prefer.roleId === partner.id &&
      combo.when.roleId === leader.id
    ) {
      choices.push({ memberId: combo.when.memberId, dual: false });
    }
  }
  const pool = stableSortBy(
    ctx.pools.get(leader.id) ?? [],
    leaderKey(ctx, leader.id, aw.week.date),
  );
  for (const memberId of pool) choices.push({ memberId, dual: false });
  return choices;
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
  const pinned = pinnedIn(aw, role.id);
  if (pinned.length >= role.perWeek) return;
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

    // 含有指定服事的人的組排最前面（規格 §7.12.2）；沒有指定時這一格全部是 0
    const pinnedHere = (members: readonly MemberId[]): number =>
      -pinned.filter((memberId) => members.includes(memberId)).length;

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
      ({ members, index }) => [pinnedHere(members), pinRank(index), groupConsecutive(members)],
    );

    for (const { members: group, index: groupIndex } of usable) {
      // 指定的人先占位，其餘格子由組員補。組合本身已經查過，這裡多查一次是為了
      // 指定的人 —— 沒有指定時這兩項永遠不會擋
      const survivors: MemberId[] = [...pinned];
      for (const memberId of group) {
        if (survivors.includes(memberId)) continue;
        if (
          eligible(memberId, survivors) &&
          !violatesForbiddenTogether(ctx, role.id, [...survivors, memberId]) &&
          !violatesRoleCombinationWithin(ctx, role.id, [...survivors, memberId])
        ) {
          survivors.push(memberId);
        }
      }
      if (!survivors.some((memberId) => group.includes(memberId))) continue;

      if (survivors.length >= role.perWeek) {
        const picked = survivors.slice(pinned.length, role.perWeek);
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
      const added = picked.slice(pinned.length);
      const lastResort = lastResortSnapshot(ctx, aw, role, added);
      commit(ctx, aw, role.id, added);
      notePin(groupIndex);
      // 指定的人不算替補（規格 §7.12.2）：替補只有 survivors 之後補進來的那些
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
      reportLastResort(ctx, aw, role, added, lastResort);
      return;
    }
  }

  const need = role.perWeek - pinned.length;
  const accepts = acceptsWith(ctx, role, pinned);
  const candidates = stableSortBy(
    (ctx.pools.get(role.id) ?? []).filter(
      (memberId) => !pinned.includes(memberId) && eligible(memberId, []),
    ),
    substituteKey(ctx, role.id, date),
  );

  const combination =
    candidates.length < need ? null : pickCombination(candidates, need, accepts);
  if (candidates.length < need || (combination === null && pinned.length > 0)) {
    // 所有固定組合都湊不滿，人員池也不夠：排得上幾個就排幾個（規格 §7.11）。
    // 有指定服事時，湊不成合法組合也走這裡，不把違規的組合硬排上去
    const partial = largestCombination(candidates, need, accepts);
    if (partial === null) {
      reportEmpty(ctx, aw, role);
    } else {
      commitPartial(ctx, aw, role, partial);
    }
    return;
  }

  const picked = combination ?? candidates.slice(0, need);
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
  const pinned = pinnedIn(aw, role.id);
  const need = role.perWeek - pinned.length;
  if (need <= 0) return;

  const candidates = stableSortBy(
    (ctx.pools.get(role.id) ?? []).filter(
      (memberId) =>
        !pinned.includes(memberId) &&
        canServe(ctx, memberId, role.id, date, excludedSet(ctx, aw), aw.week.assignments),
    ),
    termCountKey(ctx, role.id, date),
  );

  // 這裡的人選也是一次挑完的，所以組合本身要查過才算數（規格 §7.7.3）
  const accepts = acceptsWith(ctx, role, pinned);
  const combination =
    candidates.length < need ? null : pickCombination(candidates, need, accepts);

  if (candidates.length < need || (combination === null && pinned.length > 0)) {
    // 人數不夠就排得上幾個就排幾個，不整個留空（規格 §7.11）。
    // 有指定服事時，湊不成合法組合也走這裡，不把違規的組合硬排上去
    const partial = largestCombination(candidates, need, accepts);
    if (partial === null) {
      reportEmpty(ctx, aw, role);
    } else {
      commitPartial(ctx, aw, role, partial);
    }
    return;
  }

  const picked = combination ?? candidates.slice(0, need);
  if (combination === null) {
    warn(aw, role.id, 'forbidden_pair_unavoidable', `${role.name}的禁止配對無法迴避`);
  }
  const lastResort = lastResortSnapshot(ctx, aw, role, picked);
  commit(ctx, aw, role.id, picked);
  reportLastResort(ctx, aw, role, picked, lastResort);
}
