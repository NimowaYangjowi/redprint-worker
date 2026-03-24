/**
 * Admin Todos Schema
 * Internal task management system for admin team
 */

import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Priority levels for admin todos
 */
export const adminTodoPriorities = ['low', 'medium', 'high', 'urgent'] as const;
export type AdminTodoPriority = (typeof adminTodoPriorities)[number];

/**
 * Status values for admin todos
 */
export const adminTodoStatuses = ['pending', 'in_progress', 'completed'] as const;
export type AdminTodoStatus = (typeof adminTodoStatuses)[number];

/**
 * Admin Todos Table
 * Internal task management for admin team
 */
export const adminTodos = pgTable('admin_todos', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority').notNull().default('medium').$type<AdminTodoPriority>(),
  status: text('status').notNull().default('pending').$type<AdminTodoStatus>(),
  dueDate: timestamp('due_date', { withTimezone: true }),
  assignedTo: text('assigned_to'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  tags: text('tags').array(),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * Type exports for admin todos
 */
export type AdminTodo = typeof adminTodos.$inferSelect;
export type NewAdminTodo = typeof adminTodos.$inferInsert;
