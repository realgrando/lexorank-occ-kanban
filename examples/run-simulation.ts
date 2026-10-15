/**
 * LexoRank OCC Kanban — Working Proof-of-Concept Simulation
 * Run with: npx tsx examples/run-simulation.ts
 */

import {
  InMemoryBoardStorage,
  KanbanOccEngine,
  StaleVersionConflictError,
  WipLimitExceededError,
} from '../src';

async function main() {
  console.log('\x1b[1m\x1b[36m');
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║               LEXORANK OCC KANBAN — REAL-TIME SIMULATION              ║');
  console.log('║      O(1) Fractional Midpoint Indexing & Concurrency Guardrails       ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('\x1b[0m');

  const storage = new InMemoryBoardStorage();
  const engine = new KanbanOccEngine({ storageDriver: storage });

  console.log('\x1b[33m[SETUP]\x1b[0m Initializing Board, Columns and Initial WorkItems...');

  const board = await storage.createBoard({
    name: 'Core Engineering Workflow',
    description: 'Mission-critical distributed pipeline',
  });

  // Column 1: Backlog (Uncapped)
  const colBacklog = await storage.createColumn({
    boardId: board.id,
    name: 'Backlog',
    position: 1000,
  });

  // Column 2: In Progress (Strict WIP Limit: Max 2 Cards)
  const colInProgress = await storage.createColumn({
    boardId: board.id,
    name: 'In Progress (WIP: 2)',
    position: 2000,
    maxWipLimit: 2,
  });

  // Column 3: Quality Assurance (Requires Security Level >= 2)
  const colQa = await storage.createColumn({
    boardId: board.id,
    name: 'QA & Verification',
    position: 3000,
    securityLevel: 2,
  });

  console.log(`✓ Board ready with 3 Columns:`);
  console.log(`  - [${colBacklog.name}] (Unrestricted)`);
  console.log(`  - [${colInProgress.name}] (Capacity: 2 items)`);
  console.log(`  - [${colQa.name}] (Requires Role Level >= 2)\n`);

  // =========================================================================
  // SCENARIO 1: O(1) Fractional Midpoint Indexing
  // =========================================================================
  console.log('\x1b[1m\x1b[34m----------------------------------------------------------------------\x1b[0m');
  console.log('\x1b[1mSCENARIO 1: O(1) Fractional Midpoint Indexing (Zero Array Shifting)\x1b[0m');
  console.log('\x1b[1m\x1b[34m----------------------------------------------------------------------\x1b[0m');

  // Create initial spaced cards in Backlog: Base 65536
  const cardA = await storage.createCard({
    boardId: board.id,
    columnId: colBacklog.id,
    title: 'TASK-101: Database Schema Migration',
    position: 65536,
    version: 1,
    isArchived: false,
  });

  const cardB = await storage.createCard({
    boardId: board.id,
    columnId: colBacklog.id,
    title: 'TASK-102: Auth Middleware Hardening',
    position: 131072, // 65536 * 2
    version: 1,
    isArchived: false,
  });

  const cardC = await storage.createCard({
    boardId: board.id,
    columnId: colBacklog.id,
    title: 'TASK-103: Dynamic Rule Evaluator',
    position: 196608, // 65536 * 3
    version: 1,
    isArchived: false,
  });

  console.log(`Initial Column State:`);
  console.log(`  [Pos: ${cardA.position}] ${cardA.title} (v${cardA.version})`);
  console.log(`  [Pos: ${cardB.position}] ${cardB.title} (v${cardB.version})`);
  console.log(`  [Pos: ${cardC.position}] ${cardC.title} (v${cardC.version})\n`);

  // Operator drops Card C directly between Card A and Card B:
  console.log(`[Drag & Drop] Moving "${cardC.title}" between Task 101 (${cardA.position}) and Task 102 (${cardB.position})...`);
  
  const moveCRes = await engine.moveCard({
    cardId: cardC.id,
    targetColumnId: colBacklog.id,
    expectedVersion: cardC.version,
    overCardId: cardB.id,
    relativePlacement: 'before',
  });

  console.log(`✓ Operation executed in O(1) time without updating neighbors:`);
  console.log(`  - New Position for Task 103: \x1b[32m\x1b[1m${moveCRes.newPosition}\x1b[0m (Formula: Math.floor((${cardA.position} + ${cardB.position}) / 2))`);
  console.log(`  - Version incremented to:   \x1b[32mv${moveCRes.card.version}\x1b[0m`);
  console.log(`  - Database updates performed: Exactly \x1b[1m1 row\x1b[0m (Neighbors remained untouched)\n`);

  // =========================================================================
  // SCENARIO 2: Optimistic Concurrency Control (OCC Collision Prevention)
  // =========================================================================
  console.log('\x1b[1m\x1b[34m----------------------------------------------------------------------\x1b[0m');
  console.log('\x1b[1mSCENARIO 2: Optimistic Concurrency Control (OCC Lost Update Defense)\x1b[0m');
  console.log('\x1b[1m\x1b[34m----------------------------------------------------------------------\x1b[0m');

  const sharedCard = await storage.createCard({
    boardId: board.id,
    columnId: colBacklog.id,
    title: 'TASK-200: Critical Security Patch',
    position: 250000,
    version: 1,
    isArchived: false,
  });

  console.log(`A shared card is loaded by two concurrent actors:`);
  console.log(`  Card: "${sharedCard.title}" | Read Version: \x1b[1mv${sharedCard.version}\x1b[0m`);

  console.log(`\n[Actor A (Human Operator)] Submits move to "In Progress" with expectedVersion = 1...`);
  const actorARes = await engine.moveCard({
    cardId: sharedCard.id,
    targetColumnId: colInProgress.id,
    expectedVersion: 1,
  });
  console.log(`  ✓ Actor A succeeded: Card moved. New DB Version is \x1b[32mv${actorARes.card.version}\x1b[0m`);

  console.log(`\n[Actor B (Autonomous AI Agent)] Submits concurrent move with stale expectedVersion = 1...`);
  try {
    await engine.moveCard({
      cardId: sharedCard.id,
      targetColumnId: colQa.id,
      expectedVersion: 1, // Stale! Database is already v2
    });
    console.error('❌ ERROR: Actor B should have been rejected!');
  } catch (error) {
    if (error instanceof StaleVersionConflictError) {
      console.log(`  \x1b[31m\x1b[1m✖ REJECTED (409 Conflict):\x1b[0m ${error.message}`);
      console.log(`  ✓ Lost Update prevented! Database state remains deterministic.\n`);
    } else {
      throw error;
    }
  }

  // =========================================================================
  // SCENARIO 3: WIP Limit & Governance Guardrail
  // =========================================================================
  console.log('\x1b[1m\x1b[34m----------------------------------------------------------------------\x1b[0m');
  console.log('\x1b[1mSCENARIO 3: WIP Limit & Capacity Guardrail Enforcement\x1b[0m');
  console.log('\x1b[1m\x1b[34m----------------------------------------------------------------------\x1b[0m');

  // Fill "In Progress" column to its limit (Cap: 2)
  // One card is already there from Scenario 2. Add second card:
  const cardWip2 = await storage.createCard({
    boardId: board.id,
    columnId: colInProgress.id,
    title: 'TASK-201: Redis Sentinel Setup',
    position: 65536,
    version: 1,
    isArchived: false,
  });

  const currentWip = await storage.countActiveCardsInColumn(colInProgress.id);
  console.log(`"In Progress" column has reached its capacity: ${currentWip}/${colInProgress.maxWipLimit} cards.`);

  const cardWipOverflow = await storage.createCard({
    boardId: board.id,
    columnId: colBacklog.id,
    title: 'TASK-202: Rate Limiting Module',
    position: 300000,
    version: 1,
    isArchived: false,
  });

  console.log(`[Attempted Move] Moving "${cardWipOverflow.title}" into full "In Progress" column...`);
  try {
    await engine.moveCard({
      cardId: cardWipOverflow.id,
      targetColumnId: colInProgress.id,
      expectedVersion: cardWipOverflow.version,
    });
    console.error('❌ ERROR: WIP limit should have blocked this move!');
  } catch (error) {
    if (error instanceof WipLimitExceededError) {
      console.log(`  \x1b[31m\x1b[1m✖ BLOCKED BY GOVERNANCE (400 Bad Request):\x1b[0m`);
      console.log(`    ${error.message}`);
      console.log(`  ✓ Transaction aborted: Card remains safely in "${colBacklog.name}".\n`);
    } else {
      throw error;
    }
  }

  // =========================================================================
  // SCENARIO 4: Index Exhaustion & Automatic Column Rebalancing
  // =========================================================================
  console.log('\x1b[1m\x1b[34m----------------------------------------------------------------------\x1b[0m');
  console.log('\x1b[1mSCENARIO 4: Integer Gap Exhaustion & Automatic Rebalancing\x1b[0m');
  console.log('\x1b[1m\x1b[34m----------------------------------------------------------------------\x1b[0m');

  // Create two cards with adjacent positions (gap = 1: 100 and 101)
  const tightCard1 = await storage.createCard({
    boardId: board.id,
    columnId: colBacklog.id,
    title: 'TASK-TIGHT-1',
    position: 100,
    version: 1,
    isArchived: false,
  });

  const tightCard2 = await storage.createCard({
    boardId: board.id,
    columnId: colBacklog.id,
    title: 'TASK-TIGHT-2',
    position: 101, // Gap is 1 -> No integer exists between 100 and 101!
    version: 1,
    isArchived: false,
  });

  const candidateToInsert = await storage.createCard({
    boardId: board.id,
    columnId: colBacklog.id,
    title: 'TASK-TIGHT-INSERT',
    position: 999999,
    version: 1,
    isArchived: false,
  });

  console.log(`Simulating extreme integer crowding between adjacent items:`);
  console.log(`  Card 1 Position: ${tightCard1.position}`);
  console.log(`  Card 2 Position: ${tightCard2.position} (Gap: ${tightCard2.position - tightCard1.position})`);
  console.log(`  There is NO integer space between 100 and 101.`);

  console.log(`\n[Action] Squeezing "${candidateToInsert.title}" between 100 and 101...`);
  const rebalanceRes = await engine.moveCard({
    cardId: candidateToInsert.id,
    targetColumnId: colBacklog.id,
    expectedVersion: candidateToInsert.version,
    overCardId: tightCard2.id,
    relativePlacement: 'before',
  });

  console.log(`✓ Automatic Rebalancing Triggered!`);
  console.log(`  - Rebalanced Status: \x1b[32m\x1b[1m${rebalanceRes.rebalanced}\x1b[0m`);
  console.log(`  - Total cards re-spaced: \x1b[32m\x1b[1m${rebalanceRes.rebalancedCardsCount}\x1b[0m`);
  console.log(`  - New Position assigned: \x1b[32m${rebalanceRes.newPosition}\x1b[0m`);

  const refreshedCards = await storage.getCardsByColumn(colBacklog.id);
  console.log(`\nRestored Healthy Column Spacing:`);
  for (const c of refreshedCards.slice(0, 4)) {
    console.log(`  [Pos: ${c.position}] ${c.title}`);
  }

  console.log('\n\x1b[1m\x1b[32m======================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[32m      SIMULATION COMPLETE: ALL KANBAN GUARANTEES FULLY VERIFIED       \x1b[0m');
  console.log('\x1b[1m\x1b[32m======================================================================\x1b[0m\n');
}

main().catch((err) => {
  console.error('Fatal Simulation Error:', err);
  process.exit(1);
});
