import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type { WhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

export type SenderServiceOptions = {
  prisma: Pick<DatabaseClient, 'whatsAppDispatch'>;
  provider: WhatsAppProvider;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
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
  destination: { destination: string };
  product?: { comissao?: number | null } | null;
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

    const dispatch = (await this.options.prisma.whatsAppDispatch.findUnique({
      where: { id: dispatchId },
      include: { generatedCopy: true, destination: true, product: true },
    })) as DispatchWithRelations | null;

    if (!dispatch) {
      throw new AppError(
        'Envio WhatsApp não encontrado',
        'WHATSAPP_DISPATCH_NOT_FOUND',
      );
    }

    const message = buildWhatsAppPublicMessage(dispatch.generatedCopy);

    try {
      await this.options.prisma.whatsAppDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: 'PENDING',
          attemptCount: { increment: 1 },
          errorMessage: null,
        },
      });

      const result = await this.options.provider.sendMessage({
        destination: dispatch.destination.destination,
        message,
      });

      const updated = await this.options.prisma.whatsAppDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: 'SENT',
          externalMessageId: result.externalMessageId,
          sentAt: result.sentAt,
          errorMessage: null,
        },
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
      await this.options.prisma.whatsAppDispatch.update({
        where: { id: dispatch.id },
        data: { status: 'FAILED', errorMessage: messageError },
      });
      this.options.logger.error(
        { event: 'whatsapp.dispatch.failed', dispatchId, error },
        'WhatsApp dispatch failed',
      );
      if (error instanceof AppError) throw error;
      throw error;
    }
  }
}
