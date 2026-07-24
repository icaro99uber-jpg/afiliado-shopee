import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { ProductRepository } from './repositories';

export type ScorableProduct = {
  id: string;
  providerProductId?: string;
  nome: string;
  desconto: number;
  nota: number;
  vendidos: number;
  comissao: number;
  loja: string;
};

export type ScoreRunResult = {
  produtosProcessados: number;
  maiorScore: number;
  menorScore: number;
  mediaScore: number;
  tempoExecucao: string;
};

export type ScoreServiceOptions = {
  products: ProductRepository;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
};

const SCORE_WEIGHTS = {
  comissao: 0.35,
  avaliacoes: 0.25,
  vendidos: 0.2,
  desconto: 0.1,
  lojaOficial: 0.1,
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeCommissionPercent = (comissao: number) => {
  const percentual = comissao <= 1 ? comissao * 100 : comissao;
  return (clamp(percentual, 0, 20) / 20) * 100;
};

const normalizeOfficialStore = (loja: string) =>
  loja.toLocaleLowerCase('pt-BR').includes('oficial') ? 100 : 0;

export class ScoreService {
  constructor(private readonly options: ScoreServiceOptions) {}

  calculate(product: ScorableProduct): number {
    const componentes = {
      comissao: normalizeCommissionPercent(product.comissao),
      avaliacoes: (clamp(product.nota, 0, 5) / 5) * 100,
      vendidos: (clamp(product.vendidos, 0, 10000) / 10000) * 100,
      desconto: clamp(product.desconto, 0, 100),
      lojaOficial: normalizeOfficialStore(product.loja),
    };

    const score =
      componentes.comissao * SCORE_WEIGHTS.comissao +
      componentes.avaliacoes * SCORE_WEIGHTS.avaliacoes +
      componentes.vendidos * SCORE_WEIGHTS.vendidos +
      componentes.desconto * SCORE_WEIGHTS.desconto +
      componentes.lojaOficial * SCORE_WEIGHTS.lojaOficial;

    return Math.round(clamp(score, 0, 100));
  }

  async run(): Promise<ScoreRunResult> {
    const inicio = Date.now();
    this.options.logger.info({ event: 'score.run.started' }, 'Score execution started');

    try {
      const produtos = await this.options.products.listForScoring();
      const scores: number[] = [];

      for (const produto of produtos) {
        const score = this.calculate(produto);
        await this.options.products.updateScore(produto.id, score, new Date());
        scores.push(score);
      }

      const produtosProcessados = scores.length;
      const maiorScore = produtosProcessados > 0 ? Math.max(...scores) : 0;
      const menorScore = produtosProcessados > 0 ? Math.min(...scores) : 0;
      const mediaScore =
        produtosProcessados > 0
          ? Number((scores.reduce((total, score) => total + score, 0) / produtosProcessados).toFixed(2))
          : 0;
      const resultado = {
        produtosProcessados,
        maiorScore,
        menorScore,
        mediaScore,
        tempoExecucao: `${Date.now() - inicio}ms`,
      };

      this.options.logger.info({ event: 'score.run.completed', ...resultado }, 'Score execution completed');
      return resultado;
    } catch (error) {
      this.options.logger.error({ event: 'score.run.failed', error }, 'Score execution failed');
      throw new AppError('Falha ao executar Score Engine', 'SCORE_RUN_FAILED');
    }
  }
}
