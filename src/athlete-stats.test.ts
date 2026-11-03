import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeAthlete } from './athlete-stats';

const window = { start: new Date('2026-11-03T00:00:00+02:00'), end: new Date('2027-01-01T00:00:00+02:00') };
const athlete = { name: 'Kalle A.', connectedAt: new Date('2026-11-03T10:00:00Z') };

test('totals only activities with distance inside the challenge window', () => {
  const stats = summarizeAthlete(athlete, [
    { km: 5.123, sportType: 'Run', startDate: new Date('2026-11-04T06:00:00Z'), updatedAt: new Date('2026-11-04T07:00:00Z') },
    { km: 20, sportType: 'Ride', startDate: new Date('2026-11-05T06:00:00Z'), updatedAt: new Date('2026-11-05T07:00:00Z') },
    { km: 0, sportType: 'WeightTraining', startDate: new Date('2026-11-06T06:00:00Z'), updatedAt: null },
    { km: 10, sportType: 'Run', startDate: new Date('2026-11-01T06:00:00Z'), updatedAt: null },
  ], window);

  assert.equal(stats.totalKm, 25.12);
  assert.equal(stats.countedActivities, 2);
  assert.deepEqual(stats.categories, [
    { name: 'Running', totalKm: 5.12, activities: 1 },
    { name: 'Cycling', totalKm: 20, activities: 1 },
  ]);
  assert.equal(stats.lastSyncedAt, '2026-11-05T07:00:00.000Z');
});

test('lists recent activities newest first and marks the ones that do not count', () => {
  const stats = summarizeAthlete(athlete, [
    { km: 5, sportType: 'Run', startDate: new Date('2026-11-04T06:00:00Z'), updatedAt: null },
    { km: 0, sportType: 'Yoga', startDate: new Date('2026-11-06T06:00:00Z'), updatedAt: null },
  ], window);

  assert.deepEqual(
    stats.recentActivities.map((a) => [a.sportType, a.category, a.counted]),
    [['Yoga', 'Other', false], ['Run', 'Running', true]],
  );
});

test('an athlete without activities has zero totals', () => {
  const stats = summarizeAthlete(athlete, [], window);
  assert.equal(stats.name, 'Kalle A.');
  assert.equal(stats.connectedAt, '2026-11-03T10:00:00.000Z');
  assert.equal(stats.totalKm, 0);
  assert.deepEqual(stats.recentActivities, []);
  assert.equal(stats.lastSyncedAt, null);
});
