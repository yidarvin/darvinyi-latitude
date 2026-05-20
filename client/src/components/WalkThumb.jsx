/**
 * WalkThumb — small SVG sketch of a walk's route.
 *
 * Props:
 *   stops: [{ ordinal, lat, lng }]
 *
 * Normalizes the stops into the viewBox while preserving relative geometry.
 */
export default function WalkThumb({ stops }) {
  const VB_W = 280;
  const VB_H = 130;
  const PAD = 20;

  if (!stops || stops.length === 0) {
    return (
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
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

  const latSpan = Math.max(maxLat - minLat, 0.0005);
  const lngSpan = Math.max(maxLng - minLng, 0.0005);

  // lat flipped — north is up
  const project = (s) => {
    const x = PAD + ((s.lng - minLng) / lngSpan) * (VB_W - PAD * 2);
    const y = PAD + (1 - (s.lat - minLat) / latSpan) * (VB_H - PAD * 2);
    return [x, y];
  };

  const points = stops.map(project);
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
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
