import L from 'leaflet';

/**
 * Create a numbered stop marker icon.
 * Returns a Leaflet divIcon.
 */
export function makeStopIcon(ordinal, isActive = false) {
  return L.divIcon({
    className: 'lat-stop-icon',
    html: `<div class="lat-stop-icon-inner ${isActive ? 'is-active' : ''}">${ordinal}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}
