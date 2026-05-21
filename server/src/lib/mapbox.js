import { config } from '../config.js';

const BASE = 'https://api.mapbox.com';

/**
 * Forward geocode a free-text place into a coordinate + canonical info.
 * Uses Mapbox Geocoding v6.
 *
 * @param {string} query  e.g., "Mission District, San Francisco"
 * @returns {Promise<{name, lat, lng, neighborhood, city, full}>}
 */
export async function geocode(query) {
  const url = new URL(`${BASE}/search/geocode/v6/forward`);
  url.searchParams.set('q', query);
  url.searchParams.set('access_token', config.mapboxToken);
  url.searchParams.set('limit', '1');
  url.searchParams.set('types', 'neighborhood,locality,place,address,street');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox geocode failed: ${res.status}`);
  const data = await res.json();

  const feature = data.features?.[0];
  if (!feature) throw new Error(`No geocode result for "${query}"`);

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

  const res = await fetch(url);
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

/**
 * Get a transit route from origin to destination using Mapbox driving profile
 * as a stand-in for transit (Mapbox has no first-class transit profile in the
 * Directions API; we approximate with driving distance, which is fine for
 * showing a rough leg on the map).
 */
export async function transitDirections(origin, destination) {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = new URL(`${BASE}/directions/v5/mapbox/driving/${coords}`);
  url.searchParams.set('access_token', config.mapboxToken);
  url.searchParams.set('geometries', 'polyline');
  url.searchParams.set('overview', 'full');
  url.searchParams.set('steps', 'false');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox transit (driving) failed: ${res.status}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('No transit route found');

  return {
    polyline:   route.geometry,
    distance_m: Math.round(route.distance),
    duration_s: Math.round(route.duration),
  };
}
