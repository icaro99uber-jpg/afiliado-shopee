CREATE TYPE "CommercialPromotionCandidateStatus" AS ENUM (
  'QUEUED',
  'COPY_READY',
  'RESERVED',
  'DISPATCHED',
  'EXPIRED',
  'BLOCKED'
);

CREATE TYPE "CommercialPromotionSignal" AS ENUM (
  'PRICE_DROP',
  'DISCOUNT_INCREASE',
  'NEWLY_OBSERVED',
  'CURRENT_DISCOUNT'
);

CREATE TABLE "CommercialPromotionCandidate" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "status" "CommercialPromotionCandidateStatus" NOT NULL DEFAULT 'QUEUED',
  "rankPosition" INTEGER,
  "commercialScore" INTEGER NOT NULL,
  "scorePolicyVersion" TEXT NOT NULL,
  "minimumScoreUsed" INTEGER NOT NULL,
  "scoreBreakdown" JSONB NOT NULL,
  "promotionSignals" "CommercialPromotionSignal"[] NOT NULL,
  "priceDropPercent" DECIMAL(7,4),
  "queuedAt" TIMESTAMP(3) NOT NULL,
  "lastEvaluatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "dedupeUntil" TIMESTAMP(3),
  "blockedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CommercialPromotionCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialPromotionCandidate_rankPosition_positive_check"
    CHECK ("rankPosition" IS NULL OR "rankPosition" > 0),
  CONSTRAINT "CommercialPromotionCandidate_commercialScore_range_check"
    CHECK ("commercialScore" >= 0 AND "commercialScore" <= 100),
  CONSTRAINT "CommercialPromotionCandidate_minimumScoreUsed_range_check"
    CHECK ("minimumScoreUsed" >= 0 AND "minimumScoreUsed" <= 100),
  CONSTRAINT "CommercialPromotionCandidate_priceDropPercent_range_check"
    CHECK (
      "priceDropPercent" IS NULL
      OR ("priceDropPercent" >= 0 AND "priceDropPercent" <= 100)
    )
);

CREATE UNIQUE INDEX "CommercialPromotionCandidate_campaignId_productId_key"
  ON "CommercialPromotionCandidate"("campaignId", "productId");
CREATE INDEX "CommercialPromotionCandidate_campaignId_status_rankPosition_idx"
  ON "CommercialPromotionCandidate"("campaignId", "status", "rankPosition");
CREATE INDEX "CommercialPromotionCandidate_campaignId_updatedAt_idx"
  ON "CommercialPromotionCandidate"("campaignId", "updatedAt");
CREATE INDEX "CommercialPromotionCandidate_snapshotId_idx"
  ON "CommercialPromotionCandidate"("snapshotId");
CREATE INDEX "CommercialPromotionCandidate_expiresAt_idx"
  ON "CommercialPromotionCandidate"("expiresAt");
CREATE INDEX "CommercialPromotionCandidate_dedupeUntil_idx"
  ON "CommercialPromotionCandidate"("dedupeUntil");

ALTER TABLE "CommercialPromotionCandidate"
  ADD CONSTRAINT "CommercialPromotionCandidate_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "CommercialGroupCampaign"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialPromotionCandidate"
  ADD CONSTRAINT "CommercialPromotionCandidate_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "ProductLead"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialPromotionCandidate"
  ADD CONSTRAINT "CommercialPromotionCandidate_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "CommercialOfferSnapshot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
