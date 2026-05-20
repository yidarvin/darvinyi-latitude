# Latitude

A photography agenda planner with an agent that remembers where you've been.

Production: latitude.darvinyi.com

## Stack
- Node 20 + Express (ESM)
- React 18 + Vite
- PostgreSQL + Prisma
- Leaflet (CartoDB tiles) + Mapbox (routing/geocoding)
- Anthropic SDK
- Railway

## Local development

```bash
npm run install:all
cp server/.env.example server/.env
# fill in DATABASE_URL, JWT_SECRET, API_KEY_ENCRYPTION_KEY
cd server && npx prisma migrate dev
cd .. && npm run dev
```

Open http://localhost:5173.
