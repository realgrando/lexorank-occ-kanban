import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryBoardStorage,
  KanbanOccEngine,
  LexorankPositioner,
  PendingTasksBlockedError,
  StaleVersionConflictError,
  UnauthorizedTransitionError,
  WipLimitExceededError,
} from '../src';

describe('KanbanOccEngine & LexorankPositioner (Unit & Integration Tests)', () => {
  let storage: InMemoryBoardStorage;
  let engine: KanbanOccEngine;
  let boardId: string;
  let colAId: string;
  let colBId: string;
  let colStrictWipId: string;
  let colStrictSecId: string;
  let colTasksRequiredId: string;

  beforeEach(async () => {
    storage = new InMemoryBoardStorage();
    engine = new KanbanOccEngine({ storageDriver: storage });

    const board = await storage.createBoard({ name: 'Sprint Board' });
    boardId = board.id;

    const colA = await storage.createColumn({
      boardId,
      name: 'To Do',
      position: 1000,
    });
    colAId = colA.id;

    const colB = await storage.createColumn({
      boardId,
      name: 'Doing',
      position: 2000,
    });
    colBId = colB.id;

    const colWip = await storage.createColumn({
      boardId,
      name: 'Testing (WIP: 1)',
      position: 3000,
      maxWipLimit: 1,
    });
    colStrictWipId = colWip.id;

    const colSec = await storage.createColumn({
      boardId,
      name: 'Production Deploy (Sec: 3)',
      position: 4000,
      securityLevel: 3,
    });
    colStrictSecId = colSec.id;

    const colTasks = await storage.createColumn({
      boardId,
      name: 'Code Review (Requires Tasks)',
      position: 2500,
      requiresCompletedTasks: true,
    });
    colTasksRequiredId = colTasks.id;
  });

  describe('LexorankPositioner', () => {
    it('should assign default initial position (65536) when column is empty', () => {
      const res = LexorankPositioner.calculateMidpoint(undefined, undefined);
      expect(res.position).toBe(65536);
      expect(res.requiresRebalance).toBe(false);
    });

    it('should assign half position when inserting before first element', () => {
      const res = LexorankPositioner.calculateMidpoint(undefined, 65536);
      expect(res.position).toBe(32768);
      expect(res.requiresRebalance).toBe(false);
    });

    it('should append with standard spacing after last element', () => {
      const res = LexorankPositioner.calculateMidpoint(65536, undefined);
      expect(res.position).toBe(131072);
      expect(res.requiresRebalance).toBe(false);
    });

    it('should calculate integer midpoint between two adjacent positions', () => {
      const res = LexorankPositioner.calculateMidpoint(100, 200);
      expect(res.position).toBe(150);
      expect(res.requiresRebalance).toBe(false);
    });

    it('should detect gap exhaustion when distance is <= 1', () => {
      const res = LexorankPositioner.calculateMidpoint(100, 101);
      expect(res.requiresRebalance).toBe(true);
    });
  });

  describe('Optimistic Concurrency Control (OCC)', () => {
    it('should move card and atomically increment version from 1 to 2', async () => {
      const card = await storage.createCard({
        boardId,
        columnId: colAId,
        title: 'Refactor Auth Service',
        position: 65536,
        version: 1,
        isArchived: false,
      });

      const res = await engine.moveCard({
        cardId: card.id,
        targetColumnId: colBId,
        expectedVersion: 1,
      });

      expect(res.card.columnId).toBe(colBId);
      expect(res.card.version).toBe(2);
      expect(res.previousColumnId).toBe(colAId);
    });

    it('should throw StaleVersionConflictError (409) when version does not match database', async () => {
      const card = await storage.createCard({
        boardId,
        columnId: colAId,
        title: 'Fix Database Leak',
        position: 65536,
        version: 3,
        isArchived: false,
      });

      // User submits move with stale version = 2
      await expect(
        engine.moveCard({
          cardId: card.id,
          targetColumnId: colBId,
          expectedVersion: 2,
        })
      ).rejects.toThrow(StaleVersionConflictError);
    });
  });

  describe('Governance Guardrails', () => {
    it('should block move with WipLimitExceededError when target column is full', async () => {
      // 1. Fill the WIP limit of 1
      await storage.createCard({
        boardId,
        columnId: colStrictWipId,
        title: 'Existing Test Task',
        position: 65536,
        version: 1,
        isArchived: false,
      });

      // 2. Try moving a second card into colStrictWipId
      const newCard = await storage.createCard({
        boardId,
        columnId: colAId,
        title: 'Overflow Task',
        position: 65536,
        version: 1,
        isArchived: false,
      });

      await expect(
        engine.moveCard({
          cardId: newCard.id,
          targetColumnId: colStrictWipId,
          expectedVersion: 1,
        })
      ).rejects.toThrow(WipLimitExceededError);
    });

    it('should block move with UnauthorizedTransitionError if user lacks required role level', async () => {
      const card = await storage.createCard({
        boardId,
        columnId: colAId,
        title: 'Deploy to Kubernetes',
        position: 65536,
        version: 1,
        isArchived: false,
      });

      // User has level 1, but column requires level 3
      await expect(
        engine.moveCard({
          cardId: card.id,
          targetColumnId: colStrictSecId,
          expectedVersion: 1,
          user: { userId: 'u-operator', roleLevel: 1 },
        })
      ).rejects.toThrow(UnauthorizedTransitionError);

      // User with level 3 or higher must succeed
      const allowedMove = await engine.moveCard({
        cardId: card.id,
        targetColumnId: colStrictSecId,
        expectedVersion: 1,
        user: { userId: 'u-lead', roleLevel: 3 },
      });
      expect(allowedMove.card.columnId).toBe(colStrictSecId);
    });

    it('should block move with PendingTasksBlockedError when origin column requires completed tasks', async () => {
      const card = await storage.createCard({
        boardId,
        columnId: colTasksRequiredId,
        title: 'PR Feature Review',
        position: 65536,
        version: 1,
        isArchived: false,
      });

      // Add pending task
      await storage.createTask({
        cardId: card.id,
        columnId: colTasksRequiredId,
        title: 'Unit Test Coverage Verification',
        status: 'IN_PROGRESS', // Not DONE
      });

      // Trying to move out of colTasksRequiredId must fail
      await expect(
        engine.moveCard({
          cardId: card.id,
          targetColumnId: colBId,
          expectedVersion: 1,
        })
      ).rejects.toThrow(PendingTasksBlockedError);
    });
  });

  describe('Gap Exhaustion & Automatic Column Rebalancing', () => {
    it('should automatically rebalance column when integer gap is exhausted', async () => {
      // Create tight cards: gap is 1 (pos 10 and 11)
      await storage.createCard({
        boardId,
        columnId: colAId,
        title: 'Tight Card 1',
        position: 10,
        version: 1,
        isArchived: false,
      });

      const tightCard2 = await storage.createCard({
        boardId,
        columnId: colAId,
        title: 'Tight Card 2',
        position: 11,
        version: 1,
        isArchived: false,
      });

      const cardToInsert = await storage.createCard({
        boardId,
        columnId: colBId,
        title: 'Incoming Card',
        position: 999,
        version: 1,
        isArchived: false,
      });

      // Move cardToInsert right before tightCard2 (between 10 and 11)
      const moveRes = await engine.moveCard({
        cardId: cardToInsert.id,
        targetColumnId: colAId,
        expectedVersion: 1,
        overCardId: tightCard2.id,
        relativePlacement: 'before',
      });

      expect(moveRes.rebalanced).toBe(true);
      expect(moveRes.rebalancedCardsCount).toBe(3);

      const allColACards = await storage.getCardsByColumn(colAId);
      // Verify healthy intervals are restored (multiples of 65536)
      expect(allColACards[0].position).toBe(65536);
      expect(allColACards[1].position).toBe(131072);
      expect(allColACards[2].position).toBe(196608);
    });
  });
});
