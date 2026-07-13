# Latitude — User Flows

## Flow A: First visit

1. Land at `/` → if not authed, redirect to `/setup`
2. `/setup` shows the marketing intro on the left and the signup form on the right — the API key field notes the ~$0.10–0.30/walk cost and links to `console.anthropic.com/settings/keys`
3. User enters email, password, Anthropic API key → POST `/api/auth/signup`
4. Server validates the input, then does one cheap live check of the key (`models.list()`, no tokens spent) — a typo'd or revoked key is rejected here (400) instead of failing mysteriously on the first walk. A network blip on that check doesn't block signup.
5. Server encrypts the key, creates the user, sets the JWT cookie, returns `{ user }`
6. Client redirects to `/folio`

## Flow B: Return visit

1. Land at `/` → JWT cookie present → fetch `/api/auth/me` → redirect to `/folio`
2. `/folio` shows past walks + insight card + "Plan today's walk" CTA. If the user has a run stuck at `active`/`awaiting_user` (they closed the tab mid-dialogue and came back), a resume banner appears above the insight card linking straight to `/dialogue/:runId`.

## Flow C: Plan a new walk

1. From `/folio`, click "Plan today's walk" → `/brief`
2. User fills the brief (location, duration, time of day, camera + lens, route shape, styles, optional free-text intent — no mobility field; Latitude only plans on foot, and a note about being open to transit between clusters goes in Intent) → POST `/api/walks/draft` returns `{ agentRunId }` → redirect to `/dialogue/:agentRunId`
3. `/dialogue/:agentRunId` fetches the run's current status first, then opens the SSE stream only if the run is actually resumable (`active`/`awaiting_user`) — a failed status fetch shows an error instead of silently starting a stream, and a deep link to an already-`abandoned` run shows a "this walk was stopped" screen instead of resurrecting it.
4. Agent streams messages. When it calls `request_user_input`, the reply box appears.
5. User submits reply → POST `/api/agent-runs/:id/reply` → SSE resumes
6. When the agent calls `compose_walk`, server creates the Walk + Stops, SSE sends `composed` with `walkId`. In the background, the server regenerates the folio insight on the same API call budget.
7. Client redirects to `/folio/walks/:walkId` — the Plan screen (map + project + shotlist + conditions).

If the connection drops mid-dialogue (network blip, laptop sleep), the client detects the transport failure and reconnects automatically (up to 4 attempts) rather than leaving the dialogue silently stalled; the run itself was never marked failed by the disconnect, so the reconnect picks the loop back up mid-thought.

## Flow D: Review or act on a past walk

1. From `/folio`, click any walk card → `/folio/walks/:walkId`
2. The Plan screen — map, project brief, conditions, shotlist. Each shotlist stop has an "Open in Maps" link (Google Maps walking directions). Actions below the shotlist: **Plan another**, **Mark as walked** (toggles `Walk.status` between `composed`/`completed` — a walked badge then shows on the Folio card and the plan header, and `get_user_history` reports it to the agent as lived history instead of an unexecuted plan), **Download GPX**, **Print the plan** (dedicated print stylesheet — hides nav/chrome, keeps the map + shotlist).
3. A composed walk is **not** read-only — the Refine panel below the shotlist lets the photographer talk to the agent again ("swap stop 4", "make it shorter"), which re-opens the same AgentRun and updates the walk in place.
4. From `/folio`, hovering a walk card reveals a delete control (themed confirm dialog, not the browser's native one) — deleting frees that walk's stops to be reused in future compositions.

## Flow E: Account

1. Click "Account" in the topnav → `/account`
2. Shows email, member-since date, walk count, and the API key (masked, or "none on file" if removed).
3. **Rotate API key** — inline form, PATCH `/api/auth/api-key`.
4. **Remove key** — themed confirm dialog, DELETE `/api/auth/api-key`. Existing walks stay in the folio; new agent runs fail gracefully until a key is added back.
5. **Delete account** — inline password-confirmed form (not a plain confirm dialog, since the server requires the password), DELETE `/api/auth/account`. Cascades to every walk, stop, and agent run; clears the session cookie; client redirects to `/setup`.

## Routes (React Router)

| Path | Auth required | Component |
|------|---------------|-----------|
| /setup            | no  | Setup    |
| /folio            | yes | Folio    |
| /brief            | yes | Brief    |
| /dialogue/:id     | yes | Dialogue |
| /folio/walks/:id  | yes | Plan     |
| /account          | yes | Account  |
| /                 | -   | redirect based on auth |
| *                 | -   | redirect to /folio |

## Auth gate

`<RequireAuth>` wrapper component. Checks `useAuth()` hook on mount. If not authed → `<Navigate to="/setup" replace />`. If still loading → `<LoadingDot />` (a pulsing teal dot, `role="status"`, centered). `<RedirectIfAuthed>` does the inverse for `/setup`, so an already-signed-in user can't land back on the signup screen.
