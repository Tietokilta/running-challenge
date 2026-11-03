import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readChallengeWindow } from './challenge';

const valid = {
  CHALLENGE_START: '2026-11-03T00:00:00+02:00',
  CHALLENGE_END: '2027-01-01T00:00:00+02:00',
};

test('parses the challenge window from ISO 8601 timestamps', () => {
  const window = readChallengeWindow(valid);
  assert.equal(window.start.toISOString(), '2026-11-02T22:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-12-31T22:00:00.000Z');
});

test('accepts UTC timestamps', () => {
  const window = readChallengeWindow({ CHALLENGE_START: '2026-11-02T22:00:00Z', CHALLENGE_END: valid.CHALLENGE_END });
  assert.equal(window.start.toISOString(), '2026-11-02T22:00:00.000Z');
});

test('rejects missing dates', () => {
  assert.throws(() => readChallengeWindow({ CHALLENGE_END: valid.CHALLENGE_END }), /CHALLENGE_START/);
  assert.throws(() => readChallengeWindow({ CHALLENGE_START: valid.CHALLENGE_START }), /CHALLENGE_END/);
});

test('rejects unparseable dates', () => {
  assert.throws(() => readChallengeWindow({ ...valid, CHALLENGE_END: 'end of december' }), /CHALLENGE_END/);
});

test('rejects dates without a time zone offset, which would depend on the server time zone', () => {
  assert.throws(() => readChallengeWindow({ ...valid, CHALLENGE_START: '2026-11-03T00:00:00' }), /CHALLENGE_START/);
  assert.throws(() => readChallengeWindow({ ...valid, CHALLENGE_END: '2027-01-01' }), /CHALLENGE_END/);
});

test('rejects an end that is not after the start', () => {
  assert.throws(
    () => readChallengeWindow({ CHALLENGE_START: valid.CHALLENGE_END, CHALLENGE_END: valid.CHALLENGE_START }),
    /after/,
  );
});
