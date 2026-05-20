const BASE = import.meta.env.VITE_API_URL ?? '';

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
export const del   = (path)          => request(path, { method: 'DELETE' });
