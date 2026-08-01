CREATE TYPE "GeneratedCopySource" AS ENUM ('LEGACY_TEMPLATE', 'AI');
CREATE TYPE "CommercialCopyGenerationAttemptStatus" AS ENUM (
  'STARTED',
  'SUCCEEDED',
  'FAILED',
  'AMBIGUOUS'
);

ALTER TABLE "GeneratedCopy"
  ADD COLUMN "source" "GeneratedCopySource" NOT NULL DEFAULT 'LEGACY_TEMPLATE',
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "promptVersion" TEXT,
  ADD COLUMN "validationVersion" TEXT,
  ADD COLUMN "inputFingerprint" TEXT,
  ADD COLUMN "snapshotId" TEXT,
  ADD COLUMN "createdFromCandidateId" TEXT,
  ADD COLUMN "usageInputTokens" INTEGER,
  ADD COLUMN "usageOutputTokens" INTEGER,
  ADD COLUMN "usageTotalTokens" INTEGER,
  ADD CONSTRAINT "GeneratedCopy_usage_tokens_nonnegative_check" CHECK (
    ("usageInputTokens" IS NULL OR "usageInputTokens" >= 0) AND
    ("usageOutputTokens" IS NULL OR "usageOutputTokens" >= 0) AND
    ("usageTotalTokens" IS NULL OR "usageTotalTokens" >= 0)
  ),
  ADD CONSTRAINT "GeneratedCopy_ai_metadata_check" CHECK (
    "source" = 'LEGACY_TEMPLATE' OR (
      "provider" IS NOT NULL AND
      "model" IS NOT NULL AND
      "promptVersion" IS NOT NULL AND
      "validationVersion" IS NOT NULL AND
      "inputFingerprint" IS NOT NULL AND
      "snapshotId" IS NOT NULL AND
      "createdFromCandidateId" IS NOT NULL
    )
  );

ALTER TABLE "CommercialPromotionCandidate"
  ADD COLUMN "generatedCopyId" TEXT;

CREATE TABLE "CommercialCopyGenerationAttempt" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "validationVersion" TEXT NOT NULL,
  "status" "CommercialCopyGenerationAttemptStatus" NOT NULL,
  "generatedCopyId" TEXT,
  "failureCode" TEXT,
  "requestMayHaveStarted" BOOLEAN NOT NULL DEFAULT false,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "totalTokens" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommercialCopyGenerationAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialCopyGenerationAttempt_tokens_nonnegative_check" CHECK (
    ("inputTokens" IS NULL OR "inputTokens" >= 0) AND
    ("outputTokens" IS NULL OR "outputTokens" >= 0) AND
    ("totalTokens" IS NULL OR "totalTokens" >= 0)
  ),
  CONSTRAINT "CommercialCopyGenerationAttempt_state_check" CHECK (
    ("status" = 'STARTED' AND "completedAt" IS NULL AND "generatedCopyId" IS NULL) OR
    ("status" = 'SUCCEEDED' AND "completedAt" IS NOT NULL AND "generatedCopyId" IS NOT NULL AND "failureCode" IS NULL) OR
    ("status" IN ('FAILED', 'AMBIGUOUS') AND "completedAt" IS NOT NULL AND "generatedCopyId" IS NULL)
  )
);

CREATE UNIQUE INDEX "GeneratedCopy_inputFingerprint_key"
  ON "GeneratedCopy"("inputFingerprint");
CREATE INDEX "GeneratedCopy_snapshotId_idx" ON "GeneratedCopy"("snapshotId");
CREATE INDEX "CommercialPromotionCandidate_generatedCopyId_idx"
  ON "CommercialPromotionCandidate"("generatedCopyId");
CREATE UNIQUE INDEX "CommercialCopyGenerationAttempt_inputFingerprint_key"
  ON "CommercialCopyGenerationAttempt"("inputFingerprint");
CREATE INDEX "CommercialCopyGenerationAttempt_candidateId_createdAt_idx"
  ON "CommercialCopyGenerationAttempt"("candidateId", "createdAt");
CREATE INDEX "CommercialCopyGenerationAttempt_snapshotId_idx"
  ON "CommercialCopyGenerationAttempt"("snapshotId");
CREATE INDEX "CommercialCopyGenerationAttempt_status_createdAt_idx"
  ON "CommercialCopyGenerationAttempt"("status", "createdAt");
CREATE INDEX "CommercialCopyGenerationAttempt_generatedCopyId_idx"
  ON "CommercialCopyGenerationAttempt"("generatedCopyId");

ALTER TABLE "GeneratedCopy"
  ADD CONSTRAINT "GeneratedCopy_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "CommercialOfferSnapshot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialPromotionCandidate"
  ADD CONSTRAINT "CommercialPromotionCandidate_generatedCopyId_fkey"
  FOREIGN KEY ("generatedCopyId") REFERENCES "GeneratedCopy"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommercialCopyGenerationAttempt"
  ADD CONSTRAINT "CommercialCopyGenerationAttempt_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "CommercialPromotionCandidate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialCopyGenerationAttempt"
  ADD CONSTRAINT "CommercialCopyGenerationAttempt_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "CommercialOfferSnapshot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialCopyGenerationAttempt"
  ADD CONSTRAINT "CommercialCopyGenerationAttempt_generatedCopyId_fkey"
  FOREIGN KEY ("generatedCopyId") REFERENCES "GeneratedCopy"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
