import { describe, expect, it, vi } from 'vitest';
import { MockWhatsAppProvider } from '../../../packages/providers/src';
import {
  buildWhatsAppPublicMessage,
  SenderService,
} from '../src/sender-service';

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
};

const prismaMock = () => ({
  whatsAppDispatch: {
    findUnique: vi.fn(async () => dispatch),
    update: vi.fn(async ({ data }) => ({ ...dispatch, ...data })),
  },
});

describe('SenderService', () => {
  it('altera PENDING para SENT e incrementa attemptCount', async () => {
    const prisma = prismaMock();
    const result = await new SenderService({
      prisma: prisma as never,
      provider: new MockWhatsAppProvider(),
      logger,
    }).sendDispatch('dispatch-1');
    expect(prisma.whatsAppDispatch.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ attemptCount: { increment: 1 } }),
      }),
    );
    expect(result).toMatchObject({
      status: 'SENT',
      externalMessageId: 'mock-whatsapp-1',
      sentAt: expect.any(Date),
    });
  });

  it('altera PENDING para FAILED em erro e relança para retry do BullMQ', async () => {
    const prisma = prismaMock();
    const provider = new MockWhatsAppProvider();
    provider.simulateFailure('provider indisponível');
    await expect(
      new SenderService({
        prisma: prisma as never,
        provider,
        logger,
      }).sendDispatch('dispatch-1'),
    ).rejects.toThrow('provider indisponível');
    expect(prisma.whatsAppDispatch.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'provider indisponível',
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
});
