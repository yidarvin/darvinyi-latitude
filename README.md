# Latitude

> A walking agenda planner for photographers.

Latitude composes single-day photography walking routes. The user gives a brief — location, gear, time, styles — and a Claude-powered agent reads it against their past walks, asks a few calibrating questions, and composes a route on a real map with numbered stops and a project brief that ties them together.

Live: [latitude.darvinyi.com](https://latitude.darvinyi.com) · part of the [darvinyi.com](https://darvinyi.com) portfolio.

## Stack

- **Backend**: Node 20 + Express, Prisma + PostgreSQL, JWT auth in httpOnly cookies
- **Frontend**: React 18 + Vite, vanilla CSS with editorial type system, React Router, Leaflet
- **Agent**: `@anthropic-ai/sdk`, `claude-sonnet-5`, a custom tool loop with disconnect-safe resumption and prompt caching. Each user supplies their own Anthropic API key (encrypted at rest with AES-256-GCM)
- **External APIs**: Mapbox (geocoding + directions), Open-Meteo (weather), Anthropic web search
- **Streaming**: Server-Sent Events with explicit pause-for-user-input handling and automatic client-side reconnect
- **Testing**: Vitest + Supertest (server), ESLint across both apps, GitHub Actions CI
- **Deployment**: Railway (single Node service serving both API and built client)

## Memory as a feature

The differentiator is that the agent remembers. On each new walk, it loads the user's past walks via the `get_user_history` tool and uses them to:

- Avoid sending the user to the same blocks twice
- Notice time-of-day or neighborhood patterns and either lean in or break them
- Reference prior walks in conversation ("your Mission walk last month stayed on Valencia — I'll route you east this time")

The Folio screen surfaces a computed observation about the user's recent walks at the top of the page (e.g., *"You've gravitated toward golden light on your recent walks. Worth breaking the pattern, or keep building the consistency?"*).

## Repo layout

```
client/    React + Vite frontend
server/    Express API + agent loop + Prisma
context/   Project context files for Claude Code sessions
```

## Local dev

Requires a local PostgreSQL server running and reachable (`createdb latitude` or equivalent — `DATABASE_URL` in `server/.env` points at it) and Node 20 (`nvm use`, an `.nvmrc` is committed).

```bash
git clone https://github.com/yidarvin/darvinyi-latitude
cd darvinyi-latitude
nvm use
createdb latitude   # or your Postgres client of choice
cp server/.env.example server/.env  # fill in DATABASE_URL, JWT_SECRET, API_KEY_ENCRYPTION_KEY, MAPBOX_TOKEN
npm install
cd server && npx prisma migrate dev && npx prisma db seed
cd ..
npm run dev
```

Then sign in as `dev@latitude.test` / `hunter22hunter22` to see the seeded folio. **The seeded account's Anthropic API key is a fake placeholder** — planning a new walk will fail until you rotate in a real `sk-ant-...` key from Account (past seeded walks display fine either way, since they don't call the agent).

```bash
npm test    # server suite (Vitest + Supertest) — mocked Prisma/Anthropic, no live DB needed
npm run lint
```

CI (`.github/workflows/ci.yml`) runs both against a throwaway Postgres service container on every push/PR.

## Build notes

Built across many Claude Code sessions — early ones scaffolding, agent-loop implementation, and Railway deploy; a later multi-phase pass added the test/CI harness, a disconnect-safe agent loop rewrite, security hardening, accessibility fixes, and the account/resume/GPX/mark-as-walked features described above. Session prompts are kept in `context/sessions/` (out of the repo for size).
