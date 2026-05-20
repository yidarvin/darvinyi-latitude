# Latitude — Architecture

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend | Node 20 + Express (ESM JS) | Consistent with darvinyi-values, darvinyi-benchmarks |
| Frontend | React 18 + Vite | Standard for the portfolio |
| DB | PostgreSQL + Prisma | Standard for the portfolio |
| Map tiles | CartoDB Dark Matter | Free, no key, matches dark aesthetic |
| Routing | Mapbox Directions API | Best walking + transit pathing, generous free tier |
| Geocoding | Mapbox Geocoding | Same key as routing |
| Weather | Open-Meteo | Free, no key |
| Agent | `@anthropic-ai/sdk` (standard) | Custom tool loop with explicit pauses for user input |
| Hosting | Railway, single service | Long-lived SSE + co-located secrets |

## Monorepo layout

```
/server         — Express API + serves built client in prod
/client         — React + Vite app
/context        — Reference docs for Claude Code sessions
package.json    — Root orchestration only
```

## Data flow: agent run

1. Client POSTs the brief to `/api/walks/draft` → server stores draft, creates `AgentRun`.
2. Client opens SSE stream at `/api/agent-runs/:id/stream`.
3. Server loads user history, calls Anthropic with the agent system prompt + history + brief.
4. Agent responds. If text → stream to client as `message` events. If tool call:
   - `get_user_history` → already loaded, immediate return
   - `geocode_location`, `find_photography_spots`, `get_weather`, `compute_route` → execute, stream `tool_start` + `tool_done` events, append tool result, continue
   - `request_user_input` → server marks AgentRun status `awaiting_user`, closes the SSE, waits.
   - `compose_walk` → server validates payload, creates `Walk` + `Stop[]` rows, marks AgentRun `composed`, returns the walk ID.
5. When client gets `awaiting_user`, it shows the input box. User types reply → POST `/api/agent-runs/:id/reply` → server appends and re-opens SSE for the continuation.
6. When client gets `composed`, redirect to `/folio/walks/:walkId`.

## Auth

JWT in `httpOnly` Secure cookies. Cookie set on login/signup, cleared on logout. Middleware `requireAuth` reads cookie, verifies JWT, attaches `req.user`. JWT payload: `{ sub: userId, iat, exp }`. 7-day expiry.

## API key encryption

User's Anthropic key is encrypted at rest using `crypto.createCipheriv` with AES-256-GCM. The server holds the master encryption key in `API_KEY_ENCRYPTION_KEY`. Stored fields: `apiKeyCipher` (base64), `apiKeyNonce` (base64), `apiKeyAuthTag` (base64). Decrypted in memory only when the agent needs to call Anthropic; never logged, never returned to the client.

## API surface (final)

| Method | Path | Purpose |
|--------|------|---------|
| POST   | /api/auth/signup | Create account + set API key |
| POST   | /api/auth/login  | Set auth cookie |
| POST   | /api/auth/logout | Clear cookie |
| GET    | /api/auth/me     | Current user (no API key returned) |
| PATCH  | /api/auth/api-key | Rotate the user's Anthropic key |
| GET    | /api/walks       | List user's walks |
| GET    | /api/walks/:id   | Get one walk with stops |
| POST   | /api/walks/draft | Create draft from brief, start AgentRun |
| GET    | /api/agent-runs/:id/stream | SSE stream of agent events |
| POST   | /api/agent-runs/:id/reply  | User reply to a pending question |
| GET    | /api/folio/insight | Computed insight for the folio header |
| GET    | /api/health      | Health check |
| GET    | /api/db-health   | Database round-trip check |

## File structure (server, when complete)

```
server/
├── src/
│   ├── index.js
│   ├── config.js
│   ├── db.js
│   ├── middleware/
│   │   ├── requireAuth.js
│   │   └── errors.js
│   ├── lib/
│   │   ├── crypto.js
│   │   ├── jwt.js
│   │   ├── mapbox.js
│   │   ├── openmeteo.js
│   │   └── search.js
│   ├── agent/
│   │   ├── systemPrompt.js
│   │   ├── tools.js
│   │   ├── loop.js
│   │   └── sse.js
│   └── routes/
│       ├── health.js
│       ├── auth.js
│       ├── walks.js
│       ├── agentRuns.js
│       └── folio.js
└── prisma/
    ├── schema.prisma
    └── migrations/
```

## File structure (client, when complete)

```
client/src/
├── main.jsx
├── App.jsx
├── api/
│   ├── client.js
│   ├── auth.js
│   ├── walks.js
│   └── agentRuns.js
├── components/
│   ├── Button.jsx
│   ├── Chip.jsx
│   ├── Input.jsx
│   ├── Card.jsx
│   ├── TopNav.jsx
│   ├── StepIndicator.jsx
│   └── FooterNav.jsx
├── routes/
│   ├── Setup.jsx
│   ├── Folio.jsx
│   ├── Brief.jsx
│   ├── Dialogue.jsx
│   ├── Plan.jsx
│   ├── WalkReview.jsx
│   └── Account.jsx
├── hooks/
│   ├── useAuth.js
│   └── useAgentStream.js
├── lib/
│   └── map.js
└── styles/
    ├── global.css
    └── tokens.css
```
