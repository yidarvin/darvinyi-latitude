function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Build a GPX 1.1 document from a composed walk — one waypoint per stop,
 * plus a track for the walking route if a polyline was resolved.
 */
export function buildGpx(walk, walkingPath) {
  const waypoints = walk.stops
    .map(s => `  <wpt lat="${s.lat}" lon="${s.lng}"><name>${esc(`${s.ordinal}. ${s.name}`)}</name></wpt>`)
    .join('\n');

  const track = walkingPath && walkingPath.length > 0
    ? [
        '  <trk>',
        `    <name>${esc(walk.title)}</name>`,
        '    <trkseg>',
        walkingPath.map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`).join('\n'),
        '    </trkseg>',
        '  </trk>',
      ].join('\n')
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Latitude" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${esc(walk.title)}</name></metadata>`,
    waypoints,
    track,
    '</gpx>',
  ].filter(Boolean).join('\n');
}

/** Triggers a browser download of the walk as a .gpx file. */
export function downloadGpx(walk, walkingPath) {
  const xml = buildGpx(walk, walkingPath);
  const blob = new Blob([xml], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${walk.title.replace(/[^\w\- ]+/g, '').trim() || 'walk'}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Google Maps walking-directions deep link for a single stop. */
export function mapsLink(stop) {
  return `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=walking`;
}
