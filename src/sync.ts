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

export interface ChallengeWindow {
  start: Date;
  end: Date;
}

/** Strava data is kept only until the results have been published. */
export const RETENTION_AFTER_END_MS = 7 * 24 * 3600_000;

export interface SyncDeps {
  now(): Date;
  window: ChallengeWindow;
  findAthlete(id: number): Promise<AthleteRecord | null>;
  saveTokens(athleteId: number, tokens: TokenSet): Promise<void>;
  /** Removes the athlete and all of their activities. */
  deleteAthlete(id: number): Promise<void>;
  upsertActivity(record: ActivityRecord): Promise<void>;
  deleteActivity(stravaActivityId: number): Promise<void>;
  listStoredActivityIds(athleteId: number): Promise<number[]>;
  listAthletes(): Promise<AthleteRecord[]>;
  /** Deletes all athletes, tokens and activities. */
  purgeAllStravaData(): Promise<void>;
  strava: Pick<StravaClient, 'refreshTokens' | 'getActivity' | 'listActivitiesSince'>;
}

const TOKEN_EXPIRY_MARGIN_MS = 5 * 60_000;

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
  };
}

function isInWindow(activity: StravaActivity, window: ChallengeWindow): boolean {
  if (!activity.start_date) return false;
  const start = new Date(activity.start_date);
  return start >= window.start && start < window.end;
}

/**
 * Strava answers a refresh with a revoked token with 400 and a RefreshToken error. Other
 * failures, such as a wrong client secret, must not be mistaken for revocation or every
 * athlete would be deleted.
 */
function isRevoked(err: unknown): boolean {
  return err instanceof StravaApiError && err.status === 400 && err.body.includes('"RefreshToken"');
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
  if (isInWindow(activity, deps.window)) {
    await deps.upsertActivity(toActivityRecord(activity, athlete));
  } else {
    await deps.deleteActivity(activity.id);
  }
}

async function listOwnActivitiesInWindow(token: string, athlete: AthleteRecord, deps: SyncDeps) {
  const activities = await deps.strava.listActivitiesSince(token, deps.window.start);
  return activities.filter((a) => a.athlete?.id === athlete.id && isInWindow(a, deps.window));
}

/** Imports the athlete's existing activities in the challenge window. */
export async function backfillAthlete(athlete: AthleteRecord, deps: SyncDeps): Promise<number> {
  const token = await accessTokenFor(athlete, deps);
  if (!token) return 0;
  const own = await listOwnActivitiesInWindow(token, athlete, deps);
  for (const activity of own) await deps.upsertActivity(toActivityRecord(activity, athlete));
  return own.length;
}

/**
 * Re-reads the athlete's activities and drops stored ones Strava no longer returns, in case a
 * webhook event for a deletion or privacy change was missed.
 */
export async function reconcileAthlete(athlete: AthleteRecord, deps: SyncDeps): Promise<void> {
  const token = await accessTokenFor(athlete, deps);
  if (!token) return;
  const own = await listOwnActivitiesInWindow(token, athlete, deps);
  const current = new Set(own.map((a) => a.id));
  for (const id of await deps.listStoredActivityIds(athlete.id)) {
    if (!current.has(id)) await deps.deleteActivity(id);
  }
  for (const activity of own) await deps.upsertActivity(toActivityRecord(activity, athlete));
}

/** Deletes all Strava data once the retention period after the challenge is over. */
export async function purgeIfExpired(
  deps: Pick<SyncDeps, 'window' | 'purgeAllStravaData'>,
  now: Date,
): Promise<boolean> {
  if (now.getTime() < deps.window.end.getTime() + RETENTION_AFTER_END_MS) return false;
  await deps.purgeAllStravaData();
  console.log('[Sync] Retention period over, all Strava data purged');
  return true;
}

/** Daily job: purge everything once the retention period is over, otherwise reconcile. */
export async function runMaintenance(deps: SyncDeps, now = deps.now()): Promise<void> {
  if (await purgeIfExpired(deps, now)) return;
  if (now < deps.window.start) return;
  for (const athlete of await deps.listAthletes()) {
    try {
      await reconcileAthlete(athlete, deps);
    } catch (err) {
      console.error(`[Sync] Reconciling athlete ${athlete.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
}
