import { bigint, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Athletes who have connected their Strava account. */
export const athletes = pgTable('athletes', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  name: text('name').notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Activities counted in the challenge. Rows imported through the athlete's own Strava
 * connection have `stravaActivityId`, `athleteId` and `startDate`; older rows came from
 * the club feed and only have the hash and `firstSeen`.
 */
export const activities = pgTable('activities', {
  hash: text('hash').primaryKey(),
  athleteName: text('athlete_name').notNull(),
  km: numeric('km', { precision: 10, scale: 4 }).notNull().default('0'),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  sportType: text('sport_type'),
  stravaActivityId: bigint('strava_activity_id', { mode: 'number' }).unique(),
  athleteId: bigint('athlete_id', { mode: 'number' }).references(() => athletes.id, { onDelete: 'cascade' }),
  startDate: timestamp('start_date', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
