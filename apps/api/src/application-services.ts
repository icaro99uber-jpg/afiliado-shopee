import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type {
  HunterProvider,
  ShopeeAffiliateOfferProvider,
  WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { MockShopeeAffiliateOfferProvider } from '@shopee-auto-affiliate-ai/providers';
import type { WhatsAppDispatchJob } from '@shopee-auto-affiliate-ai/queue';
import { HunterService } from './hunter-service';
import { ScoreService } from './score-service';
import { CopyService } from './copy-service';
import { SenderService } from './sender-service';
import { PipelineService } from './pipeline-service';
import { AnalyticsService } from './analytics-service';
import { ShopeeOfferSyncService } from './shopee-offer-sync-service';
import { CouponService } from './coupon-service';
import { CopyPreviewService } from './copy-preview-service';
import {
  PrismaAnalyticsRepository,
  PrismaCouponRepository,
  PrismaGeneratedCopyRepository,
  PrismaProductRepository,
  PrismaShopeeOfferRepository,
  PrismaWhatsAppDestinationRepository,
  PrismaWhatsAppDispatchRepository,
  PrismaWhatsAppGroupDirectoryRepository,
} from './prisma-repositories';
import type {
  AnalyticsRepository,
  CouponRepository,
  GeneratedCopyRepository,
  ProductRepository,
  ShopeeOfferRepository,
  WhatsAppDestinationRepository,
  WhatsAppDispatchRepository,
  WhatsAppGroupDirectoryRepository,
} from './repositories';
import type { WhatsAppGroupSendPolicy } from './whatsapp-group-send-policy';

type DispatchQueue = {
  add: (
    name: string,
    data: WhatsAppDispatchJob,
    opts?: unknown,
  ) => Promise<unknown>;
};

export type ApplicationRepositories = {
  analytics: AnalyticsRepository;
  products: ProductRepository;
  generatedCopies: GeneratedCopyRepository;
  whatsappDestinations: WhatsAppDestinationRepository;
  whatsappDispatches: WhatsAppDispatchRepository;
  whatsappGroups: WhatsAppGroupDirectoryRepository;
  shopeeOffers: ShopeeOfferRepository;
  coupons: CouponRepository;
};

export type ApplicationServices = {
  analytics: AnalyticsService;
  hunter: HunterService;
  score: ScoreService;
  copy: CopyService;
  sender?: SenderService;
  pipeline: PipelineService;
  shopeeOfferSync: ShopeeOfferSyncService;
  coupons: CouponService;
  copyPreview: CopyPreviewService;
};

export const createSenderService = ({
  repositories,
  whatsAppProvider,
  logger,
  messageBuilder,
  groupSendPolicy,
}: {
  repositories: Pick<ApplicationRepositories, 'whatsappDispatches'>;
  whatsAppProvider: WhatsAppProvider;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  messageBuilder?: ConstructorParameters<
    typeof SenderService
  >[0]['messageBuilder'];
  groupSendPolicy?: WhatsAppGroupSendPolicy;
}) =>
  new SenderService({
    dispatches: repositories.whatsappDispatches,
    provider: whatsAppProvider,
    logger,
    messageBuilder,
    groupSendPolicy,
  });

export const createPrismaRepositories = (
  prisma: DatabaseClient,
): ApplicationRepositories => ({
  analytics: new PrismaAnalyticsRepository(prisma),
  products: new PrismaProductRepository(prisma),
  generatedCopies: new PrismaGeneratedCopyRepository(prisma),
  whatsappDestinations: new PrismaWhatsAppDestinationRepository(prisma),
  whatsappDispatches: new PrismaWhatsAppDispatchRepository(prisma),
  whatsappGroups: new PrismaWhatsAppGroupDirectoryRepository(prisma),
  shopeeOffers: new PrismaShopeeOfferRepository(prisma),
  coupons: new PrismaCouponRepository(prisma),
});

export const createApplicationServices = ({
  repositories,
  hunterProvider,
  whatsAppProvider,
  whatsappDispatchQueue,
  logger,
  shopeeOfferProvider = new MockShopeeAffiliateOfferProvider(),
  shopeeMaxOffersPerSync = 20,
}: {
  repositories: ApplicationRepositories;
  hunterProvider: HunterProvider;
  whatsAppProvider?: WhatsAppProvider;
  whatsappDispatchQueue?: DispatchQueue;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  shopeeOfferProvider?: ShopeeAffiliateOfferProvider;
  shopeeMaxOffersPerSync?: number;
}): ApplicationServices => {
  const analytics = new AnalyticsService(repositories.analytics);
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
    ? createSenderService({ repositories, whatsAppProvider, logger })
    : undefined;
  const shopeeOfferSync = new ShopeeOfferSyncService({
    provider: shopeeOfferProvider,
    offers: repositories.shopeeOffers,
    maxOffersPerSync: shopeeMaxOffersPerSync,
    logger,
  });

  return {
    analytics,
    hunter,
    score,
    copy,
    sender,
    shopeeOfferSync,
    coupons: new CouponService(repositories.coupons),
    copyPreview: new CopyPreviewService(repositories.shopeeOffers),
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
