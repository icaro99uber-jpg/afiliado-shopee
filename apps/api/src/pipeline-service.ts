import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type { HunterProvider } from '@shopee-auto-affiliate-ai/providers';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import { HunterService, type HunterRunResult } from './hunter-service';
import { ScoreService, type ScoreRunResult } from './score-service';

export type PipelineRunResult = {
  hunter: HunterRunResult;
  score: ScoreRunResult;
  tempoExecucao: string;
};

export type PipelineServiceOptions = {
  prisma: DatabaseClient;
  hunterProvider: HunterProvider;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
};

export class PipelineService {
  constructor(private readonly options: PipelineServiceOptions) {}

  async run(filters?: ProductFilters): Promise<PipelineRunResult> {
    const inicio = Date.now();
    this.options.logger.info(
      { event: 'pipeline.run.started', filters },
      'Pipeline iniciado',
    );

    try {
      const hunter = await new HunterService({
        provider: this.options.hunterProvider,
        prisma: this.options.prisma,
        logger: this.options.logger,
      }).run(filters);
      const score = await new ScoreService({
        prisma: this.options.prisma,
        logger: this.options.logger,
      }).run();
      const resultado = {
        hunter,
        score,
        tempoExecucao: `${Date.now() - inicio}ms`,
      };

      this.options.logger.info(
        { event: 'pipeline.run.completed', ...resultado },
        'Pipeline concluído',
      );
      return resultado;
    } catch (error) {
      this.options.logger.error(
        { event: 'pipeline.run.failed', error },
        'Pipeline falhou',
      );
      throw error;
    }
  }
}
