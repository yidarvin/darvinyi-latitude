-- Account trust surface: API key columns become removable (null once the
-- user removes their key from Account).
ALTER TABLE "User" ALTER COLUMN "apiKeyCipher" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "apiKeyNonce" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "apiKeyAuthTag" DROP NOT NULL;

-- Real agent-generated folio insight, regenerated after each compose.
ALTER TABLE "User" ADD COLUMN "insightText" TEXT;
ALTER TABLE "User" ADD COLUMN "insightGeneratedAt" TIMESTAMP(3);

-- Mobility honesty: Latitude only ever routes on foot — transit/bike/ride
-- were collected but never acted on. transitPolyline was model-transcribed
-- reference data for a mode nothing renders anymore.
ALTER TABLE "Walk" DROP COLUMN "transitPolyline";
