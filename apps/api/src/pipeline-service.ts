import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type { HunterProvider } from '@shopee-auto-affiliate-ai/providers';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import { CopyService } from './copy-service';
import { HunterService } from './hunter-service';
import { ScoreService } from './score-service';

export type PipelineRunResult = {
  produtosEncontrados: number;
  produtosPontuados: number;
  produtosAprovados: number;
  copiesGeradas: number;
  tempoExecucao: string;
};

export type PipelineApprovedProduct = {
  id: string;
  score: number | null;
};

export type PipelineServiceOptions = {
  prisma: Pick<DatabaseClient, 'productLead' | 'generatedCopy'>;
  hunterProvider: HunterProvider;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
};

const MIN_APPROVED_SCORE = 70;

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

      const produtosAprovados = await this.options.prisma.productLead.findMany({
        where: { score: { gte: MIN_APPROVED_SCORE } },
      });
      const copyService = new CopyService({
        prisma: this.options.prisma,
        logger: this.options.logger,
      });
      let copiesGeradas = 0;

      for (const produto of produtosAprovados) {
        await copyService.generate(produto.id);
        copiesGeradas += 1;
      }

      const resultado = {
        produtosEncontrados: hunter.encontrados,
        produtosPontuados: score.produtosProcessados,
        produtosAprovados: produtosAprovados.length,
        copiesGeradas,
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
