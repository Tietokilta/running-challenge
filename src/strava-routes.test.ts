import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStravaRoutes, type StravaRoutesDeps } from './strava-routes';
import type { AthleteRecord, WebhookEvent } from './sync';

const config = {
  clientId: '123',
  clientSecret: 'secret',
  publicUrl: 'https://running.example.fi',
  webhookVerifyToken: 'verify-me',
};

function setup(overrides: Partial<StravaRoutesDeps> = {}) {
  const saved: AthleteRecord[] = [];
  const connected: AthleteRecord[] = [];
  const events: WebhookEvent[] = [];
  const deauthorized: string[] = [];
  const deleted: number[] = [];
  const deps: StravaRoutesDeps = {
    config,
    exchangeCode: async () => ({
      tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: new Date('2026-04-10T18:00:00Z') },
      athlete: { id: 42, firstname: 'Kalle', lastname: 'Ahlström' },
    }),
    saveAthlete: async (a) => {
      saved.push(a);
    },
    onAthleteConnected: (a) => {
      connected.push(a);
    },
    onWebhookEvent: (e) => {
      events.push(e);
    },
    deauthorize: async (token) => {
      deauthorized.push(token);
    },
    deleteAthlete: async (id) => {
      deleted.push(id);
    },
    ...overrides,
  };
  return { app: createStravaRoutes(deps), saved, connected, events, deauthorized, deleted };
}

async function startConnect(app: ReturnType<typeof setup>['app'], path = '/connect?consent=1') {
  const res = await app.request(path);
  const location = new URL(res.headers.get('location')!);
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  return { res, location, cookie, state: location.searchParams.get('state')! };
}

test('connect redirects to Strava with read scope and a state bound to a cookie', async () => {
  const { app } = setup();
  const { res, location, cookie, state } = await startConnect(app);
  assert.equal(res.status, 302);
  assert.equal(location.origin + location.pathname, 'https://www.strava.com/oauth/authorize');
  assert.equal(location.searchParams.get('client_id'), '123');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://running.example.fi/api/strava/callback');
  assert.equal(location.searchParams.get('scope'), 'activity:read');
  assert.ok(state.length >= 32);
  assert.ok(cookie.endsWith(state));
});

test('connect requires explicit consent to the public leaderboard', async () => {
  const { app } = setup();
  const res = await app.request('/connect');
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('location'), null);
});

test('remove flow deletes the athlete and revokes the app without storing anything', async () => {
  const { app, saved, connected, deauthorized, deleted } = setup();
  const { location, cookie, state } = await startConnect(app, '/remove');
  assert.equal(location.searchParams.get('scope'), 'read');
  const res = await app.request(`/callback?code=c&scope=read&state=${state}`, { headers: { cookie } });
  assert.equal(res.headers.get('location'), '/?strava=removed');
  assert.deepEqual(deleted, [42]);
  assert.deepEqual(deauthorized, ['a']);
  assert.equal(saved.length, 0);
  assert.equal(connected.length, 0);
});

test('a connect state cannot be replayed as a remove and vice versa', async () => {
  const { app, deleted } = setup();
  const { cookie } = await startConnect(app);
  const { state: removeState } = await startConnect(app, '/remove');
  const res = await app.request(`/callback?code=c&scope=read&state=${removeState}`, { headers: { cookie } });
  assert.equal(res.status, 400);
  assert.deepEqual(deleted, []);
});

test('callback stores the athlete and starts the backfill', async () => {
  const { app, saved, connected } = setup();
  const { cookie, state } = await startConnect(app);
  const res = await app.request(`/callback?code=c&scope=read,activity:read&state=${state}`, {
    headers: { cookie },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/?strava=connected');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 42);
  assert.equal(saved[0].name, 'Kalle A.');
  assert.deepEqual(connected.map((a) => a.id), [42]);
});

test('callback with a state that does not match the cookie is rejected', async () => {
  const { app, saved } = setup();
  const { cookie } = await startConnect(app);
  const res = await app.request('/callback?code=c&scope=read,activity:read&state=forged', {
    headers: { cookie },
  });
  assert.equal(res.status, 400);
  assert.equal(saved.length, 0);
});

test('callback without activity read permission does not store the athlete', async () => {
  const { app, saved } = setup();
  const { cookie, state } = await startConnect(app);
  const res = await app.request(`/callback?code=c&scope=read&state=${state}`, { headers: { cookie } });
  assert.equal(res.headers.get('location'), '/?strava=missing-scope');
  assert.equal(saved.length, 0);
});

test('callback when the user cancels on Strava redirects back with a notice', async () => {
  const { app, saved } = setup();
  const { cookie, state } = await startConnect(app);
  const res = await app.request(`/callback?error=access_denied&state=${state}`, { headers: { cookie } });
  assert.equal(res.headers.get('location'), '/?strava=denied');
  assert.equal(saved.length, 0);
});

test('webhook validation echoes the challenge only for the configured verify token', async () => {
  const { app } = setup();
  const ok = await app.request('/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { 'hub.challenge': 'abc' });

  const bad = await app.request('/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc');
  assert.equal(bad.status, 403);
});

test('webhook events are acknowledged and handed off', async () => {
  const { app, events } = setup();
  const body = {
    object_type: 'activity',
    object_id: 1,
    aspect_type: 'create',
    owner_id: 42,
    subscription_id: 9,
    event_time: 1,
  };
  const res = await app.request('/webhook', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(events, [body]);
});

test('routes report unavailable when Strava is not configured', async () => {
  const { app } = setup({ config: null });
  assert.equal((await app.request('/connect?consent=1')).status, 503);
});
