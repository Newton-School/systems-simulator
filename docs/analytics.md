# Usage analytics

The app can report a few anonymous usage events to measure whether the simple layout helps people
get to a first run. It reports **nothing** unless the build configures a destination.

## Turning it on

Set these at build time (Vite env variables):

| Variable               | Meaning                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `VITE_ANALYTICS_SINKS` | Comma-separated destinations: `posthog`, `console`. Empty = nothing.                           |
| `VITE_POSTHOG_KEY`     | PostHog project API key (needed for `posthog`).                                                |
| `VITE_POSTHOG_HOST`    | Ingestion host. Defaults to `https://us.i.posthog.com`; use `https://eu.i.posthog.com` for EU. |

`console` prints events to the browser console, for development.

PostHog is used through its public capture endpoint with a plain `fetch`, so there is no SDK, no
auto-capture, no session recording and no person profile.

## What is sent

Only the events in `src/renderer/src/analytics/events.ts`, each with the few properties listed
there (for example `run_started { first, layout, ms_since_open }`). There is no user, account,
assignment, question or topology data. The id is a random UUID kept in this browser's
`localStorage` (`nssimulator.analytics-id`).

People can opt out: the browser's Do Not Track setting is honoured, and
`localStorage['nssimulator.analytics-opt-out'] = '1'` turns reporting off.

## Switching or adding a destination

Call sites only use `track(name, properties)`. A destination is an `AnalyticsSink`
(`{ id, send(event) }`) in `analytics/sinks.ts`, chosen in `sinksFromEnv`. To report through the
Newton host instead, add a sink that posts the event to `window.parent` (using the origin checks in
`utils/questionHostMessaging.ts`) and name it in `VITE_ANALYTICS_SINKS`. Several sinks can run at
once, so the two can be compared. The host must handle the new message type before anything
arrives.
