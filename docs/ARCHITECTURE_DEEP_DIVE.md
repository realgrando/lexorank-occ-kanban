# Architecture Deep Dive: LexoRank OCC Kanban
**Author:** Gustavo Grando (`@realgrando`)  
**Design Paradigm:** Hexagonal Architecture / Ports & Adapters  
**Core Principles:** O(1) Fractional Midpoint Indexing, Lockless Optimistic Concurrency Control, Multi-Tenancy Guardrails  

---

## 1. The Mathematical & Concurrency Dilemma in Kanban Engines

A naive drag-and-drop Kanban implementation typically stores items in a database using an integer index sequence (`position = 0, 1, 2, 3...`):

```sql
-- The Naive Anti-Pattern: Shifting the entire array
UPDATE tasks 
SET position = position + 1 
WHERE column_id = $1 AND position >= $2;
```

When an operator drags card #50 to position #2 in a column containing 1,000 cards:
1. **$O(N)$ Write Amplification:** The database must write 998 row updates, generating heavy Write-Ahead Log (WAL) volume and lock contention.
2. **Table Contention & Deadlocks:** If two operators move cards in the same column concurrently, their overlapping range updates trigger database deadlocks (`40P01 deadlock_detected`).
3. **Cache Invalidation Thrashing:** In front-ends backed by Redis or TanStack Query, modifying 998 items forces a total cache purge instead of updating a single item.

---

## 2. Mathematical Foundation of O(1) Fractional Midpoint Indexing

Instead of storing consecutive integers, `lexorank-occ-kanban` allocates numbers with generous base gaps:

$$\Delta = 65536 = 2^{16}$$

When a card is moved between item $A$ (position $P_A$) and item $B$ (position $P_B$), the new position $P_{new}$ is computed deterministically in $O(1)$ memory and execution time:

$$P_{new} = P_A + \left\lfloor \frac{P_B - P_A}{2} \right\rfloor$$

```
Initial State:
[Card 1: 65,536] ---------------- (Gap: 65,536) ---------------- [Card 2: 131,072]

Insert Card X between 1 and 2:
Midpoint = 65,536 + floor((131,072 - 65,536) / 2) = 98,304

Resulting State:
[Card 1: 65,536] --- (32,768) --- [Card X: 98,304] --- (32,768) --- [Card 2: 131,072]
```

### Why Exactly 1 Database Row is Mutated:
Only the moved card is updated with `UPDATE kanban_cards SET position = $1, version = version + 1 WHERE id = $2`. All neighboring items maintain their positions. The database transaction completes in sub-millisecond time.

### The Integer Exhaustion Boundary:
Repeatedly inserting between the same two items halves the available gap:

$$65536 \rightarrow 32768 \rightarrow 16384 \rightarrow 8192 \rightarrow 4096 \rightarrow 2048 \rightarrow 1024 \rightarrow 512 \rightarrow 256 \rightarrow 128 \rightarrow 64 \rightarrow 32 \rightarrow 16 \rightarrow 8 \rightarrow 4 \rightarrow 2 \rightarrow 1$$

A gap of $2^{16}$ allows **16 consecutive insertions in the exact same spot** before exhausting the integer space. When:

$$P_B - P_A \le 1$$

The algorithm detects **Gap Exhaustion** (`requiresRebalance: true`). The engine then triggers an atomic rebalance of that specific column:

$$P_i = (i + 1) \times 65536$$

Rebalancing is an amortized $O(N)$ event that occurs exceedingly rarely in production, preserving $O(1)$ performance for 99.9% of user interactions.

---

## 3. Lockless Concurrency: Why OCC Beats Pessimistic Locking

### The Lost Update Anomaly in Real-World Workflows:
Consider a scenario with two actors (e.g., a human operator and an automated AI worker):
1. **Time $T_0$:** Operator loads Card #400 (Status: "To Do", Version: 1).
2. **Time $T_0$:** AI Agent loads Card #400 (Status: "To Do", Version: 1).
3. **Time $T_1$:** Operator drags Card #400 to "Doing" (assigning position 1500).
4. **Time $T_2$:** AI Agent finishes validation and moves Card #400 to "Review" (assigning position 8000).

In a naive system, the AI Agent's write unconditionally overwrites the Operator's change, silently obliterating the operator's action (**Lost Update**).

### Pessimistic Locking Anti-Pattern (`SELECT FOR UPDATE`):
Acquiring an exclusive row lock while an operator interacts with a drag-and-drop UI holds open database transactions across network roundtrips, holding database connection pool slots hostage and causing cascade timeouts.

### The OCC Solution Implemented in Core:
Every card entity has an integer `version` field starting at `1`.
When any mutation occurs:

```sql
UPDATE kanban_cards 
SET column_id = $1, 
    position = $2, 
    version = version + 1, 
    updated_at = now()
WHERE id = $3 AND version = $4; -- $4 is expectedVersion
```

If another actor mutated the card in the interim, `version` was already incremented to `2`. The `WHERE version = 1` condition matches 0 rows.
The engine catches this at the domain boundary:

```typescript
if (card.version !== input.expectedVersion) {
  throw new StaleVersionConflictError(card.id, input.expectedVersion, card.version);
}
```

This returns an explicit HTTP `409 Conflict`, completely avoiding lost updates while keeping read operations 100% lockless.

---

## 4. Front-End Optimistic UI & Transactional Rollback

In high-performance user interfaces (Next.js + `@dnd-kit` + `@tanstack/react-query`), the UI must feel instantaneous ("Zero Latency / 60 FPS Drag").

```
[User Drops Card]
       │
       ├───> 1. Optimistic Mutation:
       │        - Cancel outgoing refetches (`queryClient.cancelQueries`)
       │        - Snapshot current cache (`queryClient.getQueryData`)
       │        - Move card visually in local state immediately
       │
       ├───> 2. Dispatch API Request with current `version`
       │
       ├───> [Success (200 OK)]
       │        - Update local card with returned `version: version + 1`
       │        - Invalidate queries in background
       │
       └───> [Failure (409 Conflict / 400 WIP Exceeded)]
                - Automatic Rollback: Restore snapshot from step 1
                - Display informative toast notification to user
```

Because `KanbanOccEngine` provides deterministic status codes (`409 Conflict`, `400 WipLimitExceeded`, `403 UnauthorizedTransition`), client-side adapters can distinguish between network interruptions and business guardrail rejections, applying targeted rollback animations.

---

## 5. Domain Governance Architecture

Beyond positioning, modern kanban workflows require multi-dimensional constraints:

```
                      [MoveCardInput]
                            │
                            ▼
           ┌─────────────────────────────────┐
           │     KanbanOccEngine.moveCard    │
           └────────────────┬────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
    [OCC Version Check]         [TransitionGovernance]
     - card.version == input      - WIP Limit: count < maxWipLimit
                                  - Security: userLevel >= securityLevel
                                  - Required Tasks: count(open) == 0
```

1. **WIP Limits (Work In Progress):** Prevents operational bottlenecks by capping the maximum number of active items in focused lanes (e.g., "Code Review", "Production").
2. **Hierarchical RBAC Security Levels:** Restricts lane transitions based on numeric capability tiers (e.g., Level 1: Junior, Level 2: Tech Lead, Level 4: Platform Admin).
3. **Pending Task Gatekeeper:** Mandates that structured checklists within a lane are marked as `DONE` before the card can be progressed to the next column.
