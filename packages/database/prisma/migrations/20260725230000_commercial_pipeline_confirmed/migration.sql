CREATE TYPE "CommercialPipelineFinalStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'AMBIGUOUS');

ALTER TYPE "WhatsAppDispatchStatus" ADD VALUE 'PROCESSING';

ALTER TABLE "CommercialPipelineRun"
  ADD COLUMN "dispatchId" TEXT,
  ADD COLUMN "jobId" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "finalStatus" "CommercialPipelineFinalStatus",
  ADD COLUMN "investigationRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "CommercialPipelineRun_dispatchId_key"
  ON "CommercialPipelineRun"("dispatchId");

CREATE UNIQUE INDEX "CommercialPipelineRun_jobId_key"
  ON "CommercialPipelineRun"("jobId");

ALTER TABLE "CommercialPipelineRun"
  ADD CONSTRAINT "CommercialPipelineRun_dispatchId_fkey"
  FOREIGN KEY ("dispatchId") REFERENCES "WhatsAppDispatch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
