/**
 * Kanban OCC Engine — Core State Machine & Transaction Orchestrator
 * 
 * Orchestrates O(1) fractional indexing, Optimistic Concurrency Control (OCC),
 * and transition governance within ACID transactions.
 */

import {
  CardNotFoundError,
  ColumnNotFoundError,
  IBoardStorageDriver,
  ICard,
  IKanbanEngineOptions,
  MoveCardInput,
  MoveCardResult,
  StaleVersionConflictError,
} from '../interfaces';
import { TransitionGovernance } from './governance';
import { LexorankPositioner } from './positioner';

export class KanbanOccEngine {
  private readonly storage: IBoardStorageDriver;
  private readonly baseSpacing: number;
  private readonly minCollisionGap: number;

  constructor(options: IKanbanEngineOptions) {
    this.storage = options.storageDriver;
    this.baseSpacing = options.baseSpacing ?? LexorankPositioner.DEFAULT_SPACING;
    this.minCollisionGap =
      options.minCollisionGap ?? LexorankPositioner.MIN_COLLISION_GAP;
  }

  /**
   * Moves a card to a target column and/or reorders it within the lane.
   * Enforces OCC version checking, governance guardrails, and O(1) midpoint positioning.
   */
  public async moveCard(
    input: MoveCardInput,
    tx?: unknown
  ): Promise<MoveCardResult> {
    const execute = async (trx: unknown): Promise<MoveCardResult> => {
      // 1. Fetch current card state
      const card = await this.storage.getCardById(input.cardId, trx);
      if (!card) {
        throw new CardNotFoundError(input.cardId);
      }

      // 2. Optimistic Concurrency Control (OCC) Barrier
      // Prevents the "Lost Update" anomaly when multiple actors move the card concurrently
      if (card.version !== input.expectedVersion) {
        throw new StaleVersionConflictError(
          card.id,
          input.expectedVersion,
          card.version
        );
      }

      // 3. Resolve origin and target columns
      const sourceColumn = await this.storage.getColumnById(card.columnId, trx);
      if (!sourceColumn) {
        throw new ColumnNotFoundError(card.columnId);
      }

      const targetColumn = await this.storage.getColumnById(
        input.targetColumnId,
        trx
      );
      if (!targetColumn) {
        throw new ColumnNotFoundError(input.targetColumnId);
      }

      const isCrossColumnMove = card.columnId !== input.targetColumnId;

      // 4. Governance Guardrail: Security / RBAC Check
      TransitionGovernance.validateSecurityLevel(sourceColumn, input.user);
      TransitionGovernance.validateSecurityLevel(targetColumn, input.user);

      // 5. Governance Guardrail: Pending Required Tasks
      if (isCrossColumnMove && sourceColumn.requiresCompletedTasks) {
        const hasPending = await this.storage.hasPendingTasks(
          card.id,
          sourceColumn.id,
          trx
        );
        TransitionGovernance.validatePendingTasks(
          card.id,
          sourceColumn,
          hasPending,
          isCrossColumnMove
        );
      }

      // 6. Governance Guardrail: Target Column WIP Limits
      if (isCrossColumnMove && targetColumn.maxWipLimit) {
        const currentWipCount =
          await this.storage.countActiveCardsInColumn(targetColumn.id, trx);
        TransitionGovernance.validateWipLimit(
          targetColumn,
          currentWipCount,
          isCrossColumnMove
        );
      }

      // 7. Fractional Indexing Positioning
      let newPosition: number;
      let rebalanced = false;
      let rebalancedCardsCount = 0;

      if (input.targetPosition !== undefined) {
        newPosition = input.targetPosition;
      } else {
        const targetCards = await this.storage.getCardsByColumn(
          targetColumn.id,
          trx
        );

        // Exclude the card itself if reordering within the same column
        const siblingCards = isCrossColumnMove
          ? targetCards
          : targetCards.filter((c) => c.id !== card.id);

        const positionCalc = LexorankPositioner.calculateInsertPosition(
          siblingCards,
          input.overCardId,
          input.relativePlacement,
          this.minCollisionGap
        );

        if (positionCalc.requiresRebalance) {
          // Gap exhaustion detected -> Rebalance the entire column
          const simulatedCard: ICard = {
            ...card,
            columnId: targetColumn.id,
            position: positionCalc.position,
          };
          const allCardsToRebalance = [...siblingCards, simulatedCard];
          const rebalancePlan = LexorankPositioner.rebalanceColumn(
            allCardsToRebalance,
            this.baseSpacing
          );

          await this.storage.bulkUpdateCardPositions(rebalancePlan, trx);

          newPosition =
            rebalancePlan.find((p) => p.cardId === card.id)?.position ??
            positionCalc.position;
          rebalanced = true;
          rebalancedCardsCount = rebalancePlan.length;
        } else {
          newPosition = positionCalc.position;
        }
      }

      // 8. Atomic Mutation: Increment version and persist new position
      const nextVersion = card.version + 1;
      const updatedCard = await this.storage.updateCardPositionAndVersion(
        card.id,
        targetColumn.id,
        newPosition,
        nextVersion,
        undefined,
        trx
      );

      return {
        card: updatedCard,
        previousColumnId: card.columnId,
        newPosition,
        rebalanced,
        rebalancedCardsCount: rebalanced ? rebalancedCardsCount : undefined,
      };
    };

    // If caller provided an active transaction, reuse it; otherwise, wrap in storage transaction
    return tx ? execute(tx) : this.storage.transaction(execute);
  }

  // Convenience helper delegations
  public async getCards(columnId: string, tx?: unknown) {
    return this.storage.getCardsByColumn(columnId, tx);
  }

  public async getCard(cardId: string, tx?: unknown) {
    return this.storage.getCardById(cardId, tx);
  }
}
