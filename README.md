# Latitude

> A walking agenda planner for photographers.

Latitude composes single-day photography walking routes. The user gives a brief — location, gear, time, styles — and a Claude-powered agent reads it against their past walks, asks a few calibrating questions, and composes a route on a real map with numbered stops and a project brief that ties them together.

Live: [latitude.darvinyi.com](https://latitude.darvinyi.com) · part of the [darvinyi.com](https://darvinyi.com) portfolio.

## Stack

- **Backend**: Node 20 + Express, Prisma + PostgreSQL, JWT auth in httpOnly cookies
- **Frontend**: React 18 + Vite, vanilla CSS with editorial type system, React Router, Leaflet
- **Agent**: `@anthropic-ai/sdk` with a custom tool loop. Each user supplies their own Anthropic API key (encrypted at rest with AES-256-GCM)
- **External APIs**: Mapbox (geocoding + directions), Open-Meteo (weather), Anthropic web search
- **Streaming**: Server-Sent Events with explicit pause-for-user-input handling
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

```bash
git clone https://github.com/yidarvin/darvinyi-latitude
cd darvinyi-latitude
cp server/.env.example server/.env  # fill in DATABASE_URL, JWT_SECRET, API_KEY_ENCRYPTION_KEY, MAPBOX_TOKEN
npm install
cd server && npx prisma migrate dev && npx prisma db seed
cd ..
npm run dev
```

Then sign in as `dev@latitude.test` / `hunter22hunter22` to see the seeded folio.

## Build notes

Built over 14 Claude Code sessions, each with a self-contained prompt in the `context/sessions/` folder (kept out of the repo for size). Sessions ranged from scaffolding to agent loop implementation to Railway deploy.
