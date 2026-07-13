import { z } from 'zod';
import { prisma } from '../db.js';
import { geocode, walkingDirections } from '../lib/mapbox.js';
import { getWeather } from '../lib/openmeteo.js';
import polyline from '@mapbox/polyline';

/**
 * Tool definitions passed to the Anthropic SDK.
 * web_search is Anthropic's hosted tool — included here so Claude can use it,
 * but execution happens on Anthropic's side.
 */
export const TOOL_DEFS = [
  {
    name: 'get_user_history',
    description: 'Load the user\'s past Latitude walks. ALWAYS call this first, before any other tool. Returns walks sorted most-recent-first, each with title, location, date, styles, duration, distance, and stop names with coordinates.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'geocode_location',
    description: 'Convert a free-text place name or landmark into coordinates — including POIs like "Sutro Baths" or "Palace of Fine Arts", not just street addresses and neighborhoods. Use for any location in the brief, or any candidate stop you find via web_search. Returns up to 3 ranked candidates in `results` — pick the one that actually matches the intended place, don\'t assume the first is always correct. Pass `near` once you have a general area for the walk, so an ambiguous name (e.g. "Chinatown") resolves to the right neighborhood instead of a different city.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text location (e.g., "Balmy Alley, San Francisco" or "Sutro Baths")' },
        near: {
          type: 'object',
          description: 'Optional. A coordinate already established for this walk (the brief location, or an earlier stop), used to bias ambiguous results toward the right area.',
          properties: {
            lat: { type: 'number' },
            lng: { type: 'number' },
          },
          required: ['lat', 'lng'],
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_weather',
    description: 'Get the weather forecast for a coordinate on a specific date. Use after you have a center coordinate from geocode_location.',
    input_schema: {
      type: 'object',
      properties: {
        lat: { type: 'number' },
        lng: { type: 'number' },
        date: { type: 'string', description: 'YYYY-MM-DD. If omitted, defaults to today.' },
      },
      required: ['lat', 'lng'],
    },
  },
  {
    name: 'compute_route',
    description: 'Given an ordered list of stop coordinates, get the actual walking polyline + total distance + duration. Call this once you have your final stop list, before compose_walk.',
    input_schema: {
      type: 'object',
      properties: {
        stops: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              lat: { type: 'number' },
              lng: { type: 'number' },
            },
            required: ['lat', 'lng'],
          },
          minItems: 2,
        },
      },
      required: ['stops'],
    },
  },
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: 5,
  },
  {
    name: 'request_user_input',
    description: 'Ask the photographer a single follow-up question. Pauses the agent run. Must be the only tool call in its turn — do not combine with other tools.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
      },
      required: ['question'],
    },
  },
  {
    name: 'compose_walk',
    description: 'Finalize the walk plan. On the first pass, call once when you have everything — this creates the Walk + Stop rows. During refinement, call it again to save changes — it updates the existing walk in place.',
    input_schema: {
      type: 'object',
      properties: {
        title:            { type: 'string', minLength: 1, maxLength: 60 },
        subtitle:         { type: 'string', minLength: 1, maxLength: 120 },
        brief:            { type: 'string', minLength: 20 },
        centerLat:        { type: 'number' },
        centerLng:        { type: 'number' },
        timeOfDay:        { type: 'string', enum: ['dawn','morning','midday','golden','blue','night'] },
        durationMin:      { type: 'integer' },
        distanceM:        { type: 'integer' },
        walkingPolyline:  { type: 'string', description: 'Optional. Leave blank — the server draws the walking route from your stop coordinates. Only provide as a fallback.' },
        stops: {
          type: 'array',
          minItems: 3,
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              ordinal:           { type: 'integer' },
              name:              { type: 'string' },
              lat:               { type: 'number' },
              lng:               { type: 'number' },
              arrival_time:      { type: 'string' },
              duration_minutes:  { type: 'integer' },
              brief:             { type: 'string', minLength: 10 },
            },
            required: ['ordinal','name','lat','lng','arrival_time','duration_minutes','brief'],
          },
        },
        conditions: {
          type: 'object',
          properties: {
            light:        { type: 'string' },
            weather:      { type: 'string' },
            camera_notes: { type: 'string' },
            afterward:    { type: 'string' },
          },
          required: ['light','weather','camera_notes','afterward'],
        },
      },
      required: ['title','subtitle','brief','centerLat','centerLng','timeOfDay',
                 'durationMin','distanceM','stops','conditions'],
    },
  },
];

/**
 * Execute a tool by name with the given input.
 *
 * @param {string} toolName
 * @param {object} input
 * @param {object} ctx  { userId, runId }
 * @returns {Promise<any>} the tool result (will be JSON.stringified into tool_result content)
 *
 * NOTE: This does NOT handle:
 *   - web_search (executed by Anthropic)
 *   - request_user_input (intercepted by the loop)
 *   - compose_walk (intercepted by the loop, which then calls createWalkFromCompose)
 */
export async function executeTool(toolName, input, ctx) {
  switch (toolName) {
    case 'get_user_history':
      return await handleGetUserHistory(ctx.userId);

    case 'geocode_location':
      return await handleGeocode(input);

    case 'get_weather':
      return await handleWeather(input, ctx);

    case 'compute_route':
      return await handleComputeRoute(input);

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

async function handleGetUserHistory(userId) {
  const walks = await prisma.walk.findMany({
    where: { userId, status: { not: 'draft' } },
    orderBy: { date: 'desc' },
    take: 20,
    select: {
      title:        true,
      subtitle:     true,
      locationName: true,
      date:         true,
      timeOfDay:    true,
      styles:       true,
      durationMin:  true,
      distanceM:    true,
      cameraBody:   true,
      status:       true,
      stops: {
        select: { ordinal: true, name: true, lat: true, lng: true },
        orderBy: { ordinal: 'asc' },
      },
    },
  });

  return {
    walks: walks.map(w => ({
      title:         w.title,
      subtitle:      w.subtitle,
      location:      w.locationName,
      date:          w.date.toISOString().slice(0, 10),
      time_of_day:   w.timeOfDay,
      styles:        w.styles,
      duration_min:  w.durationMin,
      distance_m:    w.distanceM,
      camera:        w.cameraBody,
      // Whether the photographer actually walked this one, vs. a plan that
      // was composed but never executed — don't let an unwalked plan read
      // as lived history the way a completed walk does.
      walked:        w.status === 'completed',
      stops:         w.stops.map(s => ({
        ordinal: s.ordinal, name: s.name, lat: s.lat, lng: s.lng
      })),
    })),
  };
}

async function handleGeocode(input) {
  if (!input?.query) throw new Error('geocode_location requires query');
  return await geocode(input.query, input.near ? { proximity: input.near } : {});
}

async function handleWeather(input, ctx) {
  if (typeof input?.lat !== 'number' || typeof input?.lng !== 'number') {
    throw new Error('get_weather requires lat + lng');
  }
  // The model may omit `date` and expect "today" — resolve that from the
  // brief's own local date (the photographer's timezone), not the server's.
  const date = input.date || ctx?.briefSnapshot?.localDate || new Date().toISOString().slice(0, 10);
  return await getWeather(input.lat, input.lng, date, ctx?.briefSnapshot?.timeOfDay);
}

const computeRouteStopsSchema = z.array(
  z.object({
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
  })
).min(2).max(25);

async function handleComputeRoute(input) {
  // Model tool input is advisory, not enforced by the API — validate real
  // finite, in-range coordinates before they reach a Mapbox URL path.
  const result = computeRouteStopsSchema.safeParse(input?.stops);
  if (!result.success) {
    throw new Error(`compute_route input invalid — ${result.error.issues.map(i => `stops.${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const route = await walkingDirections(result.data);
  return route;
}

const MAX_STOP_RADIUS_KM = 20; // implausibly far for a single walk — likely a lat/lng swap or bad geocode

const composeStopSchema = z.object({
  ordinal:          z.number().int().positive(),
  name:             z.string().min(1).max(200),
  lat:              z.number().gte(-90).lte(90),
  lng:              z.number().gte(-180).lte(180),
  arrival_time:     z.string().min(1).max(20),
  duration_minutes: z.number().int().positive(),
  brief:            z.string().min(10).max(2000),
});

const composeWalkInputSchema = z.object({
  title:           z.string().min(1).max(60),
  subtitle:        z.string().min(1).max(120),
  brief:           z.string().min(20).max(4000),
  centerLat:       z.number().gte(-90).lte(90),
  centerLng:       z.number().gte(-180).lte(180),
  timeOfDay:       z.enum(['dawn', 'morning', 'midday', 'golden', 'blue', 'night']),
  durationMin:     z.number().int().positive(),
  distanceM:       z.number().int().nonnegative(),
  walkingPolyline: z.string().optional(),
  stops:           z.array(composeStopSchema).min(3).max(12),
  conditions: z.object({
    light:        z.string().min(1).max(2000),
    weather:      z.string().min(1).max(2000),
    camera_notes: z.string().min(1).max(2000),
    afterward:    z.string().min(1).max(2000),
  }),
}).superRefine((data, ctx) => {
  const sortedOrdinals = [...data.stops.map(s => s.ordinal)].sort((a, b) => a - b);
  const expected = data.stops.map((_, i) => i + 1);
  if (sortedOrdinals.some((o, i) => o !== expected[i])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['stops'],
      message: `Stop ordinals must be unique and numbered 1..${data.stops.length} — got [${sortedOrdinals.join(',')}]`,
    });
  }

  for (const stop of data.stops) {
    const distanceKm = haversineKm(data.centerLat, data.centerLng, stop.lat, stop.lng);
    if (distanceKm > MAX_STOP_RADIUS_KM) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stops', stop.ordinal],
        message: `Stop "${stop.name}" (ordinal ${stop.ordinal}) is ${distanceKm.toFixed(1)}km from the walk center (${MAX_STOP_RADIUS_KM}km max) — check for a lat/lng swap or bad geocode result.`,
      });
    }
  }
});

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Validate the model's compose_walk tool input before it ever reaches
 * Prisma. The JSON schema sent to Anthropic (TOOL_DEFS) is advisory — the
 * API does not enforce minLength/minItems/enum membership — so without this,
 * a swapped lat/lng or a hallucinated coordinate surfaces as an opaque Prisma
 * error instead of a message the model can act on.
 *
 * @param {object} input  raw compose_walk tool_use input
 * @returns {object} the validated, parsed input
 * @throws {Error} with a message describing every violation, suitable for
 *   feeding back to the model as an is_error tool_result
 */
export function validateComposeInput(input) {
  const result = composeWalkInputSchema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`compose_walk input invalid — ${detail}`);
  }
  return result.data;
}

/**
 * @mapbox/polyline's decode() rarely throws on garbage input — it just
 * produces wildly out-of-range coordinates. A structural try/catch around it
 * is not a meaningful validity check, so we also bounds-check the decoded
 * points before trusting a model-supplied fallback polyline.
 */
function isPlausiblePolyline(encoded) {
  let points;
  try {
    points = polyline.decode(encoded);
  } catch {
    return false;
  }
  if (!Array.isArray(points) || points.length === 0) return false;
  return points.every(([lat, lng]) =>
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

/**
 * Build the walking polyline + total walking distance for a composed walk.
 *
 * We recompute the route server-side from the (authoritative) stop coordinates
 * instead of trusting `composed.walkingPolyline`. The agent only reaches us
 * through a text channel, and an encoded polyline is a long opaque string the
 * model cannot reproduce verbatim — transcribing it corrupts the geometry into
 * a jagged path that no longer follows real streets. It's worst on round trips,
 * whose return leg makes the string longer and the corruption more visible. The
 * stops themselves survive the trip (short structured numbers), so rebuilding
 * the route from them keeps the drawn line glued to the markers.
 *
 * @param {object} composed       validated compose_walk input (has .stops)
 * @param {object} briefSnapshot  original brief (has .roundTrip)
 * @returns {Promise<{ polyline: string, distanceM: number }>}
 */
export async function resolveWalkingRoute(composed, briefSnapshot) {
  const ordered = [...composed.stops]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map(s => ({ lat: s.lat, lng: s.lng }));

  // For a round trip the walk returns to its origin. The agent is told to make
  // the final stop coincide with the first; if it didn't, append the origin so
  // Mapbox routes the closing leg and the loop visibly closes.
  let routeStops = ordered;
  if (briefSnapshot?.roundTrip && ordered.length >= 2) {
    const first = ordered[0];
    const last  = ordered[ordered.length - 1];
    if (first.lat !== last.lat || first.lng !== last.lng) {
      routeStops = [...ordered, first];
    }
  }

  try {
    const route = await walkingDirections(routeStops);
    return { polyline: route.polyline, distanceM: route.distance_m };
  } catch {
    // Mapbox hiccup — fall back to whatever the agent supplied so compose still
    // succeeds, but only if it decodes to a usable polyline.
    if (!composed.walkingPolyline) {
      throw new Error('Could not compute a walking route for the stops');
    }
    if (!isPlausiblePolyline(composed.walkingPolyline)) {
      throw new Error('Could not compute a walking route and the fallback polyline was invalid');
    }
    return {
      polyline:  composed.walkingPolyline,
      distanceM: composed.distanceM,
    };
  }
}

/**
 * Persist a composed walk to the database. Does NOT touch the AgentRun row —
 * the caller (the agent loop) owns that update, since it also needs to
 * persist the transcript alongside walkId/status in the same write.
 * Called by the agent loop, NOT routed through executeTool.
 *
 * @param {string} userId
 * @param {object} briefSnapshot  the original brief from the AgentRun
 * @param {object} composed       the validated input of the compose_walk tool call
 * @returns {Promise<string>} walkId
 */
export async function createWalkFromCompose(userId, briefSnapshot, composed) {
  const { polyline: walkingPolyline, distanceM } = await resolveWalkingRoute(composed, briefSnapshot);

  const walk = await prisma.walk.create({
    data: {
      userId,
      title:        composed.title,
      subtitle:     composed.subtitle,
      brief:        composed.brief,
      locationName: briefSnapshot.locationName,
      centerLat:    composed.centerLat,
      centerLng:    composed.centerLng,
      date:         new Date(),
      timeOfDay:    composed.timeOfDay,
      durationMin:  composed.durationMin,
      distanceM,
      cameraBody:   briefSnapshot.cameraLabel,
      lensSpec:     briefSnapshot.lensSpec,
      mobility:     ['foot'], // Latitude only ever routes on foot
      styles:       briefSnapshot.styles,
      intent:       briefSnapshot.intent || null,
      walkingPolyline,
      conditions:   composed.conditions,
      status:       'composed',
      composedAt:   new Date(),
      stops: {
        create: composed.stops.map(s => ({
          ordinal:      s.ordinal,
          name:         s.name,
          lat:          s.lat,
          lng:          s.lng,
          arrivalTime:  s.arrival_time,
          durationMin:  s.duration_minutes,
          brief:        s.brief,
        })),
      },
    },
    select: { id: true },
  });

  return walk.id;
}

/**
 * Update an existing walk in place from a re-issued compose_walk call.
 * Used during refinement: the run already has a walkId, so instead of
 * creating a new Walk we overwrite the composed fields and replace all stops.
 * The brief-derived fields (location, camera, lens, mobility, styles, intent)
 * come from the original brief snapshot and are intentionally left untouched.
 *
 * @param {string} walkId
 * @param {object} briefSnapshot  unused for now, kept for signature symmetry
 * @param {object} composed       the validated input of the compose_walk tool call
 */
export async function updateWalkFromCompose(walkId, briefSnapshot, composed) {
  const { polyline: walkingPolyline, distanceM } = await resolveWalkingRoute(composed, briefSnapshot);

  await prisma.$transaction([
    prisma.stop.deleteMany({ where: { walkId } }),
    prisma.walk.update({
      where: { id: walkId },
      data: {
        title:        composed.title,
        subtitle:     composed.subtitle,
        brief:        composed.brief,
        centerLat:    composed.centerLat,
        centerLng:    composed.centerLng,
        timeOfDay:    composed.timeOfDay,
        durationMin:  composed.durationMin,
        distanceM,
        walkingPolyline,
        conditions:   composed.conditions,
        composedAt:   new Date(),
        stops: {
          create: composed.stops.map(s => ({
            ordinal:      s.ordinal,
            name:         s.name,
            lat:          s.lat,
            lng:          s.lng,
            arrivalTime:  s.arrival_time,
            durationMin:  s.duration_minutes,
            brief:        s.brief,
          })),
        },
      },
    }),
  ]);

  return walkId;
}
