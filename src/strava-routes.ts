import crypto from 'crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from 'hono/cookie';
import type { AthleteStats } from './athlete-stats';
import { authorizeUrl, type StravaAthlete, type StravaConfig, type TokenSet } from './strava';
import { displayName, type AthleteRecord, type WebhookEvent } from './sync';

const STATE_COOKIE = 'strava_oauth_state';
// Remembers which athlete connected in this browser so they can see their own stats.
const SESSION_COOKIE = 'strava_session';
const SESSION_MAX_AGE_S = 180 * 24 * 3600;
const READ_SCOPES = ['activity:read', 'activity:read_all'];

export interface StravaRoutesDeps {
  config: StravaConfig | null;
  exchangeCode(code: string): Promise<{ tokens: TokenSet; athlete: StravaAthlete }>;
  saveAthlete(athlete: AthleteRecord): Promise<void>;
  /** Called after an athlete connects; should import their existing activities. */
  onAthleteConnected(athlete: AthleteRecord): void;
  /** Called for each webhook event; must not block the response. */
  onWebhookEvent(event: WebhookEvent): void;
  deauthorize(accessToken: string): Promise<void>;
  /** Removes the athlete and all of their activities. */
  deleteAthlete(id: number): Promise<void>;
  /** False once the challenge's data retention period is over. */
  isConnectionOpen(): boolean;
  /** Whether webhook events with this subscription id come from our active subscription. */
  isActiveSubscription(subscriptionId: number): boolean;
  /** The athlete's own stats, or null if they are not connected. */
  getAthleteStats(id: number): Promise<AthleteStats | null>;
}

type Intent = 'connect' | 'remove';
const SCOPES: Record<Intent, string> = { connect: 'activity:read', remove: 'read' };
// Removal always shows Strava's approval screen so it cannot complete without a deliberate click.
const APPROVAL_PROMPT: Record<Intent, 'auto' | 'force'> = { connect: 'auto', remove: 'force' };

function isWebhookEvent(body: unknown): body is WebhookEvent {
  if (typeof body !== 'object' || body === null) return false;
  const e = body as Record<string, unknown>;
  return (
    (e.object_type === 'activity' || e.object_type === 'athlete') &&
    typeof e.object_id === 'number' &&
    typeof e.owner_id === 'number' &&
    typeof e.subscription_id === 'number' &&
    typeof e.aspect_type === 'string'
  );
}

/** Routes mounted at /api/strava: OAuth connect flow and the webhook endpoint. */
export function createStravaRoutes(deps: StravaRoutesDeps) {
  const routes = new Hono();
  const { config } = deps;
  // Derived so the session signing key differs from the secret sent to Strava.
  const sessionSecret = config
    ? crypto.createHmac('sha256', config.clientSecret).update('strava-session-cookie').digest('hex')
    : '';

  routes.use('*', async (c, next) => {
    if (!config) return c.json({ error: 'Strava integration is not configured' }, 503);
    await next();
  });

  const cookieOptions = () => ({
    path: '/api/strava',
    httpOnly: true,
    secure: config!.publicUrl.startsWith('https://'),
    sameSite: 'Lax' as const,
  });

  const startAuthorization = (c: Context, intent: Intent) => {
    // The intent is part of the state so a connect authorization cannot be replayed as a removal.
    const state = `${intent}.${crypto.randomBytes(24).toString('base64url')}`;
    setCookie(c, STATE_COOKIE, state, { ...cookieOptions(), maxAge: 600 });
    return c.redirect(authorizeUrl(config!, state, SCOPES[intent], APPROVAL_PROMPT[intent]), 302);
  };

  // Connecting publishes the athlete's data and removing deletes it, so only a form on this
  // site may start either (CSRF protection via Origin).
  const isSameOrigin = (c: Context) => c.req.header('origin') === new URL(config!.publicUrl).origin;

  const startSession = (c: Context, athleteId: number) =>
    setSignedCookie(c, SESSION_COOKIE, String(athleteId), sessionSecret, {
      ...cookieOptions(),
      maxAge: SESSION_MAX_AGE_S,
    });

  const endSession = (c: Context) => deleteCookie(c, SESSION_COOKIE, cookieOptions());

  const sessionAthleteId = async (c: Context): Promise<number | null> => {
    const value = await getSignedCookie(c, sessionSecret, SESSION_COOKIE);
    const id = Number(value);
    return value && Number.isSafeInteger(id) ? id : null;
  };

  // Participants must explicitly agree to their name and totals being shown publicly.
  routes.post('/connect', async (c) => {
    if (!isSameOrigin(c)) return c.text('Forbidden', 403);
    const form = await c.req.parseBody();
    if (form.consent !== '1') {
      return c.text('Please accept that your name and kilometres are shown on the leaderboard.', 400);
    }
    if (!deps.isConnectionOpen()) return c.redirect('/?strava=closed', 302);
    return startAuthorization(c, 'connect');
  });

  routes.post('/remove', (c) => {
    if (!isSameOrigin(c)) return c.text('Forbidden', 403);
    return startAuthorization(c, 'remove');
  });

  routes.post('/logout', (c) => {
    if (!isSameOrigin(c)) return c.text('Forbidden', 403);
    endSession(c);
    return c.redirect('/', 302);
  });

  routes.get('/me', async (c) => {
    c.header('Cache-Control', 'no-store');
    const athleteId = await sessionAthleteId(c);
    if (athleteId === null) return c.json({ connected: false });
    const stats = await deps.getAthleteStats(athleteId);
    if (!stats) {
      endSession(c);
      return c.json({ connected: false });
    }
    return c.json({ connected: true, ...stats });
  });

  const connect = async (c: Context, code: string, scopes: string[]) => {
    if (!scopes.some((s) => READ_SCOPES.includes(s))) return c.redirect('/?strava=missing-scope', 302);
    if (!deps.isConnectionOpen()) return c.redirect('/?strava=closed', 302);
    try {
      const { tokens, athlete } = await deps.exchangeCode(code);
      // The retention purge may have run while the code was being exchanged.
      if (!deps.isConnectionOpen()) return c.redirect('/?strava=closed', 302);
      const record: AthleteRecord = {
        id: athlete.id,
        name: displayName(athlete.firstname, athlete.lastname),
        ...tokens,
      };
      await deps.saveAthlete(record);
      console.log(`[Strava] Athlete ${record.id} connected`);
      deps.onAthleteConnected(record);
      await startSession(c, record.id);
    } catch (err) {
      console.error('[Strava] Connecting athlete failed:', err instanceof Error ? err.message : err);
      return c.redirect('/?strava=error', 302);
    }
    return c.redirect('/?strava=connected', 302);
  };

  const remove = async (c: Context, code: string) => {
    try {
      const { tokens, athlete } = await deps.exchangeCode(code);
      await deps.deleteAthlete(athlete.id);
      await deps.deauthorize(tokens.accessToken);
      console.log(`[Strava] Athlete ${athlete.id} removed their data`);
      endSession(c);
    } catch (err) {
      console.error('[Strava] Removing athlete failed:', err instanceof Error ? err.message : err);
      return c.redirect('/?strava=error', 302);
    }
    return c.redirect('/?strava=removed', 302);
  };

  routes.get('/callback', async (c) => {
    const expectedState = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, { path: '/api/strava' });
    if (!expectedState || c.req.query('state') !== expectedState) {
      return c.text('Invalid or expired login attempt, please try again.', 400);
    }

    if (c.req.query('error')) return c.redirect('/?strava=denied', 302);

    const code = c.req.query('code');
    if (!code) return c.text('Missing authorization code.', 400);
    const intent = expectedState.split('.')[0];
    if (intent === 'remove') return remove(c, code);
    return connect(c, code, (c.req.query('scope') ?? '').split(','));
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
    // Events are unauthenticated; ignoring ones without our subscription id keeps forged
    // events from spending the app's Strava API quota. Missed events are reconciled daily.
    if (deps.isActiveSubscription(body.subscription_id)) deps.onWebhookEvent(body);
    return c.body(null, 200);
  });

  return routes;
}
