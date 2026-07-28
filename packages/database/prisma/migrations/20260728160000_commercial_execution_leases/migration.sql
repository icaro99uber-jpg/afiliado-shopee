ALTER TABLE "CommercialAutomationExecution"
ADD COLUMN "ownerId" TEXT,
ADD COLUMN "heartbeatAt" TIMESTAMP(3),
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "CommercialAutomationExecution_status_leaseExpiresAt_idx"
ON "CommercialAutomationExecution"("status", "leaseExpiresAt");
