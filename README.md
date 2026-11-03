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

Participants connect their own Strava account on the front page (`Connect with Strava`). The
app requests the `activity:read` scope, stores the athlete's tokens, and imports their
activities since the challenge start. After that, Strava pushes a webhook event whenever the
athlete creates, edits or deletes an activity, and the app re-reads that activity with the
athlete's token. Webhook events are not trusted on their own: an activity is removed only when
Strava returns 404 for it, and an athlete is removed (with all their activities) only when
their tokens have been revoked.

On startup the app creates the Strava webhook subscription for `PUBLIC_URL` if the API
application has none. Strava allows one subscription per application, so a development
instance should use its own Strava API application.

Activities count toward the challenge by their Strava start time. Rows collected by the
earlier club-feed poller have no start time and count by when they were first seen.

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
| `GET /api/strava/connect` | Starts the Strava OAuth flow |
| `GET /api/strava/callback` | Strava OAuth redirect target |
| `GET, POST /api/strava/webhook` | Strava webhook validation and events |

## Checks

```bash
npm test
npm run typecheck
npm run lint
```
