ALTER TABLE "CommercialCopyGenerationAttempt"
  ADD COLUMN "providerHttpStatus" INTEGER,
  ADD COLUMN "providerErrorCode" VARCHAR(100),
  ADD COLUMN "providerErrorType" VARCHAR(100),
  ADD COLUMN "providerErrorParam" VARCHAR(100);
