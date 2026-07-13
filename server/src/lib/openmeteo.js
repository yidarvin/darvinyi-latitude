const FORECAST_MAX_DAYS_AHEAD = 16; // Open-Meteo's forecast horizon

// Hour ranges (24h, [start, end)) worth keeping for each time-of-day the
// photographer might be shooting in. Some categories are ambiguous about
// AM vs PM (golden hour, blue hour) — both windows are kept rather than
// guessing wrong.
const HOUR_WINDOWS = {
  dawn:    [[5, 8]],
  morning: [[7, 11]],
  midday:  [[11, 15]],
  golden:  [[6, 9], [17, 20]],
  blue:    [[5, 7], [19, 21]],
  night:   [[0, 4], [19, 24]],
};

/**
 * Fetch weather forecast for a coordinate on a specific date.
 * Uses Open-Meteo's free forecast endpoint.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} dateIso     YYYY-MM-DD. Required — callers resolve "today"
 *                             themselves (see tools.js handleWeather) rather
 *                             than this function guessing the server's UTC date.
 * @param {string} [timeOfDay] one of the compose_walk timeOfDay values. When
 *                             given, the returned `hourly` array is thinned to
 *                             the hours relevant to that window instead of all 24.
 * @returns {Promise<{
 *   temperature_f: number,
 *   temperature_high_f: number,
 *   temperature_low_f: number,
 *   conditions: string,
 *   sunrise: string,
 *   sunset: string,
 *   hourly: Array<{hour: string, temperature_f: number, conditions: string}>,
 * }>}
 */
export async function getWeather(lat, lng, dateIso, timeOfDay) {
  if (!dateIso) throw new Error('getWeather requires a date');
  assertWithinForecastRange(dateIso);

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lng);
  url.searchParams.set('start_date', dateIso);
  url.searchParams.set('end_date', dateIso);
  url.searchParams.set('current', 'temperature_2m,weather_code');
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset');
  url.searchParams.set('hourly', 'temperature_2m,weather_code');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Open-Meteo failed: ${res.status}`);
  const data = await res.json();

  const daily = data.daily;
  const hourly = data.hourly;
  const current = data.current;

  const allHourly = hourly.time.map((t, i) => ({
    hour:          t.slice(11, 16),
    hourNum:       Number(t.slice(11, 13)),
    temperature_f: Math.round(hourly.temperature_2m[i]),
    conditions:    weatherCodeToText(hourly.weather_code[i]),
  }));

  return {
    temperature_f:      Math.round(current.temperature_2m),
    temperature_high_f: Math.round(daily.temperature_2m_max[0]),
    temperature_low_f:  Math.round(daily.temperature_2m_min[0]),
    conditions:         weatherCodeToText(daily.weather_code[0]),
    sunrise:            daily.sunrise[0],
    sunset:             daily.sunset[0],
    hourly:             thinHourly(allHourly, timeOfDay).map(({ hour, temperature_f, conditions }) => ({ hour, temperature_f, conditions })),
  };
}

function thinHourly(allHourly, timeOfDay) {
  const windows = HOUR_WINDOWS[timeOfDay];
  if (!windows) return allHourly;
  const filtered = allHourly.filter(h => windows.some(([start, end]) => h.hourNum >= start && h.hourNum < end));
  // Defensive fallback — never return an empty hourly array over an edge case.
  return filtered.length > 0 ? filtered : allHourly;
}

function assertWithinForecastRange(dateIso) {
  const requested = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(requested.getTime())) {
    throw new Error(`Invalid date "${dateIso}" — expected YYYY-MM-DD`);
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysAhead = Math.round((requested.getTime() - today.getTime()) / 86_400_000);
  if (daysAhead < 0 || daysAhead > FORECAST_MAX_DAYS_AHEAD) {
    throw new Error(`Weather forecasts are only available up to ${FORECAST_MAX_DAYS_AHEAD} days out — "${dateIso}" is outside that range.`);
  }
}

function weatherCodeToText(code) {
  if (code === 0) return 'Clear';
  if ([1,2,3].includes(code))         return ['Mainly clear', 'Partly cloudy', 'Overcast'][code-1];
  if ([45,48].includes(code))         return 'Foggy';
  if ([51,53,55].includes(code))      return 'Drizzle';
  if ([56,57].includes(code))         return 'Freezing drizzle';
  if ([61,63,65].includes(code))      return ['Light rain','Rain','Heavy rain'][[61,63,65].indexOf(code)];
  if ([66,67].includes(code))         return 'Freezing rain';
  if ([71,73,75].includes(code))      return ['Light snow','Snow','Heavy snow'][[71,73,75].indexOf(code)];
  if (code === 77)                    return 'Snow grains';
  if ([80,81,82].includes(code))      return ['Light showers','Showers','Heavy showers'][[80,81,82].indexOf(code)];
  if ([85,86].includes(code))         return 'Snow showers';
  if (code === 95)                    return 'Thunderstorm';
  if ([96,99].includes(code))         return 'Thunderstorm with hail';
  return 'Unknown';
}
