/**
 * NestJS Injectable Service Wrapper for KanbanOccEngine
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { KanbanOccEngine } from '../../core/engine';
import {
  IBoardStorageDriver,
  MoveCardInput,
  MoveCardResult,
} from '../../interfaces';
import { KANBAN_STORAGE_TOKEN } from './tokens';

@Injectable()
export class KanbanOccService {
  private readonly logger = new Logger(KanbanOccService.name);
  private readonly engine: KanbanOccEngine;

  constructor(
    @Inject(KANBAN_STORAGE_TOKEN)
    private readonly storageDriver: IBoardStorageDriver
  ) {
    this.engine = new KanbanOccEngine({
      storageDriver: this.storageDriver,
    });
  }

  public getRawEngine(): KanbanOccEngine {
    return this.engine;
  }

  public async moveCard(
    input: MoveCardInput,
    tx?: unknown
  ): Promise<MoveCardResult> {
    const result = await this.engine.moveCard(input, tx);
    this.logger.log(
      `Card <${result.card.id}> moved to Column <${result.card.columnId}> (Pos: ${result.newPosition}, Version: ${result.card.version})`
    );
    if (result.rebalanced) {
      this.logger.warn(
        `Column <${result.card.columnId}> rebalanced due to integer gap exhaustion (${result.rebalancedCardsCount} cards adjusted).`
      );
    }
    return result;
  }
}
