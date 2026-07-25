CREATE TYPE "CommercialPipelineRunMode" AS ENUM ('DRY_RUN', 'CONFIRMED');
CREATE TYPE "CommercialPipelineRunStatus" AS ENUM ('STARTED', 'COMPLETED', 'BLOCKED', 'FAILED');

CREATE TABLE "CommercialPipelineRun" (
  "id" TEXT NOT NULL,
  "mode" "CommercialPipelineRunMode" NOT NULL,
  "status" "CommercialPipelineRunStatus" NOT NULL,
  "productId" TEXT,
  "groupDestinationId" TEXT,
  "productName" TEXT,
  "productPrice" DECIMAL(14,4),
  "groupName" TEXT,
  "groupFingerprint" TEXT,
  "score" INTEGER,
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectionSummary" JSONB NOT NULL,
  "selectionReasons" JSONB NOT NULL,
  "copyPreview" TEXT,
  "plannedSubIds" JSONB NOT NULL,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CommercialPipelineRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommercialPipelineRun_createdAt_idx" ON "CommercialPipelineRun"("createdAt");
CREATE INDEX "CommercialPipelineRun_status_mode_idx" ON "CommercialPipelineRun"("status", "mode");
CREATE INDEX "CommercialPipelineRun_productId_idx" ON "CommercialPipelineRun"("productId");
CREATE INDEX "CommercialPipelineRun_groupDestinationId_idx" ON "CommercialPipelineRun"("groupDestinationId");

ALTER TABLE "CommercialPipelineRun"
  ADD CONSTRAINT "CommercialPipelineRun_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "ProductLead"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommercialPipelineRun"
  ADD CONSTRAINT "CommercialPipelineRun_groupDestinationId_fkey"
  FOREIGN KEY ("groupDestinationId") REFERENCES "WhatsAppDestination"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
