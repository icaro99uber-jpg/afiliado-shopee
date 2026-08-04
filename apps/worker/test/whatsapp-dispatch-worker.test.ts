import { describe, expect, it, vi } from 'vitest';
import { processWhatsAppDispatchJob, type WhatsAppDispatchProcessorOptions } from '../src/whatsapp-dispatch-worker';
import { JOB_NAMES, type WhatsAppDispatchJob } from '@shopee-auto-affiliate-ai/queue';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import type { WhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import type { CommercialMessageDraftService } from '../../api/src/commercial-message-draft-service';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

vi.mock('@shopee-auto-affiliate-ai/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shopee-auto-affiliate-ai/database')>();
  return {
    ...actual,
    createPrismaClient: vi.fn(),
  };
});

describe('processWhatsAppDispatchJob', () => {
  it('dispatch comercial recebe draftService sem COMMERCIAL_MESSAGE_DRAFT_SERVICE_UNAVAILABLE e chama provider uma vez para draft IMAGE', async () => {
    const fakeCopy = {
      id: 'copy-123',
      createdFromCandidateId: 'candidate-123',
      titulo: 'Title',
      mensagem: 'Message',
      cta: 'Buy now',
      hashtags: '#sale',
      createdAt: new Date(),
      productId: 'prod-123',
      snapshotId: 'snap-123',
      promotionCandidates: [{ id: 'candidate-123', status: 'COPY_READY' }],
    };
    
    const fakeDestination = {
      id: 'dest-123',
      destination: '5511999999999',
      available: true,
      active: true,
    };
    
    const fakeDispatch = {
      id: 'dispatch-123',
      generatedCopyId: 'copy-123',
      destinationId: 'dest-123',
      status: 'PENDING',
      attempts: 0,
      generatedCopy: fakeCopy,
      destination: fakeDestination,
    };

    const prismaMock = {
      whatsAppDispatch: {
        findUnique: vi.fn().mockResolvedValue(fakeDispatch),
        update: vi.fn().mockResolvedValue(fakeDispatch),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findByIdWithDetails: vi.fn().mockResolvedValue(fakeDispatch),
      },
      generatedCopy: {
        findUnique: vi.fn().mockResolvedValue(fakeCopy),
      },
      commercialPromotionCandidate: {
        findUnique: vi.fn().mockResolvedValue({ status: 'COPY_READY' }),
      },
      whatsAppDestination: {
        findUnique: vi.fn().mockResolvedValue(fakeDestination),
      },
      $transaction: vi.fn((cb) => cb(prismaMock)),
    } as unknown as ReturnType<typeof createPrismaClient>;

    const fakeJob = {
      id: 'job-123',
      name: JOB_NAMES.whatsappDispatch,
      data: { dispatchId: 'dispatch-123' },
    };

    const whatsAppProvider: WhatsAppProvider = {
      sendMessage: vi.fn().mockResolvedValue({
        status: 'sent',
        externalMessageId: 'ext-123',
        sentAt: new Date(),
      }),
    };

    const draftService: Pick<CommercialMessageDraftService, 'createDraft'> = {
      createDraft: vi.fn().mockReturnValue({
        candidateId: 'candidate-123',
        generatedCopyId: 'copy-123',
        caption: 'draft text',
        deliveryMode: 'IMAGE',
        imageUrl: 'http://image',
        warnings: [],
      }),
    };

    const logger = { info: vi.fn(), error: vi.fn() };

    await processWhatsAppDispatchJob(fakeJob as any, {
      prisma: prismaMock,
      whatsAppProvider,
      logger,
      draftService,
    });

    expect(draftService.createDraft).toHaveBeenCalledOnce();
    expect(whatsAppProvider.sendMessage).toHaveBeenCalledOnce();
    expect(whatsAppProvider.sendMessage).toHaveBeenCalledWith({
      destination: '5511999999999',
      message: 'draft text',
      imageUrl: 'http://image',
    });
  });

  it('falha na criacao do draft nao chama o provider e falha sem tentativas adicionais', async () => {
    const fakeCopy = {
      id: 'copy-123',
      createdFromCandidateId: 'candidate-123',
      titulo: 'Title',
      mensagem: 'Message',
      cta: 'Buy now',
      hashtags: '#sale',
      createdAt: new Date(),
      productId: 'prod-123',
      snapshotId: 'snap-123',
      promotionCandidates: [{ id: 'candidate-123', status: 'COPY_READY' }],
    };
    
    const fakeDestination = {
      id: 'dest-123',
      available: true,
      active: true,
    };
    
    const fakeDispatch = {
      id: 'dispatch-123',
      generatedCopyId: 'copy-123',
      destinationId: 'dest-123',
      status: 'PENDING',
      attempts: 0,
      generatedCopy: fakeCopy,
      destination: fakeDestination,
    };

    const prismaMock = {
      whatsAppDispatch: {
        findUnique: vi.fn().mockResolvedValue(fakeDispatch),
        update: vi.fn().mockResolvedValue(fakeDispatch),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findByIdWithDetails: vi.fn().mockResolvedValue(fakeDispatch),
      },
      generatedCopy: {
        findUnique: vi.fn().mockResolvedValue(fakeCopy),
      },
      commercialPromotionCandidate: {
        findUnique: vi.fn().mockResolvedValue({ status: 'COPY_READY' }),
      },
      whatsAppDestination: {
        findUnique: vi.fn().mockResolvedValue(fakeDestination),
      },
      $transaction: vi.fn((cb) => cb(prismaMock)),
    } as unknown as ReturnType<typeof createPrismaClient>;

    const fakeJob = {
      id: 'job-123',
      name: JOB_NAMES.whatsappDispatch,
      data: { dispatchId: 'dispatch-123' },
    };

    const whatsAppProvider: WhatsAppProvider = {
      sendMessage: vi.fn(),
    };

    const draftService: Pick<CommercialMessageDraftService, 'createDraft'> = {
      createDraft: vi.fn().mockImplementation(() => { throw new AppError('Draft failure', 'DRAFT_ERROR') }),
    };

    const logger = { info: vi.fn(), error: vi.fn() };

    await expect(
      processWhatsAppDispatchJob(fakeJob as any, {
        prisma: prismaMock,
        whatsAppProvider,
        logger,
        draftService,
      })
    ).rejects.toThrow('Falha ao montar mensagem');

    expect(draftService.createDraft).toHaveBeenCalledOnce();
    expect(whatsAppProvider.sendMessage).not.toHaveBeenCalled();
  });
});
