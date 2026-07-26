import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  EvolutionApiGroupDirectoryProvider,
  ManualShopeeAffiliateOfferProvider,
  MockShopeeAffiliateOfferProvider,
  OfficialShopeeAffiliateOfferProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { buildApp } from './app';

const start = async () => {
  const config = loadConfig();
  const groupDirectoryProvider =
    config.WHATSAPP_PROVIDER === 'evolution'
      ? new EvolutionApiGroupDirectoryProvider({
          baseUrl: config.EVOLUTION_API_URL as string,
          apiKey: config.EVOLUTION_API_KEY as string,
          instanceName: config.EVOLUTION_INSTANCE_NAME as string,
        })
      : undefined;
  const shopeeOfferProvider =
    config.SHOPEE_AFFILIATE_PROVIDER === 'official'
      ? new OfficialShopeeAffiliateOfferProvider({
          apiEnabled: config.SHOPEE_AFFILIATE_API_ENABLED,
          apiUrl: config.SHOPEE_AFFILIATE_API_URL,
          appId: config.SHOPEE_AFFILIATE_APP_ID,
          secret: config.SHOPEE_AFFILIATE_SECRET,
        })
      : config.SHOPEE_AFFILIATE_PROVIDER === 'manual'
        ? new ManualShopeeAffiliateOfferProvider()
        : new MockShopeeAffiliateOfferProvider();
  const app = await buildApp({
    redisUrl: config.REDIS_URL,
    schedulerEnabled: config.SCHEDULER_ENABLED,
    groupDirectoryProvider,
    groupInstanceName: config.EVOLUTION_INSTANCE_NAME,
    shopeeOfferProvider,
    shopeeMaxOffersPerSync: config.SHOPEE_AFFILIATE_SYNC_LIMIT,
    shopeeSubIdPrefix: config.SHOPEE_AFFILIATE_SUB_ID_PREFIX,
    commercialCopyMaxLength: config.COMMERCIAL_COPY_MAX_LENGTH,
    commercialConfirmationEnvironment: {
      groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
      safeMode: config.EVOLUTION_SAFE_MODE,
      schedulerEnabled: config.SCHEDULER_ENABLED,
      maximumMessagesPerRun: config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN,
    },
  });
  await app.listen({ host: '0.0.0.0', port: config.PORT });
};
void start();
