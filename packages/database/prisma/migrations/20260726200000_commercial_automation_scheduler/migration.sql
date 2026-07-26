CREATE TYPE "CommercialAutomationExecutionMode" AS ENUM ('PREVIEW', 'SEND');

CREATE TYPE "CommercialAutomationExecutionStatus" AS ENUM (
  'STARTED',
  'BLOCKED',
  'PREVIEW_READY',
  'QUEUED',
  'FAILED',
  'AMBIGUOUS'
);

CREATE TABLE "CommercialAutomationExecution" (
  "id" TEXT NOT NULL,
  "schedulerJobId" TEXT NOT NULL,
  "bullMqJobId" TEXT,
  "activeKey" TEXT,
  "mode" "CommercialAutomationExecutionMode" NOT NULL,
  "status" "CommercialAutomationExecutionStatus" NOT NULL,
  "reasons" JSONB NOT NULL,
  "commercialRunId" TEXT,
  "failureCode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "CommercialAutomationExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialAutomationExecution_bullMqJobId_key"
ON "CommercialAutomationExecution"("bullMqJobId");

CREATE UNIQUE INDEX "CommercialAutomationExecution_activeKey_key"
ON "CommercialAutomationExecution"("activeKey");

CREATE INDEX "CommercialAutomationExecution_startedAt_idx"
ON "CommercialAutomationExecution"("startedAt");

CREATE INDEX "CommercialAutomationExecution_status_idx"
ON "CommercialAutomationExecution"("status");

CREATE INDEX "CommercialAutomationExecution_commercialRunId_idx"
ON "CommercialAutomationExecution"("commercialRunId");
