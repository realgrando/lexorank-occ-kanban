/**
 * Drizzle ORM Schema for LexoRank OCC Kanban
 * Domain-agnostic PostgreSQL table definitions with compound indices for O(1) positioning.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const boards = pgTable('kanban_boards', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const columns = pgTable(
  'kanban_columns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    position: integer('position').notNull(),
    maxWipLimit: integer('max_wip_limit'),
    securityLevel: integer('security_level'),
    requiresCompletedTasks: boolean('requires_completed_tasks')
      .notNull()
      .default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_columns_board_position').on(table.boardId, table.position),
  ]
);

export const cards = pgTable(
  'kanban_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    columnId: uuid('column_id')
      .notNull()
      .references(() => columns.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    position: integer('position').notNull(),
    version: integer('version').notNull().default(1),
    metadata: jsonb('metadata'),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_cards_column_position').on(table.columnId, table.position),
    index('idx_cards_board_archived').on(table.boardId, table.isArchived),
  ]
);

export const tasks = pgTable(
  'kanban_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    columnId: uuid('column_id').references(() => columns.id),
    title: varchar('title', { length: 255 }).notNull(),
    status: varchar('status', { length: 50 }).notNull().default('TODO'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_tasks_card_status').on(table.cardId, table.status),
  ]
);

export const boardsRelations = relations(boards, ({ many }) => ({
  columns: many(columns),
  cards: many(cards),
}));

export const columnsRelations = relations(columns, ({ one, many }) => ({
  board: one(boards, {
    fields: [columns.boardId],
    references: [boards.id],
  }),
  cards: many(cards),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  board: one(boards, {
    fields: [cards.boardId],
    references: [boards.id],
  }),
  column: one(columns, {
    fields: [cards.columnId],
    references: [columns.id],
  }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  card: one(cards, {
    fields: [tasks.cardId],
    references: [cards.id],
  }),
}));
