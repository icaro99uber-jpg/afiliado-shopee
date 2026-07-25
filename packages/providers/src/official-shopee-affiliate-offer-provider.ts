import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type {
  ShopeeAffiliateOfferProvider,
  ShopeeProductOfferListInput,
  ShopeeProductOfferPage,
} from './shopee-affiliate-offers';

export type OfficialShopeeAffiliateRequest = {
  operation: 'productOfferV2';
  input: ShopeeProductOfferListInput;
};

export interface OfficialShopeeAffiliateTransport {
  execute(request: OfficialShopeeAffiliateRequest): Promise<unknown>;
}

export interface OfficialShopeeAffiliateSigner {
  sign(request: OfficialShopeeAffiliateRequest): Promise<unknown>;
}

export type OfficialShopeeAffiliateOfferProviderOptions = {
  apiEnabled?: boolean;
  apiUrl?: string;
  appId?: string;
  secret?: string;
  transport?: OfficialShopeeAffiliateTransport;
  signer?: OfficialShopeeAffiliateSigner;
};

export class OfficialShopeeAffiliateOfferProvider implements ShopeeAffiliateOfferProvider {
  readonly source = 'OFFICIAL' as const;

  constructor(
    private readonly options: OfficialShopeeAffiliateOfferProviderOptions = {},
  ) {}

  async listProductOffers(
    input: ShopeeProductOfferListInput = {},
  ): Promise<ShopeeProductOfferPage> {
    const configured =
      this.options.apiEnabled === true &&
      Boolean(this.options.apiUrl?.trim()) &&
      Boolean(this.options.appId?.trim()) &&
      Boolean(this.options.secret?.trim());

    if (!configured) {
      throw new AppError(
        'API oficial da Shopee ainda nao configurada',
        'SHOPEE_API_NOT_CONFIGURED',
      );
    }

    // Intencionalmente nao chama signer ou transport nesta fundacao. O formato
    // oficial de autenticacao e transporte sera implementado apenas apos a
    // liberacao das credenciais e da documentacao vinculada a conta.
    void input;
    throw new AppError(
      'Transporte oficial da Shopee aguarda documentacao da conta',
      'SHOPEE_API_TRANSPORT_PENDING',
    );
  }
}
