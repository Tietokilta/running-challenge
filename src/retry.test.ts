import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from './retry';

const noSleep = async () => {};

test('retries until the operation succeeds', async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      if (++calls < 3) throw new Error('temporary');
      return 'ok';
    },
    { delaysMs: [1, 1, 1], sleep: noSleep },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('gives up with the last error after all delays are used', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error(`fail ${calls}`);
      },
      { delaysMs: [1, 1], sleep: noSleep },
    ),
    /fail 3/,
  );
  assert.equal(calls, 3);
});

test('does not retry errors marked permanent', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error('permanent');
      },
      { delaysMs: [1, 1], sleep: noSleep, isRetryable: () => false },
    ),
  );
  assert.equal(calls, 1);
});
