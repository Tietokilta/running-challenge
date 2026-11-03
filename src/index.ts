import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as db from './db';
import routes from './routes';
import { CHALLENGE_END, CHALLENGE_START } from './constants';
import { createStravaClient, readStravaConfig } from './strava';
import { createStravaRoutes } from './strava-routes';
import { ensureWebhookSubscription } from './subscription';
import { backfillAthlete, handleWebhookEvent, purgeIfExpired, runMaintenance, type SyncDeps } from './sync';

const config = readStravaConfig();
if (!config) {
  console.warn('[Strava] CLIENT_ID, CLIENT_SECRET, PUBLIC_URL or STRAVA_WEBHOOK_VERIFY_TOKEN not set; integration disabled');
}
const strava = createStravaClient({ clientId: config?.clientId ?? '', clientSecret: config?.clientSecret ?? '' });

const MAINTENANCE_INTERVAL_MS = 24 * 3600_000;

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
      backfillAthlete(athlete, syncDeps)
        .then((count) => console.log(`[Strava] Imported ${count} activities for athlete ${athlete.id}`))
        .catch(logError(`Importing activities for athlete ${athlete.id} failed`));
    },
    onWebhookEvent: (event) => {
      handleWebhookEvent(event, syncDeps).catch(
        logError(`Handling ${event.object_type} ${event.aspect_type} event ${event.object_id} failed`),
      );
    },
    deauthorize: strava.deauthorize,
    deleteAthlete: db.deleteAthlete,
  }),
);

// Serve frontend for all other paths
app.use('/*', serveStatic({ root: './public' }));

app.onError((err, c) => {
  console.error('[Unhandled]', err);
  return c.json({ error: 'Internal server error' }, 500);
});

const PORT = Number(process.env.PORT) || 3000;

// Without Strava credentials only the retention purge runs; reconciling needs the API.
const maintenance = () =>
  (config ? runMaintenance(syncDeps) : purgeIfExpired(syncDeps, new Date())).catch(
    logError('Daily maintenance failed'),
  );

async function main() {
  await db.runMigrations();
  // Runs even without Strava configured so the retention purge always applies.
  await maintenance();
  setInterval(maintenance, MAINTENANCE_INTERVAL_MS);

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`[App] Running challenge running on http://localhost:${PORT}`);
    if (config) void ensureWebhookSubscription(config, strava);
  });
}

main().catch((err) => {
  console.error('[Startup] Fatal error:', err);
  process.exit(1);
});
