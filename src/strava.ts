const OAUTH_BASE = 'https://www.strava.com/oauth';
const API_BASE = 'https://www.strava.com/api/v3';

export class StravaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Strava API ${status}: ${body}`);
  }
}

/** Network failures, rate limiting and Strava server errors are worth retrying. */
export function isTransientError(err: unknown): boolean {
  return !(err instanceof StravaApiError) || err.status === 429 || err.status >= 500;
}

export interface StravaConfig {
  clientId: string;
  clientSecret: string;
  /** Public base URL of this app, used for the OAuth redirect and webhook callback. */
  publicUrl: string;
  webhookVerifyToken: string;
}

export function readStravaConfig(env: NodeJS.ProcessEnv = process.env): StravaConfig | null {
  const { CLIENT_ID, CLIENT_SECRET, PUBLIC_URL, STRAVA_WEBHOOK_VERIFY_TOKEN } = env;
  if (!CLIENT_ID || !CLIENT_SECRET || !PUBLIC_URL || !STRAVA_WEBHOOK_VERIFY_TOKEN) return null;
  return {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    publicUrl: PUBLIC_URL.replace(/\/+$/, ''),
    webhookVerifyToken: STRAVA_WEBHOOK_VERIFY_TOKEN,
  };
}

export const callbackPath = '/api/strava/callback';
export const webhookPath = '/api/strava/webhook';

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface StravaAthlete {
  id: number;
  firstname?: string;
  lastname?: string;
}

export interface StravaActivity {
  id: number;
  athlete: { id: number };
  name?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  sport_type?: string;
  type?: string;
  start_date?: string;
  manual?: boolean;
  [key: string]: unknown;
}

export interface WebhookSubscription {
  id: number;
  callback_url: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: StravaAthlete;
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new StravaApiError(res.status, body.slice(0, 500) || res.statusText);
  }
  return (await res.json()) as T;
}

function toTokenSet(data: TokenResponse): TokenSet {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
  };
}

export function authorizeUrl(
  config: StravaConfig,
  state: string,
  scope: string,
  approvalPrompt: 'auto' | 'force' = 'auto',
): string {
  const url = new URL(`${OAUTH_BASE}/authorize`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.publicUrl + callbackPath);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', approvalPrompt);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  return url.toString();
}

export function createStravaClient(config: Pick<StravaConfig, 'clientId' | 'clientSecret'>) {
  const tokenRequest = (params: Record<string, string>) =>
    request<TokenResponse>(`${OAUTH_BASE}/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...params,
      }),
    });

  const authHeaders = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

  return {
    async exchangeCode(code: string): Promise<{ tokens: TokenSet; athlete: StravaAthlete }> {
      const data = await tokenRequest({ code, grant_type: 'authorization_code' });
      if (!data.athlete) throw new Error('Strava token response did not include the athlete');
      return { tokens: toTokenSet(data), athlete: data.athlete };
    },

    async refreshTokens(refreshToken: string): Promise<TokenSet> {
      return toTokenSet(await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }));
    },

    /** Revokes the app's access for the athlete who owns the token. */
    async deauthorize(accessToken: string): Promise<void> {
      await request(`${OAUTH_BASE}/deauthorize`, {
        method: 'POST',
        body: new URLSearchParams({ access_token: accessToken }),
      });
    },

    async getActivity(accessToken: string, id: number): Promise<StravaActivity> {
      return request<StravaActivity>(`${API_BASE}/activities/${id}`, { headers: authHeaders(accessToken) });
    },

    async listActivitiesSince(accessToken: string, after: Date): Promise<StravaActivity[]> {
      const perPage = 200;
      const all: StravaActivity[] = [];
      for (let page = 1; ; page++) {
        const url = new URL(`${API_BASE}/athlete/activities`);
        url.searchParams.set('after', String(Math.floor(after.getTime() / 1000)));
        url.searchParams.set('per_page', String(perPage));
        url.searchParams.set('page', String(page));
        const batch = await request<StravaActivity[]>(url.toString(), { headers: authHeaders(accessToken) });
        all.push(...batch);
        if (batch.length < perPage) return all;
      }
    },

    async listSubscriptions(): Promise<WebhookSubscription[]> {
      const url = new URL(`${API_BASE}/push_subscriptions`);
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('client_secret', config.clientSecret);
      return request<WebhookSubscription[]>(url.toString());
    },

    async createSubscription(callbackUrl: string, verifyToken: string): Promise<WebhookSubscription> {
      return request<WebhookSubscription>(`${API_BASE}/push_subscriptions`, {
        method: 'POST',
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          callback_url: callbackUrl,
          verify_token: verifyToken,
        }),
      });
    },
  };
}

export type StravaClient = ReturnType<typeof createStravaClient>;
