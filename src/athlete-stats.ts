import { CATEGORY_ORDER, categoryOf } from './categories';
import type { ChallengeWindow } from './challenge';

export interface StoredActivity {
  km: number;
  sportType: string | null;
  startDate: Date | null;
  /** When the activity was last written by the sync. */
  updatedAt: Date | null;
}

export interface AthleteStats {
  name: string;
  connectedAt: string;
  totalKm: number;
  countedActivities: number;
  categories: Array<{ name: string; totalKm: number; activities: number }>;
  recentActivities: Array<{ startDate: string | null; sportType: string | null; category: string; km: number; counted: boolean }>;
  lastSyncedAt: string | null;
}

const RECENT_LIMIT = 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whether the activity counts towards the leaderboard, using the same rules as the public stats. */
function isCounted(a: StoredActivity, window: ChallengeWindow): boolean {
  return a.km > 0 && a.startDate !== null && a.startDate >= window.start && a.startDate < window.end;
}

/** Summarizes one athlete's stored activities so they can check what is being counted. */
export function summarizeAthlete(
  athlete: { name: string; connectedAt: Date },
  activities: StoredActivity[],
  window: ChallengeWindow,
): AthleteStats {
  const counted = activities.filter((a) => isCounted(a, window));

  const byCategory = new Map<string, { totalKm: number; activities: number }>();
  for (const a of counted) {
    const category = categoryOf(a.sportType);
    const entry = byCategory.get(category) ?? { totalKm: 0, activities: 0 };
    byCategory.set(category, { totalKm: entry.totalKm + a.km, activities: entry.activities + 1 });
  }

  const newestFirst = [...activities].sort(
    (a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0),
  );
  const syncTimes = activities.flatMap((a) => (a.updatedAt ? [a.updatedAt.getTime()] : []));

  return {
    name: athlete.name,
    connectedAt: athlete.connectedAt.toISOString(),
    totalKm: round2(counted.reduce((sum, a) => sum + a.km, 0)),
    countedActivities: counted.length,
    categories: CATEGORY_ORDER.flatMap((name) => {
      const entry = byCategory.get(name);
      return entry ? [{ name, totalKm: round2(entry.totalKm), activities: entry.activities }] : [];
    }),
    recentActivities: newestFirst.slice(0, RECENT_LIMIT).map((a) => ({
      startDate: a.startDate?.toISOString() ?? null,
      sportType: a.sportType,
      category: categoryOf(a.sportType),
      km: round2(a.km),
      counted: isCounted(a, window),
    })),
    lastSyncedAt: syncTimes.length > 0 ? new Date(Math.max(...syncTimes)).toISOString() : null,
  };
}
