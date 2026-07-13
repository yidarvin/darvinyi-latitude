# Latitude — Architecture

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend | Node 20 + Express (ESM JS) | Consistent with darvinyi-values, darvinyi-benchmarks |
| Frontend | React 18 + Vite | Standard for the portfolio |
| DB | PostgreSQL + Prisma | Standard for the portfolio |
| Map tiles | CartoDB Dark Matter | Free, no key, matches dark aesthetic |
| Geocoding + routing | Mapbox (Search Box API + Directions v5, walking profile) | POI-aware geocoding, real walking polylines |
| Weather | Open-Meteo | Free, no key |
| Agent | `@anthropic-ai/sdk`, `claude-sonnet-5`, custom tool loop | Explicit pauses for user input, prompt caching, adaptive thinking |
| Hosting | Railway, single service | Long-lived SSE + co-located secrets |
| Testing | Vitest + Supertest (server only) | Mocked Prisma/SDK, no live DB needed to run the suite |

## Monorepo layout

```
/server         — Express API + serves built client in prod
/client         — React + Vite app
/context        — Reference docs for Claude Code sessions
/.github         — CI workflow
package.json    — Root orchestration (lint) only
```

## Data flow: agent run

1. Client POSTs the brief to `/api/walks/draft` → server validates (zod), stores `briefSnapshot`, creates an `AgentRun` with `status: 'active'`.
2. Client opens SSE stream at `/api/agent-runs/:id/stream`. The route preempts any other loop already running for that run (`abortActiveRun`) before starting a fresh one — a second tab or a browser auto-reconnect can't double-run the loop.
3. `agent/loop.js` builds the initial user message from the brief, calls Anthropic with the system prompt (prompt-cached) + tool defs, and streams text deltas to the client as `message_delta` events.
4. On `tool_use`:
   - `get_user_history` → queried fresh each call (not preloaded)
   - `geocode_location`, `get_weather`, `compute_route` → executed server-side, results validated, `tool_start`/`tool_done` streamed, result appended, loop continues
   - `web_search` → Anthropic-hosted (`web_search_20260209`), never reaches `executeTool`
   - `request_user_input` → must be the only tool call in its turn (violations are rejected back to the model as a recoverable `is_error` tool_result); on a clean call, `AgentRun.status` → `awaiting_user`, SSE closes
   - `compose_walk` → input validated against a zod schema (lat/lng bounds, stop-radius-from-center sanity check, unique ordinals) before touching Prisma; on success creates (or, during refinement, updates in place) the `Walk` + `Stop[]` rows, `status` → `composed`; on validation failure the error is fed back to the model as a recoverable `is_error` tool_result instead of failing the run
5. A dropped SSE connection does **not** fail the run — `messages` are persisted and `status` stays `active`/`awaiting_user` so a reconnect resumes exactly where it left off (see "Reliability" below).
6. When the client gets `awaiting_user`, it shows the reply box. User submits → POST `/api/agent-runs/:id/reply` → server appends the reply as a `tool_result`, flips back to `active`, client reopens the stream.
7. When the client gets `composed`, it redirects to `/folio/walks/:walkId`. In the background (not blocking the response), the server regenerates the user's folio insight with one more Anthropic call on the same key (`generateFolioInsight`).

## Reliability (agent loop)

- **Disconnect ≠ failure.** `sse.isClosed()` no longer routes into `failRun`. The loop persists `messages` every iteration via a guarded `updateMany({ where: { status: 'active' } })` and just returns; the run stays resumable.
- **Single active loop per run.** An in-process `Map<runId, controller>` (`activeRuns`) lets a fresh connection abort whatever loop is already live for that run, rather than running two loops (and burning the user's API budget twice) concurrently.
- **`pause_turn`** (the hosted `web_search` tool hitting its internal round limit) resumes automatically by re-sending history — no synthetic user message needed.
- **`max_tokens`** gets one retry at a higher budget (16k → 32k) before the run is marked failed.
- **Retryable Anthropic errors** (429/5xx/network) leave the run resumable instead of terminal; only a genuine model outcome (unexpected `stop_reason`, `end_turn` without composing, iteration exhaustion) marks the run `error`.
- **Stale runs.** Any `active`/`awaiting_user` run untouched for 24h is flipped to `abandoned` lazily, the next time it's read (`reapIfStale`) — no scheduled sweep job.
- **Graceful shutdown.** SIGTERM/SIGINT close all active SSE streams and abort their in-flight Anthropic calls (leaving them resumable), then disconnect Prisma and exit, with a bounded force-exit timer as backstop.

## Auth

JWT in `httpOnly` Secure cookies, `HS256` pinned explicitly on both sign and verify. Cookie set on login/signup, cleared on logout (and on account deletion). Middleware `requireAuth` reads the cookie, verifies the JWT, attaches `req.user`. JWT payload: `{ sub: userId, iat, exp }`. 7-day expiry.

Login and signup are rate-limited by IP (`express-rate-limit`); login is additionally limited by the submitted email so one account can't be brute-forced from many IPs. The "unknown email" and "wrong password" paths always run the full bcrypt compare (against a real dummy hash) so response timing doesn't leak account existence.

## API key handling

The user's Anthropic key is encrypted at rest with `crypto.createCipheriv` (AES-256-GCM). The server holds the master key in `API_KEY_ENCRYPTION_KEY`. Stored fields: `apiKeyCipher`, `apiKeyNonce`, `apiKeyAuthTag` (all base64, all **nullable** — a user can remove their key from Account without deleting the account; an agent run started with no key on file fails gracefully with a message pointing back to Account, instead of crashing). Decrypted in memory only when the agent needs to call Anthropic; never logged, never returned to the client (only a masked preview is).

At signup, the key gets one cheap live check (`models.list()`, no tokens spent) before the account is created — a typo'd or already-revoked key is rejected immediately rather than surfacing as a mysterious failure on the first walk.

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| POST   | /api/auth/signup | Create account + set API key (validates the key live first) |
| POST   | /api/auth/login  | Set auth cookie |
| POST   | /api/auth/logout | Clear cookie |
| GET    | /api/auth/me     | Current user (masked key preview, no raw key) |
| PATCH  | /api/auth/api-key | Rotate the user's Anthropic key |
| DELETE | /api/auth/api-key | Remove the stored key without deleting the account |
| DELETE | /api/auth/account | Password-confirmed account deletion (cascades walks/runs) |
| GET    | /api/walks       | List user's walks, cursor-paginated |
| GET    | /api/walks/:id   | Get one walk with stops |
| DELETE | /api/walks/:id   | Delete a walk (stops cascade, its stops become reusable) |
| PATCH  | /api/walks/:id/status | Mark a walk `composed`/`completed` ("mark as walked") |
| POST   | /api/walks/draft | Validate a brief, create an AgentRun |
| GET    | /api/agent-runs  | List the user's resumable (`active`/`awaiting_user`) runs |
| GET    | /api/agent-runs/:id | Run status + derived transcript (for hydrating the Dialogue screen on load) |
| GET    | /api/agent-runs/:id/stream | SSE stream — runs or resumes the agent loop |
| POST   | /api/agent-runs/:id/reply  | User reply to a pending `request_user_input` |
| POST   | /api/agent-runs/:id/refine | Re-open a composed run with a follow-up note |
| POST   | /api/agent-runs/:id/abort  | Stop an in-progress run (marks `abandoned`) |
| GET    | /api/folio/insight | The folio header insight (agent-generated if available, template fallback otherwise) + stats |
| GET    | /api/util/reverse-geocode | "Use my location" support for the Brief form |
| GET    | /api/health      | Health check (Railway healthcheck target) |
| GET    | /api/db-health   | Database round-trip check |

All non-GET routes above (except signup/login, which are unauthenticated by design) require `requireAuth` and scope every query to `req.user.id` — there is no route that trusts a client-supplied user id.

## File structure (server)

```
server/
├── src/
│   ├── index.js               — helmet, request logging, graceful shutdown, mounts routers
│   ├── config.js               — env validation (zod) at boot, fails loud on placeholder secrets
│   ├── db.js                   — Prisma client singleton
│   ├── middleware/
│   │   ├── requireAuth.js
│   │   └── rateLimit.js        — per-user in-memory limiter (unauthenticated routes use express-rate-limit instead)
│   ├── lib/
│   │   ├── crypto.js           — AES-256-GCM encrypt/decrypt/mask
│   │   ├── jwt.js
│   │   ├── mapbox.js           — geocode (Search Box API) + walkingDirections
│   │   ├── openmeteo.js
│   │   └── cameras.js          — camera/lens/duration/style catalog shared by walks.js + the agent
│   ├── agent/
│   │   ├── systemPrompt.js
│   │   ├── tools.js            — tool defs, zod validation, compose_walk persistence
│   │   ├── loop.js             — the agent loop, error/retry handling, folio-insight generation
│   │   ├── transcript.js       — derives a client-renderable transcript from raw message history
│   │   └── sse.js               — thin SSE helper (send/heartbeat/close/onClose)
│   └── routes/
│       ├── health.js
│       ├── auth.js
│       ├── walks.js
│       ├── agentRuns.js
│       ├── folio.js
│       └── util.js              — reverse-geocode for "Use my location"
├── test/setup.js                — test env vars, loaded before every suite
├── scripts/test-tools.js        — manual live-API smoke test (not part of the Vitest suite)
└── prisma/
    ├── schema.prisma
    ├── seed.js
    └── migrations/
```

## File structure (client)

```
client/src/
├── main.jsx
├── App.jsx                      — routes, wraps everything in <AuthProvider>
├── api/
│   ├── client.js                — fetch wrapper, apiUrl() for EventSource
│   ├── auth.js
│   ├── walks.js
│   └── agentRuns.js
├── components/
│   ├── Button.jsx
│   ├── Chip.jsx                 — Chip + ChipGroup, ARIA pressed/radio states
│   ├── Input.jsx                — Input / Textarea / Select
│   ├── Card.jsx
│   ├── ConfirmDialog.jsx        — themed confirm, replaces window.confirm
│   ├── AgentTranscript.jsx      — Turn + ReplyBox, shared by Dialogue and RefinePanel
│   ├── RefinePanel.jsx          — "talk to the agent again" on the Plan screen
│   ├── TopNav.jsx
│   ├── StepIndicator.jsx
│   ├── WalkThumb.jsx            — SVG route sketch, uniform-scale with cos(lat) correction
│   ├── LoadingDot.jsx
│   ├── Skeleton.jsx
│   ├── Brand.jsx
│   └── FooterNav.jsx
├── routes/
│   ├── Setup.jsx                 — signup/login, no TopNav
│   ├── Folio.jsx                  — past walks, insight card, resume-run banner
│   ├── Brief.jsx
│   ├── Dialogue.jsx
│   ├── Plan.jsx                   — map + shotlist + refine + print/GPX/maps-links/mark-walked
│   └── Account.jsx                — key rotate/remove, account deletion
├── hooks/
│   ├── useAuth.jsx
│   └── useAgentStream.js          — SSE state machine, auto-reconnect on transport drops
├── lib/
│   ├── mapMarkers.js
│   ├── markdownLite.jsx
│   ├── walkLabels.js
│   └── gpx.js                     — GPX export + Google Maps deep links
└── styles/
    ├── global.css                 — tokens, focus-visible, reduced-motion
    ├── components.css
    └── pages.css                  — includes the print stylesheet
```
