CREATE TABLE "CommercialNiche" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "categoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "includeKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "excludeKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "minPrice" DECIMAL(14,4),
  "maxPrice" DECIMAL(14,4),
  "minDiscountRate" DOUBLE PRECISION NOT NULL DEFAULT 5,
  "minRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "minSales" INTEGER NOT NULL DEFAULT 0,
  "minCommissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "minimumScore" INTEGER NOT NULL DEFAULT 60,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CommercialNiche_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommercialGroupCampaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "logicalGroupFingerprint" TEXT NOT NULL,
  "anchorDestinationId" TEXT,
  "nicheId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "cadenceMinutes" INTEGER NOT NULL DEFAULT 15,
  "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "allowedStartTime" TEXT NOT NULL DEFAULT '07:00',
  "allowedEndTime" TEXT NOT NULL DEFAULT '22:00',
  "dailyLimit" INTEGER NOT NULL DEFAULT 60,
  "queueTargetSize" INTEGER NOT NULL DEFAULT 40,
  "dedupeDays" INTEGER NOT NULL DEFAULT 30,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CommercialGroupCampaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialNiche_slug_key" ON "CommercialNiche"("slug");
CREATE INDEX "CommercialNiche_active_idx" ON "CommercialNiche"("active");
CREATE UNIQUE INDEX "CommercialGroupCampaign_logicalGroupFingerprint_key"
  ON "CommercialGroupCampaign"("logicalGroupFingerprint");
CREATE INDEX "CommercialGroupCampaign_active_idx"
  ON "CommercialGroupCampaign"("active");
CREATE INDEX "CommercialGroupCampaign_nicheId_idx"
  ON "CommercialGroupCampaign"("nicheId");

ALTER TABLE "CommercialGroupCampaign"
  ADD CONSTRAINT "CommercialGroupCampaign_anchorDestinationId_fkey"
  FOREIGN KEY ("anchorDestinationId") REFERENCES "WhatsAppDestination"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommercialGroupCampaign"
  ADD CONSTRAINT "CommercialGroupCampaign_nicheId_fkey"
  FOREIGN KEY ("nicheId") REFERENCES "CommercialNiche"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
