ALTER TABLE "ProductLead"
  ADD COLUMN "commercialSnapshotRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "commercialSnapshotFingerprint" TEXT;

ALTER TABLE "ProductLead"
  ADD CONSTRAINT "ProductLead_commercialSnapshotRevision_nonnegative_check"
    CHECK ("commercialSnapshotRevision" >= 0),
  ADD CONSTRAINT "ProductLead_commercialSnapshot_state_check"
    CHECK (
      ("commercialSnapshotRevision" = 0 AND "commercialSnapshotFingerprint" IS NULL)
      OR
      ("commercialSnapshotRevision" > 0 AND "commercialSnapshotFingerprint" IS NOT NULL)
    );

CREATE TABLE "CommercialOfferSnapshot" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "price" DECIMAL(14,4) NOT NULL,
  "priceMin" DECIMAL(14,4),
  "priceMax" DECIMAL(14,4),
  "discountRate" DOUBLE PRECISION NOT NULL,
  "commissionRate" DOUBLE PRECISION NOT NULL,
  "observedRating" DOUBLE PRECISION NOT NULL,
  "observedSales" INTEGER NOT NULL,
  "offerStartsAt" TIMESTAMP(3),
  "offerEndsAt" TIMESTAMP(3),
  "unavailableAt" TIMESTAMP(3),
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommercialOfferSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialOfferSnapshot_revision_positive_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "CommercialOfferSnapshot_productId_revision_key"
  ON "CommercialOfferSnapshot"("productId", "revision");
CREATE INDEX "CommercialOfferSnapshot_productId_revision_idx"
  ON "CommercialOfferSnapshot"("productId", "revision");
CREATE INDEX "CommercialOfferSnapshot_productId_capturedAt_idx"
  ON "CommercialOfferSnapshot"("productId", "capturedAt");
CREATE INDEX "CommercialOfferSnapshot_fingerprint_idx"
  ON "CommercialOfferSnapshot"("fingerprint");

ALTER TABLE "CommercialOfferSnapshot"
  ADD CONSTRAINT "CommercialOfferSnapshot_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "ProductLead"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
