/** 引擎的對外介面。UI 只透過這裡取用，不直接 import 內部模組。 */

export { runScheduler } from './run';
export { ProjectValidationError, validateProject } from './context';
export { SCHEMA_VERSION } from './schema';
export { addDays, fromEpochDay, isIsoDate, toEpochDay, weekdayOf } from './dates';
export type {
  BlockedCandidate,
  BlockReason,
  Constraint,
  ConstraintType,
  GoldenRoster,
  IsoDate,
  Member,
  MemberId,
  MemberTally,
  Project,
  Role,
  RoleId,
  RoleSlot,
  RosterResult,
  RosterWarning,
  RosterWeek,
  SoftViolation,
  Term,
  Week,
  WeekTag,
  WeekTagId,
  WeekTagRule,
} from './schema';
