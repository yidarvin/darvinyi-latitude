# Railway deployment notes

Things that have bitten the portfolio before. Refer back to this whenever Railway behaves unexpectedly.

## Hard-won lessons

1. **VITE_API_URL must be hardcoded in `client/.env.production`.** Railway does NOT pass Variables as Docker build args to Vite. Don't set it as a Railway Variable. For Latitude specifically, set it to empty string (same-origin) since we serve the client from the same service that serves the API.

2. **No shell access on Railway.** Database seeding and migrations must be wired into the start command. Latitude uses:

   ```json
   "start": "prisma migrate deploy && node src/index.js"
   ```

3. **Domain doesn't auto-generate.** After deploying, must click "Generate Domain" in Railway's UI to get a `*.up.railway.app` URL. Without this, the service is up but unreachable.

4. **`postinstall: prisma generate` required.** Without it, Railway builds finish without the Prisma client and the server crashes on first request.

5. **Static file serving from Express.** In production, Express serves the built client from `server/public/`. The build script copies `client/dist` → `server/public`. This needs to be in the root `npm run build` step. Railway runs this during build phase.

6. **Postgres connection string from Railway.** Railway's Postgres provides `DATABASE_URL` automatically when you link the Postgres plugin to the service. Don't override it.

7. **Cookies and SameSite.** In production, `httpOnly` cookies must be `Secure: true` and `SameSite: 'lax'` (or `'none'` if cross-origin). For Latitude (same-origin), `'lax'` is correct.

8. **Long-lived SSE connections.** Railway's proxy honors `text/event-stream` headers and won't time out. But set `res.flushHeaders()` early and write a heartbeat comment every 15s to prevent any intermediate proxies from killing the connection:

   ```js
   res.write(': heartbeat\n\n');
   ```

## DNS — Namecheap for latitude.darvinyi.com

1. In Railway: project → service → Settings → Custom Domain → add `latitude.darvinyi.com`. Railway gives a CNAME target.
2. In Namecheap: darvinyi.com → Advanced DNS → Add CNAME record. Host: `latitude`. Value: Railway's CNAME target. TTL: Automatic.
3. Wait ~5–60 min for propagation. Railway auto-provisions SSL.

## Environment variables to set in Railway

```
DATABASE_URL              # auto-set by Railway Postgres plugin
JWT_SECRET                # openssl rand -hex 32
API_KEY_ENCRYPTION_KEY    # openssl rand -base64 32
NODE_ENV                  = production
PORT                      # auto-set by Railway
CLIENT_ORIGIN             = https://latitude.darvinyi.com
COOKIE_DOMAIN             = latitude.darvinyi.com
MAPBOX_TOKEN              # public token from mapbox.com
```

Do NOT set `VITE_API_URL` here — it's hardcoded in client/.env.production.

## Pre-deploy checklist

- [ ] All migrations committed (server/prisma/migrations/)
- [ ] `client/.env.production` has `VITE_API_URL=` (empty)
- [ ] `server/package.json` has `postinstall: prisma generate`
- [ ] `server/package.json` start runs `prisma migrate deploy`
- [ ] Root `npm run build` copies client/dist → server/public
- [ ] No secrets in committed files
