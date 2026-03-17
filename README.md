# Running Challenge

Tracks cumulative running km for the DNA x Tietokilta running challenge (1.4.–1.6.2026).

## Development

Copy `.env.example` to `.env` and fill in the values, then:

```bash
docker compose up -d
npm install
npm run dev
```

## Environment variables

| Variable | Description |
|---|---|
| `CLIENT_ID` | OAuth app client ID |
| `CLIENT_SECRET` | OAuth app client secret |
| `REFRESH_TOKEN` | OAuth refresh token (obtained via one-time auth flow) |
| `CLUB_ID` | ID of the club to fetch activities from |
| `PGHOST` | Postgres host |
| `PGPORT` | Postgres port (default: 5432) |
| `PGDATABASE` | Database name |
| `PGUSER` | Database user |
| `PGPASSWORD` | Database password |
| `PORT` | HTTP port (default: 3000) |

## API

| Endpoint | Description |
|---|---|
| `GET /api/stats` | Returns cumulative km totals per athlete |
| `POST /api/fetch` | Manually triggers an activity fetch |

Activities are fetched automatically every 10 minutes. Only activities recorded on or after 2026-04-01 count toward the total.
