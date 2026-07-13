const BASE = import.meta.env.VITE_API_URL ?? '';

/**
 * Build a full API URL for callers that can't go through request() (e.g. a
 * native EventSource, which doesn't accept a fetch-style options object).
 * Keeps VITE_API_URL honored everywhere — a caller that hand-builds a
 * relative '/api/...' URL instead silently breaks the day the client is
 * ever hosted on a different origin than the API.
 */
export function apiUrl(path) {
  return `${BASE}/api${path}`;
}

export async function request(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const get   = (path)          => request(path);
export const post  = (path, body)    => request(path, { method: 'POST',  body: JSON.stringify(body) });
export const patch = (path, body)    => request(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del   = (path, body)    => request(path, { method: 'DELETE', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
