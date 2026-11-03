export interface RetryOptions {
  /** Delay before each retry; the operation runs at most `delaysMs.length + 1` times. */
  delaysMs: number[];
  sleep?: (ms: number) => Promise<void>;
  isRetryable?: (err: unknown) => boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { delaysMs, sleep = defaultSleep, isRetryable = () => true } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (attempt >= delaysMs.length || !isRetryable(err)) throw err;
      await sleep(delaysMs[attempt]);
    }
  }
}
