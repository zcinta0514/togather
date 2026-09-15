import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  rangeStart: integer('range_start').notNull(),
  rangeEnd: integer('range_end').notNull(),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),
  granularity: text('granularity', { enum: ['day', 'half_day'] }).notNull().default('day'),
  collectDestinations: integer('collect_destinations', { mode: 'boolean' }).notNull().default(true),
  budgetEnabled: integer('budget_enabled', { mode: 'boolean' }).notNull().default(false),
  coreOnly: integer('core_only', { mode: 'boolean' }).notNull().default(false),
  anonymity: text('anonymity', { enum: ['open', 'vote_anonymous'] })
    .notNull()
    .default('open'),
  adminKeyHash: text('admin_key_hash').notNull(),
  finalizedPlan: text('finalized_plan'),
  createdAt: integer('created_at').notNull(),
});

export const participants = sqliteTable(
  'participants',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    token: text('token').notNull().unique(),
    isCore: integer('is_core', { mode: 'boolean' }).notNull().default(false),
    availability: text('availability').notNull().default(''),
    respondedAt: integer('responded_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('participants_event_idx').on(t.eventId)],
);

export const destinations = sqliteTable(
  'destinations',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    daysNeeded: integer('days_needed').notNull(),
    budgetLevel: integer('budget_level'),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('destinations_event_idx').on(t.eventId)],
);

export const votes = sqliteTable(
  'votes',
  {
    participantId: text('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    // 注意：drizzle 的 integer 不支持 enum 选项，所以这里推断出的是 number。
    // 出库后在响应边界转成 VoteLevel（见 routes/events.ts）。
    level: integer('level').notNull(),
  },
  (t) => [primaryKey({ columns: [t.participantId, t.destinationId] })],
);
