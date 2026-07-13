-- Every hot query on Walk orders by `date` desc, not `createdAt` — the old
-- index couldn't be used for that sort, so Postgres had to re-sort results
-- after the userId filter. Replace it with an index on the column actually
-- queried.
DROP INDEX "Walk_userId_createdAt_idx";

-- CreateIndex
CREATE INDEX "Walk_userId_date_idx" ON "Walk"("userId", "date" DESC);

-- Stop_walkId_idx was redundant: Stop_walkId_ordinal_key (the unique
-- constraint on [walkId, ordinal]) already leads with walkId, so Postgres
-- can serve walkId-only lookups from that index's prefix.
DROP INDEX "Stop_walkId_idx";

-- User_email_idx was redundant: User_email_key (the unique constraint on
-- email) is already backed by its own index.
DROP INDEX "User_email_idx";
