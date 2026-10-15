/**
 * Transition Governance — State Machine Guardrails
 * 
 * Enforces WIP limits, hierarchical RBAC security levels, and task compliance barriers.
 */

import {
  IColumn,
  IUserContext,
  PendingTasksBlockedError,
  UnauthorizedTransitionError,
  WipLimitExceededError,
} from '../interfaces';

export class TransitionGovernance {
  /**
   * Verifies that moving a card to the target column does not violate Work In Progress (WIP) capacity.
   */
  public static validateWipLimit(
    targetColumn: IColumn,
    currentCount: number,
    isCrossColumnMove: boolean
  ): void {
    if (!isCrossColumnMove) return;

    if (
      targetColumn.maxWipLimit !== undefined &&
      targetColumn.maxWipLimit !== null &&
      targetColumn.maxWipLimit > 0
    ) {
      if (currentCount >= targetColumn.maxWipLimit) {
        throw new WipLimitExceededError(
          targetColumn.id,
          targetColumn.name,
          targetColumn.maxWipLimit,
          currentCount
        );
      }
    }
  }

  /**
   * Enforces Role-Based Access Control (RBAC) security thresholds on columns.
   */
  public static validateSecurityLevel(
    column: IColumn,
    user?: IUserContext
  ): void {
    if (
      column.securityLevel !== undefined &&
      column.securityLevel !== null &&
      column.securityLevel > 0
    ) {
      const userLevel = user?.roleLevel ?? 0;
      if (userLevel < column.securityLevel) {
        throw new UnauthorizedTransitionError(
          column.id,
          userLevel,
          column.securityLevel
        );
      }
    }
  }

  /**
   * Ensures all origin tasks are marked as DONE before a card leaves a strict governance column.
   */
  public static validatePendingTasks(
    cardId: string,
    sourceColumn: IColumn,
    hasPendingTasks: boolean,
    isCrossColumnMove: boolean
  ): void {
    if (!isCrossColumnMove) return;

    if (sourceColumn.requiresCompletedTasks && hasPendingTasks) {
      throw new PendingTasksBlockedError(cardId, sourceColumn.id);
    }
  }
}
