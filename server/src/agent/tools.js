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
    description: 'Convert a free-text place name into a coordinate. Use for any location the user mentions in their brief, or for any candidate stop you find via web_search.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text location (e.g., "Balmy Alley, San Francisco")' },
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
    type: 'web_search_20250305',
    name: 'web_search',
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
        walkingPolyline:  { type: 'string' },
        transitPolyline:  { type: 'string' },
        stops: {
          type: 'array',
          minItems: 4,
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
                 'durationMin','distanceM','walkingPolyline','stops','conditions'],
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
      return await handleWeather(input);

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
      stops:         w.stops.map(s => ({
        ordinal: s.ordinal, name: s.name, lat: s.lat, lng: s.lng
      })),
    })),
  };
}

async function handleGeocode(input) {
  if (!input?.query) throw new Error('geocode_location requires query');
  return await geocode(input.query);
}

async function handleWeather(input) {
  if (typeof input?.lat !== 'number' || typeof input?.lng !== 'number') {
    throw new Error('get_weather requires lat + lng');
  }
  return await getWeather(input.lat, input.lng, input.date);
}

async function handleComputeRoute(input) {
  if (!Array.isArray(input?.stops) || input.stops.length < 2) {
    throw new Error('compute_route requires at least 2 stops');
  }
  const route = await walkingDirections(input.stops);
  return route;
}

/**
 * Persist a composed walk to the database.
 * Called by the agent loop, NOT routed through executeTool.
 *
 * @param {string} userId
 * @param {string} agentRunId
 * @param {object} briefSnapshot  the original brief from the AgentRun
 * @param {object} composed       the validated input of the compose_walk tool call
 * @returns {Promise<string>} walkId
 */
export async function createWalkFromCompose(userId, agentRunId, briefSnapshot, composed) {
  try {
    polyline.decode(composed.walkingPolyline);
  } catch {
    throw new Error('walkingPolyline is not a valid encoded polyline');
  }

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
      distanceM:    composed.distanceM,
      cameraBody:   briefSnapshot.cameraLabel,
      lensSpec:     briefSnapshot.lensSpec,
      mobility:     briefSnapshot.mobility,
      styles:       briefSnapshot.styles,
      intent:       briefSnapshot.intent || null,
      walkingPolyline: composed.walkingPolyline,
      transitPolyline: composed.transitPolyline || null,
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

  await prisma.agentRun.update({
    where: { id: agentRunId },
    data:  { walkId: walk.id, status: 'composed' },
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
  try {
    polyline.decode(composed.walkingPolyline);
  } catch {
    throw new Error('walkingPolyline is not a valid encoded polyline');
  }

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
        distanceM:    composed.distanceM,
        walkingPolyline: composed.walkingPolyline,
        transitPolyline: composed.transitPolyline || null,
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
