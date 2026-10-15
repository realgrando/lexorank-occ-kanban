/**
 * In-Memory Board Storage Adapter
 * Zero-dependency, thread-safe memory storage for local simulation, testing, and edge runtimes.
 */

import {
  IBoard,
  IBoardStorageDriver,
  ICard,
  IColumn,
  ITask,
} from '../../interfaces';

export class InMemoryBoardStorage implements IBoardStorageDriver {
  private readonly boards = new Map<string, IBoard>();
  private readonly columns = new Map<string, IColumn>();
  private readonly cards = new Map<string, ICard>();
  private readonly tasks = new Map<string, ITask>();

  public async getBoardById(boardId: string): Promise<IBoard | null> {
    return this.boards.get(boardId) ?? null;
  }

  public async getColumnById(columnId: string): Promise<IColumn | null> {
    return this.columns.get(columnId) ?? null;
  }

  public async getCardById(cardId: string): Promise<ICard | null> {
    return this.cards.get(cardId) ?? null;
  }

  public async getCardsByColumn(columnId: string): Promise<ICard[]> {
    return Array.from(this.cards.values())
      .filter((c) => c.columnId === columnId && !c.isArchived)
      .sort((a, b) => a.position - b.position);
  }

  public async countActiveCardsInColumn(columnId: string): Promise<number> {
    return Array.from(this.cards.values()).filter(
      (c) => c.columnId === columnId && !c.isArchived
    ).length;
  }

  public async hasPendingTasks(
    cardId: string,
    columnId?: string
  ): Promise<boolean> {
    return Array.from(this.tasks.values()).some((t) => {
      if (t.cardId !== cardId) return false;
      if (columnId && t.columnId && t.columnId !== columnId) return false;
      return t.status !== 'DONE';
    });
  }

  public async updateCardPositionAndVersion(
    cardId: string,
    columnId: string,
    position: number,
    newVersion: number,
    metadata?: Record<string, unknown>
  ): Promise<ICard> {
    const existing = this.cards.get(cardId);
    if (!existing) {
      throw new Error(`Card with ID "${cardId}" not found in memory store.`);
    }

    const updated: ICard = {
      ...existing,
      columnId,
      position,
      version: newVersion,
      metadata: metadata ? { ...existing.metadata, ...metadata } : existing.metadata,
      updatedAt: new Date(),
    };

    this.cards.set(cardId, updated);
    return updated;
  }

  public async bulkUpdateCardPositions(
    updates: Array<{ cardId: string; position: number }>
  ): Promise<void> {
    const now = new Date();
    for (const update of updates) {
      const existing = this.cards.get(update.cardId);
      if (existing) {
        this.cards.set(update.cardId, {
          ...existing,
          position: update.position,
          updatedAt: now,
        });
      }
    }
  }

  public async createBoard(
    board: Omit<IBoard, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<IBoard> {
    const id = this.generateId();
    const now = new Date();
    const created: IBoard = { ...board, id, createdAt: now, updatedAt: now };
    this.boards.set(id, created);
    return created;
  }

  public async createColumn(
    column: Omit<IColumn, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<IColumn> {
    const id = this.generateId();
    const now = new Date();
    const created: IColumn = { ...column, id, createdAt: now, updatedAt: now };
    this.columns.set(id, created);
    return created;
  }

  public async createCard(
    card: Omit<ICard, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ICard> {
    const id = this.generateId();
    const now = new Date();
    const created: ICard = {
      ...card,
      id,
      version: card.version ?? 1,
      createdAt: now,
      updatedAt: now,
    };
    this.cards.set(id, created);
    return created;
  }

  public async createTask(
    task: Omit<ITask, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ITask> {
    const id = this.generateId();
    const now = new Date();
    const created: ITask = { ...task, id, createdAt: now, updatedAt: now };
    this.tasks.set(id, created);
    return created;
  }

  public async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    // In-memory simulation: transactions run synchronously in the Node event loop
    return fn(this);
  }

  public clear(): void {
    this.boards.clear();
    this.columns.clear();
    this.cards.clear();
    this.tasks.clear();
  }

  private generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
