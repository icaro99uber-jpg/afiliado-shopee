CREATE TABLE "CommercialAutomationSettings" (
  "id" TEXT NOT NULL DEFAULT 'commercial-automation',
  "paused" BOOLEAN NOT NULL DEFAULT true,
  "pausedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "resumedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommercialAutomationSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "CommercialAutomationSettings" (
  "id",
  "paused",
  "pausedAt",
  "updatedAt"
) VALUES (
  'commercial-automation',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
