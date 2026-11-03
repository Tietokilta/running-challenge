import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureWebhookSubscription } from './subscription';
import type { WebhookSubscription } from './strava';

const config = {
  clientId: '1',
  clientSecret: 's',
  publicUrl: 'https://running.example.fi',
  webhookVerifyToken: 'vt',
};
const noSleep = async () => {};

test('subscription setup is retried after a temporary failure', async () => {
  let listCalls = 0;
  const created: string[] = [];
  const result = await ensureWebhookSubscription(
    config,
    {
      listSubscriptions: async () => {
        if (++listCalls === 1) throw new Error('network down');
        return [];
      },
      createSubscription: async (url): Promise<WebhookSubscription> => {
        created.push(url);
        return { id: 1, callback_url: url };
      },
    },
    { delaysMs: [1, 1], sleep: noSleep },
  );
  assert.deepEqual(result, { status: 'active', subscriptionId: 1 });
  assert.deepEqual(created, ['https://running.example.fi/api/strava/webhook']);
});

test('a subscription for another URL is reported without retrying or replacing it', async () => {
  let listCalls = 0;
  const result = await ensureWebhookSubscription(
    config,
    {
      listSubscriptions: async () => {
        listCalls++;
        return [{ id: 9, callback_url: 'https://other.example.fi/api/strava/webhook' }];
      },
      createSubscription: async () => {
        throw new Error('must not create');
      },
    },
    { delaysMs: [1, 1], sleep: noSleep },
  );
  assert.deepEqual(result, { status: 'conflict' });
  assert.equal(listCalls, 1);
});
