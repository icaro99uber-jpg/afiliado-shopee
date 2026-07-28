import type { AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  MockShopeeAffiliateOfferProvider,
  OfficialShopeeAffiliateOfferProvider,
} from '@shopee-auto-affiliate-ai/providers';

import {
  createCommercialAutomationPolicyService,
  createCommercialPipelineConfirmationService,
  createCommercialPipelineService,
  createPrismaRepositories,
} from '../../api/src/application-services';
import { CommercialAutomationOrchestrator } from '../../api/src/commercial-automation-orchestrator';
import type { CommercialDispatchOutboxQueue } from '../../api/src/commercial-dispatch-outbox-publisher';
import { ScoreService } from '../../api/src/score-service';
import { ShopeeOfferSyncService } from '../../api/src/shopee-offer-sync-service';

export type CommercialAutomationRuntimeLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

export const commercialAutomationConsoleLogger: CommercialAutomationRuntimeLogger =
  {
    info: (obj, message) => console.info(message, obj),
    error: (obj, message) => console.error(message, obj),
  };

const manualCatalogSync = {
  async run() {
    return {
      source: 'manual' as const,
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      expired: 0,
    };
  },
};

export const createCommercialAutomationOrchestratorRuntime = (
  config: AppEnv,
  options: {
    prisma?: ReturnType<typeof createPrismaClient>;
    logger?: CommercialAutomationRuntimeLogger;
    confirmationQueue?: CommercialDispatchOutboxQueue;
  } = {},
) => {
  const prisma = options.prisma ?? createPrismaClient();
  const logger = options.logger ?? commercialAutomationConsoleLogger;
  const repositories = createPrismaRepositories(prisma);
  const score = new ScoreService({ products: repositories.products, logger });
  const pipeline = createCommercialPipelineService({
    repositories,
    score,
    instanceName: config.EVOLUTION_INSTANCE_NAME ?? 'affiliate-bot',
    subIdPrefix: config.SHOPEE_AFFILIATE_SUB_ID_PREFIX,
    maximumCopyLength: config.COMMERCIAL_COPY_MAX_LENGTH,
    logger,
  });
  const policy = createCommercialAutomationPolicyService({
    repositories,
    instanceName: config.EVOLUTION_INSTANCE_NAME ?? 'affiliate-bot',
    config: {
      enabled: config.COMMERCIAL_AUTOMATION_ENABLED,
      timezone: config.COMMERCIAL_TIMEZONE,
      allowedStartTime: config.COMMERCIAL_ALLOWED_START_TIME,
      allowedEndTime: config.COMMERCIAL_ALLOWED_END_TIME,
      dailyGlobalLimit: config.COMMERCIAL_DAILY_GLOBAL_LIMIT,
      dailyGroupLimit: config.COMMERCIAL_DAILY_GROUP_LIMIT,
      minimumIntervalMinutes: config.COMMERCIAL_MIN_INTERVAL_MINUTES,
    },
  });

  const syncOffers =
    config.SHOPEE_AFFILIATE_PROVIDER === 'manual'
      ? manualCatalogSync
      : new ShopeeOfferSyncService({
          provider:
            config.SHOPEE_AFFILIATE_PROVIDER === 'official'
              ? new OfficialShopeeAffiliateOfferProvider({
                  apiEnabled: config.SHOPEE_AFFILIATE_API_ENABLED,
                  apiUrl: config.SHOPEE_AFFILIATE_API_URL,
                  appId: config.SHOPEE_AFFILIATE_APP_ID,
                  secret: config.SHOPEE_AFFILIATE_SECRET,
                })
              : new MockShopeeAffiliateOfferProvider(),
          offers: repositories.shopeeOffers,
          maxOffersPerSync: config.SHOPEE_AFFILIATE_SYNC_LIMIT,
          logger,
        });

  const confirmation = options.confirmationQueue
    ? createCommercialPipelineConfirmationService({
        repositories,
        queue: options.confirmationQueue,
        instanceName: config.EVOLUTION_INSTANCE_NAME ?? 'affiliate-bot',
        maximumCopyLength: config.COMMERCIAL_COPY_MAX_LENGTH,
        environment: {
          groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
          safeMode: config.EVOLUTION_SAFE_MODE,
          schedulerEnabled: config.SCHEDULER_ENABLED,
          maximumMessagesPerRun: config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN,
        },
        logger,
      })
    : {
        async confirm(): Promise<never> {
          throw new Error('Confirmation is unavailable in preview runtime');
        },
      };

  return {
    orchestrator: new CommercialAutomationOrchestrator({
      policy,
      syncOffers,
      pipeline,
      confirmation,
      commercialRuns: repositories.commercialRuns,
      executions: repositories.commercialAutomationExecutions,
      logger,
      leaseSeconds: config.COMMERCIAL_EXECUTION_LEASE_SECONDS,
      heartbeatSeconds: config.COMMERCIAL_EXECUTION_HEARTBEAT_SECONDS,
    }),
    prisma,
    ownsPrisma: !options.prisma,
  };
};
