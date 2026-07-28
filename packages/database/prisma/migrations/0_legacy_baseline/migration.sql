-- CreateTable
CREATE TABLE "ProductLead" (
    "id" TEXT NOT NULL,
    "providerProductId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "preco" DOUBLE PRECISION NOT NULL,
    "desconto" DOUBLE PRECISION NOT NULL,
    "nota" DOUBLE PRECISION NOT NULL,
    "vendidos" INTEGER NOT NULL,
    "comissao" DOUBLE PRECISION NOT NULL,
    "loja" TEXT NOT NULL,
    "urlImagem" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT NOT NULL,
    "score" INTEGER,
    "scoreUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedCopy" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "hashtags" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductLead_providerProductId_key" ON "ProductLead"("providerProductId");

-- CreateIndex
CREATE INDEX "GeneratedCopy_productId_idx" ON "GeneratedCopy"("productId");

-- AddForeignKey
ALTER TABLE "GeneratedCopy" ADD CONSTRAINT "GeneratedCopy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
