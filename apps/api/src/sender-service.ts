import type { FastifyBaseLogger } from 'fastify';
import type { WhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { WhatsAppDispatchRepository } from './repositories';
import type { WhatsAppGroupSendPolicy } from './whatsapp-group-send-policy';

export type SenderServiceOptions = {
  dispatches: WhatsAppDispatchRepository;
  provider: WhatsAppProvider;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  messageBuilder?: (copy: DispatchWithRelations['generatedCopy']) => string;
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
  status?: string;
};

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Falha desconhecida ao enviar WhatsApp';

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

  async sendDispatch(dispatchId: string) {
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

    const message = this.options.messageBuilder
      ? this.options.messageBuilder(dispatch.generatedCopy)
      : buildWhatsAppPublicMessage(dispatch.generatedCopy);

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

    try {
      await this.options.dispatches.markAttemptPending(dispatch.id);

      const result = await this.options.provider.sendMessage({
        destination: dispatch.destination.destination,
        message,
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
          externalMessageId: result.externalMessageId,
        },
        'WhatsApp dispatch sent',
      );
      return updated;
    } catch (error) {
      const messageError = errorMessage(error);
      await this.options.dispatches.markFailed(dispatch.id, messageError);
      this.options.logger.error(
        { event: 'whatsapp.dispatch.failed', dispatchId, error },
        'WhatsApp dispatch failed',
      );
      if (error instanceof AppError) throw error;
      throw error;
    }
  }
}
