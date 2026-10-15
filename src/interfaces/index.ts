/**
 * LexoRank OCC Kanban — Domain Contracts & Port Interfaces
 * Hexagonal Architecture / Ports & Adapters
 */

export interface IBoard {
  id: string;
  name: string;
  description?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IColumn {
  id: string;
  boardId: string;
  name: string;
  position: number;
  maxWipLimit?: number | null;
  securityLevel?: number | null; // Numeric role threshold (e.g. 1 = Standard, 2 = Senior, 4 = Admin)
  requiresCompletedTasks?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICard {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  position: number;
  version: number; // Optimistic Concurrency Control (OCC) version
  metadata?: Record<string, unknown> | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITask {
  id: string;
  cardId: string;
  columnId?: string | null;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserContext {
  userId: string;
  roleLevel: number;
  metadata?: Record<string, unknown>;
}

export interface MoveCardInput {
  cardId: string;
  targetColumnId: string;
  expectedVersion: number; // OCC check
  overCardId?: string; // Target card to place before/after
  relativePlacement?: 'before' | 'after';
  targetPosition?: number; // Explicit position if pre-calculated
  user?: IUserContext;
}

export interface MoveCardResult {
  card: ICard;
  previousColumnId: string;
  newPosition: number;
  rebalanced: boolean;
  rebalancedCardsCount?: number;
}

// -----------------------------------------------------------------------------
// Domain Exceptions (Deterministic Failures)
// -----------------------------------------------------------------------------

export class StaleVersionConflictError extends Error {
  public readonly statusCode = 409;
  constructor(
    public readonly cardId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `Optimistic Concurrency Control conflict on card <${cardId}>: expected version ${expectedVersion}, but actual database version is ${actualVersion}.`
    );
    this.name = 'StaleVersionConflictError';
  }
}

export class WipLimitExceededError extends Error {
  public readonly statusCode = 400;
  constructor(
    public readonly columnId: string,
    public readonly columnName: string,
    public readonly maxWipLimit: number,
    public readonly currentCount: number
  ) {
    super(
      `WIP limit exceeded for column "${columnName}" <${columnId}>: current count is ${currentCount}, maximum allowed capacity is ${maxWipLimit}.`
    );
    this.name = 'WipLimitExceededError';
  }
}

export class UnauthorizedTransitionError extends Error {
  public readonly statusCode = 403;
  constructor(
    public readonly columnId: string,
    public readonly userLevel: number,
    public readonly requiredLevel: number
  ) {
    super(
      `Access denied for column <${columnId}>: user security level ${userLevel} is below required threshold ${requiredLevel}.`
    );
    this.name = 'UnauthorizedTransitionError';
  }
}

export class PendingTasksBlockedError extends Error {
  public readonly statusCode = 400;
  constructor(public readonly cardId: string, public readonly sourceColumnId: string) {
    super(
      `Cannot move card <${cardId}> from column <${sourceColumnId}>: there are pending uncompleted tasks required by governance.`
    );
    this.name = 'PendingTasksBlockedError';
  }
}

export class CardNotFoundError extends Error {
  public readonly statusCode = 404;
  constructor(public readonly cardId: string) {
    super(`Card <${cardId}> not found.`);
    this.name = 'CardNotFoundError';
  }
}

export class ColumnNotFoundError extends Error {
  public readonly statusCode = 404;
  constructor(public readonly columnId: string) {
    super(`Column <${columnId}> not found.`);
    this.name = 'ColumnNotFoundError';
  }
}

// -----------------------------------------------------------------------------
// Ports (Storage and Infrastructure Contracts)
// -----------------------------------------------------------------------------

export interface IBoardStorageDriver {
  getBoardById(boardId: string, tx?: unknown): Promise<IBoard | null>;
  getColumnById(columnId: string, tx?: unknown): Promise<IColumn | null>;
  getCardById(cardId: string, tx?: unknown): Promise<ICard | null>;
  getCardsByColumn(columnId: string, tx?: unknown): Promise<ICard[]>;
  countActiveCardsInColumn(columnId: string, tx?: unknown): Promise<number>;
  hasPendingTasks(cardId: string, columnId?: string, tx?: unknown): Promise<boolean>;

  updateCardPositionAndVersion(
    cardId: string,
    columnId: string,
    position: number,
    newVersion: number,
    metadata?: Record<string, unknown>,
    tx?: unknown
  ): Promise<ICard>;

  bulkUpdateCardPositions(
    updates: Array<{ cardId: string; position: number }>,
    tx?: unknown
  ): Promise<void>;

  createBoard(board: Omit<IBoard, 'id' | 'createdAt' | 'updatedAt'>, tx?: unknown): Promise<IBoard>;
  createColumn(column: Omit<IColumn, 'id' | 'createdAt' | 'updatedAt'>, tx?: unknown): Promise<IColumn>;
  createCard(card: Omit<ICard, 'id' | 'createdAt' | 'updatedAt'>, tx?: unknown): Promise<ICard>;
  createTask(task: Omit<ITask, 'id' | 'createdAt' | 'updatedAt'>, tx?: unknown): Promise<ITask>;

  transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface IKanbanEngineOptions {
  storageDriver: IBoardStorageDriver;
  baseSpacing?: number;
  minCollisionGap?: number;
}
