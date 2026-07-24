import type { FastifyBaseLogger } from 'fastify';
import type { HunterProvider } from '@shopee-auto-affiliate-ai/providers';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { ProductRepository } from './repositories';
import { toProductLeadData } from './repositories';

export type HunterRunResult = {
  encontrados: number;
  novos: number;
  atualizados: number;
  tempoExecucao: string;
};

export type HunterServiceOptions = {
  provider: HunterProvider;
  products: ProductRepository;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
};

export class HunterService {
  constructor(private readonly options: HunterServiceOptions) {}

  async run(filters?: ProductFilters): Promise<HunterRunResult> {
    const inicio = Date.now();
    this.options.logger.info({ event: 'hunter.run.started', filters }, 'Hunter execution started');

    try {
      const produtos = await this.options.provider.buscarProdutos(filters);
      let novos = 0;
      let atualizados = 0;

      for (const produto of produtos) {
        const existente =
          await this.options.products.findByProviderProductId(produto.id);
        const productData = toProductLeadData(produto);

        if (existente) {
          await this.options.products.updateByProviderProductId(
            produto.id,
            productData,
          );
          atualizados += 1;
        } else {
          await this.options.products.create(productData);
          novos += 1;
        }
      }

      const resultado = {
        encontrados: produtos.length,
        novos,
        atualizados,
        tempoExecucao: `${Date.now() - inicio}ms`,
      };

      this.options.logger.info({ event: 'hunter.run.completed', ...resultado }, 'Hunter execution completed');
      return resultado;
    } catch (error) {
      this.options.logger.error({ event: 'hunter.run.failed', error }, 'Hunter execution failed');
      throw new AppError('Falha ao executar Hunter Agent', 'HUNTER_RUN_FAILED');
    }
  }
}
