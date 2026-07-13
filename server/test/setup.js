// Vitest setup — runs before each test file's module graph loads.
// config.js validates process.env eagerly on import, so these must be set
// before any test imports a module that (transitively) imports config.js.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/latitude_test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
process.env.API_KEY_ENCRYPTION_KEY = 'wIiiTOgWSJY0AfOa5VmsGTqZ7CO6rcbHGCxneyJ1+Ug=';
process.env.MAPBOX_TOKEN = 'pk.test-mapbox-token-xxxxxxxxxxxxxxxxxxxx';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
