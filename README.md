# Running Challenge

Tracks cumulative running km for the DNA x Tietokilta running challenge (1.4.–1.6.2026).

## Development

Copy `.env.example` to `.env` and fill in the values, then:

```bash
docker compose up -d
npm install
npm run dev
```

## How activities are collected

Participants connect their own Strava account on the front page after ticking a consent box
for their first name, last initial and km totals to be shown publicly. The app requests the
`activity:read` scope, stores the athlete's tokens, and imports their activities in the
challenge window. After that, Strava pushes a webhook event whenever the athlete creates,
edits or deletes an activity, and the app re-reads that activity with the athlete's token.
Webhook events are not trusted on their own: an activity is removed only when Strava returns
404 for it, and an athlete is removed (with all their activities) only when Strava rejects
their refresh token as revoked.

On startup the app creates the Strava webhook subscription for `PUBLIC_URL` if the API
application has none. Strava allows one subscription per application, so a development
instance should use its own Strava API application.

Activities count toward the challenge by their Strava start time. Rows collected by the
earlier club-feed poller cannot be matched to re-imported activities and are not counted;
they are deleted with the rest of the Strava data after the retention period.

Webhook events are acknowledged immediately and processed in the background with retries
for temporary failures. Events whose `subscription_id` is not the app's active subscription
are ignored, so forged events cannot spend the Strava API quota. The daily job also
re-checks the webhook subscription. Token refreshes are serialized per athlete because
Strava rotates refresh tokens; a rejected refresh only counts as revocation if the stored
token is unchanged. New connections are refused once the retention period is over.

## Strava data handling

The app follows the [Strava API Policy](https://www.strava.com/legal/api_policy) as closely as
the public leaderboard allows:

- Only the distance, sport type and start time of activities inside the challenge window are
  stored, with the athlete's first name, last initial and tokens.
- A daily job re-reads every athlete's activities and removes ones that were deleted or made
  private, in case a webhook event was missed.
- **All Strava data, including club-feed rows, is deleted 7 days after `CHALLENGE_END`**
  (`RETENTION_AFTER_END_MS` in `src/sync.ts`). Update the dates in `src/constants.ts` before
  each challenge.
- "Remove my data" on the front page deletes the athlete's data and revokes the app's access
  after the athlete signs in to Strava; revoking access in Strava's settings has the same
  effect through the webhook.

Showing other participants' data publicly is restricted by the policy (sections 2.3 and 6.1);
get Strava's written approval for the leaderboard before launching a challenge.

### Strava API application settings

- **Authorization Callback Domain** must be the host of `PUBLIC_URL`.
- New Strava API applications accept one athlete. The owner can raise this to 10 in the API
  settings; more than 10 requires Strava's app review, which can take weeks, so submit it well
  before the challenge starts.

## Environment variables

| Variable | Description |
|---|---|
| `CLIENT_ID` | Strava API application client ID |
| `CLIENT_SECRET` | Strava API application client secret |
| `PUBLIC_URL` | Public base URL of the app, e.g. `https://running.example.fi`; used for the OAuth redirect and webhook callback |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Random string Strava echoes back when validating the webhook subscription |
| `PGHOST` | Postgres host |
| `PGPORT` | Postgres port (default: 5432) |
| `PGDATABASE` | Database name |
| `PGUSER` | Database user |
| `PGPASSWORD` | Database password |
| `PORT` | HTTP port (default: 3000) |

The Strava integration is disabled (and its routes return 503) unless `CLIENT_ID`,
`CLIENT_SECRET`, `PUBLIC_URL` and `STRAVA_WEBHOOK_VERIFY_TOKEN` are all set.

## API

| Endpoint | Description |
|---|---|
| `GET /api/stats` | Returns cumulative km totals per athlete and category |
| `GET /api/strava/connect?consent=1` | Starts the Strava OAuth flow |
| `POST /api/strava/remove` | Same-origin form only; after Strava's approval screen, deletes the athlete's data and revokes access |
| `GET /api/strava/callback` | Strava OAuth redirect target |
| `GET, POST /api/strava/webhook` | Strava webhook validation and events |

## Checks

```bash
npm test
npm run typecheck
npm run lint
```
