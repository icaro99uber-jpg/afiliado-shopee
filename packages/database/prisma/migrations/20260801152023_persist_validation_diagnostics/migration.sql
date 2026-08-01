-- AlterTable
ALTER TABLE "CommercialCopyGenerationAttempt" ADD COLUMN     "validationFailureCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
