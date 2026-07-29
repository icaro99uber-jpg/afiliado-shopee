ALTER TABLE "CommercialPipelineRun"
  ADD COLUMN "scorePolicyVersion" TEXT,
  ADD COLUMN "minimumScoreUsed" INTEGER,
  ADD COLUMN "maximumScoreObserved" INTEGER,
  ADD COLUMN "selectedScoreBreakdown" JSONB;
