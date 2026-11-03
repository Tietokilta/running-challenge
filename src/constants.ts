import { readChallengeWindow } from './challenge';

// Read at startup so a missing or invalid window stops the app before the retention purge can run.
export const { start: CHALLENGE_START, end: CHALLENGE_END } = readChallengeWindow();
