import { webhookPath, type StravaClient, type StravaConfig } from './strava';

/**
 * Makes sure Strava pushes activity events to this app. Strava allows one subscription per
 * API application and validates the callback URL while creating it, so this must run after
 * the HTTP server is listening.
 */
export async function ensureWebhookSubscription(
  config: StravaConfig,
  client: Pick<StravaClient, 'listSubscriptions' | 'createSubscription'>,
): Promise<void> {
  const callbackUrl = config.publicUrl + webhookPath;
  try {
    const existing = await client.listSubscriptions();
    if (existing.some((s) => s.callback_url === callbackUrl)) {
      console.log(`[Strava] Webhook subscription active for ${callbackUrl}`);
      return;
    }
    if (existing.length > 0) {
      console.error(
        `[Strava] Application already has a webhook subscription for ${existing[0].callback_url}; ` +
          `delete it to receive events at ${callbackUrl}`,
      );
      return;
    }
    const created = await client.createSubscription(callbackUrl, config.webhookVerifyToken);
    console.log(`[Strava] Created webhook subscription ${created.id} for ${callbackUrl}`);
  } catch (err) {
    console.error('[Strava] Webhook subscription check failed:', err instanceof Error ? err.message : err);
  }
}
