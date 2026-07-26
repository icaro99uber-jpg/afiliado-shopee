import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import type { CommercialCopyGenerator } from './commercial-copy-service';
import { isCommercialAuthorizedGroup } from './commercial-group-selection';
import { commercialProductRejections } from './commercial-pipeline-service';
import type {
  CommercialDeliveryHistoryRepository,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  GeneratedCopyRepository,
  ShopeeOfferRepository,
  WhatsAppDispatchRepository,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupRecord,
} from './repositories';

export const COMMERCIAL_CONFIRMATION_TOKEN = 'CONFIRMAR_ENVIO_COMERCIAL';

export const commercialConfirmationIds = (dryRunId: string) => ({
  copyId: `commercial-${dryRunId}-copy`,
  dispatchId: `commercial-${dryRunId}-dispatch`,
  jobId: `commercial-${dryRunId}-job`,
});

export type CommercialConfirmationQueue = {
  hasJob(jobId: string): Promise<boolean>;
  enqueue(dispatchId: string, jobId: string): Promise<void>;
};

export type CommercialConfirmationEnvironment = {
  groupSendEnabled: boolean;
  safeMode: boolean;
  schedulerEnabled: boolean;
  maximumMessagesPerRun: number;
};

export type CommercialPipelineConfirmationResult = {
  runId: string;
  mode: 'confirmed';
  status: 'queued';
  selectedProduct: { name: string; price: string };
  selectedGroup: { name: string; fingerprint: string };
  copyPreview: string;
  dispatchWasCreated: true;
  jobWasCreated: true;
  messageWasSent: false;
  dispatchStatus: 'pending';
  attemptCount: 0;
  externalMessageIdRecorded: false;
  investigationRequired: false;
};

export type CommercialPipelineConfirmationServiceOptions = {
  runs: CommercialPipelineRunRepository;
  offers: ShopeeOfferRepository;
  groups: WhatsAppGroupDirectoryRepository;
  generatedCopies: GeneratedCopyRepository;
  dispatches: WhatsAppDispatchRepository;
  deliveryHistory: CommercialDeliveryHistoryRepository;
  copy: CommercialCopyGenerator;
  queue: CommercialConfirmationQueue;
  instanceName: string;
  environment: CommercialConfirmationEnvironment;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  clock?: () => Date;
};

const changed = (message: string, code: string): never => {
  throw new AppError(message, code);
};

const assertEnvironment = (environment: CommercialConfirmationEnvironment) => {
  if (!environment.groupSendEnabled) {
    changed(
      'Envio comercial para grupos esta desativado',
      'GROUP_SEND_DISABLED',
    );
  }
  if (!environment.safeMode) {
    changed(
      'Safe mode e obrigatorio para envio comercial',
      'COMMERCIAL_SAFE_MODE_REQUIRED',
    );
  }
  if (environment.schedulerEnabled) {
    changed(
      'Scheduler deve permanecer desativado',
      'COMMERCIAL_SCHEDULER_BLOCKED',
    );
  }
  if (environment.maximumMessagesPerRun !== 1) {
    changed(
      'O limite comercial deve ser exatamente uma mensagem',
      'COMMERCIAL_MESSAGE_LIMIT_INVALID',
    );
  }
};

const assertReadyRun = (run: CommercialPipelineRunRecord | null) => {
  if (!run) {
    return changed(
      'Dry-run comercial nao esta pronto',
      'COMMERCIAL_RUN_NOT_READY',
    );
  }
  if (
    run.mode === 'CONFIRMED' ||
    run.confirmedAt ||
    run.dispatchId ||
    run.jobId
  ) {
    return changed(
      'Dry-run comercial ja possui confirmacao ou tentativa anterior',
      'COMMERCIAL_RUN_ALREADY_CONFIRMED',
    );
  }
  if (
    run.mode !== 'DRY_RUN' ||
    run.status !== 'COMPLETED' ||
    !run.productId ||
    !run.groupDestinationId ||
    !run.productName ||
    !run.productPrice ||
    !run.groupName ||
    !run.groupFingerprint ||
    !run.copyPreview
  ) {
    return changed(
      'Dry-run comercial nao esta pronto',
      'COMMERCIAL_RUN_NOT_READY',
    );
  }
  return run as CommercialPipelineRunRecord & {
    productId: string;
    groupDestinationId: string;
    productName: string;
    productPrice: string;
    groupName: string;
    groupFingerprint: string;
    copyPreview: string;
  };
};

export class CommercialPipelineConfirmationService {
  private readonly clock: () => Date;

  constructor(
    private readonly options: CommercialPipelineConfirmationServiceOptions,
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async confirm(
    dryRunId: string,
    confirmation: string,
  ): Promise<CommercialPipelineConfirmationResult> {
    if (confirmation !== COMMERCIAL_CONFIRMATION_TOKEN) {
      changed(
        'Confirmacao comercial invalida',
        'COMMERCIAL_CONFIRMATION_INVALID',
      );
    }
    assertEnvironment(this.options.environment);

    const initial = assertReadyRun(await this.options.runs.findById(dryRunId));
    const ids = commercialConfirmationIds(dryRunId);
    const [existingCopy, existingDispatch, existingJob] = await Promise.all([
      this.options.generatedCopies.findById(ids.copyId),
      this.options.dispatches.findByIdWithDetails(ids.dispatchId),
      this.options.queue.hasJob(ids.jobId),
    ]);
    if (existingCopy || existingDispatch || existingJob) {
      changed(
        'Existe estado anterior para este dry-run',
        'COMMERCIAL_RUN_ALREADY_CONFIRMED',
      );
    }

    const confirmedAt = this.clock();
    const claimed = await this.options.runs.claimConfirmation(
      initial.id,
      confirmedAt,
    );
    if (!claimed) {
      return changed(
        'Dry-run comercial ja foi confirmado',
        'COMMERCIAL_RUN_ALREADY_CONFIRMED',
      );
    }

    let dispatchCreated = false;
    let queueAttempted = false;
    try {
      const run = initial;
      const product = await this.options.offers.findOfferById(run.productId);
      if (
        !product ||
        !['MOCK', 'MANUAL'].includes(product.source) ||
        commercialProductRejections(product, this.clock()).length > 0 ||
        product.productName !== run.productName ||
        product.price !== run.productPrice ||
        !product.affiliateLink ||
        !run.copyPreview.includes(product.affiliateLink)
      ) {
        return changed(
          'Produto mudou desde o dry-run',
          'COMMERCIAL_PRODUCT_CHANGED',
        );
      }
      const currentCopy = this.options.copy.generate({
        productName: product.productName,
        price: product.price,
        discountRate: product.discountRate,
        shopName: product.shopName,
        affiliateLink: product.affiliateLink,
      });
      if (currentCopy !== run.copyPreview) {
        return changed(
          'Produto ou link mudou desde o dry-run',
          'COMMERCIAL_PRODUCT_CHANGED',
        );
      }

      const groups = (
        await this.options.groups.list(this.options.instanceName, {
          active: true,
          available: true,
        })
      ).filter((group): group is WhatsAppGroupRecord =>
        isCommercialAuthorizedGroup(group, this.options.instanceName),
      );
      const group = groups[0];
      if (
        groups.length !== 1 ||
        !group ||
        group.id !== run.groupDestinationId ||
        group.name !== run.groupName ||
        group.fingerprint !== run.groupFingerprint
      ) {
        return changed(
          'Grupo mudou desde o dry-run',
          'COMMERCIAL_GROUP_CHANGED',
        );
      }
      if (
        await this.options.deliveryHistory.wasProductSentToGroup(
          run.productId,
          group.id,
        )
      ) {
        return changed(
          'Produto ja foi enviado ao grupo',
          'PRODUCT_ALREADY_SENT',
        );
      }

      await this.options.generatedCopies.create({
        id: ids.copyId,
        productId: run.productId,
        titulo: '',
        mensagem: run.copyPreview,
        cta: '',
        hashtags: '',
      });
      const dispatch = await this.options.dispatches.createPending({
        id: ids.dispatchId,
        productId: run.productId,
        generatedCopyId: ids.copyId,
        destinationId: group.id,
      });
      if (!dispatch) {
        return changed(
          'Dispatch comercial nao pode ser criado',
          'COMMERCIAL_DISPATCH_FAILED',
        );
      }
      dispatchCreated = true;
      await this.options.runs.update(run.id, {
        dispatchId: ids.dispatchId,
        finalStatus: 'PENDING',
      });

      queueAttempted = true;
      await this.options.queue.enqueue(ids.dispatchId, ids.jobId);
      await this.options.runs.update(run.id, {
        jobId: ids.jobId,
        finalStatus: 'PENDING',
        investigationRequired: false,
      });
      this.options.logger.info(
        {
          event: 'commercial-pipeline.confirmed.queued',
          runId: run.id,
          groupFingerprint: group.fingerprint,
        },
        'Commercial pipeline confirmation queued',
      );
      return {
        runId: run.id,
        mode: 'confirmed',
        status: 'queued',
        selectedProduct: { name: run.productName, price: run.productPrice },
        selectedGroup: {
          name: run.groupName,
          fingerprint: run.groupFingerprint,
        },
        copyPreview: run.copyPreview,
        dispatchWasCreated: true,
        jobWasCreated: true,
        messageWasSent: false,
        dispatchStatus: 'pending',
        attemptCount: 0,
        externalMessageIdRecorded: false,
        investigationRequired: false,
      };
    } catch (error) {
      const safeCode =
        error instanceof AppError &&
        [
          'COMMERCIAL_PRODUCT_CHANGED',
          'COMMERCIAL_GROUP_CHANGED',
          'PRODUCT_ALREADY_SENT',
          'COMMERCIAL_DISPATCH_FAILED',
        ].includes(error.code)
          ? error.code
          : 'COMMERCIAL_DISPATCH_FAILED';
      const investigationRequired = dispatchCreated || queueAttempted;
      await this.options.runs.update(initial.id, {
        status: 'FAILED',
        failureCode: safeCode,
        finalStatus: investigationRequired ? 'AMBIGUOUS' : null,
        investigationRequired,
        completedAt: this.clock(),
      });
      this.options.logger.error(
        {
          event: 'commercial-pipeline.confirmed.failed',
          runId: initial.id,
          code: safeCode,
          investigationRequired,
        },
        'Commercial pipeline confirmation failed',
      );
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Falha segura ao confirmar pipeline comercial',
        'COMMERCIAL_DISPATCH_FAILED',
      );
    }
  }

  async markInvestigationRequired(runId: string) {
    const run = await this.options.runs.findById(runId);
    if (!run || run.mode !== 'CONFIRMED') return;
    await this.options.runs.update(runId, {
      status: 'FAILED',
      finalStatus: 'AMBIGUOUS',
      failureCode: 'COMMERCIAL_DISPATCH_FAILED',
      investigationRequired: true,
      completedAt: this.clock(),
    });
  }
}
