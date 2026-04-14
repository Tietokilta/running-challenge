import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { inArray, gt, gte, lt, and, sql } from 'drizzle-orm';
import { activities } from './schema';

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

export const db = drizzle(pool, { schema: { activities } });

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('[DB] Migrations applied');
}

export async function getSeenHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const rows = await db
    .select({ hash: activities.hash })
    .from(activities)
    .where(inArray(activities.hash, hashes));
  return new Set(rows.map((r) => r.hash));
}

export async function recordActivitiesBatch(
  records: Array<{ hash: string; athleteName: string; km: number; sportType?: string; rawData?: unknown }>,
): Promise<void> {
  if (records.length === 0) return;
  await db
    .insert(activities)
    .values(records.map((r) => ({ hash: r.hash, athleteName: r.athleteName, km: String(r.km), sportType: r.sportType, rawData: r.rawData })))
    .onConflictDoNothing();
}

import { ACTIVITY_CATEGORIES, CHALLENGE_START, CHALLENGE_END } from './constants';

export async function getStats() {
  const statsRows = await db
    .select({
      athleteName: activities.athleteName,
      totalKm: sql<number>`SUM(${activities.km})::float`.as('total_km'),
      activityCount: sql<string>`COUNT(*)`.as('activity_count'),
      sportType: activities.sportType,
    })
    .from(activities)
    .where(and(
      gte(activities.firstSeen, CHALLENGE_START),
      lt(activities.firstSeen, CHALLENGE_END),
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

  return {
    grandTotalKm: round2(grandTotalKm),
    athletes: allAthletes,
    categories,
  };
}
