import { jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const activities = pgTable('activities', {
  hash: text('hash').primaryKey(),
  athleteName: text('athlete_name').notNull(),
  km: numeric('km', { precision: 10, scale: 4 }).notNull().default('0'),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  sportType: text('sport_type'),
  rawData: jsonb('raw_data'),
});
