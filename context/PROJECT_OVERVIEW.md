# Latitude — Project Overview

## What it is

Latitude is a photography walking-route planner with an agent that remembers. A photographer enters their gear, location, time available, and what they're open to shooting; an agent asks 2–3 calibrating follow-up questions; out comes a real walking route on a real map, with numbered photo stops and a project brief that ties them together thematically.

The "remembers" part is the differentiator. Latitude tracks past walks and uses them as context for new ones, so the agent can avoid repeating stops and progressively push the photographer into new neighborhoods, light conditions, and themes.

## Who it's for

The target user is a thoughtful hobbyist photographer with curated gear — someone who shoots a Fujifilm X100VI, a Leica Q3, or a Hasselblad X2D II rather than a smartphone, and who cares about why they're shooting, not just what.

Latitude assumes the user knows their gear. It doesn't explain camera basics. It speaks the language of "stops", "frames", "focal lengths", "golden hour", "tonal range" without unpacking them.

## What it does

1. **Account**: Email + password, plus the user's own Anthropic API key (encrypted server-side).
2. **Brief**: A form capturing location, time available, time of day, camera body + lens, mobility (foot/transit/bike/ride), photography styles (Street, Documentary, Fine Art, Portrait, Architecture, Landscape, Abstract, Minimalism, Color Study, Night), and an optional free-text intent.
3. **Dialogue**: The agent loads the user's past walks, asks 2–3 follow-up questions, then composes the route.
4. **The Plan**: A real Leaflet map with the route drawn, numbered photo stops, a project name and brief, a shot list with time allocations, and conditions notes (light, weather, camera notes, afterward).
5. **Folio**: A grid of past walks. Each is clickable to review its plan. An "Agent insight" card at the top of the folio surfaces patterns ("you've gravitated toward quieter neighborhoods on your last 3 walks").

## Out of scope

- No payment / subscription. Users supply their own Anthropic key.
- No social / sharing features.
- No photo upload, editing, or organization.
- No mobile native app — responsive web only.
- No multi-user accounts / teams.

## Core principle

The agent should feel like a knowledgeable friend with local taste and a memory, not like a search engine wrapped in chat. It picks; it doesn't list. It references your past work. It commits.
