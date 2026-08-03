import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaWhatsAppDispatchRepository } from '../src/prisma-repositories';

describe('PrismaWhatsAppDispatchRepository', () => {
  let prismaMock: Record<string, Record<string, import('vitest').Mock>>;
  let repository: PrismaWhatsAppDispatchRepository;

  beforeEach(() => {
    prismaMock = {
      whatsAppDispatch: {
        findUnique: vi.fn(),
      },
      commercialPromotionCandidate: {
        findUnique: vi.fn(),
      }
    };
    repository = new PrismaWhatsAppDispatchRepository(prismaMock as never);
  });

  it('findByIdForSending executa uma unica query usando select sem includes e não consulta promotionCandidate', async () => {
    const fakeDispatch = {
      id: 'disp-1',
      destinationId: 'dest-1',
      generatedCopyId: 'copy-1',
      status: 'PENDING',
      destination: {
        id: 'dest-1',
        destination: '5511999999999',
        type: 'INDIVIDUAL',
        name: 'John',
        active: true,
        available: true,
      },
      product: {
        id: 'prod-1',
        nome: 'Product',
        preco: 10,
        urlImagem: 'http://img',
        affiliateLink: 'http://link',
        desconto: 0,
        lastSeenAt: new Date(),
        categoria: 'cat',
        nota: 5,
        vendidos: 100,
        comissao: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        score: 100,
        scoreUpdatedAt: new Date(),
        providerProductId: 'prod-1',
        origin: 'OFFICIAL',
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: 'hash',
        unavailableAt: null,
      },
      generatedCopy: {
        id: 'copy-1',
        titulo: 'Title',
        mensagem: 'Message',
        cta: 'Click',
        hashtags: '#promo',
        createdFromCandidateId: 'cand-1',
        promotionCandidates: [
          {
            id: 'cand-1',
            productId: 'prod-1',
            snapshotId: 'snap-1',
            generatedCopyId: 'copy-1',
            status: 'COPY_READY',
            expiresAt: new Date(Date.now() + 100000),
            product: {
              id: 'prod-1',
              unavailableAt: null,
              affiliateLink: 'http://link',
              urlImagem: 'http://img',
              commercialSnapshotRevision: 1,
            },
            snapshot: {
              id: 'snap-1',
              productId: 'prod-1',
              revision: 1,
              unavailableAt: null,
              offerEndsAt: null,
            },
          },
        ],
      },
    };

    prismaMock.whatsAppDispatch.findUnique.mockResolvedValueOnce(fakeDispatch);

    const result = await repository.findByIdForSending('disp-1');

    expect(prismaMock.whatsAppDispatch.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.commercialPromotionCandidate.findUnique).not.toHaveBeenCalled();

    const callArgs = prismaMock.whatsAppDispatch.findUnique.mock.calls[0][0];

    expect(callArgs.include).toBeUndefined();
    expect(callArgs.select).toBeDefined();

    expect(callArgs.select).toHaveProperty('destination');
    expect(callArgs.select).toHaveProperty('product');
    expect(callArgs.select.generatedCopy.select).toHaveProperty('productId', true);
    expect(callArgs.select.generatedCopy.select).toHaveProperty('snapshotId', true);
    expect(callArgs.select.generatedCopy.select).toHaveProperty('createdFromCandidateId');
    expect(callArgs.select.generatedCopy.select).toHaveProperty('promotionCandidates');
    expect(callArgs.select.generatedCopy.select.promotionCandidates.select).toHaveProperty('product');
    expect(callArgs.select.generatedCopy.select.promotionCandidates.select).toHaveProperty('snapshot');

    expect(result).toBeDefined();
    expect(result?.id).toBe('disp-1');
  });
});
