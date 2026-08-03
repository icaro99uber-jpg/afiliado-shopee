import { describe, expect, it, vi } from 'vitest';
import {
  MockWhatsAppProvider,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  buildWhatsAppPublicMessage,
  SenderService,
} from '../src/sender-service';
import { PrismaWhatsAppDispatchRepository } from '../src/prisma-repositories';

const logger = { info: vi.fn(), error: vi.fn() };
const dispatch = {
  id: 'dispatch-1',
  productId: 'product-1',
  generatedCopyId: 'copy-1',
  destinationId: 'dest-1',
  generatedCopy: {
    titulo: 'Título',
    mensagem: 'Mensagem sem comissão',
    cta: 'Compre agora',
    hashtags: '#Oferta',
  },
  destination: { destination: 'mock-group-01' },
  product: { comissao: 0.2 },
  status: 'PENDING',
};

const prismaMock = (dispatchData = dispatch) => ({
  whatsAppDispatch: {
    findUnique: vi.fn(async () => dispatchData),
    updateMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async ({ data }) => ({ ...dispatch, ...data })),
  },
});

import { CommercialMessageDraftService } from '../src/commercial-message-draft-service';

const createService = (
  prisma = prismaMock(),
  provider: WhatsAppProvider = new MockWhatsAppProvider(),
  options?: { draftService?: CommercialMessageDraftService; }
) =>
  new SenderService({
    dispatches: new PrismaWhatsAppDispatchRepository(prisma as never),
    provider,
    logger,
    ...(options || {}),
  });

describe('SenderService', () => {
  it('altera PENDING para SENT e incrementa attemptCount', async () => {
    const prisma = prismaMock();
    const result = await createService(prisma).sendDispatch('dispatch-1');

    expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dispatch-1', status: 'PENDING' },
        data: expect.objectContaining({ attemptCount: { increment: 1 } }),
      }),
    );
    expect(prisma.whatsAppDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
    expect(result).toMatchObject({
      status: 'SENT',
      externalMessageId: 'mock-whatsapp-1',
      sentAt: expect.any(Date),
    });
  });

  it('mantem PROCESSING quando o resultado do provider e incerto', async () => {
    const prisma = prismaMock();
    const provider = {
      sendMessage: vi.fn(async () => {
        throw new Error('provider indisponível');
      }),
    };

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppDispatch.update).not.toHaveBeenCalled();
  });

  it('registra FAILED quando o provider bloqueia antes do request externo', async () => {
    const prisma = prismaMock();
    const provider = new MockWhatsAppProvider();
    provider.simulateFailure('falha simulada antes do request');

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({ code: 'MOCK_WHATSAPP_FAILURE' });
    expect(prisma.whatsAppDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'Envio bloqueado antes do request externo',
        }),
      }),
    );
  });

  it('monta mensagem pública com título, mensagem, CTA e hashtags sem comissão', () => {
    const message = buildWhatsAppPublicMessage(dispatch.generatedCopy);
    expect(message).toContain('Título');
    expect(message).toContain('Mensagem sem comissão');
    expect(message).toContain('Compre agora');
    expect(message).toContain('#Oferta');
    expect(message.toLocaleLowerCase('pt-BR')).not.toContain(
      'comissão de afiliado',
    );
    expect(message).not.toContain('0.2');
  });

  it('bloqueia retry automatico de dispatch FAILED', async () => {
    const prisma = prismaMock({ ...dispatch, status: 'FAILED' });
    const provider = new MockWhatsAppProvider();

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_RETRY_REQUIRES_MANUAL_REVIEW',
    });
    expect(provider.sentMessages).toHaveLength(0);
    expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
  });

  it('bloqueia redelivery de dispatch PROCESSING sem chamar o provider', async () => {
    const prisma = prismaMock({ ...dispatch, status: 'PROCESSING' });
    const provider = new MockWhatsAppProvider();

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    expect(provider.sentMessages).toHaveLength(0);
    expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
  });

  it('nao envia quando outro processamento adquiriu o mesmo dispatch', async () => {
    const prisma = prismaMock();
    prisma.whatsAppDispatch.updateMany.mockResolvedValue({ count: 0 });
    const provider = new MockWhatsAppProvider();

    await expect(
      createService(prisma, provider).sendDispatch('dispatch-1'),
    ).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_ALREADY_CLAIMED' });
    expect(provider.sentMessages).toHaveLength(0);
  });

  it('permite somente um envio quando dois workers disputam o dispatch', async () => {
    let current = { ...dispatch, attemptCount: 0 };
    const prisma = {
      whatsAppDispatch: {
        findUnique: vi.fn(async () => current),
        updateMany: vi.fn(async () => {
          if (current.status !== 'PENDING') return { count: 0 };
          current = {
            ...current,
            status: 'PROCESSING',
            attemptCount: current.attemptCount + 1,
          };
          return { count: 1 };
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          current = { ...current, ...data } as typeof current;
          return current;
        }),
      },
    };
    const provider = new MockWhatsAppProvider();
    const firstWorker = createService(prisma, provider);
    const secondWorker = createService(prisma, provider);

    const results = await Promise.allSettled([
      firstWorker.sendDispatch('dispatch-1'),
      secondWorker.sendDispatch('dispatch-1'),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(provider.sentMessages).toHaveLength(1);
    expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(2);
  });

  it('nao reenvia quando o provider respondeu mas persistir SENT falhou', async () => {
    let current = { ...dispatch };
    const prisma = {
      whatsAppDispatch: {
        findUnique: vi.fn(async () => current),
        updateMany: vi.fn(async () => {
          current = { ...current, status: 'PROCESSING' };
          return { count: 1 };
        }),
        update: vi.fn(async () => {
          throw new Error('database unavailable');
        }),
      },
    };
    const provider = new MockWhatsAppProvider();
    const service = createService(prisma, provider);

    await expect(service.sendDispatch('dispatch-1')).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    await expect(service.sendDispatch('dispatch-1')).rejects.toMatchObject({
      code: 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
    });
    expect(provider.sentMessages).toHaveLength(1);
    expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(1);
  });

  it('não reenvia dispatch SENT', async () => {
    const prisma = prismaMock({ ...dispatch, status: 'SENT' });
    const provider = new MockWhatsAppProvider();
    const result = await createService(prisma, provider).sendDispatch(
      'dispatch-1',
    );

    expect(result).toMatchObject({ status: 'SENT' });
    expect(provider.sentMessages).toHaveLength(0);
    expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
    expect(prisma.whatsAppDispatch.update).not.toHaveBeenCalled();
  });

  describe('Integração com CommercialMessageDraftService', () => {
    const mockCandidate = { id: 'candidate-123', productId: 'product-1', snapshotId: 'snap-1' };
    const commercialDispatch = {
      ...dispatch,
      generatedCopy: {
        ...dispatch.generatedCopy,
        createdFromCandidateId: 'candidate-123',
        promotionCandidates: [mockCandidate],
      },
    };

    it('usa draft com imagem se candidato válido e draft image for gerado', async () => {
      const prisma = prismaMock(commercialDispatch);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(() => ({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-123',
          warnings: [],
          caption: 'Draft caption',
          imageUrl: 'https://shopee.com/image.jpg',
          deliveryMode: 'IMAGE' as const,
        })),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await createService(prisma, provider, { draftService }).sendDispatch('dispatch-1');

      expect(draftService.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'candidate-123' })
      );
      expect(provider.sentMessages[0]).toMatchObject({
        message: 'Draft caption',
        imageUrl: 'https://shopee.com/image.jpg',
      });
      expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(1);
    });

    it('lança erro se zero candidato correspondente e interrompe fluxo', async () => {
      const dispatchSemCandidato = {
        ...commercialDispatch,
        generatedCopy: {
          ...commercialDispatch.generatedCopy,
          promotionCandidates: [],
        },
      };
      const prisma = prismaMock(dispatchSemCandidato);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await expect(
        createService(prisma, provider, { draftService }).sendDispatch('dispatch-1')
      ).rejects.toMatchObject({ code: 'COMMERCIAL_MESSAGE_RELATION_MISMATCH' });

      expect(draftService.createDraft).not.toHaveBeenCalled();
      expect(provider.sentMessages).toHaveLength(0);
      expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
    });

    it('lança erro se múltiplos candidatos correspondentes e interrompe fluxo', async () => {
      const dispatchComMultiplos = {
        ...commercialDispatch,
        generatedCopy: {
          ...commercialDispatch.generatedCopy,
          promotionCandidates: [mockCandidate, mockCandidate],
        },
      };
      const prisma = prismaMock(dispatchComMultiplos);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await expect(
        createService(prisma, provider, { draftService }).sendDispatch('dispatch-1')
      ).rejects.toMatchObject({ code: 'COMMERCIAL_MESSAGE_RELATION_MISMATCH' });

      expect(draftService.createDraft).not.toHaveBeenCalled();
      expect(provider.sentMessages).toHaveLength(0);
      expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
    });
    it('lança erro de draftService e interrompe fluxo (candidato inválido ou vencido)', async () => {
      const prisma = prismaMock(commercialDispatch);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(() => {
          throw new Error('COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED');
        }),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await expect(
        createService(prisma, provider, { draftService }).sendDispatch('dispatch-1')
      ).rejects.toMatchObject({ code: 'COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED' });

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'whatsapp.dispatch.draft_failed' }),
        'Failed to create commercial draft'
      );
      expect(provider.sentMessages).toHaveLength(0);
      expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
    });

    it('fluxo legado: envia apenas texto e não chama draftService se createdFromCandidateId for nulo', async () => {
      const dispatchLegado = {
        ...commercialDispatch,
        generatedCopy: {
          ...commercialDispatch.generatedCopy,
          createdFromCandidateId: null,
          promotionCandidates: [],
        },
      };
      const prisma = prismaMock(dispatchLegado);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await createService(prisma, provider, { draftService }).sendDispatch('dispatch-1');

      expect(draftService.createDraft).not.toHaveBeenCalled();
      expect(provider.sentMessages[0]).toMatchObject({
        message: expect.stringContaining(dispatchLegado.generatedCopy.titulo),
      });
      expect(provider.sentMessages[0]).not.toHaveProperty('imageUrl');
      expect(prisma.whatsAppDispatch.updateMany).toHaveBeenCalledTimes(1);
    });

    it('não usa imageUrl se draft disser deliveryMode=TEXT', async () => {
      const prisma = prismaMock(commercialDispatch);
      const provider = new MockWhatsAppProvider();
      const draftService = {
        createDraft: vi.fn(() => ({
          candidateId: 'candidate-123',
          generatedCopyId: 'copy-123',
          warnings: [],
          caption: 'Draft caption text',
          imageUrl: 'https://shopee.com/image.jpg',
          deliveryMode: 'TEXT' as const,
        })),
      } satisfies Pick<CommercialMessageDraftService, 'createDraft'>;

      await createService(prisma, provider, { draftService }).sendDispatch('dispatch-1');

      expect(provider.sentMessages[0]).toMatchObject({
        message: 'Draft caption text',
      });
      expect(provider.sentMessages[0]).not.toHaveProperty('imageUrl');
    });

    describe('Testes com CommercialMessageDraftService real', () => {
      const buildRealDispatch = () => {
        const now = new Date();
        return {
          id: 'dispatch-1',
          destinationId: 'dest-1',
          productId: 'product-1',
          generatedCopyId: 'copy-1',
          status: 'PENDING',
          destination: { type: 'INDIVIDUAL', destination: '11999999999' },
          product: { id: 'product-1', comissao: 0.2 },
          generatedCopy: {
            id: 'copy-1',
            productId: 'product-1',
            snapshotId: 'snap-1',
            createdFromCandidateId: 'candidate-1',
            titulo: 'Title',
            mensagem: 'Message',
            cta: 'CTA https://shope.ee/link',
            hashtags: '#hash',
            promotionCandidates: [
              {
                id: 'candidate-1',
                productId: 'product-1',
                snapshotId: 'snap-1',
                generatedCopyId: 'copy-1',
                status: 'COPY_READY',
                expiresAt: new Date(now.getTime() + 100000),
                product: {
                  id: 'product-1',
                  unavailableAt: null,
                  affiliateLink: 'https://shope.ee/link',
                  urlImagem: 'https://shopee.com/image.jpg',
                  commercialSnapshotRevision: 1,
                },
                snapshot: {
                  id: 'snap-1',
                  productId: 'product-1',
                  revision: 1,
                  unavailableAt: null,
                  offerEndsAt: null,
                },
              },
            ],
          },
        };
      };

      it('generatedCopy.productId diferente do produto gera erro de integridade de relação', async () => {
        const dispatchObj = buildRealDispatch();
        dispatchObj.generatedCopy.productId = 'other-product';
        const prisma = prismaMock(dispatchObj);
        const provider = new MockWhatsAppProvider();
        const draftService = new CommercialMessageDraftService();

        await expect(
          createService(prisma, provider, { draftService }).sendDispatch('dispatch-1')
        ).rejects.toMatchObject({ code: 'COMMERCIAL_MESSAGE_RELATION_MISMATCH' });

        expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
        expect(provider.sentMessages).toHaveLength(0);
      });

      it('generatedCopy.snapshotId diferente do snapshot gera erro de integridade de relação', async () => {
        const dispatchObj = buildRealDispatch();
        dispatchObj.generatedCopy.snapshotId = 'other-snap';
        const prisma = prismaMock(dispatchObj);
        const provider = new MockWhatsAppProvider();
        const draftService = new CommercialMessageDraftService();

        await expect(
          createService(prisma, provider, { draftService }).sendDispatch('dispatch-1')
        ).rejects.toMatchObject({ code: 'COMMERCIAL_MESSAGE_RELATION_MISMATCH' });

        expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
        expect(provider.sentMessages).toHaveLength(0);
      });

      it('candidato com expiresAt no passado gera AppError com código COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED', async () => {
        const dispatchObj = buildRealDispatch();
        dispatchObj.generatedCopy.promotionCandidates[0].expiresAt = new Date(Date.now() - 10000);
        const prisma = prismaMock(dispatchObj);
        const provider = new MockWhatsAppProvider();
        const draftService = new CommercialMessageDraftService();

        await expect(
          createService(prisma, provider, { draftService }).sendDispatch('dispatch-1')
        ).rejects.toMatchObject({ code: 'COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED' });

        expect(prisma.whatsAppDispatch.updateMany).not.toHaveBeenCalled();
        expect(provider.sentMessages).toHaveLength(0);
      });
    });
  });
});
