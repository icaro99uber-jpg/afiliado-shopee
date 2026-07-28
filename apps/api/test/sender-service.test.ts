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

const createService = (
  prisma = prismaMock(),
  provider: WhatsAppProvider = new MockWhatsAppProvider(),
) =>
  new SenderService({
    dispatches: new PrismaWhatsAppDispatchRepository(prisma as never),
    provider,
    logger,
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
});
