import { config } from '../config.js';

const BASE = 'https://api.mapbox.com';

/**
 * Forward geocode a free-text place into candidate coordinates + canonical
 * info. Uses Mapbox's Search Box API rather than Geocoding v6 — v6 cannot
 * return POI features under any `types` filter (POI search moved to Search
 * Box), and photography stops are very often landmarks/POIs ("Sutro Baths",
 * "Palace of Fine Arts") that v6 would silently fail to find.
 *
 * @param {string} query  e.g., "Mission District, San Francisco" or "Sutro Baths"
 * @param {object} [opts]
 * @param {{lat:number,lng:number}} [opts.proximity]  bias ambiguous results
 *   toward this coordinate (e.g. the walk's already-established center)
 * @returns {Promise<{ results: Array<{name, lat, lng, neighborhood, city, full}> }>}
 *   Up to 3 ranked candidates — callers should let the model disambiguate
 *   rather than blindly trusting the first result.
 */
export async function geocode(query, { proximity } = {}) {
  const url = new URL(`${BASE}/search/searchbox/v1/forward`);
  url.searchParams.set('q', query);
  url.searchParams.set('access_token', config.mapboxToken);
  url.searchParams.set('limit', '3');
  url.searchParams.set('types', 'poi,address,street,neighborhood,locality,place');
  if (proximity) {
    url.searchParams.set('proximity', `${proximity.lng},${proximity.lat}`);
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Mapbox geocode failed: ${res.status}`);
  const data = await res.json();

  const features = data.features || [];
  if (features.length === 0) throw new Error(`No geocode result for "${query}"`);

  return {
    results: features.map((feature) => {
      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties;
      const ctx = props.context || {};
      return {
        name:         props.name || query,
        lat,
        lng,
        neighborhood: ctx.neighborhood?.name || null,
        city:         ctx.place?.name || ctx.locality?.name || null,
        full:         props.full_address || props.place_formatted || props.name,
      };
    }),
  };
}

/**
 * Get a walking route through an ordered list of stops.
 * Uses Mapbox Directions v5 with profile=walking.
 *
 * @param {Array<{lat, lng}>} stops  ordered, 2+ entries
 * @returns {Promise<{ polyline, distance_m, duration_s, legs }>}
 */
export async function walkingDirections(stops) {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error('walkingDirections requires at least 2 stops');
  }
  const coords = stops.map(s => `${s.lng},${s.lat}`).join(';');
  const url = new URL(`${BASE}/directions/v5/mapbox/walking/${coords}`);
  url.searchParams.set('access_token', config.mapboxToken);
  url.searchParams.set('geometries', 'polyline');
  url.searchParams.set('overview', 'full');
  url.searchParams.set('steps', 'false');

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Mapbox directions failed: ${res.status}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('No directions route found');

  return {
    polyline:   route.geometry,
    distance_m: Math.round(route.distance),
    duration_s: Math.round(route.duration),
    legs:       route.legs.map(l => ({
      distance_m: Math.round(l.distance),
      duration_s: Math.round(l.duration),
    })),
  };
}
