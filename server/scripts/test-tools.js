import 'dotenv/config';
import { executeTool } from '../src/agent/tools.js';
import { geocode, walkingDirections } from '../src/lib/mapbox.js';
import { getWeather } from '../src/lib/openmeteo.js';

const TEST_USER_ID = process.env.TEST_USER_ID;

console.log('─'.repeat(60));
console.log('Testing Latitude agent tools');
console.log('This is a manual, live-API smoke check (real Mapbox/Open-Meteo');
console.log('calls) — distinct from the mocked unit suite (`npm test`).');
console.log('─'.repeat(60));

let failures = 0;

async function run(label, fn) {
  process.stdout.write(`  ${label}... `);
  try {
    const result = await fn();
    console.log('✓');
    const s = JSON.stringify(result);
    console.log('    →', s.slice(0, 200) + (s.length > 200 ? '…' : ''));
    return result;
  } catch (err) {
    console.log('✗');
    console.error('    !', err.message);
    failures++;
    return null;
  }
}

async function main() {
  console.log('\n[1] mapbox.geocode');
  const geoResult = await run('Mission District, SF', () => geocode('Mission District, San Francisco'));

  console.log('\n[2] mapbox.walkingDirections');
  await run('two-stop route', () => walkingDirections([
    { lat: 37.7521, lng: -122.4181 },
    { lat: 37.7613, lng: -122.4214 },
  ]));

  console.log('\n[3] openmeteo.getWeather');
  if (geoResult) {
    await run('today at Mission', () => getWeather(geoResult.lat, geoResult.lng));
  }

  console.log('\n[4] executeTool: geocode_location');
  await run('via executeTool', () => executeTool('geocode_location', { query: 'Dolores Park' }, { userId: TEST_USER_ID }));

  console.log('\n[5] executeTool: get_weather');
  if (geoResult) {
    await run('via executeTool', () => executeTool('get_weather', { lat: geoResult.lat, lng: geoResult.lng }, { userId: TEST_USER_ID }));
  }

  console.log('\n[6] executeTool: compute_route');
  await run('via executeTool', () => executeTool('compute_route', {
    stops: [
      { lat: 37.7521, lng: -122.4181 },
      { lat: 37.7508, lng: -122.4116 },
      { lat: 37.7556, lng: -122.4117 },
    ],
  }, { userId: TEST_USER_ID }));

  if (TEST_USER_ID) {
    console.log('\n[7] executeTool: get_user_history');
    await run('via executeTool', () => executeTool('get_user_history', {}, { userId: TEST_USER_ID }));
  } else {
    console.log('\n[7] executeTool: get_user_history — SKIPPED (set TEST_USER_ID env)');
  }

  console.log('\n' + '─'.repeat(60));
  if (failures > 0) {
    console.log(`Done — ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('Done — all checks passed.');
}

main().catch(err => { console.error(err); process.exit(1); });
