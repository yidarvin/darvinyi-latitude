/**
 * Fetch weather forecast for a coordinate on a specific date.
 * Uses Open-Meteo's free forecast endpoint.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} dateIso  YYYY-MM-DD (defaults to today)
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
export async function getWeather(lat, lng, dateIso) {
  const date = dateIso || new Date().toISOString().slice(0, 10);

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lng);
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', date);
  url.searchParams.set('current', 'temperature_2m,weather_code');
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset');
  url.searchParams.set('hourly', 'temperature_2m,weather_code');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('timezone', 'auto');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo failed: ${res.status}`);
  const data = await res.json();

  const daily = data.daily;
  const hourly = data.hourly;
  const current = data.current;

  return {
    temperature_f:      Math.round(current.temperature_2m),
    temperature_high_f: Math.round(daily.temperature_2m_max[0]),
    temperature_low_f:  Math.round(daily.temperature_2m_min[0]),
    conditions:         weatherCodeToText(daily.weather_code[0]),
    sunrise:            daily.sunrise[0],
    sunset:             daily.sunset[0],
    hourly: hourly.time.map((t, i) => ({
      hour:           t.slice(11, 16),
      temperature_f:  Math.round(hourly.temperature_2m[i]),
      conditions:     weatherCodeToText(hourly.weather_code[i]),
    })),
  };
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
