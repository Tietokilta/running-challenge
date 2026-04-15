import cron from 'node-cron';
import { fetchClubActivities, hashActivity } from './client';
import { getSeenHashes, recordActivitiesBatch } from './db';

export let lastFetchAttempt: Date | null = null;

export async function runFetch(): Promise<void> {
  lastFetchAttempt = new Date();
  const clubId = process.env.CLUB_ID;
  if (!clubId) {
    console.error('[Cron] CLUB_ID not set.');
    return;
  }

  console.log('[Cron] Fetching club activities...');
  try {
    const activities = await fetchClubActivities(clubId);
    const hashes = activities.map(hashActivity);
    const seen = await getSeenHashes(hashes);

    const toRecord = activities
      .map((activity, i) => ({ activity, hash: hashes[i] }))
      .filter(({ hash }) => !seen.has(hash))
      .map(({ activity, hash }) => ({
        hash,
        athleteName: `${activity.athlete?.firstname ?? '?'} ${activity.athlete?.lastname ?? '?'}`,
        km: (activity.distance ?? 0) / 1000,
        sportType: activity.sport_type ?? activity.type,
        rawData: activity,
      }));

    await recordActivitiesBatch(toRecord);
    console.log(`[Cron] Done. ${toRecord.length} new activities recorded out of ${activities.length} fetched.`);
  } catch (err) {
    console.error('[Cron] Failed:', err instanceof Error ? err.message : err);
  }
}

export async function startCron(): Promise<void> {
  cron.schedule('*/2 * * * *', runFetch);
  console.log('[Cron] Scheduled fetch every 2 minutes.');
  runFetch().catch(console.error);
}
