import crypto from 'crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { authorizeUrl, type StravaAthlete, type StravaConfig, type TokenSet } from './strava';
import { displayName, type AthleteRecord, type WebhookEvent } from './sync';

const STATE_COOKIE = 'strava_oauth_state';
const READ_SCOPES = ['activity:read', 'activity:read_all'];

export interface StravaRoutesDeps {
  config: StravaConfig | null;
  exchangeCode(code: string): Promise<{ tokens: TokenSet; athlete: StravaAthlete }>;
  saveAthlete(athlete: AthleteRecord): Promise<void>;
  /** Called after an athlete connects; should import their existing activities. */
  onAthleteConnected(athlete: AthleteRecord): void;
  /** Called for each webhook event; must not block the response. */
  onWebhookEvent(event: WebhookEvent): void;
}

function isWebhookEvent(body: unknown): body is WebhookEvent {
  if (typeof body !== 'object' || body === null) return false;
  const e = body as Record<string, unknown>;
  return (
    (e.object_type === 'activity' || e.object_type === 'athlete') &&
    typeof e.object_id === 'number' &&
    typeof e.owner_id === 'number' &&
    typeof e.aspect_type === 'string'
  );
}

/** Routes mounted at /api/strava: OAuth connect flow and the webhook endpoint. */
export function createStravaRoutes(deps: StravaRoutesDeps) {
  const routes = new Hono();
  const { config } = deps;

  routes.use('*', async (c, next) => {
    if (!config) return c.json({ error: 'Strava integration is not configured' }, 503);
    await next();
  });

  routes.get('/connect', (c) => {
    const state = crypto.randomBytes(24).toString('base64url');
    setCookie(c, STATE_COOKIE, state, {
      path: '/api/strava',
      httpOnly: true,
      secure: config!.publicUrl.startsWith('https://'),
      sameSite: 'Lax',
      maxAge: 600,
    });
    return c.redirect(authorizeUrl(config!, state), 302);
  });

  routes.get('/callback', async (c) => {
    const expectedState = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: '/api/strava' });
    if (!expectedState || c.req.query('state') !== expectedState) {
      return c.text('Invalid or expired login attempt, please try again.', 400);
    }

    if (c.req.query('error')) return c.redirect('/?strava=denied', 302);

    const code = c.req.query('code');
    const scopes = (c.req.query('scope') ?? '').split(',');
    if (!code) return c.text('Missing authorization code.', 400);
    if (!scopes.some((s) => READ_SCOPES.includes(s))) return c.redirect('/?strava=missing-scope', 302);

    try {
      const { tokens, athlete } = await deps.exchangeCode(code);
      const record: AthleteRecord = {
        id: athlete.id,
        name: displayName(athlete.firstname, athlete.lastname),
        ...tokens,
      };
      await deps.saveAthlete(record);
      console.log(`[Strava] Athlete ${record.id} connected`);
      deps.onAthleteConnected(record);
    } catch (err) {
      console.error('[Strava] Connecting athlete failed:', err instanceof Error ? err.message : err);
      return c.redirect('/?strava=error', 302);
    }
    return c.redirect('/?strava=connected', 302);
  });

  // Subscription validation, see https://developers.strava.com/docs/webhooks/
  routes.get('/webhook', (c) => {
    if (c.req.query('hub.mode') !== 'subscribe' || c.req.query('hub.verify_token') !== config!.webhookVerifyToken) {
      return c.text('Forbidden', 403);
    }
    return c.json({ 'hub.challenge': c.req.query('hub.challenge') ?? '' });
  });

  routes.post('/webhook', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!isWebhookEvent(body)) return c.text('Bad Request', 400);
    deps.onWebhookEvent(body);
    return c.body(null, 200);
  });

  return routes;
}
