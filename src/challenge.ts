export interface ChallengeWindow {
  start: Date;
  end: Date;
}

// An explicit offset keeps the window independent of the server time zone.
const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** Parses the timestamp, rejecting values like Nov 31 that `Date` would silently roll over. */
function parseStrict(value: string): Date | null {
  const m = ISO_WITH_OFFSET.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second = '0', offsetHour = '0', offsetMinute = '0'] = m.slice(1);
  const local = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  const exists =
    local.getUTCFullYear() === +year &&
    local.getUTCMonth() === +month - 1 &&
    local.getUTCDate() === +day &&
    local.getUTCHours() === +hour &&
    local.getUTCMinutes() === +minute &&
    local.getUTCSeconds() === +second;
  if (!exists || +offsetHour > 14 || +offsetMinute > 59) return null;
  return new Date(value);
}

function readDate(env: NodeJS.ProcessEnv, name: string): Date {
  const date = parseStrict(env[name] ?? '');
  if (!date) throw new Error(`${name} must be an ISO 8601 timestamp with an offset, e.g. 2026-11-03T00:00:00+02:00`);
  return date;
}

/** Reads CHALLENGE_START (inclusive) and CHALLENGE_END (exclusive); throws if they are missing or invalid. */
export function readChallengeWindow(env: NodeJS.ProcessEnv = process.env): ChallengeWindow {
  const start = readDate(env, 'CHALLENGE_START');
  const end = readDate(env, 'CHALLENGE_END');
  if (end.getTime() <= start.getTime()) throw new Error('CHALLENGE_END must be after CHALLENGE_START');
  return { start, end };
}
