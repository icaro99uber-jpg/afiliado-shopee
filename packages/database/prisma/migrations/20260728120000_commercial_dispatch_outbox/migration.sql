CREATE TYPE "CommercialDispatchOutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'AMBIGUOUS');

CREATE TABLE "CommercialDispatchOutbox" (
  "id" TEXT NOT NULL,
  "commercialRunId" TEXT NOT NULL,
  "dispatchId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "status" "CommercialDispatchOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),

  CONSTRAINT "CommercialDispatchOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialDispatchOutbox_commercialRunId_key"
  ON "CommercialDispatchOutbox"("commercialRunId");

CREATE UNIQUE INDEX "CommercialDispatchOutbox_dispatchId_key"
  ON "CommercialDispatchOutbox"("dispatchId");

CREATE UNIQUE INDEX "CommercialDispatchOutbox_jobId_key"
  ON "CommercialDispatchOutbox"("jobId");

CREATE INDEX "CommercialDispatchOutbox_status_createdAt_idx"
  ON "CommercialDispatchOutbox"("status", "createdAt");

ALTER TABLE "CommercialDispatchOutbox"
  ADD CONSTRAINT "CommercialDispatchOutbox_commercialRunId_fkey"
  FOREIGN KEY ("commercialRunId") REFERENCES "CommercialPipelineRun"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialDispatchOutbox"
  ADD CONSTRAINT "CommercialDispatchOutbox_dispatchId_fkey"
  FOREIGN KEY ("dispatchId") REFERENCES "WhatsAppDispatch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
