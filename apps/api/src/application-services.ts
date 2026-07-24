import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type {
  HunterProvider,
  WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import type { WhatsAppDispatchJob } from '@shopee-auto-affiliate-ai/queue';
import { HunterService } from './hunter-service';
import { ScoreService } from './score-service';
import { CopyService } from './copy-service';
import { SenderService } from './sender-service';
import { PipelineService } from './pipeline-service';
import {
  PrismaGeneratedCopyRepository,
  PrismaProductRepository,
  PrismaWhatsAppDestinationRepository,
  PrismaWhatsAppDispatchRepository,
} from './prisma-repositories';
import type {
  GeneratedCopyRepository,
  ProductRepository,
  WhatsAppDestinationRepository,
  WhatsAppDispatchRepository,
} from './repositories';

type DispatchQueue = {
  add: (
    name: string,
    data: WhatsAppDispatchJob,
    opts?: unknown,
  ) => Promise<unknown>;
};

export type ApplicationRepositories = {
  products: ProductRepository;
  generatedCopies: GeneratedCopyRepository;
  whatsappDestinations: WhatsAppDestinationRepository;
  whatsappDispatches: WhatsAppDispatchRepository;
};

export type ApplicationServices = {
  hunter: HunterService;
  score: ScoreService;
  copy: CopyService;
  sender?: SenderService;
  pipeline: PipelineService;
};

export const createPrismaRepositories = (
  prisma: DatabaseClient,
): ApplicationRepositories => ({
  products: new PrismaProductRepository(prisma),
  generatedCopies: new PrismaGeneratedCopyRepository(prisma),
  whatsappDestinations: new PrismaWhatsAppDestinationRepository(prisma),
  whatsappDispatches: new PrismaWhatsAppDispatchRepository(prisma),
});

export const createApplicationServices = ({
  repositories,
  hunterProvider,
  whatsAppProvider,
  whatsappDispatchQueue,
  logger,
}: {
  repositories: ApplicationRepositories;
  hunterProvider: HunterProvider;
  whatsAppProvider?: WhatsAppProvider;
  whatsappDispatchQueue?: DispatchQueue;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
}): ApplicationServices => {
  const hunter = new HunterService({
    provider: hunterProvider,
    products: repositories.products,
    logger,
  });
  const score = new ScoreService({ products: repositories.products, logger });
  const copy = new CopyService({
    products: repositories.products,
    generatedCopies: repositories.generatedCopies,
    logger,
  });
  const sender = whatsAppProvider
    ? new SenderService({
        dispatches: repositories.whatsappDispatches,
        provider: whatsAppProvider,
        logger,
      })
    : undefined;

  return {
    hunter,
    score,
    copy,
    sender,
    pipeline: new PipelineService({
      provider: hunterProvider,
      products: repositories.products,
      generatedCopies: repositories.generatedCopies,
      whatsappDestinations: repositories.whatsappDestinations,
      whatsappDispatches: repositories.whatsappDispatches,
      logger,
      hunterService: hunter,
      scoreService: score,
      copyService: copy,
      whatsappDispatchQueue,
    }),
  };
};
