CREATE TYPE "WhatsAppDispatchStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "WhatsAppDestination" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppDestination_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppDispatch" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "generatedCopyId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "status" "WhatsAppDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppDispatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppDispatch_generatedCopyId_destinationId_key" ON "WhatsAppDispatch"("generatedCopyId", "destinationId");
CREATE INDEX "WhatsAppDispatch_productId_idx" ON "WhatsAppDispatch"("productId");
CREATE INDEX "WhatsAppDispatch_destinationId_idx" ON "WhatsAppDispatch"("destinationId");
CREATE INDEX "WhatsAppDispatch_status_idx" ON "WhatsAppDispatch"("status");
ALTER TABLE "WhatsAppDispatch" ADD CONSTRAINT "WhatsAppDispatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppDispatch" ADD CONSTRAINT "WhatsAppDispatch_generatedCopyId_fkey" FOREIGN KEY ("generatedCopyId") REFERENCES "GeneratedCopy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppDispatch" ADD CONSTRAINT "WhatsAppDispatch_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "WhatsAppDestination"("id") ON DELETE CASCADE ON UPDATE CASCADE;
