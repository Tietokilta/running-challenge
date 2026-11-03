import { StravaApiError, type StravaActivity, type StravaClient, type TokenSet } from './strava';

export interface AthleteRecord {
  id: number;
  name: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface ActivityRecord {
  stravaActivityId: number;
  athleteId: number;
  athleteName: string;
  km: number;
  sportType?: string;
  startDate?: Date;
  rawData: Record<string, unknown>;
}

/** Strava webhook event, see https://developers.strava.com/docs/webhooks/ */
export interface WebhookEvent {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, string>;
}

export interface SyncDeps {
  now(): Date;
  findAthlete(id: number): Promise<AthleteRecord | null>;
  saveTokens(athleteId: number, tokens: TokenSet): Promise<void>;
  /** Removes the athlete and all of their activities. */
  deleteAthlete(id: number): Promise<void>;
  upsertActivity(record: ActivityRecord): Promise<void>;
  deleteActivity(stravaActivityId: number): Promise<void>;
  strava: Pick<StravaClient, 'refreshTokens' | 'getActivity' | 'listActivitiesSince'>;
}

const TOKEN_EXPIRY_MARGIN_MS = 5 * 60_000;

// Bulky per-activity detail that is not needed for the leaderboard.
const OMITTED_RAW_FIELDS = new Set([
  'map',
  'segment_efforts',
  'splits_metric',
  'splits_standard',
  'laps',
  'best_efforts',
  'photos',
  'stats_visibility',
]);

/** Shows athletes the same way Strava's club feed does: first name and last initial. */
export function displayName(firstname?: string, lastname?: string): string {
  const first = firstname?.trim() ?? '';
  const initial = lastname?.trim().charAt(0) ?? '';
  return [first, initial && `${initial}.`].filter(Boolean).join(' ') || '?';
}

export function toActivityRecord(activity: StravaActivity, athlete: AthleteRecord): ActivityRecord {
  return {
    stravaActivityId: activity.id,
    athleteId: athlete.id,
    athleteName: athlete.name,
    km: (activity.distance ?? 0) / 1000,
    sportType: activity.sport_type ?? activity.type,
    startDate: activity.start_date ? new Date(activity.start_date) : undefined,
    rawData: Object.fromEntries(Object.entries(activity).filter(([key]) => !OMITTED_RAW_FIELDS.has(key))),
  };
}

function isRevoked(err: unknown): boolean {
  return err instanceof StravaApiError && (err.status === 400 || err.status === 401);
}

function isGone(err: unknown): boolean {
  return err instanceof StravaApiError && err.status === 404;
}

/** Returns a usable access token, or null if the athlete has revoked access (and removes them). */
async function accessTokenFor(athlete: AthleteRecord, deps: SyncDeps, forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && athlete.expiresAt.getTime() - TOKEN_EXPIRY_MARGIN_MS > deps.now().getTime()) {
    return athlete.accessToken;
  }
  try {
    const tokens = await deps.strava.refreshTokens(athlete.refreshToken);
    await deps.saveTokens(athlete.id, tokens);
    athlete.accessToken = tokens.accessToken;
    athlete.refreshToken = tokens.refreshToken;
    athlete.expiresAt = tokens.expiresAt;
    return tokens.accessToken;
  } catch (err) {
    if (!isRevoked(err)) throw err;
    console.log(`[Sync] Athlete ${athlete.id} has revoked access, removing their data`);
    await deps.deleteAthlete(athlete.id);
    return null;
  }
}

/**
 * Applies a webhook event. Events are unauthenticated, so they are only used as hints:
 * the activity is always re-read from Strava with the athlete's own token, and data is
 * removed only when Strava confirms it is gone or access is revoked.
 */
export async function handleWebhookEvent(event: WebhookEvent, deps: SyncDeps): Promise<void> {
  const athlete = await deps.findAthlete(event.owner_id);
  if (!athlete) return;

  if (event.object_type === 'athlete') {
    if (event.updates?.authorized === 'false') await accessTokenFor(athlete, deps, true);
    return;
  }

  const token = await accessTokenFor(athlete, deps);
  if (!token) return;

  let activity: StravaActivity;
  try {
    activity = await deps.strava.getActivity(token, event.object_id);
  } catch (err) {
    if (!isGone(err)) throw err;
    await deps.deleteActivity(event.object_id);
    return;
  }

  if (activity.athlete?.id !== athlete.id) {
    console.warn(`[Sync] Activity ${activity.id} does not belong to athlete ${athlete.id}, ignoring`);
    return;
  }
  await deps.upsertActivity(toActivityRecord(activity, athlete));
}

/** Imports the athlete's existing activities since the given date. */
export async function backfillAthlete(athlete: AthleteRecord, since: Date, deps: SyncDeps): Promise<number> {
  const token = await accessTokenFor(athlete, deps);
  if (!token) return 0;
  const activities = await deps.strava.listActivitiesSince(token, since);
  const own = activities.filter((a) => a.athlete?.id === athlete.id);
  for (const activity of own) await deps.upsertActivity(toActivityRecord(activity, athlete));
  return own.length;
}
