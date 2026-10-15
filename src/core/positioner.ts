/**
 * Lexorank Positioner — O(1) Fractional Indexing Algorithm
 * 
 * Implements deterministic integer midpoint interpolation with gap exhaustion
 * detection and column rebalancing.
 */

import { ICard } from '../interfaces';

export interface PositionCalculationResult {
  position: number;
  requiresRebalance: boolean;
}

export class LexorankPositioner {
  public static readonly DEFAULT_INITIAL_POSITION = 65536;
  public static readonly DEFAULT_SPACING = 65536;
  public static readonly MIN_COLLISION_GAP = 2;

  /**
   * Calculates the deterministic midpoint between two positions.
   * If the gap between prev and next is <= 1, gap exhaustion occurs and triggers a rebalance requirement.
   */
  public static calculateMidpoint(
    prevPosition?: number,
    nextPosition?: number,
    minGap = LexorankPositioner.MIN_COLLISION_GAP
  ): PositionCalculationResult {
    // 1. Column is empty
    if (prevPosition === undefined && nextPosition === undefined) {
      return {
        position: LexorankPositioner.DEFAULT_INITIAL_POSITION,
        requiresRebalance: false,
      };
    }

    // 2. Inserting at the very top of the column (before the first item)
    if (prevPosition === undefined && nextPosition !== undefined) {
      if (nextPosition <= 1) {
        return {
          position: 1,
          requiresRebalance: true,
        };
      }
      const position = Math.floor(nextPosition / 2);
      return {
        position,
        requiresRebalance: position <= 1,
      };
    }

    // 3. Inserting at the very bottom of the column (after the last item)
    if (prevPosition !== undefined && nextPosition === undefined) {
      return {
        position: prevPosition + LexorankPositioner.DEFAULT_SPACING,
        requiresRebalance: false,
      };
    }

    // 4. Inserting between two existing items
    const prev = prevPosition as number;
    const next = nextPosition as number;
    const gap = next - prev;

    if (gap < minGap) {
      // Gap exhaustion: No integer space left between adjacent positions
      return {
        position: prev,
        requiresRebalance: true,
      };
    }

    const midpoint = prev + Math.floor(gap / 2);
    return {
      position: midpoint,
      requiresRebalance: false,
    };
  }

  /**
   * Computes position when dropping a card relative to an existing card in a column.
   */
  public static calculateInsertPosition(
    cards: ICard[],
    overCardId?: string,
    relativePlacement: 'before' | 'after' = 'before',
    minGap = LexorankPositioner.MIN_COLLISION_GAP
  ): PositionCalculationResult {
    const sorted = [...cards].sort((a, b) => a.position - b.position);

    if (sorted.length === 0) {
      return {
        position: LexorankPositioner.DEFAULT_INITIAL_POSITION,
        requiresRebalance: false,
      };
    }

    if (!overCardId) {
      // Default: append to the bottom
      const last = sorted[sorted.length - 1];
      return LexorankPositioner.calculateMidpoint(last.position, undefined, minGap);
    }

    const overIndex = sorted.findIndex((c) => c.id === overCardId);
    if (overIndex === -1) {
      const last = sorted[sorted.length - 1];
      return LexorankPositioner.calculateMidpoint(last.position, undefined, minGap);
    }

    if (relativePlacement === 'before') {
      const nextPos = sorted[overIndex].position;
      const prevPos = sorted[overIndex - 1]?.position;
      return LexorankPositioner.calculateMidpoint(prevPos, nextPos, minGap);
    } else {
      const prevPos = sorted[overIndex].position;
      const nextPos = sorted[overIndex + 1]?.position;
      return LexorankPositioner.calculateMidpoint(prevPos, nextPos, minGap);
    }
  }

  /**
   * Rebalances an entire column to restore generous spacing gaps (65536) between cards.
   * Executed only when gap exhaustion occurs.
   */
  public static rebalanceColumn(
    cards: ICard[],
    baseSpacing = LexorankPositioner.DEFAULT_SPACING
  ): Array<{ cardId: string; position: number }> {
    const sorted = [...cards].sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return sorted.map((card, index) => ({
      cardId: card.id,
      position: (index + 1) * baseSpacing,
    }));
  }
}
