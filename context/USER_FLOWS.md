# Latitude — User Flows

## Flow A: First visit

1. Land at `/` → if not authed, redirect to `/setup`
2. `/setup` shows the marketing intro on the left and the signup form on the right
3. User enters email, password, Anthropic API key → POST `/api/auth/signup`
4. Server validates, encrypts API key, creates user, sets JWT cookie, returns `{ user }`
5. Client redirects to `/folio`

## Flow B: Return visit

1. Land at `/` → JWT cookie present → fetch `/api/auth/me` → redirect to `/folio`
2. `/folio` shows past walks + insight card + "Plan today's walk" CTA

## Flow C: Plan a new walk

1. From `/folio`, click "Plan today's walk" → `/brief`
2. User fills brief → POST `/api/walks/draft` returns `{ agentRunId }` → redirect to `/dialogue/:agentRunId`
3. `/dialogue/:agentRunId` opens SSE stream
4. Agent streams messages. When agent calls `request_user_input`, the input box appears.
5. User submits reply → POST `/api/agent-runs/:id/reply` → SSE resumes
6. When agent calls `compose_walk`, server creates Walk + Stops, SSE sends `composed` event with `walkId`
7. Client redirects to `/folio/walks/:walkId`
8. `/folio/walks/:walkId` shows the Plan screen (map + project + shotlist + conditions)

## Flow D: Review a past walk

1. From `/folio`, click any walk card → `/folio/walks/:walkId`
2. Same Plan screen, but read-only (no "Save to Folio" button; replaced with "Back to Folio")

## Flow E: Account / rotate API key

1. Click "Account" in topnav → `/account`
2. Shows email, member-since date, number of walks, "Rotate API key" button
3. Click → reveals current key (masked), input for new key → PATCH `/api/auth/api-key`

## Routes (React Router)

| Path | Auth required | Component |
|------|---------------|-----------|
| /setup            | no  | Setup    |
| /folio            | yes | Folio    |
| /brief            | yes | Brief    |
| /dialogue/:id     | yes | Dialogue |
| /folio/walks/:id  | yes | Plan / WalkReview |
| /account          | yes | Account  |
| /                 | -   | redirect based on auth |

## Auth gate

`<RequireAuth>` wrapper component. Checks `useAuth()` hook on mount. If not authed → `<Navigate to="/setup" replace />`. If still loading → `<LoadingDot />` (just a pulsing teal dot, full-screen centered).
