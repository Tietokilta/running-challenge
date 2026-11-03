import { withRetry, type RetryOptions } from './retry';
import { webhookPath, type StravaClient, type StravaConfig } from './strava';

export type SubscriptionResult =
  | { status: 'active'; subscriptionId: number }
  | { status: 'conflict' | 'failed' };

const DEFAULT_RETRY: RetryOptions = { delaysMs: [10_000, 30_000, 60_000, 300_000, 900_000, 1_800_000] };

/**
 * Makes sure Strava pushes activity events to this app. Strava allows one subscription per
 * API application and validates the callback URL while creating it, so this must run after
 * the HTTP server is listening. Temporary failures are retried; a subscription for another
 * URL is left alone because it may belong to another deployment.
 */
export async function ensureWebhookSubscription(
  config: StravaConfig,
  client: Pick<StravaClient, 'listSubscriptions' | 'createSubscription'>,
  retry: RetryOptions = DEFAULT_RETRY,
): Promise<SubscriptionResult> {
  const callbackUrl = config.publicUrl + webhookPath;
  try {
    return await withRetry(async () => {
      const existing = await client.listSubscriptions();
      const ours = existing.find((s) => s.callback_url === callbackUrl);
      if (ours) {
        console.log(`[Strava] Webhook subscription ${ours.id} active for ${callbackUrl}`);
        return { status: 'active', subscriptionId: ours.id };
      }
      if (existing.length > 0) {
        console.error(
          `[Strava] Application already has a webhook subscription for ${existing[0].callback_url}; ` +
            `delete it to receive events at ${callbackUrl}`,
        );
        return { status: 'conflict' };
      }
      const created = await client.createSubscription(callbackUrl, config.webhookVerifyToken);
      console.log(`[Strava] Created webhook subscription ${created.id} for ${callbackUrl}`);
      return { status: 'active', subscriptionId: created.id };
    }, retry);
  } catch (err) {
    console.error('[Strava] Webhook subscription setup failed:', err instanceof Error ? err.message : err);
    return { status: 'failed' };
  }
}
