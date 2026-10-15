# lexorank-occ-kanban

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript: Strict](https://img.shields.io/badge/TypeScript-Strict%205.7-blue.svg)](https://www.typescriptlang.org/)
[![Architecture: Hexagonal](https://img.shields.io/badge/Architecture-Ports%20%26%20Adapters-emerald.svg)](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software))
[![Tests: Vitest](https://img.shields.io/badge/Tests-Vitest%20Passed-brightgreen.svg)](https://vitest.dev/)

> **Architectural Context & Origin**  
> I originally architected and engineered this core workflow engine inside **`nivix-os`**, the proprietary operating monolith of [Nivix Company](https://github.com/nivix-company). In our multi-tenant operations, multiple human sales closers, operational squads, and automated background workers were constantly dragging and updating high-value cards concurrently. The naive implementation—re-indexing arrays with mass SQL updates and trusting unversioned payloads—caused recurring database lock contention, deadlocks, and silent lost updates.  
> To solve this, I designed a decoupled engine combining Jira-style $O(1)$ fractional midpoint indexing (Lexorank algorithm) with strict Optimistic Concurrency Control (OCC) and domain transition guardrails (WIP Limits, RBAC, and Task Compliance). This repository is a sanitized, open-core extraction of that architecture, published as a reference implementation using the Hexagonal (Ports & Adapters) pattern.

---

## The Architectural Problem: O(N) Re-indexing & Lost Updates

Standard web tutorials and open-source Kanban prototypes persist item order using sequential integers (`0, 1, 2, 3...`):

```sql
-- The Naive Re-indexing Anti-Pattern
UPDATE tasks 
SET position = position + 1 
WHERE column_id = $1 AND position >= $2;
```

This pattern breaks down under concurrent real-world workloads:

1. **Massive Write Amplification ($O(N)$ Updates):** Moving a card to the top of a column with 500 items forces the database to write 499 row updates to the Write-Ahead Log (WAL), degrading disk I/O.
2. **Deadlocks Under Concurrency:** Two operators dragging cards within the same column execute overlapping range updates, frequently triggering transaction rollbacks (`deadlock detected`).
3. **The Lost Update Anomaly:** When Actor A (human) and Actor B (background AI worker or webhook) load a card at version 1 and update it concurrently, the last write silently overwrites the previous change without warning.

---

## The Engineering Solution

`lexorank-occ-kanban` solves these challenges through three foundational mechanisms:

### 1. O(1) Fractional Midpoint Indexing
Cards are spaced with large base gaps ($\Delta = 65536$). When dropping a card between two neighbors ($P_A$ and $P_B$), the engine calculates the integer midpoint:

$$P_{new} = P_A + \left\lfloor \frac{P_B - P_A}{2} \right\rfloor$$

- Exactly **1 single row** is updated in the database.
- Neighboring rows are never touched.
- If repeated insertions between the exact same items exhaust the integer space ($gap \le 1$), the engine detects **Gap Exhaustion** and triggers an automatic, isolated rebalance of that single column ($P_i = (i + 1) \times 65536$).

### 2. Lockless Optimistic Concurrency Control (OCC)
Every card entity maintains an atomic `version` integer. Every move command requires the client's `expectedVersion`:
- If `card.version !== expectedVersion`, the transaction immediately aborts with `StaleVersionConflictError` (`HTTP 409 Conflict`).
- No heavy row locks (`SELECT FOR UPDATE`) are held while the user interacts with the UI.

### 3. Transition Governance Guardrails
The state machine validates domain constraints before executing any position calculation:
- **Work In Progress (WIP) Limits:** Blocks transitions if the destination column has reached capacity.
- **Hierarchical RBAC Security Levels:** Enforces numeric capability thresholds (e.g. Level 1: Standard, Level 2: Lead, Level 3: Admin).
- **Task Completion Gatekeepers:** Prevents cards from exiting a stage if mandatory checklist items remain pending.

---

## Core Architecture & Design Patterns

The module is structured under **Hexagonal Architecture (Ports and Adapters)**:

```
                            [MoveCardInput]
                                   │
                                   ▼
          ┌─────────────────────────────────────────────────┐
          │               KanbanOccEngine                   │
          │         (Pure TypeScript State Machine)         │
          └────────────────────────┬────────────────────────┘
                                   │
                ┌──────────────────┴──────────────────┐
                ▼                                     ▼
   ┌─────────────────────────┐           ┌─────────────────────────┐
   │    LexorankPositioner   │           │   TransitionGovernance  │
   │  - Midpoint calculation │           │  - WIP Limit validation │
   │  - O(1) single-row move │           │  - RBAC security checks │
   │  - Gap exhaustion check │           │  - Task compliance      │
   └─────────────────────────┘           └─────────────────────────┘
                                   │
                                   ▼
          ┌─────────────────────────────────────────────────┐
          │             IBoardStorageDriver Port            │
          └────────────────────────┬────────────────────────┘
                                   │
                ┌──────────────────┴──────────────────┐
                ▼                                     ▼
   ┌─────────────────────────┐           ┌─────────────────────────┐
   │  InMemoryBoardStorage   │           │   DrizzleBoardStorage   │
   │   (Zero-deps, in-memory)│           │   (PostgreSQL ACID tx)  │
   └─────────────────────────┘           └─────────────────────────┘
```

---

## Engineering Rationale

- **Pure TypeScript Core:** The business logic, calculation algorithm, and governance validations have zero external dependencies. Can run in Node.js, Bun, browser workers, or serverless functions.
- **Drizzle ORM Adapter:** Exposes clean PostgreSQL schemas with compound indices on `(column_id, position)` for instant ordered retrieval without sorting in memory.
- **NestJS Dynamic Module:** Provided as an optional adapter (`KanbanOccModule.forRoot()`) for modular enterprise applications.

---

## Architectural Usage

### 1. Standalone / Zero-Dependency Mode

```typescript
import { 
  KanbanOccEngine, 
  InMemoryBoardStorage 
} from './src';

const storage = new InMemoryBoardStorage();
const engine = new KanbanOccEngine({ storageDriver: storage });

// Create board and columns
const board = await storage.createBoard({ name: 'Product Engineering' });
const colTodo = await storage.createColumn({ boardId: board.id, name: 'To Do', position: 1000 });
const colDoing = await storage.createColumn({ boardId: board.id, name: 'In Progress', position: 2000, maxWipLimit: 3 });

// Create initial card
const card = await storage.createCard({
  boardId: board.id,
  columnId: colTodo.id,
  title: 'Implement Resilient Webhook Ingestion',
  position: 65536,
  version: 1,
  isArchived: false,
});

// Move card to 'In Progress' with OCC check
const result = await engine.moveCard({
  cardId: card.id,
  targetColumnId: colDoing.id,
  expectedVersion: 1, // OCC verification
});

console.log(result.card.version);  // 2
console.log(result.newPosition);   // 65536
```

### 2. Drizzle ORM PostgreSQL Integration

```typescript
import { KanbanOccEngine, DrizzleBoardStorage } from './src';
import { db } from './database';

const storage = new DrizzleBoardStorage(db);
const engine = new KanbanOccEngine({ storageDriver: storage });

// All operations execute inside native ACID transactions:
const moveResult = await engine.moveCard({
  cardId: 'card-uuid',
  targetColumnId: 'column-uuid',
  expectedVersion: 4,
  overCardId: 'neighbor-card-uuid',
  relativePlacement: 'before',
});
```

---

## Running the Simulation Locally

The repository includes a runnable, self-contained terminal simulation executing:
- **Scenario 1:** $O(1)$ Fractional Midpoint Indexing without shifting neighboring rows.
- **Scenario 2:** OCC Collision detection rejecting concurrent stale updates (`409 Conflict`).
- **Scenario 3:** WIP Limit capacity enforcement blocking workflow overflow.
- **Scenario 4:** Integer gap exhaustion handling and automatic column rebalancing.

```bash
git clone https://github.com/realgrando/lexorank-occ-kanban.git
cd lexorank-occ-kanban
npm install
npm run simulate
```

To run the automated Vitest test suite:

```bash
npm test
```

To verify clean TypeScript compilation:

```bash
npm run typecheck
```

---

## Deep Dive Notes

For a complete analysis of fractional math, lockless concurrency trade-offs, and front-end optimistic update reconciliation, read:
👉 **[Architecture Deep Dive (`docs/ARCHITECTURE_DEEP_DIVE.md`)](file:///home/gustavo/Documentos/Code/lexorank-occ-kanban/docs/ARCHITECTURE_DEEP_DIVE.md)**

---

## License

MIT © [Gustavo Grando](https://github.com/realgrando)
