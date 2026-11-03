import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StravaApiError, type StravaActivity, type TokenSet } from './strava';
import {
  backfillAthlete,
  displayName,
  handleWebhookEvent,
  type AthleteRecord,
  type SyncDeps,
  type WebhookEvent,
} from './sync';

const NOW = new Date('2026-04-10T12:00:00Z');

function athlete(overrides: Partial<AthleteRecord> = {}): AthleteRecord {
  return {
    id: 1,
    name: 'Kalle A.',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: new Date(NOW.getTime() + 3600_000),
    ...overrides,
  };
}

function activity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 100,
    athlete: { id: 1 },
    distance: 5000,
    moving_time: 1500,
    sport_type: 'Run',
    start_date: '2026-04-10T06:00:00Z',
    ...overrides,
  };
}

function fakeDeps(opts: {
  athletes?: AthleteRecord[];
  activities?: Record<number, StravaActivity>;
  refresh?: (token: string) => Promise<TokenSet>;
} = {}) {
  const athletes = new Map((opts.athletes ?? []).map((a) => [a.id, a]));
  const remoteActivities = new Map(Object.entries(opts.activities ?? {}).map(([k, v]) => [Number(k), v]));
  const upserted: Array<{ stravaActivityId: number; athleteId: number; km: number }> = [];
  const deletedActivities: number[] = [];
  const deletedAthletes: number[] = [];
  const savedTokens: Array<{ athleteId: number; tokens: TokenSet }> = [];
  const usedTokens: string[] = [];

  const deps: SyncDeps = {
    now: () => NOW,
    findAthlete: async (id) => athletes.get(id) ?? null,
    saveTokens: async (athleteId, tokens) => {
      savedTokens.push({ athleteId, tokens });
    },
    deleteAthlete: async (id) => {
      deletedAthletes.push(id);
    },
    upsertActivity: async (record) => {
      upserted.push(record);
    },
    deleteActivity: async (id) => {
      deletedActivities.push(id);
    },
    strava: {
      refreshTokens: opts.refresh ?? (async () => ({
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        expiresAt: new Date(NOW.getTime() + 6 * 3600_000),
      })),
      getActivity: async (token, id) => {
        usedTokens.push(token);
        const found = remoteActivities.get(id);
        if (!found) throw new StravaApiError(404, 'Record Not Found');
        return found;
      },
      listActivitiesSince: async (token) => {
        usedTokens.push(token);
        return [...remoteActivities.values()];
      },
    },
  };
  return { deps, upserted, deletedActivities, deletedAthletes, savedTokens, usedTokens };
}

function event(overrides: Partial<WebhookEvent>): WebhookEvent {
  return {
    object_type: 'activity',
    object_id: 100,
    aspect_type: 'create',
    owner_id: 1,
    subscription_id: 1,
    event_time: NOW.getTime() / 1000,
    ...overrides,
  };
}

test('displayName keeps first name and last initial only', () => {
  assert.equal(displayName('Kalle', 'Ahlström'), 'Kalle A.');
  assert.equal(displayName('Kalle', ''), 'Kalle');
  assert.equal(displayName(undefined, undefined), '?');
});

test('activity create fetches the activity and records it for the athlete', async () => {
  const f = fakeDeps({ athletes: [athlete()], activities: { 100: activity() } });
  await handleWebhookEvent(event({}), f.deps);
  assert.equal(f.upserted.length, 1);
  assert.deepEqual(
    { id: f.upserted[0].stravaActivityId, athlete: f.upserted[0].athleteId, km: f.upserted[0].km },
    { id: 100, athlete: 1, km: 5 },
  );
});

test('events for athletes who have not connected are ignored', async () => {
  const f = fakeDeps({ activities: { 100: activity() } });
  await handleWebhookEvent(event({}), f.deps);
  assert.equal(f.upserted.length, 0);
  assert.equal(f.usedTokens.length, 0);
});

test('an activity owned by someone else is not attributed to the event owner', async () => {
  const f = fakeDeps({ athletes: [athlete()], activities: { 100: activity({ athlete: { id: 2 } }) } });
  await handleWebhookEvent(event({}), f.deps);
  assert.equal(f.upserted.length, 0);
});

test('expired access token is refreshed and persisted before fetching', async () => {
  const f = fakeDeps({
    athletes: [athlete({ expiresAt: new Date(NOW.getTime() - 1000) })],
    activities: { 100: activity() },
  });
  await handleWebhookEvent(event({}), f.deps);
  assert.equal(f.savedTokens.length, 1);
  assert.deepEqual(f.usedTokens, ['access-new']);
  assert.equal(f.upserted.length, 1);
});

test('delete event removes the activity once Strava no longer returns it', async () => {
  const f = fakeDeps({ athletes: [athlete()] });
  await handleWebhookEvent(event({ aspect_type: 'delete' }), f.deps);
  assert.deepEqual(f.deletedActivities, [100]);
});

test('delete event for an activity that still exists keeps it', async () => {
  const f = fakeDeps({ athletes: [athlete()], activities: { 100: activity() } });
  await handleWebhookEvent(event({ aspect_type: 'delete' }), f.deps);
  assert.deepEqual(f.deletedActivities, []);
  assert.equal(f.upserted.length, 1);
});

test('update that makes the activity unreadable removes it', async () => {
  const f = fakeDeps({ athletes: [athlete()] });
  await handleWebhookEvent(event({ aspect_type: 'update', updates: { private: 'true' } }), f.deps);
  assert.deepEqual(f.deletedActivities, [100]);
});

test('deauthorization deletes the athlete when their tokens are revoked', async () => {
  const f = fakeDeps({
    athletes: [athlete()],
    refresh: async () => {
      throw new StravaApiError(400, 'Bad Request');
    },
  });
  await handleWebhookEvent(
    event({ object_type: 'athlete', object_id: 1, aspect_type: 'update', updates: { authorized: 'false' } }),
    f.deps,
  );
  assert.deepEqual(f.deletedAthletes, [1]);
});

test('deauthorization event is ignored while the athlete tokens still work', async () => {
  const f = fakeDeps({ athletes: [athlete()] });
  await handleWebhookEvent(
    event({ object_type: 'athlete', object_id: 1, aspect_type: 'update', updates: { authorized: 'false' } }),
    f.deps,
  );
  assert.deepEqual(f.deletedAthletes, []);
});

test('transient Strava errors do not delete anything', async () => {
  const f = fakeDeps({ athletes: [athlete()] });
  f.deps.strava.getActivity = async () => {
    throw new StravaApiError(503, 'Service Unavailable');
  };
  await assert.rejects(handleWebhookEvent(event({ aspect_type: 'delete' }), f.deps));
  assert.deepEqual(f.deletedActivities, []);
});

test('backfill records only the athlete own activities', async () => {
  const f = fakeDeps({
    athletes: [athlete()],
    activities: { 100: activity(), 101: activity({ id: 101, athlete: { id: 2 } }) },
  });
  await backfillAthlete(athlete(), new Date('2026-04-01T00:00:00Z'), f.deps);
  assert.deepEqual(f.upserted.map((r) => r.stravaActivityId), [100]);
});
