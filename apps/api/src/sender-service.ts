import type { FastifyBaseLogger } from 'fastify';
import {
  WhatsAppSendError,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type {
  WhatsAppDispatchRepository,
  WhatsAppDispatchRecord,
  WhatsAppDispatchStatus,
} from './repositories';
import type { WhatsAppGroupSendPolicy } from './whatsapp-group-send-policy';

import type { CommercialMessageDraftService } from './commercial-message-draft-service';
import type { CommercialPromotionCandidateRepository } from './repositories';

export type SenderServiceOptions = {
  dispatches: WhatsAppDispatchRepository;
  provider: WhatsAppProvider;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  messageBuilder?: (copy: DispatchWithRelations['generatedCopy']) => string;
  draftService?: CommercialMessageDraftService;
  candidateRepository?: Pick<CommercialPromotionCandidateRepository, 'findCandidateForDraft'>;
  groupSendPolicy?: WhatsAppGroupSendPolicy;
};

type DispatchWithRelations = {
  id: string;
  productId: string;
  generatedCopyId: string;
  destinationId: string;
  generatedCopy: {
    titulo: string;
    mensagem: string;
    cta: string;
    hashtags: string;
    createdFromCandidateId?: string | null;
  };
  destination: {
    destination: string;
    type?: 'INDIVIDUAL' | 'GROUP';
    active?: boolean;
    available?: boolean;
    fingerprint?: string | null;
    sourceInstanceName?: string | null;
  };
  product?: { comissao?: number | null } | null;
  status: WhatsAppDispatchStatus;
  attemptCount: number;
};

const providerErrorCode = (error: unknown) =>
  error instanceof AppError ? error.code : undefined;

export const buildWhatsAppPublicMessage = (copy: {
  titulo: string;
  mensagem: string;
  cta: string;
  hashtags: string;
}) =>
  [copy.titulo, copy.mensagem, copy.cta, copy.hashtags]
    .filter(Boolean)
    .join('\n\n');

export class SenderService {
  constructor(private readonly options: SenderServiceOptions) {}

  async sendDispatch(dispatchId: string): Promise<WhatsAppDispatchRecord> {
    this.options.logger.info(
      { event: 'whatsapp.dispatch.started', dispatchId },
      'WhatsApp dispatch started',
    );

    const dispatch = (await this.options.dispatches.findByIdForSending(
      dispatchId,
    )) as DispatchWithRelations | null;

    if (!dispatch) {
      throw new AppError(
        'Envio WhatsApp não encontrado',
        'WHATSAPP_DISPATCH_NOT_FOUND',
      );
    }

    if (dispatch.status === 'SENT') return dispatch;

    if (dispatch.status !== 'PENDING') {
      throw new AppError(
        'Dispatch sem permissao para envio automatico',
        dispatch.status === 'PROCESSING'
          ? 'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS'
          : 'WHATSAPP_DISPATCH_RETRY_REQUIRES_MANUAL_REVIEW',
      );
    }

    let message: string;
    let imageUrl: string | undefined;
    let deliveryMode: 'TEXT' | 'IMAGE' = 'TEXT';

    const candidateId = dispatch.generatedCopy.createdFromCandidateId;

    if (candidateId && this.options.draftService && this.options.candidateRepository) {
      const candidate = await this.options.candidateRepository.findCandidateForDraft(candidateId);
      if (candidate) {
        try {
          const draft = this.options.draftService.createDraft(candidate);
          message = draft.caption;
          if (draft.deliveryMode === 'IMAGE' && draft.imageUrl) {
            imageUrl = draft.imageUrl;
            deliveryMode = 'IMAGE';
          }
        } catch (error) {
          this.options.logger.error(
            { event: 'whatsapp.dispatch.draft_failed', dispatchId, errorType: error instanceof Error ? error.name : 'UnknownError' },
            'Failed to create commercial draft',
          );
          message = this.options.messageBuilder
            ? this.options.messageBuilder(dispatch.generatedCopy)
            : buildWhatsAppPublicMessage(dispatch.generatedCopy);
        }
      } else {
        message = this.options.messageBuilder
          ? this.options.messageBuilder(dispatch.generatedCopy)
          : buildWhatsAppPublicMessage(dispatch.generatedCopy);
      }
    } else {
      message = this.options.messageBuilder
        ? this.options.messageBuilder(dispatch.generatedCopy)
        : buildWhatsAppPublicMessage(dispatch.generatedCopy);
    }

    if (dispatch.destination.type === 'GROUP') {
      if (!this.options.groupSendPolicy) {
        throw new AppError(
          'Politica de envio para grupos nao configurada',
          'WHATSAPP_GROUP_POLICY_REQUIRED',
        );
      }
      this.options.groupSendPolicy.assertAuthorized(
        dispatch.destination as Parameters<
          WhatsAppGroupSendPolicy['assertAuthorized']
        >[0],
      );
    }

    const claimed = await this.options.dispatches.markAttemptPending(
      dispatch.id,
    );
    if (!claimed) {
      throw new AppError(
        'Dispatch ja adquirido por outro processamento',
        'WHATSAPP_DISPATCH_ALREADY_CLAIMED',
      );
    }

    try {
      const result = await this.options.provider.sendMessage({
        destination: dispatch.destination.destination,
        message,
        ...(imageUrl && deliveryMode === 'IMAGE' ? { imageUrl } : {}),
        ...(dispatch.destination.type === 'GROUP'
          ? { destinationType: 'GROUP' as const }
          : {}),
      });

      const updated = await this.options.dispatches.markSent(dispatch.id, {
        externalMessageId: result.externalMessageId,
        sentAt: result.sentAt,
      });

      this.options.logger.info(
        {
          event: 'whatsapp.dispatch.sent',
          dispatchId,
        },
        'WhatsApp dispatch sent',
      );
      return updated;
    } catch (error) {
      if (
        error instanceof WhatsAppSendError &&
        !error.deliveryMayHaveStarted
      ) {
        try {
          await this.options.dispatches.markFailed(
            dispatch.id,
            'Envio bloqueado antes do request externo',
          );
        } catch (persistenceError) {
          this.options.logger.error(
            {
              event: 'whatsapp.dispatch.preflight-persistence-failed',
              dispatchId,
              errorType:
                persistenceError instanceof Error
                  ? persistenceError.name
                  : 'UnknownError',
            },
            'WhatsApp dispatch preflight failure could not be persisted',
          );
          throw new AppError(
            'Estado do dispatch incerto; revisao manual obrigatoria',
            'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
          );
        }
        this.options.logger.error(
          {
            event: 'whatsapp.dispatch.blocked-before-request',
            dispatchId,
            providerErrorCode: error.code,
          },
          'WhatsApp dispatch blocked before external request',
        );
        throw error;
      }
      this.options.logger.error(
        {
          event: 'whatsapp.dispatch.delivery-ambiguous',
          dispatchId,
          errorType: error instanceof Error ? error.name : 'UnknownError',
          providerErrorCode: providerErrorCode(error),
        },
        'WhatsApp dispatch delivery is ambiguous',
      );
      throw new AppError(
        'Resultado do envio incerto; revisao manual obrigatoria',
        'WHATSAPP_DISPATCH_DELIVERY_AMBIGUOUS',
      );
    }
  }
}
