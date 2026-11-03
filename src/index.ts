import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as db from './db';
import routes from './routes';
import { CHALLENGE_END, CHALLENGE_START } from './constants';
import { createStravaClient, isTransientError, readStravaConfig } from './strava';
import { withRetry } from './retry';
import { createStravaRoutes } from './strava-routes';
import { ensureWebhookSubscription } from './subscription';
import {
  backfillAthlete,
  handleWebhookEvent,
  purgeIfExpired,
  RETENTION_AFTER_END_MS,
  runMaintenance,
  type SyncDeps,
} from './sync';

const config = readStravaConfig();
if (!config) {
  console.warn('[Strava] CLIENT_ID, CLIENT_SECRET, PUBLIC_URL or STRAVA_WEBHOOK_VERIFY_TOKEN not set; integration disabled');
}
const strava = createStravaClient({ clientId: config?.clientId ?? '', clientSecret: config?.clientSecret ?? '' });

const MAINTENANCE_INTERVAL_MS = 24 * 3600_000;
const RETENTION_ENDS_AT = CHALLENGE_END.getTime() + RETENTION_AFTER_END_MS;

// Set once the webhook subscription is confirmed; events for other ids are ignored.
let activeSubscriptionId: number | null = null;

const syncDeps: SyncDeps = {
  now: () => new Date(),
  window: { start: CHALLENGE_START, end: CHALLENGE_END },
  findAthlete: db.findAthlete,
  saveTokens: db.saveTokens,
  deleteAthlete: db.deleteAthlete,
  upsertActivity: db.upsertActivity,
  deleteActivity: db.deleteActivity,
  listStoredActivityIds: db.listStoredActivityIds,
  listAthletes: db.listAthletes,
  purgeAllStravaData: db.purgeAllStravaData,
  strava,
};

const logError = (context: string) => (err: unknown) =>
  console.error(`[Strava] ${context}:`, err instanceof Error ? err.message : err);

// Webhooks are acknowledged before processing, so transient failures are retried in-process.
// Anything still missed is picked up by the daily reconciliation.
const retryTransient = <T>(operation: () => Promise<T>) =>
  withRetry(operation, { delaysMs: [30_000, 120_000, 600_000], isRetryable: isTransientError });

const app = new Hono();

app.use('/api/stats', cors());

// API routes take priority over static files
app.route('/api', routes);
app.route(
  '/api/strava',
  createStravaRoutes({
    config,
    exchangeCode: strava.exchangeCode,
    saveAthlete: db.saveAthlete,
    onAthleteConnected: (athlete) => {
      retryTransient(() => backfillAthlete(athlete, syncDeps))
        .then((count) => console.log(`[Strava] Imported ${count} activities for athlete ${athlete.id}`))
        .catch(logError(`Importing activities for athlete ${athlete.id} failed`));
    },
    onWebhookEvent: (event) => {
      retryTransient(() => handleWebhookEvent(event, syncDeps)).catch(
        logError(`Handling ${event.object_type} ${event.aspect_type} event ${event.object_id} failed`),
      );
    },
    deauthorize: strava.deauthorize,
    deleteAthlete: db.deleteAthlete,
    isConnectionOpen: () => Date.now() < RETENTION_ENDS_AT,
    isActiveSubscription: (id) => id === activeSubscriptionId,
  }),
);

// Serve frontend for all other paths
app.use('/*', serveStatic({ root: './public' }));

app.onError((err, c) => {
  console.error('[Unhandled]', err);
  return c.json({ error: 'Internal server error' }, 500);
});

const PORT = Number(process.env.PORT) || 3000;

// Runs even without Strava configured so the retention purge always applies; reconciling and
// the webhook subscription need the API. Must run after the server is listening because
// Strava validates the webhook callback while creating the subscription.
async function maintenance() {
  try {
    if ((await purgeIfExpired(syncDeps, new Date())) || !config) return;
    const subscription = await ensureWebhookSubscription(config, strava);
    if (subscription.status === 'active') activeSubscriptionId = subscription.subscriptionId;
    await runMaintenance(syncDeps);
  } catch (err) {
    logError('Daily maintenance failed')(err);
  }
}

// setTimeout's maximum delay; a later deadline is scheduled by a daily run once it is closer.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
let purgeTimer: NodeJS.Timeout | null = null;

// The daily run alone could purge up to a day late, so the deadline gets its own timer.
function schedulePurgeAtDeadline() {
  const delay = RETENTION_ENDS_AT - Date.now();
  if (purgeTimer || delay <= 0 || delay > MAX_TIMEOUT_MS) return;
  purgeTimer = setTimeout(() => {
    withRetry(() => purgeIfExpired(syncDeps, new Date()), { delaysMs: [30_000, 120_000, 600_000, 1_800_000] })
      .catch(logError('Retention purge failed'))
      .finally(() => {
        purgeTimer = null;
      });
  }, delay);
}

async function main() {
  await db.runMigrations();

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[App] Running challenge running on http://localhost:${PORT}`);
    void maintenance();
    schedulePurgeAtDeadline();
    setInterval(() => {
      schedulePurgeAtDeadline();
      void maintenance();
    }, MAINTENANCE_INTERVAL_MS);
  });
}

main().catch((err) => {
  console.error('[Startup] Fatal error:', err);
  process.exit(1);
});
