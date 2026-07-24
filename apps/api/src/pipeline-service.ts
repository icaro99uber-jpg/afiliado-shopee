import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type { HunterProvider } from '@shopee-auto-affiliate-ai/providers';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { CopyService } from './copy-service';
import { HunterService, type HunterRunResult } from './hunter-service';
import { ScoreService, type ScoreRunResult } from './score-service';

export type PipelineRunReport = {
  produtosEncontrados: number;
  produtosPontuados: number;
  produtosAprovados: number;
  copiesGeradas: number;
  tempoExecucao: string;
};

type PipelineLogger = Pick<FastifyBaseLogger, 'info' | 'error'>;

type PipelinePrisma = Pick<DatabaseClient, 'productLead' | 'generatedCopy'>;

export type PipelineServiceOptions = {
  provider: HunterProvider;
  prisma: PipelinePrisma;
  logger: PipelineLogger;
  hunterService?: Pick<HunterService, 'run'>;
  scoreService?: Pick<ScoreService, 'run'>;
  copyService?: Pick<CopyService, 'generate'>;
};

const APPROVAL_SCORE = 70;

export class PipelineService {
  private readonly hunterService: Pick<HunterService, 'run'>;
  private readonly scoreService: Pick<ScoreService, 'run'>;
  private readonly copyService: Pick<CopyService, 'generate'>;

  constructor(private readonly options: PipelineServiceOptions) {
    this.hunterService = options.hunterService ?? new HunterService(options);
    this.scoreService = options.scoreService ?? new ScoreService(options);
    this.copyService = options.copyService ?? new CopyService(options);
  }

  async run(filters?: ProductFilters): Promise<PipelineRunReport> {
    const inicio = Date.now();
    this.options.logger.info(
      { event: 'pipeline.run.started', filters },
      'Pipeline iniciado...',
    );

    try {
      this.options.logger.info(
        { event: 'pipeline.hunter.started' },
        'Hunter iniciado...',
      );
      const hunterResult: HunterRunResult =
        await this.hunterService.run(filters);
      this.options.logger.info(
        { event: 'pipeline.hunter.completed', ...hunterResult },
        'Hunter finalizado...',
      );

      this.options.logger.info(
        { event: 'pipeline.score.started' },
        'Score iniciado...',
      );
      const scoreResult: ScoreRunResult = await this.scoreService.run();
      this.options.logger.info(
        { event: 'pipeline.score.completed', ...scoreResult },
        'Score finalizado...',
      );

      const produtosAprovados = await this.options.prisma.productLead.findMany({
        where: { score: { gte: APPROVAL_SCORE } },
      });

      this.options.logger.info(
        {
          event: 'pipeline.products.approved',
          approvalScore: APPROVAL_SCORE,
          count: produtosAprovados.length,
        },
        'Produtos aprovados selecionados...',
      );

      this.options.logger.info(
        { event: 'pipeline.copy.started' },
        'Copy iniciado...',
      );
      let copiesGeradas = 0;
      for (const produto of produtosAprovados) {
        await this.copyService.generate(produto.id);
        copiesGeradas += 1;
      }
      this.options.logger.info(
        { event: 'pipeline.copy.completed', copiesGeradas },
        'Copy finalizado...',
      );

      const report = {
        produtosEncontrados: hunterResult.encontrados,
        produtosPontuados: scoreResult.produtosProcessados,
        produtosAprovados: produtosAprovados.length,
        copiesGeradas,
        tempoExecucao: `${Date.now() - inicio}ms`,
      };

      this.options.logger.info(
        { event: 'pipeline.run.completed', ...report },
        'Pipeline finalizado.',
      );
      return report;
    } catch (error) {
      this.options.logger.error(
        { event: 'pipeline.run.failed', error },
        'Pipeline failed',
      );
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Falha ao executar Pipeline Engine',
        'PIPELINE_RUN_FAILED',
      );
    }
  }
}
