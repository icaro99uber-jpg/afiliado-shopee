CREATE TYPE "ShopeeOfferSource" AS ENUM ('MOCK', 'MANUAL', 'OFFICIAL');
CREATE TYPE "CouponSource" AS ENUM ('MANUAL', 'OFFICIAL');
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

ALTER TABLE "ProductLead"
  ADD COLUMN "source" "ShopeeOfferSource" NOT NULL DEFAULT 'MOCK',
  ADD COLUMN "precoMin" DECIMAL(14,4),
  ADD COLUMN "precoMax" DECIMAL(14,4),
  ADD COLUMN "commissionAmount" DECIMAL(14,4),
  ADD COLUMN "sellerCommissionRate" DOUBLE PRECISION,
  ADD COLUMN "shopeeCommissionRate" DOUBLE PRECISION,
  ADD COLUMN "shopId" TEXT,
  ADD COLUMN "categoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "affiliateLink" TEXT,
  ADD COLUMN "offerStartsAt" TIMESTAMP(3),
  ADD COLUMN "offerEndsAt" TIMESTAMP(3),
  ADD COLUMN "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "unavailableAt" TIMESTAMP(3);

ALTER TABLE "ProductLead"
  ALTER COLUMN "preco" TYPE DECIMAL(14,4) USING "preco"::DECIMAL(14,4);

DROP INDEX IF EXISTS "ProductLead_providerProductId_key";
CREATE UNIQUE INDEX "ProductLead_source_providerProductId_key"
  ON "ProductLead"("source", "providerProductId");
CREATE INDEX "ProductLead_source_lastSeenAt_idx"
  ON "ProductLead"("source", "lastSeenAt");
CREATE INDEX "ProductLead_offerEndsAt_unavailableAt_idx"
  ON "ProductLead"("offerEndsAt", "unavailableAt");

CREATE TABLE "Coupon" (
  "id" TEXT NOT NULL,
  "source" "CouponSource" NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "discountType" "CouponDiscountType" NOT NULL,
  "discountValue" DECIMAL(14,4) NOT NULL,
  "minPurchase" DECIMAL(14,4),
  "maxDiscount" DECIMAL(14,4),
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "shopId" TEXT,
  "productId" TEXT,
  "terms" TEXT,
  "lastValidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Coupon_active_startsAt_endsAt_idx"
  ON "Coupon"("active", "startsAt", "endsAt");
CREATE INDEX "Coupon_shopId_idx" ON "Coupon"("shopId");
CREATE INDEX "Coupon_productId_idx" ON "Coupon"("productId");

ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "ProductLead"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
