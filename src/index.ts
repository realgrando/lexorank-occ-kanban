/**
 * LexoRank OCC Kanban
 * High-performance workflow state machine and optimistic Kanban engine with O(1) fractional indexing and ACID Optimistic Concurrency Control.
 * 
 * @author Gustavo Grando (@realgrando)
 * @license MIT
 */

// Domain contracts, exceptions and ports
export * from './interfaces';

// Core State Machine & Algorithms
export * from './core/engine';
export * from './core/positioner';
export * from './core/governance';

// In-Memory Storage Adapter (Zero dependencies)
export * from './adapters/memory/memory-board-storage';

// Drizzle ORM PostgreSQL Adapter
export * from './adapters/drizzle';

// NestJS Dynamic Module Adapter
export * from './adapters/nestjs';
