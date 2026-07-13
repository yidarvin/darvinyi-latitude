import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

// Mirror the encryption logic from server/src/lib/crypto.js
// (kept self-contained so the seed can run without booting the full app)
function encryptApiKey(plaintext, masterKey) {
  const key = Buffer.from(masterKey, 'base64');
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    cipher: ct.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

const SEED_EMAIL = process.env.SEED_EMAIL || 'dev@latitude.test';
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'hunter22hunter22';

async function main() {
  // This upserts a well-known email + password (and wipes that account's
  // walks) — safe against a local dev DB, destructive and a real account
  // takeover if ever pointed at production. Require an explicit opt-in.
  if (process.env.NODE_ENV === 'production' && process.env.FORCE_SEED !== '1') {
    console.error('Refusing to seed with NODE_ENV=production. If this is genuinely intentional, set FORCE_SEED=1.');
    process.exit(1);
  }

  if (!process.env.API_KEY_ENCRYPTION_KEY) {
    throw new Error('API_KEY_ENCRYPTION_KEY must be set in env to run seed');
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const enc = encryptApiKey('sk-ant-seed-fakefakefakefake', process.env.API_KEY_ENCRYPTION_KEY);

  const user = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    update: {},
    create: {
      email: SEED_EMAIL,
      passwordHash,
      apiKeyCipher: enc.cipher,
      apiKeyNonce: enc.nonce,
      apiKeyAuthTag: enc.authTag,
    },
  });

  await prisma.walk.deleteMany({ where: { userId: user.id } });

  const now = Date.now();
  const daysAgo = (d) => new Date(now - d * 24 * 60 * 60 * 1000);

  const walks = [
    {
      title: 'Marine Pause',
      subtitle: 'A study of horizon · 8 frames · color',
      brief: 'The Outer Sunset at golden hour. Look for places where the fog is just about to lift but hasn\'t. *Stay with horizontals.*',
      locationName: 'Outer Sunset, San Francisco',
      centerLat: 37.7593, centerLng: -122.5083,
      date: daysAgo(14),
      timeOfDay: 'golden',
      durationMin: 165, distanceM: 4100,
      cameraBody: 'Fujifilm X100VI',
      lensSpec: '35mm equiv. f/2',
      mobility: ['foot'],
      styles: ['landscape', 'minimal'],
      stops: [
        { name: 'Ocean Beach south parking', lat: 37.7458, lng: -122.5088 },
        { name: 'Lawton & Great Highway',    lat: 37.7585, lng: -122.5085 },
        { name: 'Java Beach Café (Judah)',   lat: 37.7603, lng: -122.5084 },
        { name: 'Judah & 46th streetcar turnaround', lat: 37.7605, lng: -122.5095 },
      ],
    },
    {
      title: 'Rivets and Rain',
      subtitle: 'A study of industry · 12 frames · B&W',
      brief: 'Dogpatch in the morning. The metal trades meet the new condos. *Bring rain shoes and patience.*',
      locationName: 'Dogpatch, San Francisco',
      centerLat: 37.7600, centerLng: -122.3884,
      date: daysAgo(22),
      timeOfDay: 'morning',
      durationMin: 195, distanceM: 5200,
      cameraBody: 'Fujifilm X100VI',
      lensSpec: '35mm equiv. f/2',
      mobility: ['foot'],
      styles: ['documentary', 'arch'],
      stops: [
        { name: '20th & Illinois',            lat: 37.7615, lng: -122.3877 },
        { name: 'Crane Cove Park',            lat: 37.7607, lng: -122.3852 },
        { name: 'Pier 70 shipyard fence',     lat: 37.7591, lng: -122.3852 },
        { name: '22nd & Tennessee',           lat: 37.7574, lng: -122.3893 },
        { name: 'Piccino (Minnesota)',        lat: 37.7574, lng: -122.3911 },
      ],
    },
    {
      title: 'Long Shadows',
      subtitle: 'A study of edges · 9 frames · color',
      brief: 'Afternoon Presidio. Where eucalyptus meets brick. *The shadows do the work.*',
      locationName: 'Presidio, San Francisco',
      centerLat: 37.7989, centerLng: -122.4662,
      date: daysAgo(35),
      timeOfDay: 'midday',
      durationMin: 220, distanceM: 6800,
      cameraBody: 'Leica Q3',
      lensSpec: '28mm Summilux f/1.7',
      mobility: ['foot'],
      styles: ['landscape', 'fineart'],
      stops: [
        { name: 'Main Post bandstand',        lat: 37.7989, lng: -122.4625 },
        { name: 'Officers\' Row hedge gap',   lat: 37.8002, lng: -122.4651 },
        { name: 'Pacific Overlook trailhead', lat: 37.8048, lng: -122.4732 },
        { name: 'Battery Crosby ruins',       lat: 37.8077, lng: -122.4729 },
      ],
    },
    {
      title: 'The Walk Home',
      subtitle: 'A study of color · 7 frames · color',
      brief: 'Bernal Heights at blue hour. The pastels go saturated for ten minutes. *Catch them or wait a month.*',
      locationName: 'Bernal Heights, San Francisco',
      centerLat: 37.7400, centerLng: -122.4156,
      date: daysAgo(46),
      timeOfDay: 'blue',
      durationMin: 140, distanceM: 2900,
      cameraBody: 'Fujifilm X100VI',
      lensSpec: '35mm equiv. f/2',
      mobility: ['foot'],
      styles: ['street', 'color'],
      stops: [
        { name: 'Cortland & Folsom',          lat: 37.7384, lng: -122.4137 },
        { name: 'Anderson stair-stepped row', lat: 37.7415, lng: -122.4131 },
        { name: 'Bernal hill east ascent',    lat: 37.7416, lng: -122.4118 },
        { name: 'Summit benches',             lat: 37.7430, lng: -122.4140 },
      ],
    },
    {
      title: 'Painted Edges',
      subtitle: 'A study of facades · 6 frames · color',
      brief: 'Mission at midday. Murals are everywhere; the ones worth shooting are the ones the building has aged into.',
      locationName: 'Mission District, San Francisco',
      centerLat: 37.7565, centerLng: -122.4170,
      date: daysAgo(128),
      timeOfDay: 'midday',
      durationMin: 180, distanceM: 3400,
      cameraBody: 'Fujifilm X100VI',
      lensSpec: '35mm equiv. f/2',
      mobility: ['foot'],
      styles: ['street', 'color'],
      stops: [
        { name: 'Clarion Alley entrance',     lat: 37.7626, lng: -122.4220 },
        { name: '16th & Valencia plaza',      lat: 37.7649, lng: -122.4218 },
        { name: 'Bi-Rite Creamery line',      lat: 37.7613, lng: -122.4214 },
        { name: 'Dolores Park north slope',   lat: 37.7607, lng: -122.4267 },
      ],
    },
  ];

  for (const w of walks) {
    const { stops, ...walkData } = w;
    await prisma.walk.create({
      data: {
        ...walkData,
        userId: user.id,
        status: 'composed',
        composedAt: walkData.date,
        intent: null,
        conditions: {
          light: 'Reconstructed from past data.',
          weather: 'Unknown.',
          camera_notes: 'Seeded entry.',
          afterward: 'Saved for reference.',
        },
        stops: {
          create: stops.map((s, i) => ({
            ordinal: i + 1,
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            arrivalTime: `${9 + i}:00`,
            durationMin: 25,
            brief: 'Seeded — agent did not compose this stop.',
          })),
        },
      },
    });
  }

  console.log(`Seeded ${walks.length} walks for ${SEED_EMAIL}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
