import type { FastifyBaseLogger } from 'fastify';

import type {
  CommercialPipelineRunRepository,
  WhatsAppDispatchRecord,
} from './repositories';

export const finalizeCommercialPipelineRun = async ({
  runs,
  dispatch,
  failed,
  logger,
  clock = () => new Date(),
}: {
  runs: CommercialPipelineRunRepository;
  dispatch: WhatsAppDispatchRecord;
  failed: boolean;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  clock?: () => Date;
}) => {
  const run = await runs.findByDispatchId(dispatch.id);
  if (!run || run.mode !== 'CONFIRMED') return;

  if (run.investigationRequired) {
    logger.error(
      {
        event: 'commercial-pipeline.finalization.preserved-investigation',
        runId: run.id,
      },
      'Commercial pipeline investigation state preserved',
    );
    return;
  }

  const sent = !failed && dispatch.status === 'SENT';
  const failedSafely = dispatch.status === 'FAILED';
  await runs.update(run.id, {
    status: sent ? 'COMPLETED' : 'FAILED',
    finalStatus: sent ? 'SENT' : failedSafely ? 'FAILED' : 'AMBIGUOUS',
    failureCode: sent ? null : 'COMMERCIAL_DISPATCH_FAILED',
    investigationRequired: !sent,
    completedAt: clock(),
  });
  (sent ? logger.info : logger.error)(
    {
      event: sent
        ? 'commercial-pipeline.finalization.sent'
        : 'commercial-pipeline.finalization.failed',
      runId: run.id,
      dispatchStatus: dispatch.status,
      attemptCount: dispatch.attemptCount,
      investigationRequired: !sent,
    },
    sent
      ? 'Commercial pipeline dispatch sent'
      : 'Commercial pipeline dispatch requires investigation',
  );
};
