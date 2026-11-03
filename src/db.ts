import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, gt, gte, lt, and, sql } from 'drizzle-orm';
import { activities, athletes } from './schema';
import { ACTIVITY_CATEGORIES, CHALLENGE_START, CHALLENGE_END } from './constants';
import type { TokenSet } from './strava';
import type { ActivityRecord, AthleteRecord } from './sync';

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

export const db = drizzle(pool, { schema: { activities, athletes } });

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('[DB] Migrations applied');
}

export async function findAthlete(id: number): Promise<AthleteRecord | null> {
  const [row] = await db.select().from(athletes).where(eq(athletes.id, id));
  return row ?? null;
}

export async function saveAthlete(athlete: AthleteRecord): Promise<void> {
  await db
    .insert(athletes)
    .values(athlete)
    .onConflictDoUpdate({
      target: athletes.id,
      set: {
        name: athlete.name,
        accessToken: athlete.accessToken,
        refreshToken: athlete.refreshToken,
        expiresAt: athlete.expiresAt,
      },
    });
}

export async function saveTokens(athleteId: number, tokens: TokenSet): Promise<void> {
  await db.update(athletes).set(tokens).where(eq(athletes.id, athleteId));
}

/** Deletes the athlete; their activities are removed by the foreign key cascade. */
export async function deleteAthlete(id: number): Promise<void> {
  await db.delete(athletes).where(eq(athletes.id, id));
}

export async function upsertActivity(record: ActivityRecord): Promise<void> {
  const updatable = {
    stravaActivityId: record.stravaActivityId,
    athleteId: record.athleteId,
    athleteName: record.athleteName,
    km: String(record.km),
    sportType: record.sportType,
    startDate: record.startDate,
    updatedAt: new Date(),
  };
  await db
    .insert(activities)
    .values({ hash: `strava:${record.stravaActivityId}`, ...updatable })
    .onConflictDoUpdate({ target: activities.hash, set: updatable });
}

export async function deleteActivity(stravaActivityId: number): Promise<void> {
  await db.delete(activities).where(eq(activities.stravaActivityId, stravaActivityId));
}

export async function listStoredActivityIds(athleteId: number): Promise<number[]> {
  const rows = await db
    .select({ id: activities.stravaActivityId })
    .from(activities)
    .where(eq(activities.athleteId, athleteId));
  return rows.flatMap((r) => (r.id === null ? [] : [r.id]));
}

export async function listAthletes(): Promise<AthleteRecord[]> {
  return db.select().from(athletes);
}

/** Deletes every athlete, token and activity, including rows from the earlier club feed. */
export async function purgeAllStravaData(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(activities);
    await tx.delete(athletes);
  });
}

export async function getStats() {
  const countedAt = sql`COALESCE(${activities.startDate}, ${activities.firstSeen})`;
  const statsRows = await db
    .select({
      athleteName: activities.athleteName,
      totalKm: sql<number>`SUM(${activities.km})::float`.as('total_km'),
      activityCount: sql<string>`COUNT(*)`.as('activity_count'),
      sportType: activities.sportType,
    })
    .from(activities)
    .where(and(
      gte(countedAt, CHALLENGE_START),
      lt(countedAt, CHALLENGE_END),
      gt(activities.km, '0'),
    ))
    .groupBy(activities.athleteName, activities.sportType)
    .orderBy(sql`total_km DESC`);

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const categoryMap = new Map<string, Map<string, { totalKm: number; activities: number }>>();
  const allAthletesMap = new Map<string, { totalKm: number; activities: number }>();

  for (const r of statsRows) {
    const category = ACTIVITY_CATEGORIES[r.sportType || ''] || 'Other';
    const count = Number(r.activityCount);

    if (!categoryMap.has(category))
      categoryMap.set(category, new Map());
    const catAthletes = categoryMap.get(category)!;
    const existing = catAthletes.get(r.athleteName) ?? { totalKm: 0, activities: 0 };
    catAthletes.set(r.athleteName, {
      totalKm: existing.totalKm + r.totalKm,
      activities: existing.activities + count,
    });

    const overall = allAthletesMap.get(r.athleteName) ?? { totalKm: 0, activities: 0 };
    allAthletesMap.set(r.athleteName, {
      totalKm: overall.totalKm + r.totalKm,
      activities: overall.activities + count,
    });
  }

  const toSortedList = (m: Map<string, { totalKm: number; activities: number }>) =>
    [...m.entries()]
      .map(([name, v]) => ({ name, totalKm: round2(v.totalKm), activities: v.activities }))
      .sort((a, b) => b.totalKm - a.totalKm);

  const allAthletes = toSortedList(allAthletesMap);
  const grandTotalKm = allAthletes.reduce((s, a) => s + a.totalKm, 0);

  const categoryOrder = ['Running', 'Walking', 'Cycling', 'Winter Sports', 'Water Sports', 'Gym & Fitness', 'Other'];
  const categories = [
    { name: 'All', athletes: allAthletes },
    ...categoryOrder
      .filter((cat) => categoryMap.has(cat))
      .map((cat) => ({ name: cat, athletes: toSortedList(categoryMap.get(cat)!) })),
  ];

  const [{ lastUpdated }] = await db
    .select({ lastUpdated: sql<Date | null>`MAX(COALESCE(${activities.updatedAt}, ${activities.firstSeen}))` })
    .from(activities);

  return {
    lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null,
    grandTotalKm: round2(grandTotalKm),
    athletes: allAthletes,
    categories,
  };
}
