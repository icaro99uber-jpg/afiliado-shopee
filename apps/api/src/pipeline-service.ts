import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type { HunterProvider } from '@shopee-auto-affiliate-ai/providers';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  JOB_NAMES,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import { HunterService } from './hunter-service';
import { ScoreService } from './score-service';
import { CopyService } from './copy-service';

export type PipelineRunResult = {
  produtosEncontrados: number;
  produtosPontuados: number;
  produtosAprovados: number;
  copiesGeradas: number;
  enviosEnfileirados: number;
  tempoExecucao: string;
};

type DispatchQueue = {
  add: (
    name: string,
    data: WhatsAppDispatchJob,
    opts?: unknown,
  ) => Promise<unknown>;
};

type PipelineServiceOptions = {
  provider: HunterProvider;
  prisma: DatabaseClient;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  hunterService?: Pick<HunterService, 'run'>;
  scoreService?: Pick<ScoreService, 'run'>;
  copyService?: Pick<CopyService, 'generate'>;
  whatsappDispatchQueue?: DispatchQueue;
};

const isUniqueConstraintError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

export class PipelineService {
  constructor(private readonly options: PipelineServiceOptions) {}

  async run(filters?: ProductFilters): Promise<PipelineRunResult> {
    const inicio = Date.now();
    this.options.logger.info(
      { event: 'pipeline.run.started', filters },
      'Pipeline started',
    );

    try {
      const hunter =
        this.options.hunterService ??
        new HunterService({
          provider: this.options.provider,
          prisma: this.options.prisma,
          logger: this.options.logger,
        });
      const score =
        this.options.scoreService ??
        new ScoreService({
          prisma: this.options.prisma,
          logger: this.options.logger,
        });
      const copy =
        this.options.copyService ??
        new CopyService({
          prisma: this.options.prisma,
          logger: this.options.logger,
        });

      const hunterResult = await hunter.run(filters);
      const scoreResult = await score.run();
      const approvedProducts = await this.options.prisma.productLead.findMany({
        where: { score: { gte: 70 } },
      });
      const activeDestinations = this.options.prisma.whatsAppDestination
        ? await this.options.prisma.whatsAppDestination.findMany({
            where: { active: true },
          })
        : [];

      let copiesGeradas = 0;
      let enviosEnfileirados = 0;

      for (const product of approvedProducts) {
        const generatedCopy = (await copy.generate(product.id)) as {
          id: string;
        };
        copiesGeradas += 1;

        for (const destination of activeDestinations) {
          try {
            if (!this.options.prisma.whatsAppDispatch) continue;
            const dispatch = await this.options.prisma.whatsAppDispatch.create({
              data: {
                productId: product.id,
                generatedCopyId: generatedCopy.id,
                destinationId: destination.id,
                status: 'PENDING',
              },
            });
            await this.options.whatsappDispatchQueue?.add(
              JOB_NAMES.whatsappDispatch,
              { dispatchId: dispatch.id },
            );
            enviosEnfileirados += 1;
          } catch (error) {
            if (isUniqueConstraintError(error)) {
              this.options.logger.info(
                {
                  event: 'pipeline.dispatch.duplicate',
                  generatedCopyId: generatedCopy.id,
                  destinationId: destination.id,
                },
                'Duplicate WhatsApp dispatch skipped',
              );
              continue;
            }
            throw error;
          }
        }
      }

      const result = {
        produtosEncontrados: hunterResult.encontrados,
        produtosPontuados: scoreResult.produtosProcessados,
        produtosAprovados: approvedProducts.length,
        copiesGeradas,
        enviosEnfileirados,
        tempoExecucao: `${Date.now() - inicio}ms`,
      };
      this.options.logger.info(
        { event: 'pipeline.run.completed', ...result },
        'Pipeline completed',
      );
      return result;
    } catch (error) {
      this.options.logger.error(
        { event: 'pipeline.run.failed', error },
        'Pipeline failed',
      );
      if (error instanceof AppError) throw error;
      throw error;
    }
  }
}
