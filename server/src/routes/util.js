import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { config } from '../config.js';

const router = Router();

/**
 * GET /api/util/reverse-geocode?lat=...&lng=...
 * Used by the Brief screen's "Use mine" button.
 */
router.get('/util/reverse-geocode', requireAuth, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) {
    return res.status(400).json({ error: 'Invalid coords' });
  }
  try {
    const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
    url.searchParams.set('latitude', lat);
    url.searchParams.set('longitude', lng);
    url.searchParams.set('access_token', config.mapboxToken);
    url.searchParams.set('limit', '1');
    url.searchParams.set('types', 'neighborhood,locality,place');
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const data = await r.json();
    const f = data.features?.[0];
    if (!f) return res.status(404).json({ error: 'No place found' });

    const props = f.properties;
    const ctx = props.context || {};
    const neighborhood = ctx.neighborhood?.name || props.name;
    const place = ctx.place?.name || ctx.locality?.name || '';
    const name = place && neighborhood && neighborhood !== place
      ? `${neighborhood}, ${place}`
      : (props.full_address || props.place_formatted || props.name);

    res.json({ name, lat, lng });
  } catch {
    res.status(500).json({ error: 'Reverse geocode failed' });
  }
});

export default router;
