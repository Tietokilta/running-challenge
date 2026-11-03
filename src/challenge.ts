export interface ChallengeWindow {
  start: Date;
  end: Date;
}

// An explicit offset keeps the window independent of the server time zone.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function readDate(env: NodeJS.ProcessEnv, name: string): Date {
  const value = env[name];
  const date = value && ISO_WITH_OFFSET.test(value) ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`${name} must be an ISO 8601 timestamp with an offset, e.g. 2026-11-03T00:00:00+02:00`);
  }
  return date;
}

/** Reads CHALLENGE_START (inclusive) and CHALLENGE_END (exclusive); throws if they are missing or invalid. */
export function readChallengeWindow(env: NodeJS.ProcessEnv = process.env): ChallengeWindow {
  const start = readDate(env, 'CHALLENGE_START');
  const end = readDate(env, 'CHALLENGE_END');
  if (end.getTime() <= start.getTime()) throw new Error('CHALLENGE_END must be after CHALLENGE_START');
  return { start, end };
}
