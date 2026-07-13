/**
 * WalkThumb — small SVG sketch of a walk's route.
 *
 * Props:
 *   stops: [{ ordinal, lat, lng }]
 *
 * Uses a single uniform scale (with a cos(lat) correction on longitude, since
 * a degree of longitude is shorter than a degree of latitude away from the
 * equator) so the sketch reflects the route's real shape instead of
 * stretching it independently per axis to fill the box.
 */
export default function WalkThumb({ stops }) {
  const VB_W = 280;
  const VB_H = 130;
  const PAD = 20;

  if (!stops || stops.length === 0) {
    return (
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} aria-hidden="true">
        <rect width={VB_W} height={VB_H} fill="#0d0d0d" />
        <text x={VB_W/2} y={VB_H/2} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="#4a4a4a" letterSpacing="1">
          NO ROUTE
        </text>
      </svg>
    );
  }

  const lats = stops.map(s => s.lat);
  const lngs = stops.map(s => s.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2;

  const lngCorrection = Math.cos(midLat * Math.PI / 180);

  const latSpan = Math.max(maxLat - minLat, 0.0005);
  const lngSpan = Math.max((maxLng - minLng) * lngCorrection, 0.0005);

  const availW = VB_W - PAD * 2;
  const availH = VB_H - PAD * 2;
  const scale = Math.min(availW / lngSpan, availH / latSpan);

  const drawnW = lngSpan * scale;
  const drawnH = latSpan * scale;
  const offsetX = (VB_W - drawnW) / 2;
  const offsetY = (VB_H - drawnH) / 2;

  // lat flipped — north is up
  const project = (s) => {
    const x = offsetX + (s.lng - minLng) * lngCorrection * scale;
    const y = offsetY + (1 - (s.lat - minLat) / latSpan) * drawnH;
    return [x, y];
  };

  const points = stops.map(project);
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} aria-hidden="true">
      <rect width={VB_W} height={VB_H} fill="#0d0d0d" />
      <g stroke="#2a2a2a" strokeWidth="0.5" fill="none">
        <line x1="0" y1={VB_H/3} x2={VB_W} y2={VB_H/3} />
        <line x1="0" y1={VB_H*2/3} x2={VB_W} y2={VB_H*2/3} />
        <line x1={VB_W/4} y1="0" x2={VB_W/4} y2={VB_H} />
        <line x1={VB_W/2} y1="0" x2={VB_W/2} y2={VB_H} />
        <line x1={VB_W*3/4} y1="0" x2={VB_W*3/4} y2={VB_H} />
      </g>
      <path d={path} stroke="#2dd4bf" strokeWidth="1.6" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="#2dd4bf" />
      ))}
    </svg>
  );
}
