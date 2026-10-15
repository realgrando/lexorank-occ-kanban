/**
 * Drizzle ORM Storage Driver for LexoRank OCC Kanban
 * Persistent PostgreSQL adapter with transactional guarantees and atomic OCC updates.
 */

import { and, asc, count, eq, ne } from 'drizzle-orm';
import {
  IBoard,
  IBoardStorageDriver,
  ICard,
  IColumn,
  ITask,
} from '../../interfaces';
import { boards, cards, columns, tasks } from './schema';

export class DrizzleBoardStorage implements IBoardStorageDriver {
  private readonly db: any;

  constructor(drizzleDbInstance: any) {
    this.db = drizzleDbInstance;
  }

  private getExecutor(tx?: unknown): any {
    return (tx as any) ?? this.db;
  }

  public async getBoardById(
    boardId: string,
    tx?: unknown
  ): Promise<IBoard | null> {
    const executor = this.getExecutor(tx);
    const rows = await executor
      .select()
      .from(boards)
      .where(eq(boards.id, boardId))
      .limit(1);

    return rows.length > 0 ? this.mapBoard(rows[0]) : null;
  }

  public async getColumnById(
    columnId: string,
    tx?: unknown
  ): Promise<IColumn | null> {
    const executor = this.getExecutor(tx);
    const rows = await executor
      .select()
      .from(columns)
      .where(eq(columns.id, columnId))
      .limit(1);

    return rows.length > 0 ? this.mapColumn(rows[0]) : null;
  }

  public async getCardById(
    cardId: string,
    tx?: unknown
  ): Promise<ICard | null> {
    const executor = this.getExecutor(tx);
    const rows = await executor
      .select()
      .from(cards)
      .where(eq(cards.id, cardId))
      .limit(1);

    return rows.length > 0 ? this.mapCard(rows[0]) : null;
  }

  public async getCardsByColumn(
    columnId: string,
    tx?: unknown
  ): Promise<ICard[]> {
    const executor = this.getExecutor(tx);
    const rows = await executor
      .select()
      .from(cards)
      .where(and(eq(cards.columnId, columnId), eq(cards.isArchived, false)))
      .orderBy(asc(cards.position));

    return rows.map((r: any) => this.mapCard(r));
  }

  public async countActiveCardsInColumn(
    columnId: string,
    tx?: unknown
  ): Promise<number> {
    const executor = this.getExecutor(tx);
    const [res] = await executor
      .select({ count: count() })
      .from(cards)
      .where(and(eq(cards.columnId, columnId), eq(cards.isArchived, false)));

    return Number(res?.count || 0);
  }

  public async hasPendingTasks(
    cardId: string,
    columnId?: string,
    tx?: unknown
  ): Promise<boolean> {
    const executor = this.getExecutor(tx);
    const conditions = [
      eq(tasks.cardId, cardId),
      ne(tasks.status, 'DONE'),
    ];

    if (columnId) {
      conditions.push(eq(tasks.columnId, columnId));
    }

    const [res] = await executor
      .select({ count: count() })
      .from(tasks)
      .where(and(...conditions));

    return Number(res?.count || 0) > 0;
  }

  public async updateCardPositionAndVersion(
    cardId: string,
    columnId: string,
    position: number,
    newVersion: number,
    metadata?: Record<string, unknown>,
    tx?: unknown
  ): Promise<ICard> {
    const executor = this.getExecutor(tx);
    const updatePayload: any = {
      columnId,
      position,
      version: newVersion,
      updatedAt: new Date(),
    };

    if (metadata !== undefined) {
      updatePayload.metadata = metadata;
    }

    const [updated] = await executor
      .update(cards)
      .set(updatePayload)
      .where(eq(cards.id, cardId))
      .returning();

    if (!updated) {
      throw new Error(`Card ${cardId} not found during update.`);
    }

    return this.mapCard(updated);
  }

  public async bulkUpdateCardPositions(
    updates: Array<{ cardId: string; position: number }>,
    tx?: unknown
  ): Promise<void> {
    const executor = this.getExecutor(tx);
    const now = new Date();

    for (const update of updates) {
      await executor
        .update(cards)
        .set({ position: update.position, updatedAt: now })
        .where(eq(cards.id, update.cardId));
    }
  }

  public async createBoard(
    board: Omit<IBoard, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: unknown
  ): Promise<IBoard> {
    const executor = this.getExecutor(tx);
    const [created] = await executor
      .insert(boards)
      .values({
        name: board.name,
        description: board.description,
      })
      .returning();

    return this.mapBoard(created);
  }

  public async createColumn(
    column: Omit<IColumn, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: unknown
  ): Promise<IColumn> {
    const executor = this.getExecutor(tx);
    const [created] = await executor
      .insert(columns)
      .values({
        boardId: column.boardId,
        name: column.name,
        position: column.position,
        maxWipLimit: column.maxWipLimit,
        securityLevel: column.securityLevel,
        requiresCompletedTasks: column.requiresCompletedTasks ?? false,
      })
      .returning();

    return this.mapColumn(created);
  }

  public async createCard(
    card: Omit<ICard, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: unknown
  ): Promise<ICard> {
    const executor = this.getExecutor(tx);
    const [created] = await executor
      .insert(cards)
      .values({
        boardId: card.boardId,
        columnId: card.columnId,
        title: card.title,
        position: card.position,
        version: card.version ?? 1,
        metadata: card.metadata,
        isArchived: card.isArchived ?? false,
      })
      .returning();

    return this.mapCard(created);
  }

  public async createTask(
    task: Omit<ITask, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: unknown
  ): Promise<ITask> {
    const executor = this.getExecutor(tx);
    const [created] = await executor
      .insert(tasks)
      .values({
        cardId: task.cardId,
        columnId: task.columnId,
        title: task.title,
        status: task.status ?? 'TODO',
      })
      .returning();

    return this.mapTask(created);
  }

  public async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    if (typeof this.db.transaction === 'function') {
      return this.db.transaction(fn);
    }
    return fn(this.db);
  }

  private mapBoard(row: any): IBoard {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  private mapColumn(row: any): IColumn {
    return {
      id: row.id,
      boardId: row.boardId,
      name: row.name,
      position: Number(row.position),
      maxWipLimit: row.maxWipLimit ? Number(row.maxWipLimit) : null,
      securityLevel: row.securityLevel ? Number(row.securityLevel) : null,
      requiresCompletedTasks: Boolean(row.requiresCompletedTasks),
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  private mapCard(row: any): ICard {
    return {
      id: row.id,
      boardId: row.boardId,
      columnId: row.columnId,
      title: row.title,
      position: Number(row.position),
      version: Number(row.version),
      metadata: row.metadata,
      isArchived: Boolean(row.isArchived),
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  private mapTask(row: any): ITask {
    return {
      id: row.id,
      cardId: row.cardId,
      columnId: row.columnId,
      title: row.title,
      status: row.status,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }
}
