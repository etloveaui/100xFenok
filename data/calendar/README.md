# Calendar Data

> Public financial calendar mirror for feno-data and feno-data-remote.

## Files

1. `usd-calendar.json`
   - Source: BujaBot USD Google Calendar
   - Range: 2026-01-01 through 2027-03-01
   - Events: 388
   - Coverage: US macro releases, FOMC, FOMC minutes, Jackson Hole, monthly options expiration, SEC 13F filing deadlines

## Contract

The Google Calendar stays the operational source for alerts. This folder is a read-only data mirror for agents and public data consumers.

Each event keeps:

1. machine fields: `id`, `start_utc`, `start_kst`, `date_kst`, `time_kst`
2. display fields: `summary`, `title_en`, `title_ko`
3. classification fields: `importance`, `category`, `notification_profile`
4. evidence fields: `source`, `source_url`, `html_link`

Long calendar descriptions and legacy migration titles are intentionally excluded. The mirror is data, not a briefing.
